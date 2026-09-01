/**
 * Tests for the background-scan-job primitives shared by
 * app/api/v3/scan/route.ts and app/api/v3/scan/crawl/route.ts.
 *
 * Mocks only the database pool (the boundary these functions actually
 * cross) so the real SQL and guard logic run against a controllable
 * fake result set.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockQuery = vi.fn();
// finalizeScanSuccess runs its status-flip UPDATE and (when it applies) the
// auto-tags INSERT on a dedicated transactional client (pool.connect()),
// not the plain pool -- see lib/scanner/scan-jobs.ts's own comment for why
// (atomicity: a poller must never observe status='completed' before the
// tags exist). Every other function under test here still goes through
// plain pool.query, mocked separately via mockQuery.
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();
/**
 * The interleaving of plain pool.query calls and pool.connect calls, which a
 * per-mock call count cannot express. finalizeScanSuccess has to warm the
 * promoted-auto-tag-rules cache BEFORE it takes a connection: on a cache miss
 * inside its own open transaction, loadPromotedRules asks the pool for a
 * SECOND connection, and with CONFIG_DB_POOL_MAX = 10 that deadlocks once ten
 * scans finalize in the same miss window (AUDIT-012#perf-25).
 */
const mockPoolCallOrder: string[] = [];
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => {
      mockPoolCallOrder.push(`query:${String(args[0] ?? "")}`);
      return mockQuery(...args);
    },
    connect: () => {
      mockPoolCallOrder.push("connect");
      return Promise.resolve({
        query: (...args: unknown[]) => mockClientQuery(...args),
        release: (...args: unknown[]) => mockRelease(...args),
      });
    },
  },
}));

// sweepStaleScans sizes its age guard from the admin-configured scan budgets.
// Mocked so the guard's arithmetic is asserted against known numbers, and so
// the settings lookup does not consume the pool.query responses each test
// queues for the statement actually under test.
const mockGetSettings = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

const {
  ScanCancelledError,
  requestCancel,
  isCancelled,
  clearCancel,
  getCancelSignal,
  createProgressTracker,
  startWatchdog,
  finalizeScanSuccess,
  finalizeScanFailure,
  markScanRunning,
  sweepStaleScans,
} = await import("@/lib/scanner/scan-jobs");

const { invalidatePromotedRulesCache } = await import("@/lib/tags/auto-tags");

/**
 * Queues client.query's responses for the transaction finalizeScanSuccess
 * opens: BEGIN first (return value unused by the code), then the status-
 * flip UPDATE's RETURNING result. COMMIT (and ROLLBACK, on the error-path
 * tests) fall through to mockClientQuery's default mockResolvedValue, same
 * reasoning -- their return value is never read either.
 */
function mockUpdateResult(result: { rows: unknown[]; rowCount: number }) {
  mockClientQuery.mockResolvedValueOnce({}); // BEGIN
  mockClientQuery.mockResolvedValueOnce(result); // UPDATE ... RETURNING ...
}

beforeEach(() => {
  mockGetSettings.mockReset();
  mockGetSettings.mockResolvedValue({
    SCAN_TIMEOUT_SECONDS: 300,
    CRAWL_SCAN_TIMEOUT_SECONDS: 900,
  });
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
  mockClientQuery.mockReset();
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockRelease.mockReset();
});

describe("cancellation registry", () => {
  it("starts un-flagged, flags on requestCancel, and forgets on clearCancel", () => {
    expect(isCancelled(101)).toBe(false);
    requestCancel(101);
    expect(isCancelled(101)).toBe(true);
    // Scoped per scan id — flagging one never affects another.
    expect(isCancelled(102)).toBe(false);
    clearCancel(101);
    expect(isCancelled(101)).toBe(false);
  });
});

describe("getCancelSignal", () => {
  it("returns a signal that is not aborted for a scan that was never cancelled", () => {
    const signal = getCancelSignal(201);
    expect(signal.aborted).toBe(false);
    clearCancel(201);
  });

  it("aborts the signal the moment requestCancel is called for that scan id", () => {
    const signal = getCancelSignal(202);
    expect(signal.aborted).toBe(false);
    requestCancel(202);
    expect(signal.aborted).toBe(true);
    clearCancel(202);
  });

  it("returns an already-aborted signal when requestCancel fired before the first getCancelSignal call", () => {
    requestCancel(203);
    const signal = getCancelSignal(203);
    expect(signal.aborted).toBe(true);
    clearCancel(203);
  });

  it("never aborts another scan's signal", () => {
    const signalA = getCancelSignal(204);
    const signalB = getCancelSignal(205);
    requestCancel(204);
    expect(signalA.aborted).toBe(true);
    expect(signalB.aborted).toBe(false);
    clearCancel(204);
    clearCancel(205);
  });

  it("returns the same signal instance across repeated calls for one scan id", () => {
    const first = getCancelSignal(206);
    const second = getCancelSignal(206);
    expect(first).toBe(second);
    clearCancel(206);
  });
});

describe("createProgressTracker", () => {
  it("persists current_category, the count and the total in one UPDATE on the first event", () => {
    const { onProgress, setTotal } = createProgressTracker(42);
    setTotal(5);
    onProgress("headers", "start");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("current_category = $1");
    expect(sql).toContain("categories_completed = $2");
    expect(sql).toContain("categories_total = $3");
    expect(sql).toContain("status IN ('pending', 'running')");
    // $5 is the in-progress findings list, merged into result_meta by the same
    // UPDATE so the poll can show what the scan has turned up so far.
    // ref: AUDIT-014#scanui-02
    expect(params).toEqual([
      "headers",
      0,
      5,
      42,
      JSON.stringify({ partialFindings: [] }),
    ]);
  });

  // ref: AUDIT-012#perf-12. Progress used to write one UPDATE per event, two
  // per category, on the widest row in the schema. Events inside the coalescing
  // window must now produce no extra writes: the first one lands immediately
  // and the rest are folded into the trailing flush.
  it("coalesces a burst of events into a single write", () => {
    const { onProgress, setTotal } = createProgressTracker(42);
    setTotal(3);
    onProgress("headers", "start");
    onProgress("headers", "done");
    onProgress("ssl", "start");
    onProgress("ssl", "done");

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("flush() lands the coalesced counters that the burst did not write", () => {
    const { onProgress, setTotal, flush } = createProgressTracker(42);
    setTotal(3);
    onProgress("headers", "done");
    onProgress("ssl", "done");
    flush();

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [, lastParams] = mockQuery.mock.calls[1];
    expect(lastParams.slice(0, 4)).toEqual([null, 2, 3, 42]);
  });

  /**
   * AUDIT-014#scanui-02: the poll used to carry a family name, two counters
   * and a clock, so the user saw none of the scan's output for its whole
   * duration and then all of it at once.
   */
  it("accumulates the findings each category reports, for the live poll", () => {
    const { onProgress, setTotal, flush } = createProgressTracker(42);
    setTotal(2);
    onProgress("headers", "done", {
      newFindings: [{ severity: "high", title: "Missing CSP" }],
    });
    onProgress("ssl", "done", {
      newFindings: [{ severity: "low", title: "Weak cipher offered" }],
    });
    flush();

    const [sql, params] = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
    expect(sql).toContain("result_meta");
    expect(JSON.parse(params[4] as string)).toEqual({
      partialFindings: [
        { severity: "high", title: "Missing CSP" },
        { severity: "low", title: "Weak cipher offered" },
      ],
    });
  });

  it("caps the accumulated findings so a 2-second poll stays small", () => {
    const { onProgress, setTotal, flush } = createProgressTracker(42);
    setTotal(1);
    onProgress("headers", "done", {
      newFindings: Array.from({ length: 100 }, (_, i) => ({
        severity: "low" as const,
        title: `Finding ${i}`,
      })),
    });
    flush();

    const [, params] = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
    const { partialFindings } = JSON.parse(params[4] as string);
    expect(partialFindings).toHaveLength(40);
  });

  it("flush() writes nothing when there is no coalesced progress left", () => {
    const { onProgress, setTotal, flush } = createProgressTracker(42);
    setTotal(1);
    onProgress("headers", "start");
    expect(mockQuery).toHaveBeenCalledTimes(1);

    flush();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("throws ScanCancelledError on a start event when the scan was cancelled, without writing anything", () => {
    requestCancel(99);
    const { onProgress, setTotal } = createProgressTracker(99);
    setTotal(1);

    expect(() => onProgress("dns", "start")).toThrow(ScanCancelledError);
    expect(mockQuery).not.toHaveBeenCalled();

    clearCancel(99);
  });

  it("does not throw on a done event even when cancelled (only start checks)", () => {
    requestCancel(77);
    const { onProgress, setTotal } = createProgressTracker(77);
    setTotal(1);

    expect(() => onProgress("dns", "done")).not.toThrow();

    clearCancel(77);
  });
});

describe("startWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the scan failed with the given reason once the timeout elapses", async () => {
    const handle = startWatchdog(7, 1000, "Scan exceeded the 1s time limit.");

    await vi.advanceTimersByTimeAsync(1000);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain("status IN ('pending', 'running')");
    expect(params[0]).toBe("Scan exceeded the 1s time limit.");
    expect(params[1]).toBe(7);

    clearTimeout(handle);
  });

  it("does nothing before the timeout elapses", async () => {
    const handle = startWatchdog(8, 5000, "too slow");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockQuery).not.toHaveBeenCalled();
    clearTimeout(handle);
  });

  it("is a no-op once cleared", async () => {
    const handle = startWatchdog(9, 1000, "too slow");
    clearTimeout(handle);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("finalizeScanSuccess", () => {
  it("writes the completed result and returns true when the row was pending/running", async () => {
    mockUpdateResult({ rows: [{ id: 5 }], rowCount: 1 });

    const applied = await finalizeScanSuccess(5, {
      summary: { critical: 0, total: 1 },
      findings: [{ id: "a" }],
      duration: 1234,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: { "x-test": "1" },
      resultMeta: { checksRun: 10, dangerScore: 2 },
    });

    expect(applied).toBe(true);
    const [sql, params] = mockClientQuery.mock.calls[1];
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("categories_completed = categories_total");
    expect(params).toEqual([
      JSON.stringify([{ id: "a" }]),
      1,
      JSON.stringify({ critical: 0, total: 1 }),
      1234,
      "2026-01-01T00:00:00.000Z",
      JSON.stringify({ "x-test": "1" }),
      JSON.stringify({ checksRun: 10, dangerScore: 2 }),
      null, // finalUrl not passed -- COALESCE(NULL, url) leaves url untouched
      5,
      null, // authenticated not passed -- COALESCE(NULL, authenticated) leaves it
    ]);
    // Transaction wrapped and committed: BEGIN, UPDATE, COMMIT.
    expect(mockClientQuery.mock.calls[0][0]).toBe("BEGIN");
    expect(mockClientQuery.mock.calls[2][0]).toBe("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("writes finalUrl into the url column when safeFetch followed a redirect", async () => {
    mockUpdateResult({ rows: [{ id: 5 }], rowCount: 1 });

    await finalizeScanSuccess(5, {
      summary: {},
      findings: [],
      duration: 1,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
      finalUrl: "https://sandbox.vulnradar.dev/landing",
    });

    const [sql, params] = mockClientQuery.mock.calls[1];
    expect(sql).toContain("url = COALESCE($8, url)");
    expect((params as unknown[])[7]).toBe(
      "https://sandbox.vulnradar.dev/landing",
    );
  });

  it("returns false when the row already reached a terminal state (guard no-op)", async () => {
    mockUpdateResult({ rows: [], rowCount: 0 });

    const applied = await finalizeScanSuccess(5, {
      summary: {},
      findings: [],
      duration: 1,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    expect(applied).toBe(false);
  });

  it("upserts host_reputation from the RETURNING url once the row applies", async () => {
    mockUpdateResult({
      rows: [{ id: 5, url: "https://www.example.com/path" }],
      rowCount: 1,
    });
    // The upsert runs on the plain pool (fire-and-forget, outside the
    // transaction) -- the default mockResolvedValue from beforeEach answers it.

    await finalizeScanSuccess(5, {
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      findings: [{ id: "a", severity: "critical", title: "SQL Injection" }],
      duration: 1234,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [upsertSql, upsertParams] = mockQuery.mock.calls[0];
    expect(upsertSql).toContain("INSERT INTO host_reputation");
    expect(upsertSql).toContain("ON CONFLICT (host) DO UPDATE");
    // Normalized the same way storage/lookup always does: strip www,
    // collapse to the root domain.
    expect(upsertParams[0]).toBe("example.com");
    expect(upsertParams[4]).toBe(5);
  });

  it("saves auto tags from the RETURNING user_id once the row applies, on the same transactional client as the UPDATE", async () => {
    mockUpdateResult({
      rows: [{ id: 5, url: "https://example.com", user_id: 42 }],
      rowCount: 1,
    });
    // upsertHostReputation issues one plain pool.query call; the default
    // mockResolvedValue from beforeEach answers it.

    await finalizeScanSuccess(5, {
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      findings: [
        {
          id: "a",
          severity: "critical",
          title: "SQL Injection",
          category: "code",
        },
      ],
      duration: 1234,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    // BEGIN, UPDATE, tags INSERT, COMMIT -- all on the same client, so the
    // INSERT commits atomically with the status flip.
    expect(mockClientQuery).toHaveBeenCalledTimes(4);
    const [tagsSql, tagsParams] = mockClientQuery.mock.calls[2];
    expect(tagsSql).toContain("INSERT INTO scan_tags");
    expect(tagsSql).toContain("'auto'");
    expect(tagsParams).toContain(5); // scanId
    expect(tagsParams).toContain(42); // user_id from RETURNING
    expect(tagsParams).toContain("Critical Exposure");
    expect(mockClientQuery.mock.calls[3][0]).toBe("COMMIT");
  });

  it("loads the promoted auto-tag rules BEFORE it takes a pool connection", async () => {
    // The deadlock this guards against needs a cache MISS to reproduce, so
    // force one. Re-loading here leaves the cache warm again, which is the
    // state every other test in this file is written against.
    invalidatePromotedRulesCache();
    mockPoolCallOrder.length = 0;
    mockUpdateResult({
      rows: [{ id: 5, url: "https://example.com", user_id: 42 }],
      rowCount: 1,
    });

    await finalizeScanSuccess(5, {
      summary: { critical: 1 },
      findings: [{ id: "a", severity: "critical", title: "SQL Injection" }],
      duration: 1234,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    const rulesAt = mockPoolCallOrder.findIndex((c) =>
      c.includes("promoted_auto_tag_rules"),
    );
    const connectAt = mockPoolCallOrder.indexOf("connect");
    expect(connectAt).toBeGreaterThanOrEqual(0);
    expect(
      rulesAt,
      `pool call order was: ${mockPoolCallOrder.map((c) => c.split("\n")[0]).join(" | ")}`,
    ).toBeGreaterThanOrEqual(0);
    // Strictly before: a rules SELECT issued after connect() is a second
    // connection requested while the transaction still holds the first.
    expect(rulesAt).toBeLessThan(connectAt);
  });

  it("does not save auto tags when the RETURNING row has no user_id", async () => {
    mockUpdateResult({
      rows: [{ id: 5, url: "https://example.com" }],
      rowCount: 1,
    });

    await finalizeScanSuccess(5, {
      summary: { critical: 1 },
      findings: [{ id: "a", severity: "critical", title: "SQL Injection" }],
      duration: 1234,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    // Only BEGIN, UPDATE, COMMIT -- no tags INSERT.
    expect(mockClientQuery).toHaveBeenCalledTimes(3);
    // ...and the host_reputation upsert (the only plain pool.query call).
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("does not touch host_reputation when the row was already terminal", async () => {
    mockUpdateResult({ rows: [], rowCount: 0 });

    await finalizeScanSuccess(5, {
      summary: {},
      findings: [],
      duration: 1,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not touch host_reputation when the returned row has no url (raw-IP or unusual target)", async () => {
    mockUpdateResult({ rows: [{ id: 5 }], rowCount: 1 });

    await finalizeScanSuccess(5, {
      summary: {},
      findings: [],
      duration: 1,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not touch host_reputation when the scan was marked private", async () => {
    mockUpdateResult({
      rows: [{ id: 5, url: "https://example.com", is_public: false }],
      rowCount: 1,
    });

    await finalizeScanSuccess(5, {
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      findings: [{ id: "a", severity: "critical", title: "SQL Injection" }],
      duration: 1234,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    // upsertHostReputation (the only plain pool.query call) never fires
    // for a private scan.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rolls back and releases the client, then rethrows, when the UPDATE itself fails", async () => {
    mockClientQuery.mockResolvedValueOnce({}); // BEGIN
    mockClientQuery.mockRejectedValueOnce(new Error("db down")); // UPDATE

    await expect(
      finalizeScanSuccess(5, {
        summary: {},
        findings: [],
        duration: 1,
        scannedAt: "2026-01-01T00:00:00.000Z",
        responseHeaders: {},
        resultMeta: {},
      }),
    ).rejects.toThrow("db down");

    const rollbackCall = mockClientQuery.mock.calls.find(
      ([sql]) => sql === "ROLLBACK",
    );
    expect(rollbackCall).toBeDefined();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("commits even when saveAutoTags' own INSERT fails (it catches internally and never throws)", async () => {
    mockUpdateResult({
      rows: [{ id: 5, url: "https://example.com", user_id: 42 }],
      rowCount: 1,
    });
    // 3rd client.query call (index 2) is the tags INSERT -- make it reject.
    mockClientQuery.mockRejectedValueOnce(new Error("unique violation"));

    const applied = await finalizeScanSuccess(5, {
      summary: { critical: 1 },
      findings: [{ id: "a", severity: "critical", title: "SQL Injection" }],
      duration: 1234,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    // The scan still completes -- a tag-save failure is non-fatal and must
    // not roll back the status flip.
    expect(applied).toBe(true);
    const commitCall = mockClientQuery.mock.calls.find(
      ([sql]) => sql === "COMMIT",
    );
    expect(commitCall).toBeDefined();
  });
});

describe("finalizeScanFailure", () => {
  it("writes failed status with the reason and returns true when applied", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9 }], rowCount: 1 });

    const applied = await finalizeScanFailure(
      9,
      "Could not reach the target URL.",
    );

    expect(applied).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain("status IN ('pending', 'running')");
    expect(params[0]).toBe("Could not reach the target URL.");
    expect(params[1]).toBe(9);
  });

  it("truncates an overlong reason", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9 }], rowCount: 1 });
    const longReason = "x".repeat(5000);

    await finalizeScanFailure(9, longReason);

    const [, params] = mockQuery.mock.calls[0];
    expect((params[0] as string).length).toBe(2000);
  });

  it("returns false when the row already reached a terminal state", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const applied = await finalizeScanFailure(9, "boom");
    expect(applied).toBe(false);
  });
});

describe("markScanRunning", () => {
  it("flips a pending row to running", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 });
    await markScanRunning(3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'running'");
    expect(sql).toContain("status = 'pending'");
    expect(params).toEqual([3]);
  });

  it("swallows a query failure instead of throwing", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    await expect(markScanRunning(3)).resolves.toBeUndefined();
  });
});

describe("sweepStaleScans", () => {
  it("fails stale pending/running rows and returns the count", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      rowCount: 3,
    });

    const count = await sweepStaleScans();

    expect(count).toBe(3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain("WHERE status IN ('pending', 'running')");
    // Bounded by age, not by scan id. The previous form of this test asserted
    // the statement took no parameters at all, which pinned the bug: an
    // unbounded sweep fails the scans a CONCURRENT instance is still running
    // during a rolling deploy, and finalizeScanSuccess then matches nothing.
    expect(sql).toContain(
      "COALESCE(started_at, scanned_at, TIMESTAMP 'epoch')",
    );
    expect(sql).toContain("NOW() - ($1 || ' seconds')::interval");
    expect(params).toEqual([String(900 * 2)]);
  });

  it("sizes the age guard at twice the longest configured budget", async () => {
    mockGetSettings.mockResolvedValue({
      SCAN_TIMEOUT_SECONDS: 1800,
      CRAWL_SCAN_TIMEOUT_SECONDS: 600,
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await sweepStaleScans();

    // the single scan budget wins here, not the crawl one
    expect(mockQuery.mock.calls[0][1]).toEqual([String(1800 * 2)]);
  });

  it("never drops below the fifteen-minute floor", async () => {
    mockGetSettings.mockResolvedValue({
      SCAN_TIMEOUT_SECONDS: 30,
      CRAWL_SCAN_TIMEOUT_SECONDS: 60,
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await sweepStaleScans();

    // 60 * 2 = 120s would sweep a scan a healthy instance is still running
    expect(mockQuery.mock.calls[0][1]).toEqual([String(15 * 60)]);
  });

  it("returns 0 when nothing was stale", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const count = await sweepStaleScans();
    expect(count).toBe(0);
  });

  it("returns 0 when rowCount is null", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: null });
    const count = await sweepStaleScans();
    expect(count).toBe(0);
  });
});
