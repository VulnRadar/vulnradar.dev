import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockConnect = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () => mockConnect(),
  },
}));

const mockGetUserPlanLimits = vi.fn();
vi.mock("@/lib/billing/plan-limits", () => ({
  getUserPlanLimits: (...args: unknown[]) => mockGetUserPlanLimits(...args),
}));

const {
  checkConcurrentScanLimit,
  reserveConcurrentScanSlot,
  reserveConcurrentScanBatch,
  withInlineScanSlot,
  __resetInlineScanSlots,
} = await import("@/lib/rate-limiting/concurrent-scans");

function planLimits(concurrentScans: number) {
  return {
    dailyScans: 100,
    apiKeys: 1,
    apiRequestsPerDay: 100,
    teams: 0,
    teamMembers: 0,
    webhooks: 0,
    scheduledScans: 0,
    bulkScanUrls: 0,
    githubReviewTokensPerWindow: 0,
    aiTokensPerWindow: 0,
    browserbaseMinutesPerMonth: 0,
    concurrentScans,
  };
}

/**
 * Fake PoolClient that records every statement in order, so a test can assert
 * the ORDER of BEGIN / advisory lock / count / insert / COMMIT rather than just
 * that they all happened. The lock has to be taken before the count or the
 * whole race fix is a no-op.
 */
function fakeClient(counts: number[]) {
  const statements: string[] = [];
  const remaining = [...counts];
  return {
    statements,
    released: 0,
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      statements.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: remaining.shift() ?? 0 }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockGetUserPlanLimits.mockReset();
});

describe("checkConcurrentScanLimit", () => {
  it("is unlimited without querying the database when billing is disabled (getUserPlanLimits returns null)", async () => {
    mockGetUserPlanLimits.mockResolvedValue(null);
    const result = await checkConcurrentScanLimit(1);
    expect(result).toEqual({ allowed: true, current: 0, limit: -1 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("is unlimited without querying the database when the plan's own limit is -1", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(-1));
    const result = await checkConcurrentScanLimit(1);
    expect(result).toEqual({ allowed: true, current: 0, limit: -1 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows the request when current in-flight scans are under the limit", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(3));
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
    const result = await checkConcurrentScanLimit(7);
    expect(result).toEqual({ allowed: true, current: 1, limit: 3 });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status IN ('pending', 'running')");
    expect(params).toEqual([7]);
  });

  it("blocks with a clear message once at the limit", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(3));
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 3 }] });
    const result = await checkConcurrentScanLimit(7);
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(3);
    expect(result.limit).toBe(3);
    expect(result.message).toMatch(/already have 3 scan\(s\) running/i);
  });

  it("blocks when already over the limit (e.g. the limit was lowered by an admin after scans started)", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(2));
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 5 }] });
    const result = await checkConcurrentScanLimit(7);
    expect(result.allowed).toBe(false);
  });

  it("treats a missing count row as zero in-flight scans", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(3));
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await checkConcurrentScanLimit(7);
    expect(result).toEqual({ allowed: true, current: 0, limit: 3 });
  });

  it("blocks outright when the plan's limit is 0", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(0));
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    const result = await checkConcurrentScanLimit(7);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
  });
});

describe("resolveConcurrentLimit (via checkConcurrentScanLimit)", () => {
  it("fails CLOSED to a cap of 1 when the configured limit is corrupt (NaN)", async () => {
    // `current >= NaN` is always false, so a NaN limit used to grant unlimited
    // concurrency silently. The daily-quota path already fails closed on the
    // same corruption; this keeps the two consistent.
    mockGetUserPlanLimits.mockResolvedValue(planLimits(Number.NaN));
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
    const result = await checkConcurrentScanLimit(7);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(1);
  });
});

describe("reserveConcurrentScanSlot", () => {
  it("takes the per-user advisory lock BEFORE counting, then inserts and commits", async () => {
    // Order is the whole point: counting outside the lock (or after the
    // insert) reopens the check-then-act race this function exists to close.
    mockGetUserPlanLimits.mockResolvedValue(planLimits(3));
    const client = fakeClient([1]);
    mockConnect.mockResolvedValue(client);
    const insertRow = vi.fn(async () => 42);

    const result = await reserveConcurrentScanSlot(7, insertRow);

    expect(result).toEqual({ ok: true, scanId: 42 });
    expect(client.statements[0]).toBe("BEGIN");
    expect(client.statements[1]).toContain("pg_advisory_xact_lock");
    expect(client.statements[2]).toContain("SELECT COUNT(*)::int");
    expect(client.statements[3]).toBe("COMMIT");
    expect(insertRow).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("keys the advisory lock per user so two users never contend", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(3));
    const client = fakeClient([0]);
    mockConnect.mockResolvedValue(client);

    await reserveConcurrentScanSlot(99, async () => 1);

    const lockCall = client.query.mock.calls.find((c) =>
      String(c[0]).includes("pg_advisory_xact_lock"),
    );
    expect(lockCall?.[1]).toEqual(["concurrent-scan:99"]);
  });

  it("rolls back and inserts nothing when the in-transaction recount is at the limit", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(2));
    const client = fakeClient([2]);
    mockConnect.mockResolvedValue(client);
    const insertRow = vi.fn(async () => 42);

    const result = await reserveConcurrentScanSlot(7, insertRow);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.check.allowed).toBe(false);
      expect(result.check.current).toBe(2);
      expect(result.check.limit).toBe(2);
      expect(result.check.message).toMatch(/already have 2 scan\(s\) running/i);
    }
    expect(insertRow).not.toHaveBeenCalled();
    expect(client.statements).toContain("ROLLBACK");
    expect(client.statements).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the client when insertRow throws", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(3));
    const client = fakeClient([0]);
    mockConnect.mockResolvedValue(client);

    await expect(
      reserveConcurrentScanSlot(7, async () => {
        throw new Error("insert exploded");
      }),
    ).rejects.toThrow("insert exploded");

    expect(client.statements).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("skips the transaction entirely when the user is unlimited", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(-1));
    const client = fakeClient([]);
    mockConnect.mockResolvedValue(client);
    const insertRow = vi.fn(async () => 5);

    const result = await reserveConcurrentScanSlot(7, insertRow);

    expect(result).toEqual({ ok: true, scanId: 5 });
    expect(client.statements).toEqual([]);
    expect(insertRow).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

/**
 * A bulk batch is admitted as ONE unit: the cap says how many scans may RUN
 * at once, and the batch runs its URLs one at a time, so a submission of N
 * URLs never exceeds it. Reserving per URL instead would mean a plan selling
 * 10 URLs per batch with a concurrency cap of 2 could only ever queue 2 of
 * them. ref: AUDIT-011#drift-06
 */
describe("reserveConcurrentScanBatch", () => {
  it("takes the per-user advisory lock BEFORE counting, then inserts every row and commits", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(2));
    const client = fakeClient([1]);
    mockConnect.mockResolvedValue(client);
    const insertRows = vi.fn(async () => [11, 12, 13]);

    const result = await reserveConcurrentScanBatch(7, insertRows);

    expect(result).toEqual({ ok: true, scanIds: [11, 12, 13] });
    expect(client.statements[0]).toBe("BEGIN");
    expect(client.statements[1]).toContain("pg_advisory_xact_lock");
    expect(client.statements[2]).toContain("SELECT COUNT(*)::int");
    expect(client.statements[3]).toBe("COMMIT");
    expect(insertRows).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("admits a batch larger than the concurrency cap, since the batch runs one URL at a time", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(2));
    const client = fakeClient([0]);
    mockConnect.mockResolvedValue(client);

    const result = await reserveConcurrentScanBatch(7, async () => [
      1, 2, 3, 4,
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scanIds).toHaveLength(4);
  });

  it("refuses the whole batch when the account is already at capacity", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(1));
    const client = fakeClient([1]);
    mockConnect.mockResolvedValue(client);
    const insertRows = vi.fn(async () => [1]);

    const result = await reserveConcurrentScanBatch(7, insertRows);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.check.current).toBe(1);
      expect(result.check.limit).toBe(1);
    }
    expect(insertRows).not.toHaveBeenCalled();
    expect(client.statements).toContain("ROLLBACK");
    expect(client.statements).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the client when an insert throws part-way through", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(3));
    const client = fakeClient([0]);
    mockConnect.mockResolvedValue(client);

    await expect(
      reserveConcurrentScanBatch(7, async () => {
        throw new Error("insert exploded");
      }),
    ).rejects.toThrow("insert exploded");

    expect(client.statements).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("skips the transaction entirely when the user is unlimited", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(-1));
    const client = fakeClient([]);
    mockConnect.mockResolvedValue(client);

    const result = await reserveConcurrentScanBatch(7, async () => [9]);

    expect(result).toEqual({ ok: true, scanIds: [9] });
    expect(client.statements).toEqual([]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

/**
 * withInlineScanSlot covers the scan path that never holds a
 * 'pending'/'running' row: POST /api/v3/scan/authenticated (row written only
 * at the end). Before it existed that path took no slot, so the per-plan
 * concurrentScans cap did not apply to it and an operator watching
 * concurrency saw zero running scans while it ran.
 */
describe("withInlineScanSlot", () => {
  beforeEach(() => {
    __resetInlineScanSlots();
  });

  it("runs the work and releases the slot", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(1));
    mockQuery.mockResolvedValue({ rows: [{ count: 0 }] });

    const first = await withInlineScanSlot(7, async () => "done");
    expect(first).toEqual({ ok: true, value: "done" });

    // Slot released, so a second request goes through too.
    const second = await withInlineScanSlot(7, async () => "done again");
    expect(second).toEqual({ ok: true, value: "done again" });
  });

  it("refuses a second inline scan while the first still holds the slot", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(1));
    mockQuery.mockResolvedValue({ rows: [{ count: 0 }] });

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withInlineScanSlot(7, async () => {
      await held;
      return "first";
    });
    // Let the first call get past its count query and claim the slot.
    await new Promise((resolve) => setImmediate(resolve));

    const second = await withInlineScanSlot(7, async () => "second");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.check.limit).toBe(1);
      expect(second.check.current).toBe(1);
    }

    release();
    await first;
  });

  it("counts row-backed running scans against the same cap", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(2));
    mockQuery.mockResolvedValue({ rows: [{ count: 2 }] });

    const result = await withInlineScanSlot(7, async () => "never runs");
    expect(result.ok).toBe(false);
  });

  it("releases the slot when the work throws", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(1));
    mockQuery.mockResolvedValue({ rows: [{ count: 0 }] });

    await expect(
      withInlineScanSlot(7, async () => {
        throw new Error("scan exploded");
      }),
    ).rejects.toThrow("scan exploded");

    const after = await withInlineScanSlot(7, async () => "ok");
    expect(after).toEqual({ ok: true, value: "ok" });
  });

  it("skips the count query entirely when the user is unlimited", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(-1));
    mockQuery.mockReset();

    const result = await withInlineScanSlot(7, async () => "ok");

    expect(result).toEqual({ ok: true, value: "ok" });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
