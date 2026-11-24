import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { app } from "../dist/app.js";
import { appDataSource } from "../dist/config/database.js";
import { User } from "../dist/entities/User.js";
import { Task } from "../dist/entities/Task.js";
import { TaskActivityEvent } from "../dist/entities/TaskActivityEvent.js";
import { UserTimeZoneVersion } from "../dist/entities/UserTimeZoneVersion.js";
import { localDateAt } from "../dist/services/time-zone.service.js";
import { Note } from "../dist/entities/Note.js";
import { Reminder } from "../dist/entities/Reminder.js";

test("friends APIs enforce ownership, serialize reciprocal requests, protect invitation tokens and aggregate privacy", async (context) => {
  if (process.env.RUN_DB_INTEGRATION !== "1") {
    context.skip("Set RUN_DB_INTEGRATION=1 after applying migrations to run database-backed Friends tests");
    return;
  }

  const createdUserIds = [];
  const prior = {
    access: process.env.JWT_ACCESS_SECRET,
    refresh: process.env.JWT_REFRESH_SECRET,
    encryption: process.env.INVITATION_LINK_ENCRYPTION_KEY,
    appBase: process.env.APP_BASE_URL,
  };
  let server;
  try {
    if (!appDataSource.isInitialized) await appDataSource.initialize();
    process.env.JWT_ACCESS_SECRET = "friends-integration-access-secret-at-least-32-characters";
    process.env.JWT_REFRESH_SECRET = "friends-integration-refresh-secret-at-least-32-characters";
    process.env.INVITATION_LINK_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.APP_BASE_URL = "https://productivity.example.test";
    const users = appDataSource.getRepository(User);
    const makeUser = async (username = null) => {
      const user = await users.save(users.create({
        email: `friends-${randomUUID()}@example.test`,
        username,
        password_hash: "integration-test-only-hash",
        first_name: username ?? "Existing",
        time_zone: "UTC",
      }));
      createdUserIds.push(user.id);
      return user;
    };
    const alice = await makeUser(`alice_${randomUUID().slice(0, 8)}`);
    const bob = await makeUser();
    const bobUsername = `bob_${randomUUID().slice(0, 8)}`;
    const charlie = await makeUser(`charlie_${randomUUID().slice(0, 8)}`);
    const [{ now }] = await appDataSource.query("SELECT transaction_timestamp() AS now");
    const reportDate = localDateAt(new Date(now), "UTC");
    await appDataSource.getRepository(UserTimeZoneVersion).save([
      { user_id: alice.id, version_no: 1, time_zone: "UTC", effective_from_date: reportDate, effective_at: new Date(now) },
      { user_id: bob.id, version_no: 1, time_zone: "UTC", effective_from_date: reportDate, effective_at: new Date(now) },
    ]);
    const secretTitle = `private task title ${randomUUID()}`;
    const task = await appDataSource.getRepository(Task).save(appDataSource.getRepository(Task).create({
      user_id: bob.id, routine_id: null, title: secretTitle, description: "private task description", task_date: reportDate,
      scheduled_time: "09:00:00", status: "pending", completed_at: null,
    }));
    await appDataSource.getRepository(TaskActivityEvent).save(appDataSource.getRepository(TaskActivityEvent).create({
      user_id: bob.id, task_id: task.id, event_sequence: 1, event_type: "created", event_at: new Date(now),
      activity_local_date: reportDate, time_zone: "UTC", task_title: secretTitle, task_description: "private task description",
      task_date: reportDate, scheduled_time: "09:00:00", status: "pending", completed_at: null,
      routine_id_snapshot: null, routine_occurrence_date: null, before_snapshot: null,
    }));
    const noteTitle = `private note title ${randomUUID()}`;
    const noteContent = `private note content ${randomUUID()}`;
    await appDataSource.getRepository(Note).save(appDataSource.getRepository(Note).create({ user_id: bob.id, title: noteTitle, content: noteContent }));
    const reminderTime = new Date(new Date(now).getTime() + 1_234_567);
    await appDataSource.getRepository(Reminder).save(appDataSource.getRepository(Reminder).create({
      user_id: bob.id, task_id: null, routine_id: null, scheduled_at: reminderTime, status: "scheduled", sent_at: null,
    }));
    const tokenFor = (id) => jwt.sign({ sub: String(id) }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });

    server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const api = (userId, path, init = {}) => fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${tokenFor(userId)}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });

    const registration = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `friends-register-${randomUUID()}@example.test`, password: "integration-test-password-987!",
        first_name: "New", last_name: "Member", username: `new_${randomUUID().slice(0, 8)}`,
      }),
    });
    assert.equal(registration.status, 201);
    const registered = await registration.json();
    createdUserIds.push(registered.user.id);
    assert.equal(registered.user.username.startsWith("new_"), true);
    assert.equal("password_hash" in registered.user, false);
    assert.equal(typeof registered.accessToken, "string");

    const setUsername = await api(bob.id, "/users/me/username", { method: "PATCH", body: JSON.stringify({ username: bobUsername }) });
    assert.equal(setUsername.status, 200);
    bob.username = bobUsername;
    const duplicateUsername = await api(bob.id, "/users/me/username", { method: "PATCH", body: JSON.stringify({ username: alice.username }) });
    assert.equal(duplicateUsername.status, 409);

    const selfRequest = await api(alice.id, "/friends/requests", { method: "POST", body: JSON.stringify({ receiverId: alice.id }) });
    assert.equal(selfRequest.status, 400);
    const cancelRequest = await api(alice.id, "/friends/requests", { method: "POST", body: JSON.stringify({ receiverId: charlie.id }) });
    assert.equal(cancelRequest.status, 201);
    const sentToCharlie = await api(alice.id, "/friends/requests/sent").then((response) => response.json());
    const cancellable = sentToCharlie.requests.find((request) => request.user.id === charlie.id);
    assert.ok(cancellable);
    assert.equal((await api(alice.id, `/friends/requests/${cancellable.id}`, { method: "DELETE" })).status, 200);
    const rejectRequest = await api(charlie.id, "/friends/requests", { method: "POST", body: JSON.stringify({ receiverId: alice.id }) });
    assert.equal(rejectRequest.status, 201);
    const receivedFromCharlie = await api(alice.id, "/friends/requests/received").then((response) => response.json());
    const rejectable = receivedFromCharlie.requests.find((request) => request.user.id === charlie.id);
    assert.ok(rejectable);
    assert.equal((await api(alice.id, `/friends/requests/${rejectable.id}/reject`, { method: "PATCH" })).status, 200);

    const search = await api(alice.id, `/friends/search?q=${encodeURIComponent(bob.username.slice(0, 5))}`);
    assert.equal(search.status, 200);
    assert.ok((await search.json()).users.some((user) => user.id === bob.id));

    const invitation = await api(alice.id, "/friends/invitation-link");
    assert.equal(invitation.status, 200);
    const invitationUrl = new URL((await invitation.json()).invitationLink);
    const invitationToken = invitationUrl.pathname.split("/").at(-1);
    assert.ok(invitationToken);
    const validate = await api(bob.id, `/friends/invitation/${invitationToken}`);
    assert.equal(validate.status, 200);
    assert.equal((await validate.json()).inviter.username, alice.username);
    const selfInvite = await api(alice.id, `/friends/invitation/${invitationToken}`);
    assert.equal(selfInvite.status, 400);

    const reciprocal = await Promise.all([
      api(alice.id, "/friends/requests", { method: "POST", body: JSON.stringify({ receiverId: bob.id }) }),
      api(bob.id, "/friends/requests", { method: "POST", body: JSON.stringify({ receiverId: alice.id }) }),
    ]);
    assert.deepEqual(reciprocal.map((response) => response.status).sort(), [201, 409]);
    const [receivedAlice, receivedBob] = await Promise.all([
      api(alice.id, "/friends/requests/received").then((response) => response.json()),
      api(bob.id, "/friends/requests/received").then((response) => response.json()),
    ]);
    const pending = receivedAlice.requests[0] ?? receivedBob.requests[0];
    assert.ok(pending?.id);
    const receiverId = receivedAlice.requests.length ? alice.id : bob.id;
    const stranger = receiverId === alice.id ? bob.id : alice.id;
    const wrongActor = await api(stranger, `/friends/requests/${pending.id}/accept`, { method: "PATCH" });
    assert.equal(wrongActor.status, 403);
    const accepted = await api(receiverId, `/friends/requests/${pending.id}/accept`, { method: "PATCH" });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).status, "accepted");

    const friendList = await api(alice.id, "/friends").then((response) => response.json());
    assert.ok(friendList.friends.some((friend) => friend.id === bob.id));
    const privateReport = await api(alice.id, `/friends/${bob.id}/productivity/daily?date=${reportDate}`);
    assert.equal(privateReport.status, 200);
    const safeReport = await privateReport.json();
    assert.equal(JSON.stringify(safeReport).includes(secretTitle), false);
    assert.equal(JSON.stringify(safeReport).includes("private task description"), false);
    assert.equal(JSON.stringify(safeReport).includes(noteTitle), false);
    assert.equal(JSON.stringify(safeReport).includes(noteContent), false);
    assert.equal(JSON.stringify(safeReport).includes(reminderTime.toISOString()), false);
    const weeklyFriendReport = await api(alice.id, `/friends/${bob.id}/productivity/weekly?startDate=${reportDate}`);
    const monthlyFriendReport = await api(alice.id, `/friends/${bob.id}/productivity/monthly?year=${reportDate.slice(0, 4)}&month=${Number(reportDate.slice(5, 7))}`);
    assert.equal(weeklyFriendReport.status, 200);
    assert.equal(monthlyFriendReport.status, 200);
    for (const response of [weeklyFriendReport, monthlyFriendReport]) {
      const body = await response.json();
      assert.ok(Array.isArray(body.daily));
      assert.equal(JSON.stringify(body).includes(secretTitle), false);
      assert.equal(JSON.stringify(body).includes(noteContent), false);
      assert.equal(JSON.stringify(body).includes(reminderTime.toISOString()), false);
    }
    assert.equal(JSON.stringify(safeReport).includes("description"), false);
    const weekly = await api(alice.id, "/friends/leaderboard?period=weekly");
    const monthly = await api(alice.id, "/friends/leaderboard?period=monthly");
    assert.equal(weekly.status, 200);
    assert.equal(monthly.status, 200);
    for (const response of [weekly, monthly]) {
      const body = await response.json();
      assert.ok(Array.isArray(body.leaderboard));
      assert.equal(JSON.stringify(body).includes("title"), false);
      assert.equal(JSON.stringify(body).includes("description"), false);
    }
    const inaccessible = await api(charlie.id, `/friends/${bob.id}/productivity/daily?date=${reportDate}`);
    assert.equal(inaccessible.status, 404);

    const removed = await api(alice.id, `/friends/${bob.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const revoked = await api(alice.id, `/friends/${bob.id}/productivity/daily?date=${reportDate}`);
    assert.equal(revoked.status, 404);

    const pendingBeforeBlock = await api(bob.id, "/friends/requests", { method: "POST", body: JSON.stringify({ receiverId: alice.id }) });
    assert.equal(pendingBeforeBlock.status, 201);
    const blocked = await api(alice.id, `/friends/${bob.id}/block`, { method: "POST" });
    assert.equal(blocked.status, 201);
    assert.equal((await api(alice.id, "/friends/requests/received").then((response) => response.json())).requests.some((request) => request.user.id === bob.id), false);
    const blockedRequest = await api(bob.id, "/friends/requests", { method: "POST", body: JSON.stringify({ receiverId: alice.id }) });
    assert.equal(blockedRequest.status, 403);
    assert.ok((await api(alice.id, "/friends/blocked").then((response) => response.json())).users.some((user) => user.id === bob.id));
    assert.equal((await api(alice.id, `/friends/${bob.id}/block`, { method: "DELETE" })).status, 200);

    assert.equal((await api(alice.id, "/friends/invitation-link", { method: "DELETE" })).status, 200);
    assert.equal((await api(bob.id, `/friends/invitation/${invitationToken}`)).status, 404);
    const replacementInvitation = await api(alice.id, "/friends/invitation-link").then((response) => response.json());
    const replacementToken = new URL(replacementInvitation.invitationLink).pathname.split("/").at(-1);
    assert.ok(replacementToken);
    assert.notEqual(replacementToken, invitationToken);
    assert.equal((await api(bob.id, `/friends/invitation/${replacementToken}`)).status, 200);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (appDataSource.isInitialized && createdUserIds.length) {
      await appDataSource.getRepository(User).delete(createdUserIds);
    }
    if (prior.access === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = prior.access;
    if (prior.refresh === undefined) delete process.env.JWT_REFRESH_SECRET; else process.env.JWT_REFRESH_SECRET = prior.refresh;
    if (prior.encryption === undefined) delete process.env.INVITATION_LINK_ENCRYPTION_KEY; else process.env.INVITATION_LINK_ENCRYPTION_KEY = prior.encryption;
    if (prior.appBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = prior.appBase;
  }
});
