import { appDataSource } from "../config/database.js";
import { Reminder } from "../entities/Reminder.js";
import { Routine } from "../entities/Routine.js";
import { RoutineWeekday } from "../entities/RoutineWeekday.js";
import { RoutineVersion, type RoutineVersionChangeType } from "../entities/RoutineVersion.js";
import { RoutineVersionWeekday } from "../entities/RoutineVersionWeekday.js";
import { User } from "../entities/User.js";
import type { CreateRoutineBody, UpdateRoutineBody } from "../validators/routine.validator.js";
import { IsNull, type EntityManager } from "typeorm";
import { reconcileFutureRoutineTasks } from "./task.service.js";
import { databaseNow, getActiveTimeZone, getTimeZoneForDate, localDateAt, nextCalendarDate } from "./time-zone.service.js";

export class RoutineNotFoundError extends Error {
  constructor() {
    super("Routine not found");
    this.name = "RoutineNotFoundError";
  }
}

export class RoutineDateRangeError extends Error {
  constructor() {
    super("End date must be on or after the start date");
    this.name = "RoutineDateRangeError";
  }
}

function sortWeekdays(routine: Routine): Routine {
  routine.weekdays?.sort((left, right) => left.iso_weekday - right.iso_weekday);
  return routine;
}

function normalizeSqlTime(value: string | null): string | null {
  if (value === null) return null;
  const [clock, fraction = ""] = value.split(".");
  const [hours, minutes, seconds = "00"] = clock.split(":");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return `${hours}:${minutes}:${seconds}${normalizedFraction ? `.${normalizedFraction}` : ""}`;
}

async function lockUser(manager: EntityManager, userId: number): Promise<User> {
  const user = await manager.getRepository(User).findOne({
    where: { id: userId },
    lock: { mode: "pessimistic_write" },
  });
  if (!user) throw new Error("Routine owner not found");
  return user;
}

async function nextRoutineVersionNumber(manager: EntityManager, userId: number, routineId: number): Promise<number> {
  const result = await manager.getRepository(RoutineVersion)
    .createQueryBuilder("version")
    .select("COALESCE(MAX(version.version_no), 0)", "max_version")
    .where("version.user_id = :userId", { userId })
    .andWhere("version.routine_id = :routineId", { routineId })
    .getRawOne<{ max_version: string | number }>();
  return Number(result?.max_version ?? 0) + 1;
}

async function saveRoutineVersion(
  manager: EntityManager,
  routine: Routine,
  weekdays: readonly number[],
  changeType: RoutineVersionChangeType,
  effectiveFromDate: string,
  timeZone: string,
): Promise<void> {
  const versionRepository = manager.getRepository(RoutineVersion);
  const version = await versionRepository.save(versionRepository.create({
    user_id: routine.user_id,
    routine_id: routine.id,
    version_no: await nextRoutineVersionNumber(manager, routine.user_id, routine.id),
    change_type: changeType,
    effective_from_date: effectiveFromDate,
    time_zone: timeZone,
    title: routine.title,
    description: routine.description,
    scheduled_time: routine.scheduled_time,
    starts_on: routine.starts_on,
    ends_on: routine.ends_on,
    is_active: routine.is_active,
  }));

  if (weekdays.length > 0) {
    await manager.getRepository(RoutineVersionWeekday).save(
      weekdays.map((iso_weekday) => ({ routine_version_id: version.id, iso_weekday })),
    );
  }
}

export async function createRoutine(userId: number, input: CreateRoutineBody): Promise<Routine> {
  if (input.ends_on && input.ends_on < input.starts_on) throw new RoutineDateRangeError();

  return appDataSource.transaction(async (manager) => {
    await lockUser(manager, userId);
    const routineRepository = manager.getRepository(Routine);
    const routine = routineRepository.create({
      user_id: userId,
      title: input.title,
      description: input.description ?? null,
      scheduled_time: input.scheduled_time ?? null,
      starts_on: input.starts_on,
      ends_on: input.ends_on ?? null,
      is_active: input.is_active ?? true,
    });
    const savedRoutine = await routineRepository.save(routine);
    const weekdays = await manager.getRepository(RoutineWeekday).save(
      input.weekdays.map((iso_weekday) => ({ routine_id: savedRoutine.id, iso_weekday })),
    );

    const now = await databaseNow(manager);
    const activeTimeZone = await getActiveTimeZone(manager, userId, now);
    const effectiveFromDate = localDateAt(now, activeTimeZone);
    const timeZone = await getTimeZoneForDate(manager, userId, effectiveFromDate);
    await saveRoutineVersion(
      manager,
      savedRoutine,
      input.weekdays,
      "created",
      effectiveFromDate,
      timeZone,
    );

    savedRoutine.weekdays = weekdays;
    return sortWeekdays(savedRoutine);
  });
}

export async function getRoutinesForUser(userId: number): Promise<Routine[]> {
  const routines = await appDataSource.getRepository(Routine).find({
    where: { user_id: userId, deleted_at: IsNull() },
    relations: { weekdays: true },
    order: { starts_on: "ASC", id: "ASC" },
  });
  return routines.map(sortWeekdays);
}

export async function getRoutineForUser(userId: number, routineId: number): Promise<Routine> {
  const routine = await appDataSource.getRepository(Routine).findOne({
    where: { id: routineId, user_id: userId, deleted_at: IsNull() },
    relations: { weekdays: true },
  });
  if (!routine) throw new RoutineNotFoundError();
  return sortWeekdays(routine);
}

export async function updateRoutineForUser(
  userId: number,
  routineId: number,
  input: UpdateRoutineBody,
): Promise<Routine> {
  return appDataSource.transaction(async (manager) => {
    await lockUser(manager, userId);
    const routineRepository = manager.getRepository(Routine);
    const routine = await routineRepository.findOne({
      where: { id: routineId, user_id: userId, deleted_at: IsNull() },
      lock: { mode: "pessimistic_write" },
    });
    if (!routine) throw new RoutineNotFoundError();
    routine.weekdays = await manager.getRepository(RoutineWeekday).findBy({ routine_id: routine.id });

    const nextStartsOn = input.starts_on ?? routine.starts_on;
    const nextEndsOn = input.ends_on === undefined ? routine.ends_on : input.ends_on;
    if (nextEndsOn && nextEndsOn < nextStartsOn) throw new RoutineDateRangeError();

    const original = {
      title: routine.title,
      description: routine.description,
      scheduled_time: routine.scheduled_time,
      starts_on: routine.starts_on,
      ends_on: routine.ends_on,
      is_active: routine.is_active,
      weekdays: routine.weekdays.map((weekday) => weekday.iso_weekday).sort((left, right) => left - right),
    };

    if (input.title !== undefined) routine.title = input.title;
    if (input.description !== undefined) routine.description = input.description;
    if (input.scheduled_time !== undefined
      && normalizeSqlTime(input.scheduled_time) !== normalizeSqlTime(routine.scheduled_time)) {
      routine.scheduled_time = input.scheduled_time;
    }
    if (input.starts_on !== undefined) routine.starts_on = input.starts_on;
    if (input.ends_on !== undefined) routine.ends_on = input.ends_on;
    if (input.is_active !== undefined) routine.is_active = input.is_active;

    let nextWeekdays = original.weekdays;
    if (input.weekdays !== undefined) {
      nextWeekdays = [...input.weekdays].sort((left, right) => left - right);
    }

    const weekdaysChanged = nextWeekdays.length !== original.weekdays.length
      || nextWeekdays.some((weekday, index) => weekday !== original.weekdays[index]);
    const configurationChanged = routine.title !== original.title
      || routine.description !== original.description
      || normalizeSqlTime(routine.scheduled_time) !== normalizeSqlTime(original.scheduled_time)
      || routine.starts_on !== original.starts_on
      || routine.ends_on !== original.ends_on
      || routine.is_active !== original.is_active
      || weekdaysChanged;

    if (!configurationChanged) return sortWeekdays(routine);

    const savedRoutine = await routineRepository.save(routine);
    if (weekdaysChanged) {
      const weekdayRepository = manager.getRepository(RoutineWeekday);
      await weekdayRepository.delete({ routine_id: routine.id });
      savedRoutine.weekdays = await weekdayRepository.save(
        nextWeekdays.map((iso_weekday) => ({ routine_id: routine.id, iso_weekday })),
      );
    }

    const now = await databaseNow(manager);
    const activeTimeZone = await getActiveTimeZone(manager, userId, now);
    const effectiveFromDate = nextCalendarDate(localDateAt(now, activeTimeZone));
    const timeZone = await getTimeZoneForDate(manager, userId, effectiveFromDate);
    await saveRoutineVersion(manager, savedRoutine, nextWeekdays, "updated", effectiveFromDate, timeZone);
    await reconcileFutureRoutineTasks(manager, userId, routineId, effectiveFromDate);
    return sortWeekdays(savedRoutine);
  });
}

export async function deleteRoutineForUser(userId: number, routineId: number): Promise<void> {
  await appDataSource.transaction(async (manager) => {
    await lockUser(manager, userId);
    const routineRepository = manager.getRepository(Routine);
    const routine = await routineRepository.findOne({
      where: { id: routineId, user_id: userId, deleted_at: IsNull() },
      lock: { mode: "pessimistic_write" },
    });
    if (!routine) throw new RoutineNotFoundError();
    routine.weekdays = await manager.getRepository(RoutineWeekday).findBy({ routine_id: routine.id });

    const now = await databaseNow(manager);
    const activeTimeZone = await getActiveTimeZone(manager, userId, now);
    const effectiveFromDate = nextCalendarDate(localDateAt(now, activeTimeZone));
    const timeZone = await getTimeZoneForDate(manager, userId, effectiveFromDate);
    await saveRoutineVersion(
      manager,
      routine,
      routine.weekdays.map((weekday) => weekday.iso_weekday),
      "deleted",
      effectiveFromDate,
      timeZone,
    );

    routine.deleted_at = now;
    await routineRepository.save(routine);

    await reconcileFutureRoutineTasks(manager, userId, routineId, effectiveFromDate);

    // Preserve the existing ON DELETE CASCADE behavior for routine reminders.
    await manager.getRepository(Reminder).delete({ user_id: userId, routine_id: routineId });
  });
}
