import { appDataSource } from "../config/database.js";
import { RoutineVersion } from "../entities/RoutineVersion.js";
import { RoutineVersionWeekday } from "../entities/RoutineVersionWeekday.js";
import { User } from "../entities/User.js";
import { UserTimeZoneVersion } from "../entities/UserTimeZoneVersion.js";
import type { EntityManager } from "typeorm";

export class UserNotFoundForTimeZoneError extends Error {
  constructor() {
    super("User not found");
    this.name = "UserNotFoundForTimeZoneError";
  }
}

export interface TimeZoneChangeResult {
  time_zone: string;
  effective_from_date: string;
  effective_at: Date;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function localDateAt(timestamp: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function nextCalendarDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export async function databaseNow(manager: EntityManager): Promise<Date> {
  const [row] = await manager.query("SELECT clock_timestamp() AS now") as Array<{ now: Date }>;
  if (!row?.now) throw new Error("Could not read the database clock");
  return row.now;
}

export async function getActiveTimeZone(
  manager: EntityManager,
  userId: number,
  at = new Date(),
): Promise<string> {
  const version = await manager.getRepository(UserTimeZoneVersion)
    .createQueryBuilder("version")
    .where("version.user_id = :userId", { userId })
    .andWhere("version.effective_at <= :at", { at })
    .orderBy("version.effective_at", "DESC")
    .addOrderBy("version.version_no", "DESC")
    .getOne();
  if (version) return version.time_zone;

  const user = await manager.getRepository(User).findOne({
    where: { id: userId },
    select: { id: true, time_zone: true },
  });
  if (!user) throw new UserNotFoundForTimeZoneError();
  return user.time_zone;
}

export async function getTimeZoneForDate(
  manager: EntityManager,
  userId: number,
  date: string,
): Promise<string> {
  const version = await manager.getRepository(UserTimeZoneVersion)
    .createQueryBuilder("version")
    .where("version.user_id = :userId", { userId })
    .andWhere("version.effective_from_date <= :date", { date })
    .orderBy("version.effective_from_date", "DESC")
    .addOrderBy("version.version_no", "DESC")
    .getOne();
  if (version) return version.time_zone;

  const user = await manager.getRepository(User).findOne({
    where: { id: userId },
    select: { id: true, time_zone: true },
  });
  if (!user) throw new UserNotFoundForTimeZoneError();
  return user.time_zone;
}

async function getNextLocalMidnight(
  manager: EntityManager,
  activeTimeZone: string,
  now: Date,
): Promise<{ effectiveFromDate: string; effectiveAt: Date }> {
  const [boundary] = await manager.query(`
    SELECT
      (($2::TIMESTAMPTZ AT TIME ZONE $1)::DATE + 1)::TEXT AS effective_from_date,
      (((($2::TIMESTAMPTZ AT TIME ZONE $1)::DATE + 1)::TIMESTAMP) AT TIME ZONE $1) AS effective_at
  `, [activeTimeZone, now]) as Array<{ effective_from_date: string; effective_at: Date }>;

  if (!boundary) throw new Error("Could not calculate the next local midnight");
  return { effectiveFromDate: boundary.effective_from_date, effectiveAt: boundary.effective_at };
}

async function nextTimeZoneVersionNumber(manager: EntityManager, userId: number): Promise<number> {
  const result = await manager.getRepository(UserTimeZoneVersion)
    .createQueryBuilder("version")
    .select("COALESCE(MAX(version.version_no), 0)", "max_version")
    .where("version.user_id = :userId", { userId })
    .getRawOne<{ max_version: string | number }>();
  return Number(result?.max_version ?? 0) + 1;
}

async function appendRoutineTimeZoneVersions(
  manager: EntityManager,
  userId: number,
  newTimeZone: string,
  effectiveFromDate: string,
): Promise<void> {
  const versions = await manager.getRepository(RoutineVersion)
    .createQueryBuilder("version")
    .leftJoinAndSelect("version.weekdays", "weekday")
    .where("version.user_id = :userId", { userId })
    .andWhere("version.effective_from_date <= :effectiveFromDate", { effectiveFromDate })
    .andWhere(`version.version_no = (
      SELECT MAX(candidate.version_no)
      FROM routine_versions AS candidate
      WHERE candidate.user_id = version.user_id
        AND candidate.routine_id = version.routine_id
        AND candidate.effective_from_date <= :effectiveFromDate
    )`, { effectiveFromDate })
    .orderBy("version.routine_id", "ASC")
    .getMany();

  const repository = manager.getRepository(RoutineVersion);
  const weekdayRepository = manager.getRepository(RoutineVersionWeekday);
  for (const version of versions) {
    const copy = await repository.save(repository.create({
      user_id: version.user_id,
      routine_id: version.routine_id,
      version_no: version.version_no + 1,
      change_type: version.change_type === "deleted" ? "deleted" : "updated",
      effective_from_date: effectiveFromDate,
      time_zone: newTimeZone,
      title: version.title,
      description: version.description,
      scheduled_time: version.scheduled_time,
      starts_on: version.starts_on,
      ends_on: version.ends_on,
      is_active: version.is_active,
    }));

    if (version.weekdays.length > 0) {
      await weekdayRepository.save(version.weekdays.map((weekday) => ({
        routine_version_id: copy.id,
        iso_weekday: weekday.iso_weekday,
      })));
    }
  }
}

export async function changeUserTimeZone(userId: number, timeZone: string): Promise<TimeZoneChangeResult> {
  if (!isValidTimeZone(timeZone)) throw new TypeError("A valid IANA timezone is required");

  return appDataSource.transaction(async (manager) => {
    const userRepository = manager.getRepository(User);
    const user = await userRepository.findOne({
      where: { id: userId },
      lock: { mode: "pessimistic_write" },
    });
    if (!user) throw new UserNotFoundForTimeZoneError();

    const [zone] = await manager.query(
      "SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1) AS valid",
      [timeZone],
    ) as Array<{ valid: boolean }>;
    if (!zone?.valid) throw new TypeError("time_zone must be recognized by PostgreSQL as an IANA timezone");

    const timeZoneRepository = manager.getRepository(UserTimeZoneVersion);
    const latestVersion = await timeZoneRepository.findOne({
      where: { user_id: userId },
      order: { version_no: "DESC" },
    });
    if (user.time_zone === timeZone && latestVersion) {
      return {
        time_zone: timeZone,
        effective_from_date: latestVersion.effective_from_date,
        effective_at: latestVersion.effective_at,
      };
    }

    const now = await databaseNow(manager);
    const activeTimeZone = await getActiveTimeZone(manager, userId, now);
    const boundary = await getNextLocalMidnight(manager, activeTimeZone, now);
    const newVersion = await timeZoneRepository.save(timeZoneRepository.create({
      user_id: userId,
      version_no: await nextTimeZoneVersionNumber(manager, userId),
      time_zone: timeZone,
      effective_from_date: boundary.effectiveFromDate,
      effective_at: boundary.effectiveAt,
    }));

    user.time_zone = timeZone;
    await userRepository.save(user);
    await appendRoutineTimeZoneVersions(manager, userId, timeZone, boundary.effectiveFromDate);

    return {
      time_zone: newVersion.time_zone,
      effective_from_date: newVersion.effective_from_date,
      effective_at: newVersion.effective_at,
    };
  });
}
