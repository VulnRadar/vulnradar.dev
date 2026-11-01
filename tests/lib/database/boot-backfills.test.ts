import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";
import {
  backfillSubDailyScheduleSlots,
  canonicalizeStoredScanUrls,
} from "@/lib/database/boot/backfills";
import { computeNextRunAt } from "@/lib/scanner/schedule-timing";

/**
 * The unit tier fakes the pool, so this proves which rows the backfill
 * chooses to write and what it writes, not what PostgreSQL does with the
 * UPDATE. The statement itself is run against a real database in
 * tests/integration/schedule-slot-backfill.test.ts.
 */

const NOW = new Date("2026-08-12T00:05:00.000Z");

interface FakeRow {
  id: number;
  frequency: string;
  preferred_hour_utc: number;
  preferred_day_of_week: number;
  preferred_day_of_month: number;
  next_run_at: Date;
}

function row(overrides: Partial<FakeRow> & { id: number }): FakeRow {
  return {
    frequency: "hourly",
    preferred_hour_utc: 14,
    preferred_day_of_week: 1,
    preferred_day_of_month: 1,
    next_run_at: new Date("2026-08-12T14:03:00.000Z"),
    ...overrides,
  };
}

function expected(r: FakeRow): Date {
  return computeNextRunAt(
    r.id,
    {
      frequency: r.frequency as "hourly" | "6hourly",
      preferredHourUtc: r.preferred_hour_utc,
      preferredDayOfWeek: r.preferred_day_of_week,
      preferredDayOfMonth: r.preferred_day_of_month,
    },
    NOW,
  );
}

function fakePool(rows: FakeRow[]) {
  const query = vi.fn(async (sql: string) => {
    if (sql.trimStart().startsWith("SELECT")) return { rows };
    return { rows: [], rowCount: 1 };
  });
  return { pool: { query } as unknown as Pool, query };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("backfillSubDailyScheduleSlots", () => {
  it("selects only active hourly and 6hourly rows, never daily or slower", async () => {
    const { pool, query } = fakePool([]);
    await backfillSubDailyScheduleSlots(pool, "App");

    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("active = true");
    expect(sql).toContain("frequency = ANY($1::text[])");
    expect(params).toEqual([["hourly", "6hourly"]]);
  });

  it("moves a row parked at its anchor hour back to the next real slot", async () => {
    // The shape the bug produced: an hourly schedule anchored at 14, parked at
    // 14:03 when the real next slot is 01:xx.
    const parked = row({ id: 7 });
    const { pool, query } = fakePool([parked]);

    await backfillSubDailyScheduleSlots(pool, "App");

    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE scheduled_scans"),
    ) as unknown as [string, unknown[]];
    expect(update).toBeDefined();
    expect(update[1]).toEqual([7, expected(parked).toISOString()]);
    expect(new Date(update[1][1] as string).getUTCHours()).toBe(1);
  });

  it("repairs a 6hourly row that skipped its early-day slots", async () => {
    const parked = row({
      id: 11,
      frequency: "6hourly",
      preferred_hour_utc: 20,
      next_run_at: new Date("2026-08-12T20:30:00.000Z"),
    });
    const { pool, query } = fakePool([parked]);

    await backfillSubDailyScheduleSlots(pool, "App");

    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE scheduled_scans"),
    ) as unknown as [string, unknown[]];
    expect(new Date(update[1][1] as string).getUTCHours()).toBe(2);
  });

  it("only ever writes a row EARLIER than it already was", async () => {
    const { pool, query } = fakePool([row({ id: 7 })]);
    await backfillSubDailyScheduleSlots(pool, "App");

    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE scheduled_scans"),
    ) as unknown as [string, unknown[]];
    // The guard lives in the statement so a run that rescheduled the row
    // between the SELECT and the UPDATE is not overwritten.
    expect(update[0]).toContain("next_run_at > $2");
    expect(update[0]).toContain("active = true");
  });

  it("leaves a row that is already on its correct slot alone", async () => {
    const correct = row({ id: 7 });
    correct.next_run_at = expected(correct);
    const { pool, query } = fakePool([correct]);

    await backfillSubDailyScheduleSlots(pool, "App");

    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE scheduled_scans"),
      ),
    ).toBe(false);
  });

  it("never postpones a row that is due or overdue", async () => {
    const overdue = row({
      id: 7,
      next_run_at: new Date("2026-08-11T22:00:00.000Z"),
    });
    const { pool, query } = fakePool([overdue]);

    await backfillSubDailyScheduleSlots(pool, "App");

    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE scheduled_scans"),
      ),
    ).toBe(false);
  });

  it("skips a row whose frequency is not one the engine knows", async () => {
    const odd = row({ id: 7, frequency: "fortnightly" });
    const { pool, query } = fakePool([odd]);

    await backfillSubDailyScheduleSlots(pool, "App");

    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE scheduled_scans"),
      ),
    ).toBe(false);
  });

  it("does not throw when the query fails, so a boot is never stopped", async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error("relation does not exist");
      }),
    } as unknown as Pool;

    await expect(
      backfillSubDailyScheduleSlots(pool, "App"),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("canonicalizeStoredScanUrls", () => {
  const BACKSLASH = "\\";

  it("updates only the rows whose parsed form differs, guarded by the old value", async () => {
    const rows = [
      { id: 3, url: `https://evil.example${BACKSLASH}@victim.example/` },
      { id: 7, url: "https://exa\u0001mple.test/" },
    ];
    const query = vi.fn(async (sql: string) =>
      sql.trimStart().startsWith("SELECT") ? { rows } : { rows: [] },
    );
    await canonicalizeStoredScanUrls({ query } as unknown as Pool);

    const updates = query.mock.calls.filter(([sql]) =>
      String(sql).trimStart().startsWith("UPDATE"),
    );
    expect(updates).toEqual([
      [
        "UPDATE scan_history SET url = $2 WHERE id = $1 AND url = $3",
        [3, "https://evil.example/@victim.example/", rows[0].url],
      ],
    ]);
  });

  it("asks for the next page after a full one, starting past its last id", async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({
      id: i + 1,
      url: "https://example.test/",
    }));
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: full })
      .mockResolvedValueOnce({ rows: [] });
    await canonicalizeStoredScanUrls({ query } as unknown as Pool);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toEqual([500, 500]);
  });

  it("does not throw when the query fails, so a boot is never stopped", async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error("relation does not exist");
      }),
    } as unknown as Pool;

    await expect(canonicalizeStoredScanUrls(pool)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
