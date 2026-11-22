import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { appDataSource } from "../dist/config/database.js";
import { groupTimeZoneDaySegments, queryTimezoneDaySegments } from "../dist/services/analytics-time-window.js";

before(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for PostgreSQL timezone integration tests");
  await appDataSource.initialize();
});

after(async () => {
  if (appDataSource.isInitialized) await appDataSource.destroy();
});

function flattenWindows(segments) {
  return [...groupTimeZoneDaySegments(segments).values()]
    .flatMap((window) => window.segments)
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
}

function assertPartition(segments, instants) {
  for (let index = 1; index < segments.length; index++) {
    assert.equal(segments[index - 1].endAt.getTime(), segments[index].startAt.getTime(), "timezone intervals must be contiguous");
  }
  for (const instant of instants) {
    const matches = segments.filter((segment) => instant >= segment.startAt && instant < segment.endAt);
    assert.equal(matches.length, 1, `instant ${instant.toISOString()} must be assigned exactly once`);
  }
}

test("offset change to a timezone on the previous local date uses the exact transition instant", async () => {
  await appDataSource.transaction("REPEATABLE READ", async (manager) => {
    await manager.query("SET TRANSACTION READ ONLY");
    const [transition] = await manager.query(`
      SELECT ('2026-11-22 00:00:00'::TIMESTAMP AT TIME ZONE 'Asia/Kolkata') AS effective_at,
        (('2026-11-22 00:00:00'::TIMESTAMP AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'America/Los_Angeles')::DATE::TEXT AS new_local_date
    `);
    assert.equal(transition.new_local_date, "2026-11-21", "fixture crosses to the previous local date");
    const rows = await queryTimezoneDaySegments(manager,
      ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"],
      [
        { time_zone: "Asia/Kolkata", effective_at: new Date("2026-11-01T00:00:00.000Z"), version_no: 1 },
        { time_zone: "America/Los_Angeles", effective_at: transition.effective_at, version_no: 2 },
      ],
      "2000-01-01",
      new Date("2000-01-01T00:00:00.000Z"));
    const segments = flattenWindows(rows);
    const boundaryIndex = segments.findIndex((segment) => segment.startAt.getTime() === transition.effective_at.getTime());
    assert.notEqual(boundaryIndex, -1, "new timezone segment must start exactly at effective_at");
    assert.equal(segments[boundaryIndex - 1].endAt.getTime(), transition.effective_at.getTime(), "previous timezone segment must end exactly at effective_at");
    const repeatedDate = groupTimeZoneDaySegments(rows).get("2026-11-21");
    assert.equal(repeatedDate?.segments.length, 2, "same local date on both sides of the change is represented by contiguous segments");
    assertPartition(segments, [
      new Date(transition.effective_at.getTime() - 1),
      transition.effective_at,
      new Date(transition.effective_at.getTime() + 1),
      new Date(segments.at(-1).endAt.getTime() - 1),
    ]);
  });
});

test("offset change that skips a local date still has no timestamp gap", async () => {
  await appDataSource.transaction("REPEATABLE READ", async (manager) => {
    await manager.query("SET TRANSACTION READ ONLY");
    const [transition] = await manager.query(`
      SELECT ('2026-11-22 00:00:00'::TIMESTAMP AT TIME ZONE 'Pacific/Honolulu') AS effective_at,
        (('2026-11-22 00:00:00'::TIMESTAMP AT TIME ZONE 'Pacific/Honolulu') AT TIME ZONE 'Pacific/Kiritimati')::DATE::TEXT AS new_local_date
    `);
    assert.equal(transition.new_local_date, "2026-11-23", "fixture crosses to the next local date");
    const rows = await queryTimezoneDaySegments(manager,
      ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"],
      [
        { time_zone: "Pacific/Honolulu", effective_at: new Date("2026-11-01T00:00:00.000Z"), version_no: 1 },
        { time_zone: "Pacific/Kiritimati", effective_at: transition.effective_at, version_no: 2 },
      ],
      "2000-01-01",
      new Date("2000-01-01T00:00:00.000Z"));
    const segments = flattenWindows(rows);
    const boundaryIndex = segments.findIndex((segment) => segment.startAt.getTime() === transition.effective_at.getTime());
    assert.notEqual(boundaryIndex, -1);
    assert.equal(segments[boundaryIndex - 1].endAt.getTime(), transition.effective_at.getTime());
    assert.equal(groupTimeZoneDaySegments(rows).has("2026-11-22"), false, "skipped local date has no fabricated interval");
    assertPartition(segments, [
      new Date(transition.effective_at.getTime() - 1),
      transition.effective_at,
      new Date(transition.effective_at.getTime() + 1),
      new Date(segments.at(-1).endAt.getTime() - 1),
    ]);
  });
});

test("PostgreSQL spring-forward and fall-back dates use 23-hour and 25-hour windows", async () => {
  await appDataSource.transaction("REPEATABLE READ", async (manager) => {
    await manager.query("SET TRANSACTION READ ONLY");
    const rows = await queryTimezoneDaySegments(manager,
      ["2026-03-07", "2026-03-08", "2026-03-09"],
      [{ time_zone: "America/New_York", effective_at: new Date("2020-01-01T00:00:00.000Z"), version_no: 1 }],
      "2000-01-01",
      new Date("2000-01-01T00:00:00.000Z"));
    const spring = flattenWindows(rows);
    const springDay = groupTimeZoneDaySegments(rows).get("2026-03-08");
    assert.equal((springDay.endAt - springDay.startAt) / 3_600_000, 23);
    assertPartition(spring, [springDay.startAt, new Date(springDay.endAt.getTime() - 1), springDay.endAt]);

    const fallRows = await queryTimezoneDaySegments(manager,
      ["2026-10-31", "2026-11-01", "2026-11-02"],
      [{ time_zone: "America/New_York", effective_at: new Date("2020-01-01T00:00:00.000Z"), version_no: 1 }],
      "2000-01-01",
      new Date("2000-01-01T00:00:00.000Z"));
    const fall = flattenWindows(fallRows);
    const fallDay = groupTimeZoneDaySegments(fallRows).get("2026-11-01");
    assert.equal((fallDay.endAt - fallDay.startAt) / 3_600_000, 25);
    assertPartition(fall, [fallDay.startAt, new Date(fallDay.endAt.getTime() - 1), fallDay.endAt]);
  });
});
