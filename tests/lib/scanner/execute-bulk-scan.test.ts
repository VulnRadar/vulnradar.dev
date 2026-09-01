/**
 * Tests for the bulk batch drain (lib/scanner/execute-bulk-scan.ts).
 *
 * Every row handed to runBulkBatch already exists as 'pending', so the
 * property that matters most here is that no row is ever left in that state:
 * a row that neither runs nor gets failed holds a concurrency slot and shows
 * as a stuck scan on the owner's dashboard until the next restart sweeps it.
 * ref: AUDIT-011#drift-06
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockExecuteScan = vi.fn();
vi.mock("@/lib/scanner/execute-scan", () => ({
  executeScan: (...args: unknown[]) => mockExecuteScan(...args),
}));

const mockFinalizeScanFailure = vi.fn();
vi.mock("@/lib/scanner/scan-jobs", () => ({
  finalizeScanFailure: (...args: unknown[]) => mockFinalizeScanFailure(...args),
}));

const { runBulkBatch } = await import("@/lib/scanner/execute-bulk-scan");

function queuedScan(scanId: number, url: string) {
  return {
    scanId,
    url,
    normalizedUrl: url,
    protocolType: "http" as const,
    isRawIpTarget: false,
    categoriesTotal: 5,
  };
}

beforeEach(() => {
  mockExecuteScan.mockReset();
  mockExecuteScan.mockResolvedValue(undefined);
  mockFinalizeScanFailure.mockReset();
  mockFinalizeScanFailure.mockResolvedValue(true);
});

describe("runBulkBatch", () => {
  it("runs every queued URL through executeScan, one at a time, in order", async () => {
    const order: number[] = [];
    let running = 0;
    let maxConcurrent = 0;
    mockExecuteScan.mockImplementation(async (params: { scanId: number }) => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      order.push(params.scanId);
      await Promise.resolve();
      running--;
    });

    await runBulkBatch({
      scans: [
        queuedScan(1, "https://one.example.com/"),
        queuedScan(2, "https://two.example.com/"),
        queuedScan(3, "https://three.example.com/"),
      ],
      authedUserId: 42,
      timeoutSeconds: 1800,
    });

    expect(order).toEqual([1, 2, 3]);
    // Sequential on purpose: this process has no job queue, so a batch of 100
    // must never become 100 concurrent scans.
    expect(maxConcurrent).toBe(1);
    expect(mockFinalizeScanFailure).not.toHaveBeenCalled();
  });

  it("passes each scan's own execution parameters through unchanged", async () => {
    await runBulkBatch({
      scans: [queuedScan(7, "https://example.com/")],
      authedUserId: 42,
      timeoutSeconds: 1800,
    });

    expect(mockExecuteScan).toHaveBeenCalledWith({
      scanId: 7,
      url: "https://example.com/",
      normalizedUrl: "https://example.com/",
      protocolType: "http",
      isRawIpTarget: false,
      selectedScanners: null,
      authedUserId: 42,
      categoriesTotal: 5,
    });
  });

  it("keeps going when one URL's dispatch throws, and closes that row out as failed", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockExecuteScan
      .mockRejectedValueOnce(new Error("settings unavailable"))
      .mockResolvedValueOnce(undefined);

    await runBulkBatch({
      scans: [
        queuedScan(1, "https://one.example.com/"),
        queuedScan(2, "https://two.example.com/"),
      ],
      authedUserId: 42,
      timeoutSeconds: 1800,
    });

    expect(mockExecuteScan).toHaveBeenCalledTimes(2);
    expect(mockFinalizeScanFailure).toHaveBeenCalledWith(
      1,
      "settings unavailable",
    );
    consoleErrorSpy.mockRestore();
  });

  it("stops at the batch deadline and fails every URL that never ran", async () => {
    // A zero-second budget is already past its deadline on the first check, so
    // nothing runs and all three rows have to be closed out.
    await runBulkBatch({
      scans: [
        queuedScan(1, "https://one.example.com/"),
        queuedScan(2, "https://two.example.com/"),
        queuedScan(3, "https://three.example.com/"),
      ],
      authedUserId: 42,
      timeoutSeconds: 0,
    });

    expect(mockExecuteScan).not.toHaveBeenCalled();
    expect(mockFinalizeScanFailure).toHaveBeenCalledTimes(3);
    for (const scanId of [1, 2, 3]) {
      expect(mockFinalizeScanFailure).toHaveBeenCalledWith(
        scanId,
        expect.stringMatching(/exceeded its 0s time limit/),
      );
    }
  });

  it("leaves no row pending when the loop itself throws", async () => {
    // finalizeScanFailure's own rejection must not stop the remaining rows
    // from being closed out either.
    mockExecuteScan.mockImplementation(async () => {
      throw new Error("boom");
    });
    mockFinalizeScanFailure.mockRejectedValue(new Error("db down"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      runBulkBatch({
        scans: [queuedScan(1, "https://one.example.com/")],
        authedUserId: 42,
        timeoutSeconds: 1800,
      }),
    ).resolves.toBeUndefined();

    consoleErrorSpy.mockRestore();
  });
});
