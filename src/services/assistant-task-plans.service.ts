import { randomUUID } from "node:crypto";
import { Type, type FunctionDeclaration } from "@google/genai";
import { QueryFailedError, type EntityManager } from "typeorm";
import { appDataSource } from "../config/database.js";
import { AssistantConversation } from "../entities/AssistantConversation.js";
import { AssistantTaskPlan } from "../entities/AssistantTaskPlan.js";
import { AssistantTaskPlanItem } from "../entities/AssistantTaskPlanItem.js";
import { AssistantMessage } from "../entities/AssistantMessage.js";
import { User } from "../entities/User.js";
import { createTaskInTransaction } from "./task.service.js";
import { databaseNow, getActiveTimeZone, getTimeZoneForDate, localDateAt } from "./time-zone.service.js";
import { z } from "zod";

const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return year! >= 1000 && year! <= 9998
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day;
};

const planDateSchema = z.string().refine(validDate, "Choose a valid calendar date in YYYY-MM-DD format");
const planItemSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(500).nullable().optional(),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Start times must use local 24-hour HH:mm format"),
  durationMinutes: z.number().int().min(1).max(720),
}).strict();
const planArgumentsSchema = z.object({
  planId: z.string().uuid().optional(),
  planDate: planDateSchema,
  tasks: z.array(planItemSchema).min(1).max(12),
}).strict();

export type PlanItemInput = z.infer<typeof planItemSchema>;
export interface PendingTaskPlan {
  planId: string;
  existingPlanId: string | null;
  expectedUpdatedAt: number | null;
  planDate: string;
  timeZone: string;
  tasks: Array<PlanItemInput & { id: string; sortOrder: number }>;
}
export interface DraftPlanSummary {
  id: string;
  plan_date: string;
  updated_at: Date;
  time_zone: string;
  items: Array<{
    id: string;
    title: string;
    description: string | null;
    start_time: string;
    duration_minutes: number;
    sort_order: number;
  }>;
}

export class AssistantPlanValidationError extends Error {
  constructor(message = "The proposed plan contains invalid dates, times, or overlapping tasks") {
    super(message);
    this.name = "AssistantPlanValidationError";
  }
}
export class AssistantPlanNotFoundError extends Error {
  constructor() { super("Task plan not found"); this.name = "AssistantPlanNotFoundError"; }
}
export class AssistantPlanNotDraftError extends Error {
  constructor() { super("This plan is no longer a draft and cannot be approved"); this.name = "AssistantPlanNotDraftError"; }
}
export class AssistantPlanConflictError extends Error {
  constructor() { super("This draft changed while you were editing it. Reload the conversation and try again"); this.name = "AssistantPlanConflictError"; }
}

export const dailyTaskPlanFunctionDeclaration: FunctionDeclaration = {
  name: "save_daily_task_plan",
  description: "Prepare or conversationally update a draft of one-time daily tasks. This does not create real tasks. Ask the user for the date and missing activity details before calling this function. Preserve the supplied planId when modifying a supplied draft. Include the complete updated task list; times are local to the authenticated user's timezone.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      planId: { type: Type.STRING, description: "Exact draft plan UUID from the assistant context when editing an existing draft. Omit for a new draft." },
      planDate: { type: Type.STRING, description: "Local calendar date in YYYY-MM-DD format. Required." },
      tasks: {
        type: Type.ARRAY,
        description: "Complete proposed schedule, with no overlapping items. Include each task and break as an item.",
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Task or break title, at most 255 characters." },
            description: { type: Type.STRING, description: "Optional short task description." },
            startTime: { type: Type.STRING, description: "Local 24-hour time in HH:mm format." },
            durationMinutes: { type: Type.INTEGER, description: "Positive estimated duration, at most 720 minutes." },
          },
          required: ["title", "startTime", "durationMinutes"],
        },
      },
    },
    required: ["planDate", "tasks"],
  },
};

function datePlusDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function sortAndValidateOverlap(tasks: PlanItemInput[]): Array<PlanItemInput & { sortOrder: number }> {
  const sorted = tasks.map((task, inputOrder) => ({ ...task, inputOrder, startMinute: Number(task.startTime.slice(0, 2)) * 60 + Number(task.startTime.slice(3, 5)) }))
    .sort((left, right) => left.startMinute - right.startMinute || left.inputOrder - right.inputOrder);
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const endMinute = current.startMinute + current.durationMinutes;
    if (endMinute > 24 * 60) throw new AssistantPlanValidationError(`“${current.title}” would continue past the selected calendar day`);
    const next = sorted[index + 1];
    if (next && endMinute > next.startMinute) throw new AssistantPlanValidationError(`“${current.title}” overlaps “${next.title}”`);
  }
  return sorted.map(({ inputOrder: _inputOrder, startMinute: _startMinute, ...task }, sortOrder) => ({ ...task, sortOrder }));
}

export function validatePlanInput(input: unknown): {
  planId?: string;
  planDate: string;
  tasks: Array<PlanItemInput & { sortOrder: number }>;
} {
  const parsed = planArgumentsSchema.safeParse(input);
  if (!parsed.success) {
    throw new AssistantPlanValidationError("Provide a valid plan date and between 1 and 12 tasks with a title, local start time, and positive duration");
  }
  return {
    ...(parsed.data.planId ? { planId: parsed.data.planId } : {}),
    planDate: parsed.data.planDate,
    tasks: sortAndValidateOverlap(parsed.data.tasks),
  };
}

async function validatePlanInManager(
  manager: EntityManager,
  userId: number,
  planDate: string,
  tasks: PlanItemInput[],
): Promise<{ timeZone: string; tasks: Array<PlanItemInput & { sortOrder: number }> }> {
  const normalizedTasks = sortAndValidateOverlap(tasks);
  const now = await databaseNow(manager);
  const activeTimeZone = await getActiveTimeZone(manager, userId, now);
  const localToday = localDateAt(now, activeTimeZone);
  if (planDate < localToday) throw new AssistantPlanValidationError("Plans can only be created for today or a future local date");
  if (planDate > datePlusDays(localToday, 365)) throw new AssistantPlanValidationError("Choose a date within the next 365 days");
  const timeZone = await getTimeZoneForDate(manager, userId, planDate);

  for (const task of normalizedTasks) {
    const [row] = await manager.query(`
      SELECT ((($1::DATE + $2::TIME) AT TIME ZONE $3) AT TIME ZONE $3) = ($1::DATE + $2::TIME) AS valid_local_time
    `, [planDate, task.startTime, timeZone]) as Array<{ valid_local_time: boolean }>;
    if (!row?.valid_local_time) {
      throw new AssistantPlanValidationError(`${task.startTime} does not exist on ${planDate} in your ${timeZone} timezone because of a clock change`);
    }
  }
  return { timeZone, tasks: normalizedTasks };
}

export async function prepareDailyPlanTool(
  userId: number,
  input: unknown,
  drafts: DraftPlanSummary[],
): Promise<{ pending: PendingTaskPlan; preview: Record<string, unknown> }> {
  const parsed = validatePlanInput(input);

  let selectedDraft: DraftPlanSummary | undefined;
  if (parsed.planId) {
    selectedDraft = drafts.find((draft) => draft.id === parsed.planId);
    if (!selectedDraft) throw new AssistantPlanConflictError();
  } else {
    selectedDraft = drafts.find((draft) => draft.plan_date === parsed.planDate);
  }

  const validated = await appDataSource.transaction("REPEATABLE READ", async (manager) => {
    await manager.query("SET TRANSACTION READ ONLY");
    return validatePlanInManager(manager, userId, parsed.planDate, parsed.tasks);
  });
  const pending: PendingTaskPlan = {
    planId: selectedDraft?.id ?? randomUUID(),
    existingPlanId: selectedDraft?.id ?? null,
    expectedUpdatedAt: selectedDraft?.updated_at.getTime() ?? null,
    planDate: parsed.planDate,
    timeZone: validated.timeZone,
    tasks: validated.tasks.map((task) => ({ ...task, id: randomUUID(), sortOrder: task.sortOrder })),
  };
  return { pending, preview: planPreview(pending) };
}

export function planPreview(plan: PendingTaskPlan | AssistantTaskPlan & { items: AssistantTaskPlanItem[] }, timeZone?: string) {
  const isPending = "planDate" in plan;
  const planId = isPending ? plan.planId : plan.id;
  const planDate = isPending ? plan.planDate : plan.plan_date;
  const zone = isPending ? plan.timeZone : timeZone ?? "UTC";
  const tasks = isPending
    ? plan.tasks.map((task) => ({ id: task.id, title: task.title, description: task.description ?? null, startTime: task.startTime, durationMinutes: task.durationMinutes, sortOrder: task.sortOrder }))
    : plan.items.map((task) => ({ id: task.id, title: task.title, description: task.description, startTime: task.start_time.slice(0, 5), durationMinutes: task.duration_minutes, sortOrder: task.sort_order }));
  return {
    type: "daily_task_plan",
    plan: { id: planId, planDate, timeZone: zone, status: "draft", tasks },
    actions: ["add_all_tasks", "edit_plan", "regenerate_plan"],
  };
}

async function lockOrCreateConversation(
  manager: EntityManager,
  userId: number,
  conversationId: string,
  conversationTitle: string,
): Promise<AssistantConversation> {
  const conversations = manager.getRepository(AssistantConversation);
  let conversation = await conversations.findOne({ where: { id: conversationId }, lock: { mode: "pessimistic_write" } });
  if (conversation && conversation.user_id !== userId) throw new AssistantPlanNotFoundError();
  if (!conversation) {
    const userExists = await manager.getRepository(User).exist({ where: { id: userId } });
    if (!userExists) throw new AssistantPlanNotFoundError();
    conversation = conversations.create({ id: conversationId, user_id: userId, title: conversationTitle.trim().slice(0, 160) });
    await conversations.save(conversation);
    conversation = await conversations.findOne({ where: { id: conversationId, user_id: userId }, lock: { mode: "pessimistic_write" } });
  }
  if (!conversation) throw new AssistantPlanNotFoundError();
  return conversation;
}

export async function saveDraftPlanInTransaction(
  manager: EntityManager,
  userId: number,
  conversationId: string,
  conversationTitle: string,
  pending: PendingTaskPlan,
): Promise<Record<string, unknown>> {
  await lockOrCreateConversation(manager, userId, conversationId, conversationTitle);
  const validated = await validatePlanInManager(manager, userId, pending.planDate, pending.tasks);
  const plans = manager.getRepository(AssistantTaskPlan);
  let plan: AssistantTaskPlan | null = null;
  if (pending.existingPlanId) {
    plan = await plans.findOne({
      where: { id: pending.existingPlanId, user_id: userId, conversation_id: conversationId },
      lock: { mode: "pessimistic_write" },
    });
    if (!plan) throw new AssistantPlanConflictError();
    if (plan.status !== "draft") throw new AssistantPlanNotDraftError();
    if (pending.expectedUpdatedAt !== null && plan.updated_at.getTime() !== pending.expectedUpdatedAt) {
      throw new AssistantPlanConflictError();
    }
  } else {
    plan = await plans.findOne({
      where: { user_id: userId, conversation_id: conversationId, plan_date: pending.planDate, status: "draft" },
      lock: { mode: "pessimistic_write" },
    });
  }
  if (!plan) plan = plans.create({ id: pending.planId, user_id: userId, conversation_id: conversationId, plan_date: pending.planDate, time_zone: validated.timeZone, status: "draft" });
  else {
    plan.plan_date = pending.planDate;
    plan.time_zone = validated.timeZone;
  }
  await plans.save(plan);

  const items = manager.getRepository(AssistantTaskPlanItem);
  await items.delete({ plan_id: plan.id });
  await items.insert(validated.tasks.map((task) => ({
    id: randomUUID(),
    plan_id: plan!.id,
    title: task.title,
    description: task.description ?? null,
    start_time: task.startTime,
    duration_minutes: task.durationMinutes,
    sort_order: task.sortOrder,
  })));
  const savedItems = await items.find({ where: { plan_id: plan.id }, order: { sort_order: "ASC" } });
  return planPreview({ ...plan, items: savedItems }, validated.timeZone);
}

export async function approveAssistantTaskPlan(userId: number, planId: string): Promise<{
  message: string;
  metadata: Record<string, unknown>;
  tasks: Array<Record<string, unknown>>;
}> {
  return appDataSource.transaction(async (manager) => {
    const plans = manager.getRepository(AssistantTaskPlan);
    const initial = await plans.findOneBy({ id: planId, user_id: userId });
    if (!initial) throw new AssistantPlanNotFoundError();
    await manager.getRepository(AssistantConversation).findOne({
      where: { id: initial.conversation_id, user_id: userId },
      lock: { mode: "pessimistic_write" },
    }).then((conversation) => { if (!conversation) throw new AssistantPlanNotFoundError(); });
    const plan = await plans.findOne({ where: { id: planId, user_id: userId, conversation_id: initial.conversation_id }, lock: { mode: "pessimistic_write" } });
    if (!plan) throw new AssistantPlanNotFoundError();
    if (plan.status !== "draft") throw new AssistantPlanNotDraftError();
    const itemsRepository = manager.getRepository(AssistantTaskPlanItem);
    const items = await itemsRepository.find({ where: { plan_id: plan.id }, order: { sort_order: "ASC" } });
    const normalized = planArgumentsSchema.safeParse({
      planDate: plan.plan_date,
      tasks: items.map((item) => ({ title: item.title, description: item.description, startTime: item.start_time.slice(0, 5), durationMinutes: item.duration_minutes })),
    });
    if (!normalized.success) throw new AssistantPlanValidationError("The saved draft contains invalid task data");
    const validated = await validatePlanInManager(manager, userId, plan.plan_date, normalized.data.tasks);
    if (validated.timeZone !== plan.time_zone) {
      throw new AssistantPlanConflictError();
    }
    const createdTasks: Array<Record<string, unknown>> = [];
    for (const item of validated.tasks) {
      const task = await createTaskInTransaction(manager, userId, {
        title: item.title,
        description: item.description ?? undefined,
        task_date: plan.plan_date,
        scheduled_time: `${item.startTime}:00`,
      });
      createdTasks.push({
        id: task.id,
        title: task.title,
        description: task.description,
        task_date: task.task_date,
        scheduled_time: task.scheduled_time,
        status: task.status,
        estimated_duration_minutes: item.durationMinutes,
      });
    }
    plan.status = "approved";
    await plans.save(plan);
    const message = `Added ${createdTasks.length} tasks to your tasks for ${plan.plan_date}.`;
    const metadata = {
      type: "task_plan_approval",
      planId: plan.id,
      planDate: plan.plan_date,
      status: "approved",
      createdTasks,
    };
    await manager.getRepository(AssistantMessage).save(manager.getRepository(AssistantMessage).create({
      conversation_id: plan.conversation_id,
      role: "assistant",
      content: message,
      metadata,
    }));
    await manager.getRepository(AssistantConversation).createQueryBuilder().update()
      .set({ updated_at: () => "CURRENT_TIMESTAMP" })
      .where('"id" = :conversationId AND "user_id" = :userId', { conversationId: plan.conversation_id, userId }).execute();
    return { message, metadata, tasks: createdTasks };
  });
}

export function isUniquePlanConflict(error: unknown): boolean {
  return error instanceof QueryFailedError && (error.driverError as { code?: string }).code === "23505";
}
