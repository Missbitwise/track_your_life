import { LessThanOrEqual, type EntityManager } from "typeorm";
import { appDataSource } from "../config/database.js";
import { RoutineVersion } from "../entities/RoutineVersion.js";
import { TaskActivityEvent } from "../entities/TaskActivityEvent.js";
import { User } from "../entities/User.js";
import { UserTimeZoneVersion } from "../entities/UserTimeZoneVersion.js";
import {
  groupTimeZoneDaySegments,
  queryTimezoneDaySegments,
  type TimeZoneDaySegment,
} from "./analytics-time-window.js";
import { localDateAt } from "./time-zone.service.js";

type ProductivityStatus = "pending" | "completed";
type CoverageStatus = "full" | "partial" | "unavailable" | "future";

interface UserHistory {
  userId: number;
  fallbackTimeZone: string;
  userCreatedAt: Date;
  now: Date;
  today: string;
  trackingStartedAt: Date;
  earliestReliableTrackingDate: string;
  isBaselineUser: boolean;
  trackingCutoverAt: Date | null;
  timeZones: UserTimeZoneVersion[];
}

interface DayWindow {
  date: string;
  timeZone: string;
  startAt: Date;
  endAt: Date;
  cutoffAt: Date;
  activityStartAt: Date;
  segments: TimeZoneDaySegment[];
  inclusiveCutoff: boolean;
  coverageStatus: CoverageStatus;
}

export interface ScheduledTaskDetail {
  kind: "task" | "routine_occurrence";
  taskId: number | null;
  routineId: number | null;
  routineOccurrenceDate: string | null;
  generated: boolean;
  title: string;
  scheduledTime: string | null;
  status: ProductivityStatus;
  completedAt: Date | null;
}

export interface ActualActivityEvent {
  taskId: number;
  eventSequence: number;
  type: "completed" | "reopened";
  title: string;
  scheduledDate: string;
  scheduledTime: string | null;
  eventAt: Date;
  completedAt: Date | null;
  previousCompletedAt: string | null;
  timeZone: string;
  late: boolean;
}

export interface DailyAnalyticsReport {
  date: string;
  timeZone: string;
  dayStartsAt: Date | null;
  dayEndsAt: Date | null;
  asOf: Date | null;
  coverage: {
    status: CoverageStatus;
    fullyCovered: boolean;
    baselineOnly: boolean;
    earliestReliableTrackingDate: string;
    trackingStartedAt: Date;
    trackingCutoverAt: Date | null;
  };
  scheduledProductivity: null | {
    totalTasks: number;
    completedTasks: number;
    incompleteTasks: number;
    completionPercentage: number;
    tasks: ScheduledTaskDetail[];
  };
  actualCompletionActivity: {
    completedTasks: ActualActivityEvent[];
    lateCompletions: ActualActivityEvent[];
    reopenedTasks: ActualActivityEvent[];
    events: ActualActivityEvent[];
  };
}

interface PeriodTotals {
  totalTasks: number | null;
  completedTasks: number | null;
  incompleteTasks: number | null;
  completionPercentage: number | null;
  actualCompletions: number | null;
  lateCompletions: number | null;
  reopenedTasks: number | null;
}

interface PeriodCoverage {
  status: "full" | "partial" | "unavailable";
  fullyCovered: boolean;
  hasBaselineOnlyData: boolean;
  earliestReliableTrackingDate: string;
  trackingStartedAt: Date;
  trackingCutoverAt: Date | null;
  partialDates: string[];
  unavailableDates: string[];
  futureDates: string[];
}

export class AnalyticsUserNotFoundError extends Error {
  constructor() {
    super("User not found");
    this.name = "AnalyticsUserNotFoundError";
  }
}

export class AnalyticsHistoryUnavailableError extends Error {
  constructor() {
    super("Historical tracking has not been initialized for this user");
    this.name = "AnalyticsHistoryUnavailableError";
  }
}

function addCalendarDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let current = startDate; current <= endDate; current = addCalendarDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

function laterDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function latestTimeZoneForDate(versions: UserTimeZoneVersion[], date: string, fallback: string): string {
  let selected: UserTimeZoneVersion | undefined;
  for (const version of versions) {
    if (version.effective_from_date <= date
      && (!selected
        || version.effective_from_date > selected.effective_from_date
        || (version.effective_from_date === selected.effective_from_date && version.version_no > selected.version_no))) {
      selected = version;
    }
  }
  return selected?.time_zone ?? fallback;
}

async function loadUserHistory(manager: EntityManager, userId: number, now: Date): Promise<UserHistory> {
  const user = await manager.getRepository(User).findOne({
    where: { id: userId },
    select: { id: true, time_zone: true, created_at: true },
  });
  if (!user) throw new AnalyticsUserNotFoundError();

  const timeZones = await manager.getRepository(UserTimeZoneVersion).find({
    where: { user_id: userId },
    order: { effective_from_date: "ASC", version_no: "ASC" },
  });
  const firstVersion = timeZones.reduce<UserTimeZoneVersion | undefined>(
    (first, version) => !first || version.version_no < first.version_no ? version : first,
    undefined,
  );
  if (!firstVersion) throw new AnalyticsHistoryUnavailableError();

  let activeTimeZone = user.time_zone;
  for (const version of [...timeZones].sort((left, right) =>
    left.effective_at.getTime() - right.effective_at.getTime() || left.version_no - right.version_no)) {
    if (version.effective_at <= now) activeTimeZone = version.time_zone;
  }

  const [cutover] = await manager.query(`
    SELECT MIN(marker.cutover_at) AS cutover_at
    FROM (
      SELECT event."event_at" AS cutover_at
      FROM "task_activity_events" AS event
      WHERE event."user_id" = $1 AND event."event_type" = 'baseline'
      UNION ALL
      SELECT version."recorded_at" AS cutover_at
      FROM "routine_versions" AS version
      WHERE version."user_id" = $1 AND version."change_type" = 'baseline'
      UNION ALL
      SELECT zone."recorded_at" AS cutover_at
      FROM "user_time_zone_versions" AS zone
      JOIN "users" AS account ON account."id" = zone."user_id"
      WHERE zone."user_id" = $1
        AND zone."version_no" = 1
        AND account."created_at" < zone."recorded_at"
    ) AS marker
  `, [userId]) as Array<{ cutover_at: Date | null }>;

  return {
    userId,
    fallbackTimeZone: user.time_zone,
    userCreatedAt: user.created_at,
    now,
    today: localDateAt(now, activeTimeZone),
    trackingStartedAt: firstVersion.recorded_at,
    earliestReliableTrackingDate: firstVersion.effective_from_date,
    isBaselineUser: user.created_at < firstVersion.recorded_at,
    trackingCutoverAt: cutover?.cutover_at ?? null,
    timeZones,
  };
}

function coverageStatus(date: string, history: UserHistory): CoverageStatus {
  if (date > history.today) return "future";
  if (date < history.earliestReliableTrackingDate) return "unavailable";
  if (date === history.earliestReliableTrackingDate) return "partial";
  return "full";
}

async function buildDayWindows(
  manager: EntityManager,
  dates: string[],
  history: UserHistory,
): Promise<Map<string, DayWindow>> {
  const eligibleDates = dates.filter((date) => {
    const status = coverageStatus(date, history);
    return status === "partial" || status === "full";
  });
  if (eligibleDates.length === 0) return new Map();

  const segments = await queryTimezoneDaySegments(
    manager,
    eligibleDates,
    history.timeZones,
    history.today,
    history.now,
  );
  const windowsByDate = groupTimeZoneDaySegments(segments);

  const output = new Map<string, DayWindow>();
  for (const row of windowsByDate.values()) {
    const status = coverageStatus(row.date, history);
    const today = row.date === history.today;
    const cutoffAt = today ? history.now : row.endAt;
    const startAt = row.startAt;
    const endAt = row.endAt;
    const activityStartAt = status === "partial" ? laterDate(startAt, history.trackingStartedAt) : startAt;
    const visibleSegments = row.segments.flatMap((segment) => {
      const clippedStart = laterDate(segment.startAt, activityStartAt);
      return segment.endAt > clippedStart ? [{ ...segment, startAt: clippedStart }] : [];
    });
    if (visibleSegments.length === 0) continue;
    output.set(row.date, {
      date: row.date,
      timeZone: row.timeZone,
      startAt,
      endAt,
      cutoffAt,
      activityStartAt,
      segments: visibleSegments,
      inclusiveCutoff: today,
      coverageStatus: status,
    });
  }
  return output;
}

function eventFallsInWindow(eventAt: Date, window: DayWindow): boolean {
  return window.segments.some((segment) =>
    eventAt >= segment.startAt
    && (eventAt < segment.endAt || (window.inclusiveCutoff && eventAt.getTime() === window.cutoffAt.getTime())));
}

async function loadEventTimelines(
  manager: EntityManager,
  userId: number,
  windows: DayWindow[],
): Promise<{ seed: TaskActivityEvent[]; activity: TaskActivityEvent[] }> {
  if (windows.length === 0) return { seed: [], activity: [] };
  const periodStart = windows.reduce((min, window) =>
    window.activityStartAt < min ? window.activityStartAt : min, windows[0]!.activityStartAt);
  const maxCutoff = windows.reduce((max, window) =>
    window.cutoffAt > max ? window.cutoffAt : max, windows[0]!.cutoffAt);
  const repository = manager.getRepository(TaskActivityEvent);

  const seed = await repository.createQueryBuilder("event")
    .distinctOn(["event.task_id"])
    .where("event.user_id = :userId", { userId })
    .andWhere("event.event_at < :periodStart", { periodStart })
    .orderBy("event.task_id", "ASC")
    .addOrderBy("event.event_at", "DESC")
    .addOrderBy("event.event_sequence", "DESC")
    .addOrderBy("event.id", "DESC")
    .getMany();

  const activity = await repository.createQueryBuilder("event")
    .where("event.user_id = :userId", { userId })
    .andWhere("event.event_at >= :periodStart", { periodStart })
    .andWhere("event.event_at <= :maxCutoff", { maxCutoff })
    .orderBy("event.event_at", "ASC")
    .addOrderBy("event.task_id", "ASC")
    .addOrderBy("event.event_sequence", "ASC")
    .addOrderBy("event.id", "ASC")
    .getMany();

  return { seed, activity };
}

function makeActivityEvent(event: TaskActivityEvent): ActualActivityEvent {
  return {
    taskId: event.task_id,
    eventSequence: event.event_sequence,
    type: event.event_type as "completed" | "reopened",
    title: event.task_title,
    scheduledDate: event.task_date,
    scheduledTime: event.scheduled_time,
    eventAt: event.event_at,
    completedAt: event.completed_at,
    previousCompletedAt: event.before_snapshot?.completed_at ?? null,
    timeZone: event.time_zone,
    late: event.activity_local_date > event.task_date,
  };
}

function isTaskStateDeleted(event: TaskActivityEvent): boolean {
  return event.event_type === "deleted";
}

function isOccurrenceApplicable(version: RoutineVersion, date: string): boolean {
  return version.change_type !== "deleted"
    && version.is_active
    && version.starts_on <= date
    && (version.ends_on === null || version.ends_on >= date)
    && version.weekdays.some((weekday) => weekday.iso_weekday === isoWeekday(date));
}

function buildScheduledTasks(
  date: string,
  states: Map<number, TaskActivityEvent>,
  versions: RoutineVersion[],
): ScheduledTaskDetail[] {
  const tasksByOccurrence = new Map<string, TaskActivityEvent[]>();
  const scheduled: ScheduledTaskDetail[] = [];

  for (const event of states.values()) {
    const routineId = event.routine_id_snapshot;
    const occurrenceDate = event.routine_occurrence_date;
    if (routineId !== null && occurrenceDate !== null) {
      const key = `${routineId}:${occurrenceDate}`;
      const existing = tasksByOccurrence.get(key) ?? [];
      existing.push(event);
      tasksByOccurrence.set(key, existing);
    }

    if (isTaskStateDeleted(event) || event.task_date !== date) continue;
    scheduled.push({
      kind: routineId === null ? "task" : "routine_occurrence",
      taskId: event.task_id,
      routineId,
      routineOccurrenceDate: occurrenceDate,
      generated: true,
      title: event.task_title,
      scheduledTime: event.scheduled_time,
      status: event.status,
      completedAt: event.completed_at,
    });
  }

  const latestVersionByRoutine = new Map<number, RoutineVersion>();
  for (const version of versions) {
    if (version.effective_from_date > date) continue;
    const current = latestVersionByRoutine.get(version.routine_id);
    if (!current
      || version.effective_from_date > current.effective_from_date
      || (version.effective_from_date === current.effective_from_date && version.version_no > current.version_no)) {
      latestVersionByRoutine.set(version.routine_id, version);
    }
  }

  for (const [routineId, version] of latestVersionByRoutine) {
    if (!isOccurrenceApplicable(version, date)) continue;
    const key = `${routineId}:${date}`;
    const matching = tasksByOccurrence.get(key) ?? [];
    const currentMatches = matching.filter((event) => !isTaskStateDeleted(event));

    // A live generated task moved to a different date represents the occurrence
    // on its new date only. Its original routine identity remains in the event.
    if (currentMatches.some((event) => event.task_date !== date)) continue;
    if (currentMatches.some((event) => event.task_date === date)) continue;

    // No generated task, or a task that was deleted, leaves the applicable
    // routine obligation visible as an incomplete synthetic occurrence.
    scheduled.push({
      kind: "routine_occurrence",
      taskId: null,
      routineId,
      routineOccurrenceDate: date,
      generated: false,
      title: version.title,
      scheduledTime: version.scheduled_time,
      status: "pending",
      completedAt: null,
    });
  }

  scheduled.sort((left, right) =>
    (left.scheduledTime ?? "99:99:99").localeCompare(right.scheduledTime ?? "99:99:99")
      || left.title.localeCompare(right.title)
      || (left.taskId ?? Number.MAX_SAFE_INTEGER) - (right.taskId ?? Number.MAX_SAFE_INTEGER));
  return scheduled;
}

function coverageForDay(
  date: string,
  history: UserHistory,
  status: CoverageStatus,
  events: TaskActivityEvent[],
  routineVersions: RoutineVersion[],
): DailyAnalyticsReport["coverage"] {
  const baselineOnly = status === "partial"
    && history.isBaselineUser
    && !events.some((event) => event.event_type !== "baseline")
    && !routineVersions.some((version) =>
      version.effective_from_date === date
      && version.change_type !== "baseline"
      && version.recorded_at >= history.trackingStartedAt);

  return {
    status,
    fullyCovered: status === "full",
    baselineOnly,
    earliestReliableTrackingDate: history.earliestReliableTrackingDate,
    trackingStartedAt: history.trackingStartedAt,
    trackingCutoverAt: history.trackingCutoverAt,
  };
}

function emptyActualActivity(): DailyAnalyticsReport["actualCompletionActivity"] {
  return { completedTasks: [], lateCompletions: [], reopenedTasks: [], events: [] };
}

function unavailableOrFutureReport(date: string, history: UserHistory, status: CoverageStatus): DailyAnalyticsReport {
  const timeZone = latestTimeZoneForDate(history.timeZones, date, history.fallbackTimeZone);
  return {
    date,
    timeZone,
    dayStartsAt: null,
    dayEndsAt: null,
    asOf: null,
    coverage: coverageForDay(date, history, status, [], []),
    scheduledProductivity: null,
    actualCompletionActivity: emptyActualActivity(),
  };
}

function coveredDateWithoutLocalInterval(date: string, history: UserHistory, status: CoverageStatus): DailyAnalyticsReport {
  return {
    date,
    timeZone: latestTimeZoneForDate(history.timeZones, date, history.fallbackTimeZone),
    dayStartsAt: null,
    dayEndsAt: null,
    asOf: null,
    coverage: coverageForDay(date, history, status, [], []),
    scheduledProductivity: {
      totalTasks: 0,
      completedTasks: 0,
      incompleteTasks: 0,
      completionPercentage: 0,
      tasks: [],
    },
    actualCompletionActivity: emptyActualActivity(),
  };
}

async function buildReports(
  manager: EntityManager,
  history: UserHistory,
  dates: string[],
): Promise<Map<string, DailyAnalyticsReport>> {
  const windowsByDate = await buildDayWindows(manager, dates, history);
  const windows = [...windowsByDate.values()];
  const { seed, activity } = await loadEventTimelines(manager, history.userId, windows);
  const routineVersions = windows.length === 0
    ? []
    : await manager.getRepository(RoutineVersion).find({
      where: { user_id: history.userId, effective_from_date: LessThanOrEqual(dates.reduce((max, date) => date > max ? date : max, dates[0]!)) },
      relations: { weekdays: true },
      order: { routine_id: "ASC", effective_from_date: "ASC", version_no: "ASC" },
    });

  const states = new Map<number, TaskActivityEvent>();
  for (const event of seed) states.set(event.task_id, event);
  const orderedWindows = [...windows].sort((left, right) => left.cutoffAt.getTime() - right.cutoffAt.getTime());
  const output = new Map<string, DailyAnalyticsReport>();
  let activityIndex = 0;

  for (const window of orderedWindows) {
    while (activityIndex < activity.length) {
      const next = activity[activityIndex]!;
      const beforeCutoff = window.inclusiveCutoff
        ? next.event_at.getTime() <= window.cutoffAt.getTime()
        : next.event_at.getTime() < window.cutoffAt.getTime();
      if (!beforeCutoff) break;
      states.set(next.task_id, next);
      activityIndex++;
    }

    const scheduledTasks = buildScheduledTasks(window.date, states, routineVersions);
    const completedCount = scheduledTasks.filter((task) => task.status === "completed").length;
    const totalCount = scheduledTasks.length;
    const dayEvents = activity.filter((event) =>
      (event.event_type === "completed" || event.event_type === "reopened")
      && eventFallsInWindow(event.event_at, window));
    const allDayEvents = activity.filter((event) => eventFallsInWindow(event.event_at, window));
    const mappedEvents = dayEvents.map(makeActivityEvent);
    const completedTasks = mappedEvents.filter((event) => event.type === "completed");

    output.set(window.date, {
      date: window.date,
      timeZone: window.timeZone,
      dayStartsAt: window.startAt,
      dayEndsAt: window.endAt,
      asOf: window.cutoffAt,
      coverage: coverageForDay(window.date, history, window.coverageStatus, allDayEvents, routineVersions),
      scheduledProductivity: {
        totalTasks: totalCount,
        completedTasks: completedCount,
        incompleteTasks: totalCount - completedCount,
        completionPercentage: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 10000) / 100,
        tasks: scheduledTasks,
      },
      actualCompletionActivity: {
        completedTasks,
        lateCompletions: completedTasks.filter((event) => event.late),
        reopenedTasks: mappedEvents.filter((event) => event.type === "reopened"),
        events: mappedEvents,
      },
    });
  }

  for (const date of dates) {
    if (output.has(date)) continue;
    const status = coverageStatus(date, history);
    output.set(date, status === "partial" || status === "full"
      ? coveredDateWithoutLocalInterval(date, history, status)
      : unavailableOrFutureReport(date, history, status));
  }
  return output;
}

function aggregateTotals(reports: DailyAnalyticsReport[]): PeriodTotals {
  const available = reports.filter((report) => report.scheduledProductivity !== null);
  if (available.length === 0) {
    return {
      totalTasks: null,
      completedTasks: null,
      incompleteTasks: null,
      completionPercentage: null,
      actualCompletions: null,
      lateCompletions: null,
      reopenedTasks: null,
    };
  }

  // A task can appear in multiple end-of-day snapshots if it is rescheduled
  // after its original date. Period totals count its latest scheduled
  // appearance once, while each daily report continues to represent that
  // date's immutable end-of-day state.
  const scheduledByIdentity = new Map<string, ScheduledTaskDetail>();
  for (const report of available) {
    for (const task of report.scheduledProductivity!.tasks) {
      const identity = task.taskId !== null
        ? `task:${task.taskId}`
        : `routine:${task.routineId}:${task.routineOccurrenceDate}`;
      scheduledByIdentity.set(identity, task);
    }
  }
  const periodTasks = [...scheduledByIdentity.values()];
  const totalTasks = periodTasks.length;
  const completedTasks = periodTasks.filter((task) => task.status === "completed").length;
  const incompleteTasks = totalTasks - completedTasks;
  const actualCompletions = available.reduce((sum, report) => sum + report.actualCompletionActivity.completedTasks.length, 0);
  const lateCompletions = available.reduce((sum, report) => sum + report.actualCompletionActivity.lateCompletions.length, 0);
  const reopenedTasks = available.reduce((sum, report) => sum + report.actualCompletionActivity.reopenedTasks.length, 0);

  return {
    totalTasks,
    completedTasks,
    incompleteTasks,
    completionPercentage: totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 10000) / 100,
    actualCompletions,
    lateCompletions,
    reopenedTasks,
  };
}

function summarizeCoverage(reports: DailyAnalyticsReport[]): PeriodCoverage {
  const partialDates = reports.filter((report) => report.coverage.status === "partial").map((report) => report.date);
  const unavailableDates = reports.filter((report) => report.coverage.status === "unavailable").map((report) => report.date);
  const futureDates = reports.filter((report) => report.coverage.status === "future").map((report) => report.date);
  const elapsedReports = reports.filter((report) => report.coverage.status !== "future");
  const fullyCovered = elapsedReports.length > 0
    && elapsedReports.every((report) => report.coverage.status === "full");
  const anyCovered = reports.some((report) => report.scheduledProductivity !== null);
  const status = !anyCovered && unavailableDates.length > 0
    ? "unavailable"
    : fullyCovered
      ? "full"
      : "partial";
  const first = reports[0];
  return {
    status,
    fullyCovered,
    hasBaselineOnlyData: reports.some((report) => report.coverage.baselineOnly),
    earliestReliableTrackingDate: first?.coverage.earliestReliableTrackingDate ?? "",
    trackingStartedAt: first?.coverage.trackingStartedAt ?? new Date(0),
    trackingCutoverAt: first?.coverage.trackingCutoverAt ?? null,
    partialDates,
    unavailableDates,
    futureDates,
  };
}

function mostAndLeastProductive(reports: DailyAnalyticsReport[]): {
  mostProductiveDay: { date: string; completionPercentage: number } | null;
  leastProductiveDay: { date: string; completionPercentage: number } | null;
} {
  const candidates = reports.flatMap((report) => {
    const stats = report.scheduledProductivity;
    return stats && stats.totalTasks > 0
      ? [{ date: report.date, completionPercentage: stats.completionPercentage }]
      : [];
  });
  if (candidates.length === 0) return { mostProductiveDay: null, leastProductiveDay: null };
  const sortedMost = [...candidates].sort((left, right) =>
    right.completionPercentage - left.completionPercentage || left.date.localeCompare(right.date));
  const sortedLeast = [...candidates].sort((left, right) =>
    left.completionPercentage - right.completionPercentage || left.date.localeCompare(right.date));
  return { mostProductiveDay: sortedMost[0]!, leastProductiveDay: sortedLeast[0]! };
}

async function withAnalyticsSnapshot<T>(
  userId: number,
  work: (manager: EntityManager, history: UserHistory) => Promise<T>,
): Promise<T> {
  return appDataSource.transaction("REPEATABLE READ", async (manager) => {
    await manager.query("SET TRANSACTION READ ONLY");
    // Read the clock in the first snapshot-establishing statement so today's
    // cutoff and the rows visible to this repeatable-read transaction describe
    // the same database snapshot.
    const [clock] = await manager.query("SELECT transaction_timestamp() AS now") as Array<{ now: Date }>;
    if (!clock?.now) throw new Error("Unable to read the database clock for analytics");
    const history = await loadUserHistory(manager, userId, clock.now);
    return work(manager, history);
  });
}

export async function getDailyProductivity(userId: number, date: string): Promise<DailyAnalyticsReport> {
  return withAnalyticsSnapshot(userId, async (manager, history) => {
    const [report] = await buildReports(manager, history, [date]).then((reports) => [reports.get(date)]);
    if (!report) throw new Error("Daily analytics report could not be assembled");
    return report;
  });
}

function periodResult(
  startDate: string,
  endDate: string,
  reports: DailyAnalyticsReport[],
): {
  startDate: string;
  endDate: string;
  totals: PeriodTotals;
  coverage: PeriodCoverage;
  daily: DailyAnalyticsReport[];
  actualCompletionActivity: {
    daily: Array<{ date: string; completedTasks: ActualActivityEvent[]; lateCompletions: ActualActivityEvent[]; reopenedTasks: ActualActivityEvent[] }>;
  };
  mostProductiveDay: { date: string; completionPercentage: number } | null;
  leastProductiveDay: { date: string; completionPercentage: number } | null;
} {
  return {
    startDate,
    endDate,
    totals: aggregateTotals(reports),
    coverage: summarizeCoverage(reports),
    daily: reports,
    actualCompletionActivity: {
      daily: reports.map((report) => ({
        date: report.date,
        completedTasks: report.actualCompletionActivity.completedTasks,
        lateCompletions: report.actualCompletionActivity.lateCompletions,
        reopenedTasks: report.actualCompletionActivity.reopenedTasks,
      })),
    },
    ...mostAndLeastProductive(reports),
  };
}

function comparison(current: ReturnType<typeof periodResult>, previous: ReturnType<typeof periodResult>) {
  const comparable = current.coverage.fullyCovered && previous.coverage.fullyCovered;
  return {
    available: comparable,
    previousPeriod: { startDate: previous.startDate, endDate: previous.endDate, totals: previous.totals, coverage: previous.coverage },
    changes: comparable ? {
      totalTasks: current.totals.totalTasks! - previous.totals.totalTasks!,
      completedTasks: current.totals.completedTasks! - previous.totals.completedTasks!,
      incompleteTasks: current.totals.incompleteTasks! - previous.totals.incompleteTasks!,
      completionPercentagePoints: Math.round((current.totals.completionPercentage! - previous.totals.completionPercentage!) * 100) / 100,
    } : null,
  };
}

export async function getWeeklyProductivity(userId: number, startDate: string) {
  return withAnalyticsSnapshot(userId, async (manager, history) => {
    const endDate = addCalendarDays(startDate, 6);
    const previousStart = addCalendarDays(startDate, -7);
    const previousEnd = addCalendarDays(startDate, -1);
    const dates = [...dateRange(previousStart, previousEnd), ...dateRange(startDate, endDate)];
    const reports = await buildReports(manager, history, dates);
    const previous = periodResult(previousStart, previousEnd, dateRange(previousStart, previousEnd).map((date) => reports.get(date)!));
    const current = periodResult(startDate, endDate, dateRange(startDate, endDate).map((date) => reports.get(date)!));
    return { ...current, comparison: comparison(current, previous) };
  });
}

export async function getMonthlyProductivity(userId: number, year: number, month: number) {
  return withAnalyticsSnapshot(userId, async (manager, history) => {
    const startDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
    const firstOfNextMonth = month === 12
      ? `${String(year + 1).padStart(4, "0")}-01-01`
      : `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`;
    const endDate = addCalendarDays(firstOfNextMonth, -1);
    const previousMonth = month === 1 ? 12 : month - 1;
    const previousYear = month === 1 ? year - 1 : year;
    const previousStart = `${String(previousYear).padStart(4, "0")}-${String(previousMonth).padStart(2, "0")}-01`;
    const previousEnd = addCalendarDays(startDate, -1);
    const previousDates = dateRange(previousStart, previousEnd);
    const currentDates = dateRange(startDate, endDate);
    const reports = await buildReports(manager, history, [...previousDates, ...currentDates]);
    const previous = periodResult(previousStart, previousEnd, previousDates.map((date) => reports.get(date)!));
    const current = periodResult(startDate, endDate, currentDates.map((date) => reports.get(date)!));
    return { year, month, ...current, comparison: comparison(current, previous) };
  });
}
