/**
 * bug-scan-13, the execute-scan half: a scan whose row was no longer pending
 * when its turn came is not run at all.
 *
 * A queued bulk row the owner cancelled was only stopped by the in-memory
 * cancel flag, which expires after twenty minutes, so a row cancelled early
 * in a long batch still sent the target the scanner's whole request set.
 * markScanRunning is mocked to report what the database said; everything it
 * would have gone on to call is mocked too, so the assertion is that none of
 * it ran.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () =>
      Promise.resolve({
        query: (...args: unknown[]) => mockQuery(...args),
        release: () => {},
      }),
  },
}));

const mockMarkScanRunning = vi.fn();
vi.mock("@/lib/scanner/scan-jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scanner/scan-jobs")>()),
  markScanRunning: (...args: unknown[]) => mockMarkScanRunning(...args),
}));

const mockSafeFetch = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  validateScanTarget: vi.fn(async () => ({ safe: true })),
}));

const mockRunAsyncChecksDetailed = vi.fn();
vi.mock("@/lib/scanner/async-checks", () => ({
  runAsyncChecksDetailed: (...args: unknown[]) =>
    mockRunAsyncChecksDetailed(...args),
  getPlannedAsyncBranches: () => ["dns"],
}));

const mockScanPorts = vi.fn();
vi.mock("@/lib/scanner/port-scan", () => ({
  scanPorts: (...args: unknown[]) => mockScanPorts(...args),
  buildRiskyPortFindings: () => [],
}));

vi.mock("@/lib/scanner/subdomain-auto", () => ({
  autoDiscoverSubdomains: vi.fn(async () => {}),
  readSubdomains: vi.fn(() => undefined),
}));

const { executeScan } = await import("@/lib/scanner/execute-scan");

function params() {
  return {
    scanId: 5,
    url: "example.com",
    normalizedUrl: "https://example.com/",
    protocolType: "http" as const,
    isRawIpTarget: false,
    selectedScanners: null,
    authedUserId: 42,
    categoriesTotal: 2,
    portScan: true,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockMarkScanRunning.mockReset();
  mockSafeFetch.mockReset();
  mockRunAsyncChecksDetailed.mockReset();
  mockScanPorts.mockReset();
  mockScanPorts.mockResolvedValue(null);
});

describe("executeScan on a row it did not claim", () => {
  it("sends the target nothing and writes no result", async () => {
    mockMarkScanRunning.mockResolvedValue(false);

    await executeScan(params());

    expect(mockMarkScanRunning).toHaveBeenCalledWith(5);
    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(mockRunAsyncChecksDetailed).not.toHaveBeenCalled();
    expect(mockScanPorts).not.toHaveBeenCalled();
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        /SET status = '(completed|failed)'/.test(sql as string),
      ),
    ).toBe(false);
  });

  it("still runs when the claim reports nothing, as it did before it reported anything", async () => {
    mockMarkScanRunning.mockResolvedValue(undefined);
    mockSafeFetch.mockRejectedValue(new Error("stop here"));

    await executeScan(params());

    expect(mockSafeFetch).toHaveBeenCalled();
  });
});
