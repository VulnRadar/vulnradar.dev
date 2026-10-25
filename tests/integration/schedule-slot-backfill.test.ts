import { it, expect, beforeEach, afterEach, vi } from "vitest";
import pool from "@/lib/database/db";
import { backfillSubDailyScheduleSlots } from "@/lib/database/boot/backfills";
import {
  computeNextRunAt,
  type ScheduleFrequency,
} from "@/lib/scanner/schedule-timing";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The boot backfill that pulls parked hourly and 6-hourly schedules back to
 * their real next slot, run against a real PostgreSQL.
 *
 * The unit suite fakes the pool, so it can show which rows the function picks
 * and nothing about whether the UPDATE's guard really leaves a row alone:
 * `next_run_at > $2` and `active = true` are evaluated by the database, and a
 * wrong operator there reads as a green tick against a fake.
 *
 * Only Date is faked, and only so the recomputed slot is a known instant. The
 * pool keeps real timers, and no statement here reads NOW().
 */
const NOW = new Date("2026-08-12T00:05:00.000Z");

describeIntegration("sub-daily schedule slot backfill", () => {
  let userId: number;

  beforeEach(async () => {
    const user = await createUser();
    userId = user.id;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function insertSchedule(opts: {
    frequency: ScheduleFrequency;
    preferredHour: number;
    nextRunAt: Date;
    active?: boolean;
  }): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO scheduled_scans
         (user_id, url, frequency, active, next_run_at, preferred_hour_utc)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        userId,
        `https://${unique("sched")}.example.test/`,
        opts.frequency,
        opts.active ?? true,
        opts.nextRunAt.toISOString(),
        opts.preferredHour,
      ],
    );
    return rows[0].id;
  }

  async function nextRunAt(id: number): Promise<Date> {
    const { rows } = await pool.query<{ next_run_at: Date }>(
      "SELECT next_run_at FROM scheduled_scans WHERE id = $1",
      [id],
    );
    return rows[0].next_run_at;
  }

  function slotFor(
    id: number,
    frequency: ScheduleFrequency,
    preferredHour: number,
  ): Date {
    return computeNextRunAt(
      id,
      {
        frequency,
        preferredHourUtc: preferredHour,
        preferredDayOfWeek: 1,
        preferredDayOfMonth: 1,
      },
      NOW,
    );
  }

  it("moves a row parked at its anchor hour back to the next real slot", async () => {
    const parked = new Date("2026-08-12T14:03:00.000Z");
    const id = await insertSchedule({
      frequency: "hourly",
      preferredHour: 14,
      nextRunAt: parked,
    });

    await backfillSubDailyScheduleSlots(pool, "Test");

    const after = await nextRunAt(id);
    expect(after.getTime()).toBe(slotFor(id, "hourly", 14).getTime());
    expect(after.getTime()).toBeLessThan(parked.getTime());
    expect(after.getUTCHours()).toBe(1);
  });

  it("repairs a 6hourly row the same way", async () => {
    const id = await insertSchedule({
      frequency: "6hourly",
      preferredHour: 20,
      nextRunAt: new Date("2026-08-12T20:30:00.000Z"),
    });

    await backfillSubDailyScheduleSlots(pool, "Test");

    expect((await nextRunAt(id)).getUTCHours()).toBe(2);
  });

  it("leaves a row that is already on the right slot exactly as it was", async () => {
    const id = await insertSchedule({
      frequency: "hourly",
      preferredHour: 14,
      nextRunAt: new Date("2026-08-12T00:30:00.000Z"),
    });
    const correct = slotFor(id, "hourly", 14);
    await pool.query(
      "UPDATE scheduled_scans SET next_run_at = $2 WHERE id = $1",
      [id, correct.toISOString()],
    );

    await backfillSubDailyScheduleSlots(pool, "Test");

    expect((await nextRunAt(id)).getTime()).toBe(correct.getTime());
  });

  it("never postpones a row that is already due", async () => {
    const overdue = new Date("2026-08-11T22:00:00.000Z");
    const id = await insertSchedule({
      frequency: "hourly",
      preferredHour: 14,
      nextRunAt: overdue,
    });

    await backfillSubDailyScheduleSlots(pool, "Test");

    expect((await nextRunAt(id)).getTime()).toBe(overdue.getTime());
  });

  it("does not touch a paused schedule", async () => {
    const parked = new Date("2026-08-12T14:03:00.000Z");
    const id = await insertSchedule({
      frequency: "hourly",
      preferredHour: 14,
      nextRunAt: parked,
      active: false,
    });

    await backfillSubDailyScheduleSlots(pool, "Test");

    expect((await nextRunAt(id)).getTime()).toBe(parked.getTime());
  });

  it("does not touch a daily schedule, which has no earlier slot to skip", async () => {
    const parked = new Date("2026-08-12T14:03:00.000Z");
    const id = await insertSchedule({
      frequency: "daily",
      preferredHour: 14,
      nextRunAt: parked,
    });

    await backfillSubDailyScheduleSlots(pool, "Test");

    expect((await nextRunAt(id)).getTime()).toBe(parked.getTime());
  });

  it("is idempotent: a second run changes nothing", async () => {
    const id = await insertSchedule({
      frequency: "hourly",
      preferredHour: 14,
      nextRunAt: new Date("2026-08-12T14:03:00.000Z"),
    });

    await backfillSubDailyScheduleSlots(pool, "Test");
    const first = await nextRunAt(id);
    await backfillSubDailyScheduleSlots(pool, "Test");

    expect((await nextRunAt(id)).getTime()).toBe(first.getTime());
  });
});
