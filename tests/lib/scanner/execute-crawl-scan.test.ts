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
// The crawl loop now charges each page through the cap-aware atomic
// incrementer (returns { recorded, count }); default to a recorded charge so
// the loop is not broken early.
const mockIncrementDailyCountCapped = vi.fn(async (..._args: unknown[]) => ({
  recorded: true,
  count: 1,
}));
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  canMakeRequest: (...args: unknown[]) => mockCanMakeRequest(...args),
  incrementDailyCountCapped: (...args: unknown[]) =>
    mockIncrementDailyCountCapped(...args),
}));

const mockRunSyncChecks = vi.fn();
// The crawl executor drives the yielding variant (AUDIT-011#scan-06): it runs
// the sync pass once per crawled page, so that is exactly the block that must
// not hold the event loop for the whole page. Same arguments, same return
// shape, awaited.
vi.mock("@/lib/scanner/engine", () => ({
  runSyncChecksYielding: async (...args: unknown[]) =>
    mockRunSyncChecks(...args),
  getPlannedSyncCategories: () => ["headers"],
}));

// The crawl executor now uses runAsyncChecksDetailed, not runAsyncChecks, so
// a crawl can report which branches did not complete (result_meta.incomplete),
// exactly as a single-URL scan does. The mock resolves the detailed shape.
//
// The 5th argument is the branch scope (AUDIT-012#perf-03): a crawl runs the
// host-level branches once for the whole crawl and only the page-level ones
// per page, so the planner mock answers per scope the way the real one does.
const mockRunAsyncChecks = vi.fn();
vi.mock("@/lib/scanner/async-checks", () => ({
  runAsyncChecksDetailed: (...args: unknown[]) => mockRunAsyncChecks(...args),
  getPlannedAsyncBranches: (
    _url: string,
    _categories: unknown,
    scope: string = "all",
  ) => (scope === "page" ? ["osv-libraries"] : ["dns"]),
}));

// A crawl now runs the same shared notification tail every other scan path
// runs (lib/webhooks/scan-notifications.ts) instead of only its own
// regression-alert email. The tail is driven for real; only the HTTP attempt
// at the bottom of it is mocked, since deliverWebhook's signing, logging and
// retry policy have their own suite (tests/lib/webhooks/delivery.test.ts).
const mockDeliverWebhook = vi.fn();
vi.mock("@/lib/webhooks/delivery", () => ({
  deliverWebhook: (...args: unknown[]) => mockDeliverWebhook(...args),
}));

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
}));

vi.mock("@/lib/email/email", () => ({
  scanCompleteEmail: () => ({}),
  criticalFindingsEmail: () => ({}),
}));

const { executeCrawlScan } = await import("@/lib/scanner/execute-crawl-scan");

/** Columns per tuple in the per-page multi-row child INSERT. */
const CHILD_INSERT_COLUMNS = 13;

/** The per-page tuples of the one multi-row child INSERT the crawl issues. */
function childInsertTuples(): unknown[][] {
  const call = mockQuery.mock.calls.find(([sql]) =>
    (sql as string).includes("INSERT INTO scan_history"),
  );
  if (!call) return [];
  const params = call[1] as unknown[];
  const tuples: unknown[][] = [];
  for (let i = 0; i < params.length; i += CHILD_INSERT_COLUMNS) {
    tuples.push(params.slice(i, i + CHILD_INSERT_COLUMNS));
  }
  return tuples;
}

function installDefaultQueryMock() {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO scan_history")) {
      // The per-page child rows go in as ONE multi-row INSERT (perf-26), so
      // the mock answers with one returned row per tuple, keyed by the url in
      // that tuple, exactly as `RETURNING id, url` does.
      const p = (params ?? []) as unknown[];
      const rows: { id: number; url: unknown }[] = [];
      for (let i = 0; i < p.length; i += CHILD_INSERT_COLUMNS) {
        rows.push({ id: 900 + rows.length, url: p[i + 1] });
      }
      return { rows, rowCount: rows.length };
    }
    // The shared notification tail's own two lookups. Answered explicitly so
    // the default "one row back" branch below does not hand the email/webhook
    // fan-out a row-shaped object it will then try to notify.
    if (sql.includes("SELECT email FROM users")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("SELECT id, url, type, secret FROM webhooks")) {
      return { rows: [], rowCount: 0 };
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
  mockIncrementDailyCountCapped.mockClear();
  mockRunSyncChecks.mockReset();
  mockRunSyncChecks.mockReturnValue({
    findings: [],
    checksRun: 1,
    checksSkipped: 0,
    deduped: 0,
  });
  mockRunAsyncChecks.mockReset();
  mockRunAsyncChecks.mockResolvedValue({ findings: [], incomplete: [] });
  mockDeliverWebhook.mockReset();
  mockDeliverWebhook.mockResolvedValue(undefined);
  mockSendNotificationEmail.mockReset();
});

describe("executeCrawlScan", () => {
  it("scans every pre-selected page and completes the tracker row with the merged result", async () => {
    await executeCrawlScan(baseParams());

    const calls = mockQuery.mock.calls;
    expect(
      calls.some(([sql]) => (sql as string).includes("status = 'running'")),
    ).toBe(true);

    // One INSERT statement carrying one tuple per selected page, not one
    // statement per page. ref: AUDIT-012#perf-26
    const insertStatements = calls.filter(([sql]) =>
      (sql as string).includes("INSERT INTO scan_history"),
    );
    expect(insertStatements.length).toBe(1);
    expect(childInsertTuples().length).toBe(2);

    const completedCall = calls.find(([sql]) =>
      (sql as string).includes("status = 'completed'"),
    );
    expect(completedCall).toBeDefined();

    expect(mockIncrementDailyCountCapped).toHaveBeenCalledTimes(2);
  });

  // ref: AUDIT-011#drift-01. The route resolves team_id onto the tracker row;
  // the per-page child rows used to omit the column entirely, so a team could
  // open the crawl and not a single one of the pages it covered.
  it("inherits the tracker row's team_id onto every per-page child row", async () => {
    const defaultImpl = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT team_id FROM scan_history")) {
        return { rows: [{ team_id: 8 }], rowCount: 1 };
      }
      return defaultImpl(sql, params);
    });

    await executeCrawlScan(baseParams());

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes("INSERT INTO scan_history"),
    );
    expect(insertCall![0] as string).toContain("team_id");
    const tuples = childInsertTuples();
    expect(tuples.length).toBe(2);
    for (const tuple of tuples) {
      expect(tuple.at(-1)).toBe(8);
    }
  });

  it("writes a null team_id on the child rows of a personal crawl", async () => {
    const defaultImpl = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT team_id FROM scan_history")) {
        return { rows: [{ team_id: null }], rowCount: 1 };
      }
      return defaultImpl(sql, params);
    });

    await executeCrawlScan(baseParams());

    const tuples = childInsertTuples();
    expect(tuples.length).toBe(2);
    for (const tuple of tuples) {
      expect(tuple.at(-1)).toBeNull();
    }
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
      async (
        _url: string,
        _categories: unknown,
        onProgress: ((label: string, phase: string) => void) | undefined,
        _signal: unknown,
        scope: string = "all",
      ) => {
        const label = scope === "page" ? "osv-libraries" : "dns";
        onProgress?.(label, "start");
        onProgress?.(label, "done");
        return { findings: [], incomplete: [] };
      },
    );

    await executeCrawlScan(baseParams());

    // Progress writes are coalesced into one UPDATE carrying all three columns
    // (AUDIT-012#perf-12), so the assertion is on the VALUE that lands, not on
    // one write per event: the count must climb across pages and finish at 5
    // (one host-level branch for the whole crawl, plus 2 pages x 2 units)
    // rather than restarting at 1 per page.
    const progressCalls = mockQuery.mock.calls.filter(([sql]) =>
      (sql as string).includes("categories_completed = $2"),
    );
    expect(progressCalls.length).toBeGreaterThan(0);
    const counts = progressCalls.map(
      ([, params]) => (params as unknown[])[1] as number,
    );
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts.at(-1)).toBe(5);
  });

  // AUDIT-012#perf-03: the host-level branches (DNS, TLS, reputation,
  // robots/security.txt, the 23 exposed-file probes) used to run on every
  // single page, so a 25-page crawl re-asked the same host-level questions 25
  // times and threw away 24 identical copies of the answer.
  it("runs the host-level branches once for the whole crawl, not once per page", async () => {
    await executeCrawlScan(
      baseParams({
        scanId: 40,
        selectedUrls: [
          "https://example.com/",
          "https://example.com/a",
          "https://example.com/b",
          "https://example.com/c",
        ],
      }),
    );

    const scopes = mockRunAsyncChecks.mock.calls.map((call) => call[4]);
    expect(scopes.filter((s) => s === "host")).toHaveLength(1);
    expect(scopes.filter((s) => s === "page")).toHaveLength(4);
    // The single host-level run is made against the crawl's main URL.
    const hostCall = mockRunAsyncChecks.mock.calls.find(
      (call) => call[4] === "host",
    );
    expect(hostCall![0]).toBe("https://example.com/");
  });

  it("merges the host-level findings into the crawl result", async () => {
    mockRunAsyncChecks.mockImplementation(
      async (
        _url: string,
        _categories: unknown,
        _onProgress: unknown,
        _signal: unknown,
        scope: string = "all",
      ) =>
        scope === "host"
          ? {
              findings: [
                {
                  id: "host-dns-1",
                  title: "SPF record missing",
                  severity: "medium",
                  category: "dns",
                  description: "",
                  evidence: "",
                  riskImpact: "",
                  explanation: "",
                  fixSteps: [],
                  references: [],
                  confidence: 90,
                  detectionMethod: "dns",
                },
              ],
              incomplete: [],
            }
          : { findings: [], incomplete: [] },
    );

    await executeCrawlScan(baseParams({ scanId: 41 }));

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[8] === 41,
    );
    const findings = JSON.parse((completedCall![1] as unknown[])[0] as string);
    expect(findings.map((f: { id: string }) => f.id)).toEqual(["host-dns-1"]);
  });

  it("reports a host-level branch that did not complete as incomplete", async () => {
    mockRunAsyncChecks.mockImplementation(
      async (
        _url: string,
        _categories: unknown,
        _onProgress: unknown,
        _signal: unknown,
        scope: string = "all",
      ) =>
        scope === "host"
          ? { findings: [], incomplete: ["dns"] }
          : { findings: [], incomplete: [] },
    );

    await executeCrawlScan(baseParams({ scanId: 42 }));

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[8] === 42,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.incomplete).toEqual(["dns"]);
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

  it("caps pre-selected pages to the plan's crawlPageLimit", async () => {
    await executeCrawlScan(baseParams({ scanId: 14, crawlPageLimit: 1 }));

    // Two URLs pre-selected, but the plan cap of 1 slices it to one.
    expect(childInsertTuples().length).toBe(1);
    expect(mockIncrementDailyCountCapped).toHaveBeenCalledTimes(1);
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

    expect(mockIncrementDailyCountCapped).toHaveBeenCalledTimes(1);
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

  // ── Completeness reporting (AUDIT-014#state-03) ─────────────────────────
  //
  // A crawl is rendered through the same components as a single scan, so it
  // has to answer "did every check actually run?" the same way. Before this,
  // a page whose async layer timed out had its DNS/TLS/live-fetch findings
  // replaced by an empty array with no record, and engineConfidence was
  // hardcoded to the complete value, so a deep scan that came back short
  // still reported "nothing exploitable found" at full confidence.

  it("writes no incomplete marker when every branch completed", async () => {
    await executeCrawlScan(baseParams({ scanId: 30 }));

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[8] === 30,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.incomplete).toBeUndefined();
  });

  it("records the branches that did not complete and discounts engine confidence", async () => {
    mockRunAsyncChecks.mockResolvedValue({
      findings: [],
      incomplete: ["dns"],
    });

    await executeCrawlScan(baseParams({ scanId: 31 }));

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[8] === 31,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.incomplete).toEqual(["dns"]);

    // Same finding set, but one branch short: confidence must be lower than
    // the all-clear run above, not the hardcoded complete value.
    mockRunAsyncChecks.mockResolvedValue({ findings: [], incomplete: [] });
    await executeCrawlScan(baseParams({ scanId: 32 }));
    const completeCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[8] === 32,
    );
    const completeMeta = JSON.parse(
      (completeCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.engineConfidence).toBeLessThan(
      completeMeta.engineConfidence,
    );
  });

  it("reports a page it could never fetch as incomplete, not as clean", async () => {
    mockSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await executeCrawlScan(baseParams({ scanId: 33 }));

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[8] === 33,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    // The page-level branches are what did not run: the host-level ones do
    // not depend on any individual page being fetchable, so they are not
    // reported as incomplete just because a page was unreachable.
    expect(resultMeta.incomplete).toEqual(["osv-libraries"]);
  });
});

describe("executeCrawlScan: notifications", () => {
  function installNotifyingQueryMock(
    rows: { id: number; url: string; type: string; secret: string | null }[],
  ) {
    const base = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT email FROM users")) {
        return { rows: [{ email: "owner@example.com" }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, url, type, secret FROM webhooks")) {
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("SELECT findings FROM scan_history")) {
        return { rows: [] };
      }
      return base(sql, params);
    });
  }

  it("delivers scan.completed and sends the scan-complete email, which a crawl never used to do", async () => {
    installNotifyingQueryMock([
      { id: 1, url: "https://hook.example/a", type: "generic", secret: "s" },
    ]);

    await executeCrawlScan(baseParams({ scanId: 40 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockDeliverWebhook).toHaveBeenCalledTimes(1);
    const [, event, body] = mockDeliverWebhook.mock.calls[0];
    expect(event).toBe("scan.completed");
    expect(JSON.parse(body as string).data.url).toBe("https://example.com/");
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ type: "scan_complete" }),
    );
  });

  it("sends exactly one regression alert email, not the shared tail's plus its own", async () => {
    installNotifyingQueryMock([]);
    mockRunSyncChecks.mockReturnValue({
      findings: [
        {
          id: "crawl-critical--hash",
          title: "Critical issue",
          description: "d",
          severity: "critical",
          category: "configuration",
          evidence: "",
          riskImpact: "",
          explanation: "",
          fixSteps: [],
          codeExamples: [],
        },
      ],
      checksRun: 1,
      checksSkipped: 0,
      deduped: 0,
    });

    await executeCrawlScan(baseParams({ scanId: 41 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const alerts = mockSendNotificationEmail.mock.calls.filter(
      ([arg]) => (arg as { type: string }).type === "severity_alerts",
    );
    expect(alerts).toHaveLength(1);
  });
});
