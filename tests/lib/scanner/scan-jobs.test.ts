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
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
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
} = await import("@/lib/scanner/scan-jobs");

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
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
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });

    const applied = await finalizeScanSuccess(5, {
      summary: { critical: 0, total: 1 },
      findings: [{ id: "a" }],
      duration: 1234,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: { "x-test": "1" },
      resultMeta: { checksRun: 10, dangerScore: 2 },
    });

    expect(applied).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
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
      5,
    ]);
  });

  it("returns false when the row already reached a terminal state (guard no-op)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

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
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, url: "https://www.example.com/path" }],
      rowCount: 1,
    });
    // The upsert itself issues a second pool.query call; the default
    // mockResolvedValue from beforeEach answers it.

    await finalizeScanSuccess(5, {
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      findings: [{ id: "a", severity: "critical", title: "SQL Injection" }],
      duration: 1234,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [upsertSql, upsertParams] = mockQuery.mock.calls[1];
    expect(upsertSql).toContain("INSERT INTO host_reputation");
    expect(upsertSql).toContain("ON CONFLICT (host) DO UPDATE");
    // Normalized the same way storage/lookup always does: strip www,
    // collapse to the root domain.
    expect(upsertParams[0]).toBe("example.com");
    expect(upsertParams[4]).toBe(5);
  });

  it("does not touch host_reputation when the row was already terminal", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await finalizeScanSuccess(5, {
      summary: {},
      findings: [],
      duration: 1,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("does not touch host_reputation when the returned row has no url (raw-IP or unusual target)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });

    await finalizeScanSuccess(5, {
      summary: {},
      findings: [],
      duration: 1,
      scannedAt: "2026-01-01T00:00:00.000Z",
      responseHeaders: {},
      resultMeta: {},
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
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
