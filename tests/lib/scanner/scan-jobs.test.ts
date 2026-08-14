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
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () =>
      Promise.resolve({
        query: (...args: unknown[]) => mockClientQuery(...args),
        release: (...args: unknown[]) => mockRelease(...args),
      }),
  },
}));

const {
  ScanCancelledError,
  requestCancel,
  isCancelled,
  clearCancel,
  createProgressTracker,
  startWatchdog,
  finalizeScanSuccess,
  finalizeScanFailure,
  markScanRunning,
  sweepStaleScans,
} = await import("@/lib/scanner/scan-jobs");

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

describe("createProgressTracker", () => {
  it("persists current_category and the total on a start event", () => {
    const { onProgress, setTotal } = createProgressTracker(42);
    setTotal(5);
    onProgress("headers", "start");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("current_category = $1");
    expect(sql).toContain("categories_total = $2");
    expect(sql).toContain("status IN ('pending', 'running')");
    expect(params).toEqual(["headers", 5, 42]);
  });

  it("increments categories_completed on each done event", () => {
    const { onProgress, setTotal } = createProgressTracker(42);
    setTotal(3);
    onProgress("headers", "done");
    onProgress("ssl", "done");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [, firstParams] = mockQuery.mock.calls[0];
    const [, secondParams] = mockQuery.mock.calls[1];
    expect(firstParams).toEqual([1, 3, 42]);
    expect(secondParams).toEqual([2, 3, 42]);
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
  it("fails every pending/running row and returns the count", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      rowCount: 3,
    });

    const count = await sweepStaleScans();

    expect(count).toBe(3);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain("WHERE status IN ('pending', 'running')");
    expect(sql).not.toContain("$1"); // no scan-id scoping -- sweeps everything
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
