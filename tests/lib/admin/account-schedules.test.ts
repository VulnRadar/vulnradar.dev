/**
 * The statements behind pausing and resuming an account's schedules. Which
 * rows they select is Postgres's answer, proved in
 * tests/integration/account-schedules.test.ts; this pins what the unit tier
 * can see: what is bound, and that a resume computes each due time.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { suspendAccountSchedules, resumeAccountSchedules } =
  await import("@/lib/admin/account-schedules");

const oneLine = (sql: unknown) => String(sql).replace(/\s+/g, " ").trim();

beforeEach(() => {
  mockQuery.mockReset();
});

describe("suspendAccountSchedules", () => {
  it("pauses the account's active schedules and marks them, returning the count", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    expect(await suspendAccountSchedules(5)).toBe(3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(oneLine(sql)).toBe(
      "UPDATE scheduled_scans SET active = false, next_run_at = NULL WHERE user_id = $1 AND active = true",
    );
    expect(params).toEqual([5]);
  });
});

describe("resumeAccountSchedules", () => {
  it("writes nothing when the disable paused nothing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await resumeAccountSchedules(5)).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(oneLine(mockQuery.mock.calls[0][0])).toContain(
      "WHERE user_id = $1 AND active = false AND next_run_at IS NULL",
    );
  });

  it("resumes each marked schedule with a due time in the future, on its own cadence", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          frequency: "daily",
          preferred_hour_utc: 3,
          preferred_day_of_week: 1,
          preferred_day_of_month: 1,
        },
        {
          id: 12,
          frequency: "weekly",
          preferred_hour_utc: 9,
          preferred_day_of_week: 4,
          preferred_day_of_month: 1,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 2 });
    const before = Date.now();
    expect(await resumeAccountSchedules(5)).toBe(2);

    const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
    // The mark is checked again on write, scoped to the account.
    expect(oneLine(sql)).toContain("s.user_id = $1");
    expect(oneLine(sql)).toContain("s.next_run_at IS NULL");
    expect(params[0]).toBe(5);
    expect(params[1]).toEqual([11, 12]);
    const due = (params[2] as string[]).map((d) => Date.parse(d));
    expect(due).toHaveLength(2);
    for (const t of due) expect(t).toBeGreaterThan(before);
    // Daily at 03:00 UTC, weekly on Thursday at 09:00 UTC.
    expect(new Date(due[0]).getUTCHours()).toBe(3);
    expect(new Date(due[1]).getUTCDay()).toBe(4);
  });
});
