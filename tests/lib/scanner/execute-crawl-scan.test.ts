/**
 * Tests for the crawl background scan job body
 * (lib/scanner/execute-crawl-scan.ts).
 *
 * Mocks the database pool, the network (safeFetch), access rules, the
 * daily-quota helpers, and the check engines — page discovery and the
 * per-page check logic have their own coverage elsewhere. This exercises
 * the job envelope for a multi-page crawl: the tracker row goes
 * pending -> running -> completed with progress accumulated across pages,
 * and a genuine failure (no pages found) marks it failed with a reason.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    // finalizeScanSuccess (lib/scanner/scan-jobs.ts) runs its status-flip
    // UPDATE and auto-tags INSERT on a dedicated transactional client --
    // route it through the same mockQuery so existing SQL-text-based
    // mock branching still answers it.
    connect: () =>
      Promise.resolve({
        query: (...args: unknown[]) => mockQuery(...args),
        release: () => {},
      }),
  },
}));

const mockSafeFetch = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

const mockCheckAccessRules = vi.fn();
vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: (...args: unknown[]) => mockCheckAccessRules(...args),
}));

const mockCanMakeRequest = vi.fn();
const mockIncrementDailyCount = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  canMakeRequest: (...args: unknown[]) => mockCanMakeRequest(...args),
  incrementDailyCount: (...args: unknown[]) => mockIncrementDailyCount(...args),
}));

const mockRunSyncChecks = vi.fn();
vi.mock("@/lib/scanner/engine", () => ({
  runSyncChecks: (...args: unknown[]) => mockRunSyncChecks(...args),
  getPlannedSyncCategories: () => ["headers"],
}));

const mockRunAsyncChecks = vi.fn();
vi.mock("@/lib/scanner/async-checks", () => ({
  runAsyncChecks: (...args: unknown[]) => mockRunAsyncChecks(...args),
  getPlannedAsyncBranches: () => ["dns"],
}));

const { executeCrawlScan } = await import("@/lib/scanner/execute-crawl-scan");

function installDefaultQueryMock() {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO scan_history")) {
      // Per-page child row insert.
      return { rows: [{ id: 900 }], rowCount: 1 };
    }
    const last = Array.isArray(params) ? params[params.length - 1] : 1;
    return { rows: [{ id: last }], rowCount: 1 };
  });
}

function baseParams(
  overrides: Partial<Parameters<typeof executeCrawlScan>[0]> = {},
) {
  return {
    scanId: 10,
    normalizedMainUrl: "https://example.com/",
    mainOrigin: "https://example.com",
    selectedUrls: ["https://example.com/", "https://example.com/about"],
    scanners: null,
    authedUserId: 42,
    isApiKeyAuth: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  installDefaultQueryMock();
  mockSafeFetch.mockReset();
  // A fresh Response per call: the mocked fetch is invoked once per page,
  // and a shared instance's body stream can only be read once.
  mockSafeFetch.mockImplementation(
    async () =>
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  );
  mockCheckAccessRules.mockReset();
  mockCheckAccessRules.mockResolvedValue({ allowed: true });
  mockCanMakeRequest.mockReset();
  mockCanMakeRequest.mockResolvedValue({
    allowed: true,
    limit: 25,
    used: 0,
    remaining: 25,
    resetsAt: "",
  });
  mockIncrementDailyCount.mockReset();
  mockRunSyncChecks.mockReset();
  mockRunSyncChecks.mockReturnValue({
    findings: [],
    checksRun: 1,
    checksSkipped: 0,
    deduped: 0,
  });
  mockRunAsyncChecks.mockReset();
  mockRunAsyncChecks.mockResolvedValue([]);
});

describe("executeCrawlScan", () => {
  it("scans every pre-selected page and completes the tracker row with the merged result", async () => {
    await executeCrawlScan(baseParams());

    const calls = mockQuery.mock.calls;
    expect(
      calls.some(([sql]) => (sql as string).includes("status = 'running'")),
    ).toBe(true);

    const perPageInserts = calls.filter(([sql]) =>
      (sql as string).includes("INSERT INTO scan_history"),
    );
    expect(perPageInserts.length).toBe(2); // one per selected page

    const completedCall = calls.find(([sql]) =>
      (sql as string).includes("status = 'completed'"),
    );
    expect(completedCall).toBeDefined();

    expect(mockIncrementDailyCount).toHaveBeenCalledTimes(2);
  });

  it("accumulates progress across pages instead of resetting per page", async () => {
    mockRunSyncChecks.mockImplementation(
      (_url, _headers, _body, _categories, onProgress) => {
        onProgress?.("headers", "start");
        onProgress?.("headers", "done");
        return { findings: [], checksRun: 1, checksSkipped: 0, deduped: 0 };
      },
    );
    mockRunAsyncChecks.mockImplementation(
      async (_url, _categories, onProgress) => {
        onProgress?.("dns", "start");
        onProgress?.("dns", "done");
        return [];
      },
    );

    await executeCrawlScan(baseParams());

    const doneCalls = mockQuery.mock.calls.filter(([sql]) =>
      (sql as string).includes("categories_completed = $1"),
    );
    // 2 pages x 2 categories (headers, dns) each = 4 "done" events, and the
    // count must climb across pages (1,2,3,4), not restart at 1 per page.
    expect(doneCalls.length).toBe(4);
    const counts = doneCalls.map(([, params]) => (params as unknown[])[0]);
    expect(counts).toEqual([1, 2, 3, 4]);
  });

  it("marks the tracker row failed with a real reason when every pre-selected URL is off-origin", async () => {
    // Every pre-selected URL is checked against mainOrigin and dropped if it
    // doesn't match, so an all-off-origin list leaves zero scannable pages.
    await executeCrawlScan(
      baseParams({
        scanId: 12,
        selectedUrls: ["https://not-example.com/page"],
      }),
    );

    const failedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'failed'") &&
        (params as unknown[])[1] === 12,
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![1][0]).toMatch(/No scannable pages/);
  });

  it("caps pages scanned to the remaining daily quota and reports the skipped count", async () => {
    mockCanMakeRequest.mockResolvedValue({
      allowed: true,
      limit: 25,
      used: 24,
      remaining: 1,
      resetsAt: "",
    });

    await executeCrawlScan(baseParams({ scanId: 13 }));

    expect(mockIncrementDailyCount).toHaveBeenCalledTimes(1);
    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[8] === 13,
    );
    expect(completedCall).toBeDefined();
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.crawl.pagesSkipped).toBe(1);
    expect(resultMeta.crawl.pagesScanned).toBe(1);
  });
});

describe("executeCrawlScan (authenticated)", () => {
  function fakeSession(
    overrides: Record<string, unknown> = {},
  ): Parameters<typeof executeCrawlScan>[0]["session"] {
    return {
      origin: "https://example.com",
      authHeadersFor: () => null,
      observe: () => {},
      lost: false,
      authType: "cookie",
      reason: null,
      ...overrides,
    };
  }

  it("threads the session into every page fetch and persists authenticated + authReport", async () => {
    const session = fakeSession();

    await executeCrawlScan(
      baseParams({ scanId: 20, session, authenticated: true }),
    );

    // One safeFetch per pre-selected page, each carrying the session as its
    // 4th argument (safeFetch scopes it to same-origin hops internally).
    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    for (const call of mockSafeFetch.mock.calls) {
      expect(call[3]).toBe(session);
    }

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[8] === 20,
    );
    expect(completedCall).toBeDefined();
    // authenticated is the last bound param of the finalize UPDATE.
    expect((completedCall![1] as unknown[])[9]).toBe(true);
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.authReport).toEqual({
      status: "authenticated",
      method: "cookie",
    });
  });

  it("reflects a session lost mid-crawl as authReport.status 'lost' with the reason", async () => {
    const session = fakeSession({
      lost: true,
      reason: "The target cleared the session cookie during the scan.",
    });

    await executeCrawlScan(
      baseParams({ scanId: 21, session, authenticated: true }),
    );

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[8] === 21,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.authReport.status).toBe("lost");
    expect(resultMeta.authReport.reason).toMatch(/cleared the session cookie/i);
  });

  it("writes no authenticated flag or authReport for an ordinary crawl", async () => {
    await executeCrawlScan(baseParams({ scanId: 22 }));

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[8] === 22,
    );
    // authenticated param is null -> COALESCE leaves the column's false default.
    expect((completedCall![1] as unknown[])[9]).toBeNull();
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.authReport).toBeUndefined();
    // ...and safeFetch was called without a session.
    for (const call of mockSafeFetch.mock.calls) {
      expect(call[3]).toBeUndefined();
    }
  });
});
