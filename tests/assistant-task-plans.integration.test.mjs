import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { app } from "../dist/app.js";
import { appDataSource } from "../dist/config/database.js";
import { getGeminiClient } from "../dist/config/gemini.js";
import { AssistantConversation } from "../dist/entities/AssistantConversation.js";
import { AssistantMessage } from "../dist/entities/AssistantMessage.js";
import { AssistantTaskPlan } from "../dist/entities/AssistantTaskPlan.js";
import { AssistantTaskPlanItem } from "../dist/entities/AssistantTaskPlanItem.js";
import { Task } from "../dist/entities/Task.js";
import { TaskActivityEvent } from "../dist/entities/TaskActivityEvent.js";
import { User } from "../dist/entities/User.js";
import { UserTimeZoneVersion } from "../dist/entities/UserTimeZoneVersion.js";
import { localDateAt } from "../dist/services/time-zone.service.js";

test("daily task plans use existing chat, persist edits, and create tasks only on atomic approval", async (context) => {
  if (process.env.RUN_DB_INTEGRATION !== "1") {
    context.skip("Set RUN_DB_INTEGRATION=1 after applying the assistant task-plans migration");
    return;
  }

  const original = {
    access: process.env.JWT_ACCESS_SECRET,
    refresh: process.env.JWT_REFRESH_SECRET,
    geminiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL,
  };
  let server;
  const createdUserIds = [];
  let rollbackConstraint;
  let originalGenerate;
  let geminiClient;
  try {
    if (!appDataSource.isInitialized) await appDataSource.initialize();
    process.env.JWT_ACCESS_SECRET = "assistant-plan-integration-access-secret-32chars";
    process.env.JWT_REFRESH_SECRET = "assistant-plan-integration-refresh-secret-32chars";
    process.env.GEMINI_API_KEY = "assistant-plan-integration-fake-key";
    process.env.GEMINI_MODEL = "gemini-test-model";
    const users = appDataSource.getRepository(User);
    const user = await users.save(users.create({
      email: `assistant-plan-${randomUUID()}@example.test`,
      password_hash: "integration-test-only-hash",
      first_name: "Plan",
      time_zone: "UTC",
    }));
    createdUserIds.push(user.id);
    const [{ now }] = await appDataSource.query("SELECT transaction_timestamp() AS now");
    const localToday = localDateAt(new Date(now), "UTC");
    const planDate = new Date(`${localToday}T00:00:00.000Z`);
    planDate.setUTCDate(planDate.getUTCDate() + 2);
    const selectedDate = planDate.toISOString().slice(0, 10);
    await appDataSource.getRepository(UserTimeZoneVersion).save({
      user_id: user.id,
      version_no: 1,
      time_zone: "UTC",
      effective_from_date: localToday,
      effective_at: new Date(new Date(now).getTime() - 86_400_000),
    });

    const client = getGeminiClient();
    geminiClient = client;
    originalGenerate = client.models.generateContent;
    const queuedResponses = [];
    client.models.generateContent = async () => {
      const next = queuedResponses.shift();
      assert.ok(next, "test supplied a deterministic Gemini response");
      return next;
    };

    server = app.listen(0);
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}/api/assistant`;
    const ownerToken = jwt.sign({ sub: String(user.id) }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    const otherUser = await users.save(users.create({
      email: `assistant-plan-other-${randomUUID()}@example.test`,
      password_hash: "integration-test-only-hash",
      time_zone: "UTC",
    }));
    createdUserIds.push(otherUser.id);
    const otherToken = jwt.sign({ sub: String(otherUser.id) }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    const api = (token, path, init = {}) => fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });
    const chat = (token, message, conversationId) => api(token, "/chat", {
      method: "POST",
      body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
    });
    const functionCall = (args) => ({
      functionCalls: [{ id: randomUUID(), name: "save_daily_task_plan", args }],
      candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "save_daily_task_plan", args } }] } }],
    });
    const finalText = (text) => ({ text, candidates: [{ content: { role: "model", parts: [{ text }] } }] });

    const taskRepository = appDataSource.getRepository(Task);
    const eventRepository = appDataSource.getRepository(TaskActivityEvent);
    const initialTaskCount = await taskRepository.countBy({ user_id: user.id });
    queuedResponses.push(finalText("What date would you like me to plan for?"));
    const missingDateStart = await chat(ownerToken, "Help me plan my day", undefined);
    assert.equal(missingDateStart.status, 200);
    const clarification = await missingDateStart.json();
    assert.equal(clarification.metadata, null);
    assert.ok(clarification.conversationId);
    assert.equal(await taskRepository.countBy({ user_id: user.id }), initialTaskCount);

    const plannedConversationId = clarification.conversationId;
    const plannedResponseArgs = {
      planDate: selectedDate,
      tasks: [
        { title: "Exercise", description: "Short workout", startTime: "07:00", durationMinutes: 30 },
        { title: "JavaScript study", description: "Practice functions", startTime: "09:00", durationMinutes: 60 },
      ],
    };
    queuedResponses.push(functionCall(plannedResponseArgs), finalText("I drafted a schedule. Review it below."));
    const plannedResponse = await chat(ownerToken, `Plan exercise and JavaScript study for ${selectedDate}`, plannedConversationId);
    assert.equal(plannedResponse.status, 200);
    const generated = await plannedResponse.json();
    assert.equal(generated.metadata.type, "daily_task_plan");
    assert.equal(generated.metadata.plan.status, "draft");
    assert.equal(generated.metadata.plan.planDate, selectedDate);
    assert.deepEqual(generated.metadata.actions, ["add_all_tasks", "edit_plan", "regenerate_plan"]);
    assert.equal(generated.metadata.plan.tasks.length, 2);
    assert.equal(await taskRepository.countBy({ user_id: user.id }), initialTaskCount, "draft generation must not create live tasks");
    assert.equal(await appDataSource.getRepository(AssistantTaskPlan).countBy({ user_id: user.id, status: "draft" }), 1);

    const modifiedArgs = {
      planId: generated.metadata.plan.id,
      planDate: selectedDate,
      tasks: [
        { title: "Exercise", description: "Short workout", startTime: "08:00", durationMinutes: 30 },
        { title: "JavaScript study", description: "Practice functions", startTime: "09:00", durationMinutes: 90 },
      ],
    };
    queuedResponses.push(functionCall(modifiedArgs), finalText("I moved exercise and gave JavaScript another half hour."));
    const modifiedResponse = await chat(ownerToken, "Move exercise to 8 AM and give JavaScript another half hour", plannedConversationId);
    assert.equal(modifiedResponse.status, 200);
    const modified = await modifiedResponse.json();
    assert.equal(modified.metadata.plan.id, generated.metadata.plan.id);
    assert.equal(modified.metadata.plan.tasks[0].startTime, "08:00");
    assert.equal(modified.metadata.plan.tasks[1].durationMinutes, 90);
    assert.equal(await appDataSource.getRepository(AssistantTaskPlan).countBy({ user_id: user.id, status: "draft" }), 1);

    queuedResponses.push(functionCall({
      planId: generated.metadata.plan.id,
      planDate: selectedDate,
      tasks: [
        { title: "Overlap one", startTime: "09:00", durationMinutes: 90 },
        { title: "Overlap two", startTime: "09:30", durationMinutes: 30 },
      ],
    }), finalText("Those times overlap. Which task would you like to move?"));
    const invalidEdit = await chat(ownerToken, "Add overlapping tasks", plannedConversationId);
    assert.equal(invalidEdit.status, 200);
    assert.equal((await invalidEdit.json()).metadata, null);
    const currentDraftItems = await appDataSource.getRepository(AssistantTaskPlanItem).find({
      where: { plan_id: generated.metadata.plan.id }, order: { sort_order: "ASC" },
    });
    assert.equal(currentDraftItems[0]?.start_time.slice(0, 5), "08:00", "invalid edits must not alter the existing draft");

    const otherApproval = await api(otherToken, `/plans/${generated.metadata.plan.id}/approve`, { method: "POST" });
    assert.equal(otherApproval.status, 404);

    await users.update({ id: user.id }, { time_zone: "America/Los_Angeles" });
    await appDataSource.getRepository(UserTimeZoneVersion).save({
      user_id: user.id,
      version_no: 2,
      time_zone: "America/Los_Angeles",
      effective_from_date: selectedDate,
      effective_at: new Date(now),
    });
    const oldZoneApproval = await api(ownerToken, `/plans/${generated.metadata.plan.id}/approve`, { method: "POST" });
    assert.equal(oldZoneApproval.status, 409, "approval must detect a timezone change that affects the plan date");
    assert.equal(await taskRepository.countBy({ user_id: user.id }), initialTaskCount);

    queuedResponses.push(functionCall(modifiedArgs), finalText("I updated the draft for your new timezone."));
    const rezoneResponse = await chat(ownerToken, "Keep this plan in my current local timezone", plannedConversationId);
    assert.equal(rezoneResponse.status, 200);
    const rezoned = await rezoneResponse.json();
    assert.equal(rezoned.metadata.plan.timeZone, "America/Los_Angeles");

    const sentinel = `FORCE_PLAN_ROLLBACK_${randomUUID().replaceAll("-", "")}`;
    rollbackConstraint = `ck_plan_rollback_${user.id}`;
    await appDataSource.query(`ALTER TABLE "tasks" ADD CONSTRAINT "${rollbackConstraint}" CHECK ("title" <> '${sentinel}')`);
    queuedResponses.push(functionCall({
      planId: generated.metadata.plan.id,
      planDate: selectedDate,
      tasks: [
        { title: "This insertion should roll back", startTime: "08:00", durationMinutes: 15 },
        { title: sentinel, startTime: "09:00", durationMinutes: 15 },
      ],
    }), finalText("The draft is ready to approve."));
    const rollbackDraftResponse = await chat(ownerToken, "Replace these tasks with a pair for rollback testing", plannedConversationId);
    assert.equal(rollbackDraftResponse.status, 200);
    const rollbackDraft = await rollbackDraftResponse.json();
    const beforeFailedApprovalTasks = await taskRepository.countBy({ user_id: user.id });
    const beforeFailedApprovalEvents = await eventRepository.countBy({ user_id: user.id });
    const failedApproval = await api(ownerToken, `/plans/${generated.metadata.plan.id}/approve`, { method: "POST" });
    assert.equal(failedApproval.status, 500);
    assert.equal(await taskRepository.countBy({ user_id: user.id }), beforeFailedApprovalTasks);
    assert.equal(await eventRepository.countBy({ user_id: user.id }), beforeFailedApprovalEvents);
    assert.equal(await appDataSource.getRepository(AssistantTaskPlan).countBy({ id: rollbackDraft.metadata.plan.id, status: "draft" }), 1);
    await appDataSource.query(`ALTER TABLE "tasks" DROP CONSTRAINT "${rollbackConstraint}"`);
    rollbackConstraint = undefined;

    const approvedResponse = await api(ownerToken, `/plans/${generated.metadata.plan.id}/approve`, { method: "POST" });
    assert.equal(approvedResponse.status, 200);
    const approved = await approvedResponse.json();
    assert.equal(approved.tasks.length, 2);
    assert.equal(approved.metadata.status, "approved");
    assert.equal(await taskRepository.countBy({ user_id: user.id }), initialTaskCount + 2);
    assert.equal(await eventRepository.countBy({ user_id: user.id }), beforeFailedApprovalEvents + 2);
    assert.equal((await eventRepository.find({ where: { user_id: user.id }, order: { id: "ASC" } })).every((event) => event.event_type === "created"), true);
    const duplicateApproval = await api(ownerToken, `/plans/${generated.metadata.plan.id}/approve`, { method: "POST" });
    assert.equal(duplicateApproval.status, 409);
    assert.equal(await taskRepository.countBy({ user_id: user.id }), initialTaskCount + 2);

    const historyResponse = await api(ownerToken, `/conversations/${plannedConversationId}`);
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.ok(history.messages.some((message) => message.metadata?.type === "daily_task_plan"));
    assert.ok(history.messages.some((message) => message.metadata?.type === "task_plan_approval"));

    queuedResponses.push(functionCall({
      planDate: "2027-03-14",
      tasks: [{ title: "Nonexistent local time", startTime: "02:30", durationMinutes: 30 }],
    }), finalText("02:30 does not exist on that date in your timezone."));
    const dstResponse = await chat(ownerToken, "Plan a task at 2:30 AM on March 14, 2027");
    assert.equal(dstResponse.status, 200);
    const dstResult = await dstResponse.json();
    assert.equal(dstResult.metadata, null);
    assert.equal(await appDataSource.getRepository(AssistantTaskPlan).countBy({ user_id: user.id, conversation_id: dstResult.conversationId }), 0);
  } finally {
    if (rollbackConstraint && appDataSource.isInitialized) {
      await appDataSource.query(`ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "${rollbackConstraint}"`).catch(() => undefined);
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    if (geminiClient && originalGenerate) geminiClient.models.generateContent = originalGenerate;
    if (appDataSource.isInitialized) {
      if (createdUserIds.length) await appDataSource.getRepository(User).delete(createdUserIds);
      await appDataSource.destroy();
    }
    if (original.access === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = original.access;
    if (original.refresh === undefined) delete process.env.JWT_REFRESH_SECRET; else process.env.JWT_REFRESH_SECRET = original.refresh;
    if (original.geminiKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = original.geminiKey;
    if (original.geminiModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = original.geminiModel;
  }
});
