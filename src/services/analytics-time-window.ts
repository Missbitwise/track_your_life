import type { EntityManager } from "typeorm";

export interface TimeZoneDaySegment {
  date: string;
  timeZone: string;
  startAt: Date;
  endAt: Date;
}

export interface TimeZoneBoundaryVersion {
  time_zone: string;
  effective_at: Date;
  version_no: number;
}

export interface ReportingDayWindow {
  date: string;
  timeZone: string;
  startAt: Date;
  endAt: Date;
  segments: TimeZoneDaySegment[];
}

/** Uses PostgreSQL's timezone database to split requested dates at exact version instants. */
export async function queryTimezoneDaySegments(
  manager: Pick<EntityManager, "query">,
  dates: string[],
  versions: TimeZoneBoundaryVersion[],
  today: string,
  now: Date,
): Promise<TimeZoneDaySegment[]> {
  if (dates.length === 0 || versions.length === 0) return [];
  const sortedVersions = [...versions].sort((left, right) =>
    left.effective_at.getTime() - right.effective_at.getTime() || left.version_no - right.version_no);

  return manager.query(`
    WITH timezone_ranges AS (
      SELECT zone."time_zone", zone."effective_at",
        LEAD(zone."effective_at") OVER (ORDER BY zone."effective_at", zone."version_no") AS "next_effective_at"
      FROM UNNEST($2::TEXT[], $3::TIMESTAMPTZ[], $4::INT[])
        AS zone("time_zone", "effective_at", "version_no")
    ), requested_dates AS (
      SELECT unnest($1::DATE[]) AS "day"
    ), candidates AS (
      SELECT requested."day", zone."time_zone",
        GREATEST(
          requested."day"::TIMESTAMP AT TIME ZONE zone."time_zone",
          zone."effective_at"
        ) AS "start_at",
        LEAST(
          (requested."day" + 1)::TIMESTAMP AT TIME ZONE zone."time_zone",
          COALESCE(zone."next_effective_at", 'infinity'::TIMESTAMPTZ),
          CASE WHEN requested."day" = $5::DATE THEN $6::TIMESTAMPTZ ELSE 'infinity'::TIMESTAMPTZ END
        ) AS "end_at"
      FROM requested_dates AS requested
      CROSS JOIN timezone_ranges AS zone
      WHERE zone."effective_at" < (requested."day" + 1)::TIMESTAMP AT TIME ZONE zone."time_zone"
        AND COALESCE(zone."next_effective_at", 'infinity'::TIMESTAMPTZ)
          > requested."day"::TIMESTAMP AT TIME ZONE zone."time_zone"
    )
    SELECT "day"::TEXT AS "date", "time_zone" AS "timeZone",
      "start_at" AS "startAt", "end_at" AS "endAt"
    FROM candidates
    WHERE "end_at" > "start_at"
    ORDER BY "start_at" ASC
  `, [
    dates,
    sortedVersions.map((version) => version.time_zone),
    sortedVersions.map((version) => version.effective_at),
    sortedVersions.map((version) => version.version_no),
    today,
    now,
  ]) as Promise<TimeZoneDaySegment[]>;
}

/** Groups each instant's timezone-local date segments into its reporting date. */
export function groupTimeZoneDaySegments(segments: TimeZoneDaySegment[]): Map<string, ReportingDayWindow> {
  const byDate = new Map<string, TimeZoneDaySegment[]>();
  for (const segment of segments) {
    if (segment.endAt.getTime() <= segment.startAt.getTime()) continue;
    const current = byDate.get(segment.date) ?? [];
    current.push(segment);
    byDate.set(segment.date, current);
  }

  return new Map([...byDate.entries()].map(([date, dateSegments]) => {
    const ordered = dateSegments.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    return [date, {
      date,
      timeZone: last.timeZone,
      startAt: first.startAt,
      endAt: last.endAt,
      segments: ordered,
    }];
  }));
}
