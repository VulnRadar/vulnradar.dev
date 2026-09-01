/**
 * Tests for lib/scanner/scheduled-scans-worker.ts -- the worker that
 * actually executes the scheduled_scans feature (previously a facade: rows
 * could be created/listed/deleted but nothing ever read next_run_at and
 * triggered a scan).
 *
 * Mocked at the database/network boundary: the pg pool (both .query and
 * .connect, since claiming uses a transaction client), validateScanTarget,
 * the planned-category helpers, executeScan itself (its own suite covers
 * its internals), the plan-frequency gate, and outbound email. Real:
 * schedule-timing.ts's computeNextRunAt/jitter and this module's own
 * claim/reschedule/batching logic.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPoolQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn(async () => ({
  query: mockClientQuery,
  release: mockRelease,
}));
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
    connect: () => mockConnect(),
  },
}));

const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
}));

vi.mock("@/lib/scanner/engine", () => ({
  getPlannedSyncCategories: () => ["headers", "ssl"],
}));

vi.mock("@/lib/scanner/async-checks", () => ({
  getPlannedAsyncBranches: () => ["dns", "tls"],
}));

const mockExecuteScan = vi.fn();
vi.mock("@/lib/scanner/execute-scan", () => ({
  executeScan: (...args: unknown[]) => mockExecuteScan(...args),
  normalizeUrl: (input: string) =>
    /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`,
  isRawIpv4: (input: string) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(input.trim()),
  getProtocolType: () => "http",
}));

const mockUserMeetsScheduleFrequency = vi.fn();
vi.mock("@/lib/billing/plan-limits", () => ({
  userMeetsScheduleFrequency: (...args: unknown[]) =>
    mockUserMeetsScheduleFrequency(...args),
}));

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
}));

const mockScheduleDisabledEmail = vi.fn((url: string, reason: string) => ({
  subject: "Scheduled Scan Disabled",
  text: `${url} ${reason}`,
  html: `<p>${url} ${reason}</p>`,
}));
const mockScheduledScanCompleteEmail = vi.fn((..._args: unknown[]) => ({
  subject: "Scheduled Scan Complete",
  text: "text",
  html: "<p>html</p>",
}));
vi.mock("@/lib/email/email", () => ({
  scheduleDisabledEmail: (...args: [string, string]) =>
    mockScheduleDisabledEmail(...args),
  scheduledScanCompleteEmail: (...args: unknown[]) =>
    mockScheduledScanCompleteEmail(...args),
}));

const mockGetSetting = vi.fn();
const mockGetSettings =
  vi.fn<(keys?: readonly string[]) => Promise<Record<string, unknown>>>();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  getSettings: (keys?: readonly string[]) => mockGetSettings(keys),
}));

// A scheduled run now goes through the same admin blocklist and daily-quota
// gates a manual scan does. Default both to "allowed" so the existing cases
// exercise the happy path; the dedicated cases below drive the refusals.
const mockCheckAccessRules =
  vi.fn<(url: string) => Promise<{ allowed: boolean; reason?: string }>>();
const mockGetDailyLimit = vi.fn<(userId: number) => Promise<number>>();
const mockIncrementDailyCountCapped =
  vi.fn<
    (
      userId: number,
      limit: number,
    ) => Promise<{ recorded: boolean; count: number }>
  >();

vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: (url: string) => mockCheckAccessRules(url),
}));
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getDailyLimit: (userId: number) => mockGetDailyLimit(userId),
  incrementDailyCountCapped: (userId: number, limit: number) =>
    mockIncrementDailyCountCapped(userId, limit),
}));

const { claimDueSchedules, processSchedule, runInBatches, runDueSchedules } =
  await import("@/lib/scanner/scheduled-scans-worker");

function makeSchedule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    user_id: 42,
    url: "https://example.com",
    frequency: "daily",
    preferred_hour_utc: 12,
    preferred_day_of_week: 1,
    preferred_day_of_month: 1,
    team_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockRelease.mockReset();
  mockConnect.mockClear();
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
  mockExecuteScan.mockReset();
  mockExecuteScan.mockResolvedValue(undefined);
  mockUserMeetsScheduleFrequency.mockReset();
  mockUserMeetsScheduleFrequency.mockResolvedValue(true);
  mockSendNotificationEmail.mockReset();
  mockSendNotificationEmail.mockResolvedValue(undefined);
  mockScheduleDisabledEmail.mockClear();
  mockScheduledScanCompleteEmail.mockClear();
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(3);
  mockGetSettings.mockReset();
  mockGetSettings.mockResolvedValue({});
  mockCheckAccessRules.mockReset();
  mockCheckAccessRules.mockResolvedValue({ allowed: true });
  mockGetDailyLimit.mockReset();
  mockGetDailyLimit.mockResolvedValue(100);
  mockIncrementDailyCountCapped.mockReset();
  mockIncrementDailyCountCapped.mockResolvedValue({ recorded: true, count: 1 });

  // Default: every pool.query call succeeds with a generic shape. Tests
  // override specific calls with mockResolvedValueOnce / mockImplementation
  // as needed.
  mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
});

describe("claimDueSchedules", () => {
  it("selects only active, due schedules with FOR UPDATE SKIP LOCKED, ordered oldest-due-first", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FOR UPDATE SKIP LOCKED")) return { rows: [] };
      return { rows: [] };
    });

    await claimDueSchedules(50);

    const selectCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("FOR UPDATE SKIP LOCKED"),
    );
    expect(selectCall).toBeDefined();
    const [sql, params] = selectCall!;
    expect(sql).toContain("WHERE active = true AND next_run_at <= NOW()");
    expect(sql).toContain("ORDER BY next_run_at ASC");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    // team_id has to come back with the claim: processSchedule can only write
    // it onto scan_history if the claim selected it. ref: AUDIT-011#drift-01
    expect(sql).toContain("team_id");
    expect(params).toEqual([50]);
  });

  it("runs the claim inside BEGIN/COMMIT and always releases the client", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      return { rows: [] };
    });

    await claimDueSchedules();

    const calls = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(calls[0]).toBe("BEGIN");
    expect(calls[calls.length - 1]).toBe("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("soft-locks claimed rows by pushing next_run_at forward, in the same transaction", async () => {
    const claimed = [makeSchedule({ id: 10 }), makeSchedule({ id: 11 })];
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FOR UPDATE SKIP LOCKED")) return { rows: claimed };
      return { rows: [] };
    });

    const result = await claimDueSchedules();

    expect(result).toEqual(claimed);
    const lockCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("make_interval(mins"),
    );
    expect(lockCall).toBeDefined();
    const [lockSql, lockParams] = lockCall!;
    expect(lockSql).toContain("SET next_run_at = NOW() + make_interval");
    expect(lockParams[0]).toEqual([10, 11]);
  });

  it("skips the soft-lock UPDATE entirely when nothing is due", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FOR UPDATE SKIP LOCKED")) return { rows: [] };
      return { rows: [] };
    });

    await claimDueSchedules();

    const lockCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("make_interval(mins"),
    );
    expect(lockCall).toBeUndefined();
  });

  it("rolls back and releases the client (and rethrows) if the transaction fails", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN") return { rows: [] };
      if (sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FOR UPDATE SKIP LOCKED")) {
        throw new Error("connection reset");
      }
      return { rows: [] };
    });

    await expect(claimDueSchedules()).rejects.toThrow("connection reset");
    expect(mockClientQuery.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(
      true,
    );
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

describe("processSchedule", () => {
  it("scans a safe, plan-cleared schedule: inserts scan_history with source='scheduled', calls executeScan with silenceRoutineEmail, and stamps last_run_at", async () => {
    const schedule = makeSchedule({ id: 7 });
    const insertCall = { rows: [{ id: 555 }], rowCount: 1 };
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO scan_history")) return insertCall;
      return { rows: [], rowCount: 1 };
    });

    const now = new Date("2026-08-12T10:00:00.000Z");
    const result = await processSchedule(schedule, now);

    expect(result).toEqual({ id: 7, outcome: "scanned" });

    const insertArgs = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(insertArgs![1]).toEqual([
      42,
      "https://example.com",
      expect.any(String), // DEFAULT_SCAN_NOTE
      expect.any(Number), // categoriesTotal
      true, // is_public: resolveScanIsPublic's account default (no preference set here)
      null, // team_id: personal schedule
    ]);
    expect(insertArgs![0]).toContain("'scheduled'");

    expect(mockExecuteScan).toHaveBeenCalledWith(
      expect.objectContaining({
        scanId: 555,
        authedUserId: 42,
        silenceRoutineEmail: true,
      }),
    );

    const rescheduleCall = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("last_run_at = NOW()"),
    );
    expect(rescheduleCall).toBeDefined();
    expect(rescheduleCall![1][1]).toBe(7);
  });

  it("creates the scan_history row as private when the owner's account has scans_private_by_default set", async () => {
    const schedule = makeSchedule({ id: 15, user_id: 99 });
    const insertCall = { rows: [{ id: 556 }], rowCount: 1 };
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT scans_private_by_default")) {
        return { rows: [{ scans_private_by_default: true }] };
      }
      if (sql.includes("INSERT INTO scan_history")) return insertCall;
      return { rows: [], rowCount: 1 };
    });

    const result = await processSchedule(schedule);

    expect(result.outcome).toBe("scanned");
    const insertArgs = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    // is_public is the second-to-last parameter now that team_id trails it.
    expect(insertArgs![1].at(-2)).toBe(false);
  });

  // ref: AUDIT-011#drift-01. Every manual scan route writes scan_history.team_id
  // and every team-scoped history read filters on it, so a scheduled run of a
  // TEAM schedule that dropped the column produced a row only the schedule's
  // owner could see. These two cases pin both directions.
  it("carries the schedule's team_id onto the scan_history row it inserts", async () => {
    const schedule = makeSchedule({ id: 31, team_id: 8 });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO scan_history")) {
        return { rows: [{ id: 900 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await processSchedule(schedule);

    expect(result.outcome).toBe("scanned");
    const insertArgs = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(String(insertArgs![0])).toContain("team_id");
    expect(insertArgs![1].at(-1)).toBe(8);
  });

  it("writes a null team_id for a personal schedule rather than omitting the column", async () => {
    const schedule = makeSchedule({ id: 32, team_id: null });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO scan_history")) {
        return { rows: [{ id: 901 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await processSchedule(schedule);

    const insertArgs = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(insertArgs![1].at(-1)).toBeNull();
  });

  it("sends the schedules-typed 'scan complete' email once the run lands as completed", async () => {
    const schedule = makeSchedule({ id: 20, frequency: "daily" });
    const insertCall = { rows: [{ id: 555 }], rowCount: 1 };
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO scan_history")) return insertCall;
      if (sql.includes("SELECT summary, duration, status FROM scan_history")) {
        return {
          rows: [
            {
              summary: JSON.stringify({
                critical: 0,
                high: 1,
                medium: 2,
                low: 0,
                info: 0,
                total: 3,
              }),
              duration: 1200,
              status: "completed",
            },
          ],
        };
      }
      if (sql.includes("SELECT email FROM users")) {
        return { rows: [{ email: "owner@example.com" }] };
      }
      return { rows: [], rowCount: 1 };
    });

    await processSchedule(schedule, new Date("2026-08-12T10:00:00.000Z"));

    expect(mockScheduledScanCompleteEmail).toHaveBeenCalledWith(
      "Daily",
      "https://example.com",
      expect.objectContaining({ total: 3, high: 1 }),
      1200,
      555,
    );
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        userEmail: "owner@example.com",
        type: "schedules",
      }),
    );
  });

  it("does not send the schedule-complete email when the run never reached 'completed' (e.g. watchdog timeout)", async () => {
    const schedule = makeSchedule({ id: 21 });
    const insertCall = { rows: [{ id: 556 }], rowCount: 1 };
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO scan_history")) return insertCall;
      if (sql.includes("SELECT summary, duration, status FROM scan_history")) {
        return { rows: [{ summary: null, duration: 0, status: "failed" }] };
      }
      return { rows: [], rowCount: 1 };
    });

    await processSchedule(schedule);

    expect(mockScheduledScanCompleteEmail).not.toHaveBeenCalled();
    expect(mockSendNotificationEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "schedules" }),
    );
  });

  it("deactivates and emails the owner when the target now fails the safety check, without ever calling executeScan", async () => {
    const schedule = makeSchedule({ id: 8, url: "http://169.254.169.254/" });
    mockValidateScanTarget.mockResolvedValueOnce({
      safe: false,
      reason: "Private IP address blocked",
    });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT email FROM users")) {
        return { rows: [{ email: "owner@example.com" }] };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await processSchedule(schedule);

    expect(result).toEqual({
      id: 8,
      outcome: "blocked",
      detail: "Private IP address blocked",
    });
    expect(mockExecuteScan).not.toHaveBeenCalled();

    const deactivateCall = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SET active = false"),
    );
    expect(deactivateCall).toBeDefined();
    expect(deactivateCall![1]).toEqual([8]);

    expect(mockScheduleDisabledEmail).toHaveBeenCalledWith(
      "http://169.254.169.254/",
      "Private IP address blocked",
    );
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        userEmail: "owner@example.com",
        type: "schedules",
      }),
    );
  });

  it("does not deactivate on an unsafe target it cannot notify about (no user row) -- still logs and skips", async () => {
    const schedule = makeSchedule({ id: 9 });
    mockValidateScanTarget.mockResolvedValueOnce({
      safe: false,
      reason: "blocked",
    });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT email FROM users")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });

    const result = await processSchedule(schedule);

    expect(result.outcome).toBe("blocked");
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("defers (reschedules, does not deactivate) when the user's plan no longer covers the frequency", async () => {
    const schedule = makeSchedule({ id: 12, frequency: "hourly" });
    mockUserMeetsScheduleFrequency.mockResolvedValueOnce(false);

    const result = await processSchedule(schedule);

    expect(result).toEqual({ id: 12, outcome: "plan_gated" });
    expect(mockExecuteScan).not.toHaveBeenCalled();
    expect(mockUserMeetsScheduleFrequency).toHaveBeenCalledWith(
      42,
      "elite_supporter",
    );

    // Rescheduled (next_run_at written) but NOT deactivated and NOT
    // stamped as a completed run (no last_run_at).
    const deactivateCall = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SET active = false"),
    );
    expect(deactivateCall).toBeUndefined();
    const rescheduleCall = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SET next_run_at = $1 WHERE id = $2"),
    );
    expect(rescheduleCall).toBeDefined();
  });

  // AUDIT-014#abuse-04: scheduled runs were entirely unmetered. They neither
  // checked nor charged dailyScans, so an account with unlimited hourly
  // schedules could run unbounded full scans against a finite daily cap while
  // the usage figure it saw stayed at zero. AUDIT-013#cov-05 separately found
  // that no test anywhere asserted a scan path charges quota, which is why
  // this went unnoticed; these three cases close that gap.
  it("charges the daily scan quota before running, like every manual scan path", async () => {
    const schedule = makeSchedule({ id: 30, user_id: 77 });

    const result = await processSchedule(schedule, new Date());

    expect(result).toEqual({ id: 30, outcome: "scanned" });
    expect(mockGetDailyLimit).toHaveBeenCalledWith(77);
    expect(mockIncrementDailyCountCapped).toHaveBeenCalledWith(77, 100);
    expect(mockExecuteScan).toHaveBeenCalled();
  });

  it("skips the run and reschedules when the account is over its daily quota, without deactivating the schedule", async () => {
    const schedule = makeSchedule({ id: 31, user_id: 78 });
    mockIncrementDailyCountCapped.mockResolvedValue({
      recorded: false,
      count: 100,
    });

    const result = await processSchedule(schedule, new Date());

    expect(result).toEqual({ id: 31, outcome: "quota_gated" });
    expect(mockExecuteScan).not.toHaveBeenCalled();

    // Being over quota is temporary, so the schedule stays active and simply
    // runs again next cadence -- the same treatment the plan gate gets.
    const deactivateCall = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SET active = false"),
    );
    expect(deactivateCall).toBeUndefined();
    const rescheduleCall = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SET next_run_at = $1 WHERE id = $2"),
    );
    expect(rescheduleCall).toBeDefined();
  });

  it("stops scanning a target an admin blocklisted after the schedule was created", async () => {
    const schedule = makeSchedule({ id: 32 });
    mockCheckAccessRules.mockResolvedValue({
      allowed: false,
      reason: "Target is on the blocklist",
    });

    const result = await processSchedule(schedule, new Date());

    expect(result).toEqual({
      id: 32,
      outcome: "blocked",
      detail: "Target is on the blocklist",
    });
    expect(mockExecuteScan).not.toHaveBeenCalled();
    expect(mockIncrementDailyCountCapped).not.toHaveBeenCalled();
  });

  it("never throws even when scan_history insert fails -- logs, reschedules at the normal cadence, and reports the error outcome (failure isolation)", async () => {
    const schedule = makeSchedule({ id: 13 });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO scan_history")) {
        throw new Error("connection terminated unexpectedly");
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await processSchedule(schedule);

    expect(result.outcome).toBe("error");
    expect(result.detail).toContain("connection terminated");
    expect(mockExecuteScan).not.toHaveBeenCalled();

    // Rescheduled at the normal cadence (not deactivated) after the failure.
    const deactivateCall = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SET active = false"),
    );
    expect(deactivateCall).toBeUndefined();
    const rescheduleCall = mockPoolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SET next_run_at = $1 WHERE id = $2"),
    );
    expect(rescheduleCall).toBeDefined();
  });

  it("never throws when executeScan itself throws", async () => {
    const schedule = makeSchedule({ id: 14 });
    mockExecuteScan.mockRejectedValueOnce(new Error("scan blew up"));

    const result = await processSchedule(schedule);

    expect(result.outcome).toBe("error");
    expect(result.detail).toContain("scan blew up");
  });
});

describe("runInBatches (bounded concurrency)", () => {
  it("never runs more than batchSize items concurrently", async () => {
    let current = 0;
    let maxConcurrent = 0;
    const worker = async (item: number) => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((resolve) => setTimeout(resolve, 5));
      current--;
      return item * 2;
    };

    const items = Array.from({ length: 11 }, (_, i) => i + 1);
    const results = await runInBatches(items, 3, worker);

    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(results).toEqual(items.map((i) => i * 2));
  });

  it("processes every item exactly once even when batchSize does not evenly divide the item count", async () => {
    const seen: number[] = [];
    const worker = async (item: number) => {
      seen.push(item);
      return item;
    };
    const items = [1, 2, 3, 4, 5, 6, 7];
    await runInBatches(items, 3, worker);
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it("treats a batchSize larger than the item count as running everything in one batch", async () => {
    let current = 0;
    let maxConcurrent = 0;
    const worker = async (item: number) => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((resolve) => setTimeout(resolve, 1));
      current--;
      return item;
    };
    const items = [1, 2, 3];
    await runInBatches(items, 100, worker);
    expect(maxConcurrent).toBe(3);
  });

  it("clamps a zero or negative batchSize up to 1 instead of looping forever or dividing by zero", async () => {
    const seen: number[] = [];
    const worker = async (item: number) => {
      seen.push(item);
      return item;
    };
    await runInBatches([1, 2, 3], 0, worker);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("returns an empty array for an empty item list without calling the worker", async () => {
    const worker = vi.fn(async (x: number) => x);
    const results = await runInBatches([], 5, worker);
    expect(results).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });
});

describe("runDueSchedules (end to end: claim + bounded-concurrency processing)", () => {
  // AUDIT-012#logic-07: FEATURE_SCHEDULED_SCANS used to gate only schedule
  // CREATION, so turning it off in /admin left every existing schedule
  // running. The kill switch has to stop the worker too.
  it("claims and runs nothing while FEATURE_SCHEDULED_SCANS is off", async () => {
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "FEATURE_SCHEDULED_SCANS" ? false : 3,
    );
    mockClientQuery.mockImplementation(async () => ({ rows: [] }));

    const stats = await runDueSchedules();

    expect(stats).toEqual({
      processed: 0,
      scanned: 0,
      blocked: 0,
      planGated: 0,
      errors: 0,
    });
    // The claim transaction never even opened, so no due row was soft-locked
    // and pushed forward: flipping the switch back on resumes the normal
    // cadence rather than skipping an occurrence.
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(mockGetSetting).not.toHaveBeenCalledWith(
      "SCHEDULE_WORKER_CLAIM_LIMIT",
    );
  });

  it("reports an all-zero pass when nothing is due, without touching the concurrency setting", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FOR UPDATE SKIP LOCKED")) return { rows: [] };
      return { rows: [] };
    });

    const stats = await runDueSchedules();

    expect(stats).toEqual({
      processed: 0,
      scanned: 0,
      blocked: 0,
      planGated: 0,
      errors: 0,
    });
    // SCHEDULE_WORKER_CLAIM_LIMIT is read unconditionally -- it bounds the
    // claim query itself, so there's no way to know anything is due without
    // it. SCHEDULE_WORKER_BATCH_CONCURRENCY only matters once there's work
    // to batch, so that one should still be skipped on the empty path.
    expect(mockGetSetting).toHaveBeenCalledWith("SCHEDULE_WORKER_CLAIM_LIMIT");
    expect(mockGetSetting).not.toHaveBeenCalledWith(
      "SCHEDULE_WORKER_BATCH_CONCURRENCY",
    );
  });

  it("never runs more concurrent scans than SCHEDULE_WORKER_BATCH_CONCURRENCY, even with a large due backlog", async () => {
    const DUE_COUNT = 9;
    const CONCURRENCY = 2;
    mockGetSetting.mockResolvedValue(CONCURRENCY);

    const claimed = Array.from({ length: DUE_COUNT }, (_, i) =>
      makeSchedule({ id: i + 1 }),
    );
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FOR UPDATE SKIP LOCKED")) return { rows: claimed };
      return { rows: [] };
    });

    let current = 0;
    let maxConcurrent = 0;
    mockValidateScanTarget.mockImplementation(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((resolve) => setTimeout(resolve, 5));
      current--;
      return { safe: true };
    });
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO scan_history")) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const stats = await runDueSchedules();

    expect(maxConcurrent).toBeLessThanOrEqual(CONCURRENCY);
    expect(stats.processed).toBe(DUE_COUNT);
    expect(stats.scanned).toBe(DUE_COUNT);
    expect(mockExecuteScan).toHaveBeenCalledTimes(DUE_COUNT);
  });

  it("isolates failures: one schedule erroring, one blocked, and one scanned all resolve independently in the same pass", async () => {
    mockGetSetting.mockResolvedValue(5);
    const claimed = [
      makeSchedule({ id: 1, url: "https://good.example.com" }),
      makeSchedule({ id: 2, url: "https://bad-target.example.com" }),
      makeSchedule({ id: 3, url: "https://erroring.example.com" }),
    ];
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FOR UPDATE SKIP LOCKED")) return { rows: claimed };
      return { rows: [] };
    });

    mockValidateScanTarget.mockImplementation(async (url: string) => {
      if (url.includes("bad-target")) {
        return { safe: false, reason: "blocked host" };
      }
      return { safe: true };
    });

    mockPoolQuery.mockImplementation(
      async (sql: string, params?: unknown[]) => {
        if (sql.includes("INSERT INTO scan_history")) {
          const url = params?.[1] as string;
          if (url.includes("erroring")) {
            throw new Error("db exploded");
          }
          return { rows: [{ id: 1 }], rowCount: 1 };
        }
        if (sql.includes("SELECT email FROM users")) {
          return { rows: [{ email: "owner@example.com" }] };
        }
        return { rows: [], rowCount: 1 };
      },
    );

    const stats = await runDueSchedules();

    expect(stats).toEqual({
      processed: 3,
      scanned: 1,
      blocked: 1,
      planGated: 0,
      errors: 1,
    });
    // Only the safe, non-erroring schedule actually reached executeScan.
    expect(mockExecuteScan).toHaveBeenCalledTimes(1);
  });
});
