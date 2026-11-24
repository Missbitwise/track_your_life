import { Type, type FunctionDeclaration } from "@google/genai";
import { Between, type EntityManager } from "typeorm";
import { z } from "zod";
import { appDataSource } from "../config/database.js";
import { Reminder } from "../entities/Reminder.js";
import { Task } from "../entities/Task.js";
import { UserTimeZoneVersion } from "../entities/UserTimeZoneVersion.js";
import {
  getDailyProductivity,
  getDailyProductivityRange,
  getMonthlyProductivity,
  getWeeklyProductivity,
  type DailyAnalyticsReport,
} from "./analytics.service.js";

const calendarDateSchema = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return year! >= 1000 && year! <= 9998
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day;
};

const date = z.string().refine(calendarDateSchema, "Use a valid YYYY-MM-DD date");
const dateRangeFields = { startDate: date, endDate: date };

function rangeWithin(maxDays: number) {
  return (range: { startDate: string; endDate: string }) => {
    if (range.startDate > range.endDate) return false;
    const start = new Date(`${range.startDate}T00:00:00.000Z`);
    const end = new Date(`${range.endDate}T00:00:00.000Z`);
    return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1 <= maxDays;
  };
}

const productivityReportArguments = z.discriminatedUnion("period", [
  z.object({ period: z.literal("daily"), date }).strict(),
  z.object({ period: z.literal("weekly"), startDate: date }).strict(),
  z.object({
    period: z.literal("monthly"),
    year: z.number().int().min(1000).max(9998),
    month: z.number().int().min(1).max(12),
  }).strict(),
]);

const incompleteTaskArguments = z.object({
  ...dateRangeFields,
  limit: z.number().int().min(1).max(20).default(10),
}).strict().refine(rangeWithin(31), "Date range cannot exceed 31 days");

const postponementArguments = z.object({
  ...dateRangeFields,
  limit: z.number().int().min(1).max(20).default(10),
}).strict().refine(rangeWithin(90), "Date range cannot exceed 90 days");

const routinePatternArguments = z.object(dateRangeFields)
  .strict()
  .refine(rangeWithin(31), "Date range cannot exceed 31 days");

const scheduleContextArguments = z.object({ date }).strict();

export type AssistantToolName =
  | "get_productivity_report"
  | "get_incomplete_tasks"
  | "get_task_postponements"
  | "get_routine_patterns"
  | "get_schedule_context";

export class AssistantToolArgumentError extends Error {
  constructor() {
    super("Tool arguments are invalid");
    this.name = "AssistantToolArgumentError";
  }
}

export class AssistantToolUnavailableError extends Error {
  constructor() {
    super("The requested assistant tool is unavailable");
    this.name = "AssistantToolUnavailableError";
  }
}

export const assistantFunctionDeclarations: FunctionDeclaration[] = [
  {
    name: "get_productivity_report",
    description: "Get the authenticated user's daily, weekly, or monthly historical productivity summary.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        period: { type: Type.STRING, enum: ["daily", "weekly", "monthly"] },
        date: { type: Type.STRING, description: "Required for daily reports. YYYY-MM-DD." },
        startDate: { type: Type.STRING, description: "Required for weekly reports. YYYY-MM-DD." },
        year: { type: Type.INTEGER, description: "Required for monthly reports. Four digit year." },
        month: { type: Type.INTEGER, description: "Required for monthly reports, 1 through 12." },
      },
      required: ["period"],
    },
  },
  {
    name: "get_incomplete_tasks",
    description: "List current pending tasks scheduled within a bounded date range. This reads task rows and never generates routine tasks.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        startDate: { type: Type.STRING, description: "YYYY-MM-DD, inclusive." },
        endDate: { type: Type.STRING, description: "YYYY-MM-DD, inclusive; at most 31 days after startDate." },
        limit: { type: Type.INTEGER, description: "Maximum results, 1 through 20; defaults to 10." },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "get_task_postponements",
    description: "Summarize actual task rescheduled events recorded in the authenticated user's history. Baseline data is not treated as a postponement.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        startDate: { type: Type.STRING, description: "YYYY-MM-DD local activity date, inclusive." },
        endDate: { type: Type.STRING, description: "YYYY-MM-DD local activity date, inclusive; range cannot exceed 90 days." },
        limit: { type: Type.INTEGER, description: "Maximum results, 1 through 20; defaults to 10." },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "get_routine_patterns",
    description: "Analyze expected routine occurrences and their completion status over at most 31 local calendar dates using historical routine versions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        startDate: { type: Type.STRING, description: "YYYY-MM-DD, inclusive." },
        endDate: { type: Type.STRING, description: "YYYY-MM-DD, inclusive; at most 31 days after startDate." },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "get_schedule_context",
    description: "Get the user's scheduled tasks and scheduled reminders for one date, using historical timezone boundaries.",
    parameters: {
      type: Type.OBJECT,
      properties: { date: { type: Type.STRING, description: "YYYY-MM-DD." } },
      required: ["date"],
    },
  },
];

async function inReadOnlyTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
  return appDataSource.transaction("REPEATABLE READ", async (manager) => {
    await manager.query("SET TRANSACTION READ ONLY");
    return work(manager);
  });
}

function rangeDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let current = new Date(`${startDate}T00:00:00.000Z`);
    current <= new Date(`${endDate}T00:00:00.000Z`);
    current.setUTCDate(current.getUTCDate() + 1)) {
    dates.push(`${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-${String(current.getUTCDate()).padStart(2, "0")}`);
  }
  return dates;
}

function summarizeDailyReport(report: DailyAnalyticsReport) {
  const stats = report.scheduledProductivity;
  return {
    date: report.date,
    timeZone: report.timeZone,
    coverage: report.coverage,
    scheduledProductivity: stats === null ? null : {
      totalTasks: stats.totalTasks,
      completedTasks: stats.completedTasks,
      incompleteTasks: stats.incompleteTasks,
      completionPercentage: stats.completionPercentage,
      tasks: stats.tasks.slice(0, 20),
      tasksTruncated: stats.tasks.length > 20,
    },
    actualCompletionActivity: {
      completedTasks: report.actualCompletionActivity.completedTasks.slice(0, 20),
      lateCompletions: report.actualCompletionActivity.lateCompletions.slice(0, 20),
      reopenedTasks: report.actualCompletionActivity.reopenedTasks.slice(0, 20),
    },
  };
}

async function getProductivityReport(userId: number, input: unknown): Promise<unknown> {
  const parsed = productivityReportArguments.safeParse(input);
  if (!parsed.success) throw new AssistantToolArgumentError();

  if (parsed.data.period === "daily") {
    return summarizeDailyReport(await getDailyProductivity(userId, parsed.data.date));
  }

  if (parsed.data.period === "weekly") {
    const report = await getWeeklyProductivity(userId, parsed.data.startDate);
    return {
      period: "weekly",
      startDate: report.startDate,
      endDate: report.endDate,
      totals: report.totals,
      coverage: report.coverage,
      mostProductiveDay: report.mostProductiveDay,
      leastProductiveDay: report.leastProductiveDay,
      comparison: report.comparison,
      daily: report.daily.map(summarizeDailyReport),
    };
  }

  const report = await getMonthlyProductivity(userId, parsed.data.year, parsed.data.month);
  return {
    period: "monthly",
    year: report.year,
    month: report.month,
    startDate: report.startDate,
    endDate: report.endDate,
    totals: report.totals,
    coverage: report.coverage,
    mostProductiveDay: report.mostProductiveDay,
    leastProductiveDay: report.leastProductiveDay,
    comparison: report.comparison,
    daily: report.daily.map(summarizeDailyReport),
  };
}

async function getIncompleteTasks(userId: number, input: unknown): Promise<unknown> {
  const parsed = incompleteTaskArguments.safeParse(input);
  if (!parsed.success) throw new AssistantToolArgumentError();
  const { startDate, endDate, limit } = parsed.data;
  const tasks = await inReadOnlyTransaction((manager) => manager.getRepository(Task).find({
    where: { user_id: userId, status: "pending", task_date: Between(startDate, endDate) },
    select: { id: true, title: true, task_date: true, scheduled_time: true, status: true },
    order: { task_date: "ASC", scheduled_time: "ASC", id: "ASC" },
    take: limit,
  }));

  return {
    state: "current pending task rows",
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      scheduledDate: task.task_date,
      scheduledTime: task.scheduled_time,
      status: task.status,
    })),
  };
}

interface PostponementRow {
  task_id: number;
  reschedule_count: number;
  task_title: string;
  task_date: string;
  scheduled_time: string | null;
  status: "pending" | "completed";
}

async function getTaskPostponements(userId: number, input: unknown): Promise<unknown> {
  const parsed = postponementArguments.safeParse(input);
  if (!parsed.success) throw new AssistantToolArgumentError();
  const { startDate, endDate, limit } = parsed.data;

  const rows = await inReadOnlyTransaction((manager) => manager.query(`
    WITH latest AS (
      SELECT DISTINCT ON (event."task_id") event."task_id", event."event_type",
        event."task_title", event."task_date", event."scheduled_time", event."status"
      FROM "task_activity_events" AS event
      WHERE event."user_id" = $1
      ORDER BY event."task_id", event."event_sequence" DESC, event."id" DESC
    ), postponements AS (
      SELECT event."task_id", COUNT(*)::INTEGER AS "reschedule_count"
      FROM "task_activity_events" AS event
      WHERE event."user_id" = $1
        AND event."event_type" = 'rescheduled'
        AND event."activity_local_date" BETWEEN $2::DATE AND $3::DATE
      GROUP BY event."task_id"
    )
    SELECT postponements."task_id", postponements."reschedule_count",
      latest."task_title", latest."task_date", latest."scheduled_time", latest."status"
    FROM postponements
    INNER JOIN latest ON latest."task_id" = postponements."task_id"
    WHERE latest."event_type" <> 'deleted'
    ORDER BY postponements."reschedule_count" DESC, latest."task_date" ASC, postponements."task_id" ASC
    LIMIT $4
  `, [userId, startDate, endDate, limit]) as Promise<PostponementRow[]>);

  return {
    trackingCoverage: "actual rescheduled events only; baseline rows are excluded",
    tasks: rows.map((row) => ({
      taskId: row.task_id,
      title: row.task_title,
      currentScheduledDate: row.task_date,
      currentScheduledTime: row.scheduled_time,
      currentStatus: row.status,
      rescheduleCount: row.reschedule_count,
    })),
  };
}

async function getRoutinePatterns(userId: number, input: unknown): Promise<unknown> {
  const parsed = routinePatternArguments.safeParse(input);
  if (!parsed.success) throw new AssistantToolArgumentError();
  const reports = await getDailyProductivityRange(userId, parsed.data.startDate, parsed.data.endDate);
  const byRoutine = new Map<number, {
    routineId: number;
    title: string;
    expectedOccurrences: number;
    completedOccurrences: number;
    incompleteOccurrences: number;
    generatedOccurrences: number;
  }>();

  for (const report of reports) {
    for (const occurrence of report.scheduledProductivity?.tasks ?? []) {
      if (occurrence.routineId === null) continue;
      const summary = byRoutine.get(occurrence.routineId) ?? {
        routineId: occurrence.routineId,
        title: occurrence.title,
        expectedOccurrences: 0,
        completedOccurrences: 0,
        incompleteOccurrences: 0,
        generatedOccurrences: 0,
      };
      summary.expectedOccurrences++;
      if (occurrence.status === "completed") summary.completedOccurrences++;
      else summary.incompleteOccurrences++;
      if (occurrence.generated) summary.generatedOccurrences++;
      byRoutine.set(occurrence.routineId, summary);
    }
  }

  const routines = [...byRoutine.values()].map((routine) => ({
    ...routine,
    completionPercentage: routine.expectedOccurrences === 0
      ? 0
      : Math.round((routine.completedOccurrences / routine.expectedOccurrences) * 10000) / 100,
  }));

  return {
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    coverage: {
      statuses: [...new Set(reports.map((report) => report.coverage.status))],
      unavailableDates: reports.filter((report) => report.coverage.status === "unavailable").map((report) => report.date),
      partialDates: reports.filter((report) => report.coverage.status === "partial").map((report) => report.date),
    },
    routines,
  };
}

interface ReminderContextRow {
  id: number;
  task_id: number | null;
  routine_id: number | null;
  scheduled_at: Date;
}

async function getScheduleContext(userId: number, input: unknown): Promise<unknown> {
  const parsed = scheduleContextArguments.safeParse(input);
  if (!parsed.success) throw new AssistantToolArgumentError();
  const { date: selectedDate } = parsed.data;
  const report = await getDailyProductivity(userId, selectedDate);

  const reminders = await inReadOnlyTransaction(async (manager) => {
    const zones = await manager.getRepository(UserTimeZoneVersion).find({
      where: { user_id: userId },
      order: { effective_at: "ASC", version_no: "ASC" },
    });
    if (zones.length === 0) return [];

    const rows = await manager.query(`
      WITH timezone_ranges AS (
        SELECT zone."time_zone", zone."effective_at",
          LEAD(zone."effective_at") OVER (ORDER BY zone."effective_at", zone."version_no") AS "next_effective_at"
        FROM UNNEST($2::TEXT[], $3::TIMESTAMPTZ[], $4::INTEGER[])
          AS zone("time_zone", "effective_at", "version_no")
      )
      SELECT reminder."id", reminder."task_id", reminder."routine_id", reminder."scheduled_at"
      FROM "reminders" AS reminder
      WHERE reminder."user_id" = $1
        AND reminder."status" = 'scheduled'
        AND EXISTS (
          SELECT 1 FROM timezone_ranges AS zone
          WHERE reminder."scheduled_at" >= zone."effective_at"
            AND reminder."scheduled_at" < COALESCE(zone."next_effective_at", 'infinity'::TIMESTAMPTZ)
            AND (reminder."scheduled_at" AT TIME ZONE zone."time_zone")::DATE = $5::DATE
        )
      ORDER BY reminder."scheduled_at" ASC, reminder."id" ASC
      LIMIT 10
    `, [
      userId,
      zones.map((zone) => zone.time_zone),
      zones.map((zone) => zone.effective_at),
      zones.map((zone) => zone.version_no),
      selectedDate,
    ]) as ReminderContextRow[];

    return rows.map((reminder) => ({
      id: reminder.id,
      taskId: reminder.task_id,
      routineId: reminder.routine_id,
      scheduledAt: reminder.scheduled_at,
    }));
  });

  return {
    date: report.date,
    timeZone: report.timeZone,
    coverage: report.coverage,
    scheduledProductivity: report.scheduledProductivity === null ? null : {
      totalTasks: report.scheduledProductivity.totalTasks,
      completedTasks: report.scheduledProductivity.completedTasks,
      incompleteTasks: report.scheduledProductivity.incompleteTasks,
      completionPercentage: report.scheduledProductivity.completionPercentage,
      tasks: report.scheduledProductivity.tasks.slice(0, 20),
      tasksTruncated: report.scheduledProductivity.tasks.length > 20,
    },
    reminders,
  };
}

type ToolHandler = (userId: number, input: unknown) => Promise<unknown>;

const handlers: Record<AssistantToolName, ToolHandler> = {
  get_productivity_report: getProductivityReport,
  get_incomplete_tasks: getIncompleteTasks,
  get_task_postponements: getTaskPostponements,
  get_routine_patterns: getRoutinePatterns,
  get_schedule_context: getScheduleContext,
};

const argumentSchemas: Record<AssistantToolName, z.ZodType> = {
  get_productivity_report: productivityReportArguments,
  get_incomplete_tasks: incompleteTaskArguments,
  get_task_postponements: postponementArguments,
  get_routine_patterns: routinePatternArguments,
  get_schedule_context: scheduleContextArguments,
};

export function validateAssistantToolArguments(name: string, input: unknown): boolean {
  if (!Object.hasOwn(argumentSchemas, name)) return false;
  return argumentSchemas[name as AssistantToolName].safeParse(input).success;
}

export async function executeAssistantTool(
  userId: number,
  name: string,
  input: unknown,
): Promise<unknown> {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new AssistantToolUnavailableError();
  if (!Object.hasOwn(handlers, name)) throw new AssistantToolUnavailableError();
  const output = await handlers[name as AssistantToolName](userId, input);
  return JSON.parse(JSON.stringify(output)) as unknown;
}
