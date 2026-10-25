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
// dedupeScanFindings is the real one: it is pure, and faking it would let a
// crawl that stopped merging duplicate findings pass.
vi.mock("@/lib/scanner/engine", async (importOriginal) => ({
  dedupeScanFindings: (
    await importOriginal<typeof import("@/lib/scanner/engine")>()
  ).dedupeScanFindings,
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

const { executeCrawlScan, crawlSoftDeadlineMs, asyncOuterTimeoutMs } =
  await import("@/lib/scanner/execute-crawl-scan");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { currentScanId } = await import("@/lib/database/request-context");

/** Columns per tuple in the per-page multi-row child INSERT. */
const CHILD_INSERT_COLUMNS = 14;
/** Position of url in a child tuple. */
const CHILD_URL = 1;
/** Position of team_id in a child tuple; result_meta comes after it. */
const CHILD_TEAM_ID = 12;
const CHILD_RESULT_META = 13;

/**
 * The per-page tuples of the one multi-row child INSERT the crawl issues.
 * Parameter 1 is the tracker row the statement's status guard reads; the
 * tuples follow it.
 */
function childInsertTuples(): unknown[][] {
  const call = mockQuery.mock.calls.find(([sql]) =>
    (sql as string).includes("INSERT INTO scan_history"),
  );
  if (!call) return [];
  const params = (call[1] as unknown[]).slice(1);
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
      const p = ((params ?? []) as unknown[]).slice(1);
      const rows: { id: number; url: unknown }[] = [];
      for (let i = 0; i < p.length; i += CHILD_INSERT_COLUMNS) {
        rows.push({ id: 900 + rows.length, url: p[i + CHILD_URL] });
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
      expect(tuple[CHILD_TEAM_ID]).toBe(8);
    }
  });

  it("gives every per-page row its own result stats, not just a duration", async () => {
    // Child rows used to be saved with summary, findings and duration only, so
    // opening one from History showed "Duration" and "Scanned" and nothing
    // else: risk score, site grade, confidence and checks-run all render only
    // when result_meta has them, and it was never written.
    await executeCrawlScan(baseParams());

    const tuples = childInsertTuples();
    expect(tuples.length).toBe(2);
    for (const tuple of tuples) {
      const meta = JSON.parse(tuple[CHILD_RESULT_META] as string);
      expect(typeof meta.dangerScore).toBe("number");
      expect(typeof meta.siteGrade).toBe("string");
      expect(typeof meta.engineConfidence).toBe("number");
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
      expect(tuple[CHILD_TEAM_ID]).toBeNull();
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
  it("stops taking pages the moment the crawl is cancelled", async () => {
    // Cancelling used to stop only the record: finalizeScanFailure cleared
    // the flag the running job reads, so a crawl cancelled five seconds in
    // kept fetching for another thirty and saved every page it had been
    // given. Three workers may already be in flight when the cancel lands;
    // what must not happen is the queue handing out the rest.
    const { requestCancel, clearCancel } =
      await import("@/lib/scanner/scan-jobs");
    mockRunSyncChecks.mockImplementationOnce(() => {
      requestCancel(41);
      return { findings: [], checksRun: 1, checksSkipped: 0, deduped: 0 };
    });

    await executeCrawlScan(
      baseParams({
        scanId: 41,
        selectedUrls: Array.from(
          { length: 9 },
          (_unused, i) => `https://example.com/p${i}`,
        ),
      }),
    );

    expect(mockRunSyncChecks.mock.calls.length).toBeLessThanOrEqual(3);
    const failed = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'failed'") &&
        (params as unknown[])[1] === 41,
    );
    expect(failed?.[1]).toContain("Cancelled");
    // A cancel is not an engine failure, so it is recorded as one of its own
    // kind and the error log stays quiet.
    expect(failed![1][2]).toBe("cancelled");
    clearCancel(41);
  });

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
        (params as unknown[])[7] === 41,
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
        (params as unknown[])[7] === 42,
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
    // Nothing was attempted, which is not the engine breaking.
    expect(failedCall![1][2]).toBe("not_run");
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
        (params as unknown[])[7] === 13,
    );
    expect(completedCall).toBeDefined();
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.crawl.pagesSkipped).toBe(1);
    expect(resultMeta.crawl.pagesScanned).toBe(1);
    // The quota cut the crawl short, so it must not read as full coverage.
    expect(resultMeta.incomplete).toContain("crawl-quota-limit");
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

    // One safeFetch per pre-selected page plus the bot-challenge look at the
    // main page, each carrying the session as its 4th argument (safeFetch
    // scopes it to same-origin hops internally).
    expect(mockSafeFetch).toHaveBeenCalledTimes(3);
    for (const call of mockSafeFetch.mock.calls) {
      expect(call[3]).toBe(session);
    }

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[7] === 20,
    );
    expect(completedCall).toBeDefined();
    // authenticated is the last bound param of the finalize UPDATE.
    expect((completedCall![1] as unknown[])[8]).toBe(true);
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
        (params as unknown[])[7] === 21,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.authReport.status).toBe("lost");
    expect(resultMeta.authReport.reason).toMatch(/cleared the session cookie/i);
  });

  it("counts a lost session as an area that did not finish, not just a badge", async () => {
    const session = fakeSession({
      lost: true,
      reason: "The target cleared the session cookie during the scan.",
    });

    await executeCrawlScan(
      baseParams({ scanId: 23, session, authenticated: true }),
    );

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[7] === 23,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    // The badge alone left the result counting as complete: full engine
    // confidence, no "did not finish" verdict, and nothing telling the reader
    // the signed-in view was never checked, although every page after the
    // drop was scanned as an anonymous visitor.
    expect(resultMeta.incomplete).toContain("authenticated-session");
    expect(resultMeta.engineConfidence).toBeLessThan(100);
  });

  it("does not grade a bot challenge as the site's pages", async () => {
    mockSafeFetch.mockImplementation(
      async () =>
        new Response("<title>Just a moment...</title>", {
          status: 403,
          headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
        }),
    );

    await executeCrawlScan(baseParams({ scanId: 26 }));

    expect(mockRunSyncChecks).not.toHaveBeenCalled();
    // The host half runs once, without anything that reads HTTP; no page half
    // runs, since no page was checked.
    expect(mockRunAsyncChecks).toHaveBeenCalledTimes(1);
    expect(mockRunAsyncChecks.mock.calls[0][4]).toBe("network");

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[7] === 26,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.incomplete).toContain("bot-challenge");
    // A challenge page is not a clean page: it gets no row of its own and is
    // listed as unread, so History cannot show it as a completed clean scan.
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        (sql as string).includes("INSERT INTO scan_history"),
      ),
    ).toBe(false);
    expect(resultMeta.crawl.pagesScanned).toBe(0);
    expect(resultMeta.crawl.pages).toEqual([]);
    expect(resultMeta.crawl.pagesUnreachable).toEqual([
      { url: "https://example.com/", reason: "Blocked by a bot challenge" },
      {
        url: "https://example.com/about",
        reason: "Blocked by a bot challenge",
      },
    ]);
  });

  it("records how many distinct checks ran, not the sum across pages", async () => {
    const pageRun = (checksRun: number) => ({
      findings: [],
      checksRun,
      checksSkipped: 0,
      deduped: 0,
    });
    mockRunSyncChecks
      .mockReturnValueOnce(pageRun(740))
      .mockReturnValueOnce(pageRun(746));

    await executeCrawlScan(baseParams({ scanId: 25 }));

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[7] === 25,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.checksRun).toBe(746);
  });

  it("does not report an incomplete area for a session that held", async () => {
    await executeCrawlScan(
      baseParams({ scanId: 24, session: fakeSession(), authenticated: true }),
    );

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[7] === 24,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    expect(resultMeta.incomplete ?? []).not.toContain("authenticated-session");
  });

  it("writes no authenticated flag or authReport for an ordinary crawl", async () => {
    await executeCrawlScan(baseParams({ scanId: 22 }));

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[7] === 22,
    );
    // authenticated param is null -> COALESCE leaves the column's false default.
    expect((completedCall![1] as unknown[])[8]).toBeNull();
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

  /**
   * A crawl was the one scan path that never computed a site grade at all, so
   * a crawl result showed no grade and a badge pointed at one had to recompute
   * what every single-URL scan had already written down. It is stored here
   * alongside dangerScore, over the same merged, deduped finding set.
   */
  it("stores the whole-site grade beside the danger score, like the single-URL path", async () => {
    await executeCrawlScan(baseParams({ scanId: 61 }));

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[7] === 61,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );

    // Derived from the same danger score the row already carries, so the
    // letter and the number can never disagree on screen. The mapping is
    // lib/scanner/site-grade.ts's own table, restated here rather than
    // imported so a retune of it has to be a deliberate edit in both places.
    const scoreToGrade = [
      "A+",
      "A",
      "A",
      "B",
      "B",
      "C",
      "C",
      "D",
      "D",
      "F",
      "F",
    ];
    expect(resultMeta.siteGrade).toBe(
      scoreToGrade[resultMeta.dangerScore as number],
    );
  });

  it("writes no incomplete marker when every branch completed", async () => {
    await executeCrawlScan(baseParams({ scanId: 30 }));

    const completedCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        (sql as string).includes("status = 'completed'") &&
        (params as unknown[])[7] === 30,
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
        (params as unknown[])[7] === 31,
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
        (params as unknown[])[7] === 32,
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
        (params as unknown[])[7] === 33,
    );
    const resultMeta = JSON.parse(
      (completedCall![1] as unknown[])[6] as string,
    );
    // The page-level branches are what did not run: the host-level ones do
    // not depend on any individual page being fetchable, so they are not
    // reported as incomplete just because a page was unreachable.
    expect(resultMeta.incomplete).toEqual(["osv-libraries"]);
    // Nothing was read, so nothing is saved as a scan.
    expect(childInsertTuples()).toEqual([]);
    expect(resultMeta.crawl.pagesScanned).toBe(0);
    expect(resultMeta.crawl.pagesUnreachable).toHaveLength(2);
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

// ── Partial crawls, unread pages and the cancel window ──────────────────────
//
// A crawl used to have exactly two outcomes: every page, or a watchdog failure
// that threw the pages away. These cover the third, honest one (a partial
// crawl that says so), and the places a finished-looking result was wrong:
// pages that were never read shown as clean, page rows saved for a crawl that
// was cancelled, and a quota stop that left the skipped count short.

function pageUrls(count: number): string[] {
  return Array.from(
    { length: count },
    (_unused, i) => `https://example.com/p${i}`,
  );
}

/** result_meta of the tracker row's completing UPDATE for `scanId`. */
function completedMeta(scanId: number) {
  const call = mockQuery.mock.calls.find(
    ([sql, params]) =>
      (sql as string).includes("status = 'completed'") &&
      (params as unknown[])[7] === scanId,
  );
  expect(call).toBeDefined();
  return JSON.parse((call![1] as unknown[])[6] as string);
}

/** The failure UPDATE for `scanId`: params are [reason, scanId, kind]. */
function failureUpdate(scanId: number) {
  return mockQuery.mock.calls.find(
    ([sql, params]) =>
      (sql as string).includes("status = 'failed'") &&
      (params as unknown[])[1] === scanId,
  )?.[1] as [string, number, string] | undefined;
}

function wasInserted(): boolean {
  return mockQuery.mock.calls.some(([sql]) =>
    (sql as string).includes("INSERT INTO scan_history"),
  );
}

describe("crawlSoftDeadlineMs", () => {
  it("stops the page loop at about 85% of the budget, less a finalize margin", () => {
    expect(crawlSoftDeadlineMs(900_000)).toBe(735_000);
    expect(crawlSoftDeadlineMs(3_600_000)).toBe(3_030_000);
  });

  it("never falls below half the budget, so a short budget still scans something", () => {
    expect(crawlSoftDeadlineMs(30_000)).toBe(15_000);
    expect(crawlSoftDeadlineMs(60_000)).toBe(30_000);
  });

  it("always stops before the watchdog does", () => {
    for (const budgetMs of [30_000, 120_000, 900_000, 21_600_000]) {
      expect(crawlSoftDeadlineMs(budgetMs)).toBeLessThan(budgetMs);
    }
  });
});

describe("asyncOuterTimeoutMs", () => {
  it("keeps the outer ceiling at least 2s past the branch timeout", () => {
    // Configured below the branch timeout: the outer race would fire first
    // and discard branches that had already finished.
    expect(asyncOuterTimeoutMs(3_000, 12_000)).toBe(14_000);
    expect(asyncOuterTimeoutMs(12_000, 12_000)).toBe(14_000);
  });

  it("leaves a ceiling that is already clear of the branch timeout alone", () => {
    expect(asyncOuterTimeoutMs(15_000, 12_000)).toBe(15_000);
  });
});

describe("executeCrawlScan: a crawl that runs out of time", () => {
  /**
   * Run a 9-page crawl whose first page to reach its checks moves the clock
   * past the soft deadline (735s of the default 900s budget) but not past the
   * watchdog, so the crawl is still alive to finalize.
   */
  async function runPastTheSoftDeadline(scanId: number) {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      mockRunSyncChecks.mockImplementationOnce(() => {
        vi.setSystemTime(Date.now() + 800_000);
        return { findings: [], checksRun: 1, checksSkipped: 0, deduped: 0 };
      });
      await executeCrawlScan(baseParams({ scanId, selectedUrls: pageUrls(9) }));
    } finally {
      vi.useRealTimers();
    }
  }

  it("stops taking pages at the soft deadline and completes with the pages it has", async () => {
    await runPastTheSoftDeadline(70);

    const meta = completedMeta(70);
    expect(meta.crawl.pagesDiscovered).toBe(9);
    // Three workers were already in flight when the deadline passed.
    expect(meta.crawl.pagesScanned).toBeGreaterThan(0);
    expect(meta.crawl.pagesScanned).toBeLessThanOrEqual(3);
    expect(meta.crawl.pagesSkipped).toBe(9 - meta.crawl.pagesScanned);
    expect(meta.incomplete).toContain("crawl-time-limit");
    expect(meta.incomplete).not.toContain("crawl-quota-limit");
    expect(failureUpdate(70)).toBeUndefined();
  });

  it("bills and saves only the pages that started", async () => {
    await runPastTheSoftDeadline(71);

    const { pagesScanned } = completedMeta(71).crawl;
    expect(mockIncrementDailyCountCapped).toHaveBeenCalledTimes(pagesScanned);
    expect(childInsertTuples()).toHaveLength(pagesScanned);
  });

  it("discounts the confidence of a crawl it cut short", async () => {
    await runPastTheSoftDeadline(72);
    await executeCrawlScan(baseParams({ scanId: 73 }));

    expect(completedMeta(72).engineConfidence).toBeLessThan(
      completedMeta(73).engineConfidence,
    );
  });

  it("adds no time-limit marker when every page started before the deadline", async () => {
    await executeCrawlScan(baseParams({ scanId: 74 }));
    expect(completedMeta(74).incomplete).toBeUndefined();
  });
});

describe("executeCrawlScan: pages that could not be read", () => {
  it("lists a page it could not fetch under pagesUnreachable and saves no row for it", async () => {
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/about")) {
        throw Object.assign(new Error("connect failed"), {
          code: "unreachable",
        });
      }
      return new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    await executeCrawlScan(baseParams({ scanId: 75 }));

    const meta = completedMeta(75);
    expect(childInsertTuples().map((t) => t[CHILD_URL])).toEqual([
      "https://example.com/",
    ]);
    expect(meta.crawl.pages.map((p: { url: string }) => p.url)).toEqual([
      "https://example.com/",
    ]);
    expect(meta.crawl.pagesDiscovered).toBe(2);
    expect(meta.crawl.pagesScanned).toBe(1);
    expect(meta.crawl.pagesSkipped).toBe(0);
    expect(meta.crawl.pagesUnreachable).toEqual([
      { url: "https://example.com/about", reason: "Could not connect" },
    ]);
    // The unread page still counts against coverage.
    expect(meta.incomplete).toContain("osv-libraries");
  });

  it("writes an empty pagesUnreachable list when every page was read", async () => {
    await executeCrawlScan(baseParams({ scanId: 76 }));
    expect(completedMeta(76).crawl.pagesUnreachable).toEqual([]);
  });

  it.each([
    [
      "a timeout",
      Object.assign(new Error("x"), { code: "timeout" }),
      "Did not answer in time",
    ],
    [
      "a TLS failure",
      Object.assign(new Error("x"), { code: "tls" }),
      "TLS certificate or handshake failed",
    ],
    [
      "an off-host redirect",
      Object.assign(new Error("x"), { code: "cross_host_redirect" }),
      "Redirected to another host",
    ],
    [
      "a blocked address",
      Object.assign(new Error("x"), { code: "blocked" }),
      "Address not allowed",
    ],
    [
      "a code on the cause",
      new Error("x", { cause: { code: "unreachable" } }),
      "Could not connect",
    ],
    [
      "a fired timer",
      new DOMException("timed out", "TimeoutError"),
      "Did not answer in time",
    ],
    [
      "an error with no code",
      new Error("socket hang up"),
      "Could not be fetched",
    ],
  ])("explains %s", async (_label, error, reason) => {
    mockSafeFetch.mockRejectedValue(error);

    await executeCrawlScan(
      baseParams({ scanId: 77, selectedUrls: ["https://example.com/"] }),
    );

    expect(completedMeta(77).crawl.pagesUnreachable).toEqual([
      { url: "https://example.com/", reason },
    ]);
  });

  it("does not log an unreachable page as an error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockSafeFetch.mockRejectedValue(
        Object.assign(new Error("x"), { code: "unreachable" }),
      );
      await executeCrawlScan(baseParams({ scanId: 78 }));
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("executeCrawlScan: the cancel window", () => {
  it("inserts no page rows when the crawl is cancelled after the page loop", async () => {
    const { requestCancel } = await import("@/lib/scanner/scan-jobs");
    const defaultImpl = mockQuery.getMockImplementation()!;
    // The team lookup is the last thing before the page-row INSERT, which is
    // exactly the stretch where a cancel used to go unnoticed.
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT team_id FROM scan_history")) {
        requestCancel(80);
        return { rows: [{ team_id: null }], rowCount: 1 };
      }
      return defaultImpl(sql, params);
    });

    await executeCrawlScan(baseParams({ scanId: 80 }));

    expect(wasInserted()).toBe(false);
    expect(
      mockQuery.mock.calls.some(
        ([sql, params]) =>
          (sql as string).includes("status = 'completed'") &&
          (params as unknown[])[7] === 80,
      ),
    ).toBe(false);
    expect(failureUpdate(80)).toEqual(["Cancelled", 80, "cancelled"]);
  });

  it("guards the page-row INSERT with the tracker's own status, inside the statement", async () => {
    await executeCrawlScan(baseParams({ scanId: 81 }));

    const call = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes("INSERT INTO scan_history"),
    );
    // A row that went terminal without this process noticing (a stale sweep, a
    // cancel on another instance) is only caught by the database. The real
    // behaviour is proved in tests/integration/crawl-page-rows.test.ts.
    expect(call![0]).toMatch(
      /WHERE EXISTS \(\s*SELECT 1 FROM scan_history\s+WHERE id = \$1 AND status IN \('pending', 'running'\)\s*\)/,
    );
    expect((call![1] as unknown[])[0]).toBe(81);
  });

  it("records a cancel as cancelled and writes nothing to the error log", async () => {
    const { requestCancel } = await import("@/lib/scanner/scan-jobs");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockRunSyncChecks.mockImplementationOnce(() => {
        requestCancel(82);
        return { findings: [], checksRun: 1, checksSkipped: 0, deduped: 0 };
      });
      await executeCrawlScan(
        baseParams({ scanId: 82, selectedUrls: pageUrls(9) }),
      );
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
    expect(failureUpdate(82)?.[2]).toBe("cancelled");
  });

  it("treats an error thrown by the cancel's own abort as a cancel, not a failure", async () => {
    const { requestCancel } = await import("@/lib/scanner/scan-jobs");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // What an in-flight fetch surfaces when the cancel aborts it.
      mockCanMakeRequest.mockImplementation(async () => {
        requestCancel(83);
        throw new DOMException("This operation was aborted", "AbortError");
      });
      await executeCrawlScan(baseParams({ scanId: 83 }));
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
    expect(failureUpdate(83)).toEqual(["Cancelled", 83, "cancelled"]);
  });
});

describe("executeCrawlScan: a crawl the quota cuts short", () => {
  it("counts the pages a mid-crawl quota stop dropped, and says why", async () => {
    // The third charge is refused, as when a concurrent crawl takes the last
    // unit of the day between this crawl's up-front read and its charge.
    let charges = 0;
    mockIncrementDailyCountCapped.mockImplementation(async () => {
      charges += 1;
      return charges === 3
        ? { recorded: false, count: 0 }
        : { recorded: true, count: charges };
    });
    try {
      await executeCrawlScan(
        baseParams({ scanId: 84, selectedUrls: pageUrls(6) }),
      );
    } finally {
      mockIncrementDailyCountCapped.mockImplementation(async () => ({
        recorded: true,
        count: 1,
      }));
    }

    const meta = completedMeta(84);
    expect(meta.crawl.pagesDiscovered).toBe(6);
    // Two pages were read before the refusal; the page whose charge failed and
    // the three behind it never ran. The skipped figure used to be computed
    // from the list as first capped, which said 0 here.
    expect(meta.crawl.pagesScanned).toBe(2);
    expect(meta.crawl.pagesSkipped).toBe(4);
    expect(meta.incomplete).toContain("crawl-quota-limit");
    expect(meta.incomplete).not.toContain("crawl-time-limit");
  });

  it("marks a crawl the quota capped up front", async () => {
    mockCanMakeRequest.mockResolvedValue({
      allowed: true,
      limit: 25,
      used: 22,
      remaining: 3,
      resetsAt: "",
    });

    await executeCrawlScan(
      baseParams({ scanId: 85, selectedUrls: pageUrls(6) }),
    );

    const meta = completedMeta(85);
    expect(meta.crawl.pagesScanned).toBe(3);
    expect(meta.crawl.pagesSkipped).toBe(3);
    expect(meta.incomplete).toContain("crawl-quota-limit");
  });

  it("does not mark a crawl whose quota covered every page", async () => {
    await executeCrawlScan(baseParams({ scanId: 86 }));
    expect(completedMeta(86).incomplete).toBeUndefined();
  });
});

describe("executeCrawlScan: failure kinds and logging", () => {
  it("records a daily-limit refusal as quota_refused", async () => {
    mockCanMakeRequest.mockResolvedValue({
      allowed: false,
      limit: 25,
      used: 25,
      remaining: 0,
      resetsAt: "",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await executeCrawlScan(baseParams({ scanId: 87 }));
      // A refusal is an outcome the row records, not an error to investigate.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }

    expect(failureUpdate(87)).toEqual([
      expect.stringMatching(/Daily scan limit reached/),
      87,
      "quota_refused",
    ]);
  });

  it("logs an unexpected failure once, with the scan id and the Error itself", async () => {
    const boom = new Error("db down");
    mockCanMakeRequest.mockRejectedValue(boom);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await executeCrawlScan(baseParams({ scanId: 88 }));

      expect(errorSpy).toHaveBeenCalledTimes(1);
      // Context before the error, and the error unwrapped, so the capture
      // keeps a stack instead of a message-only row.
      expect(errorSpy).toHaveBeenCalledWith(
        "[scan] crawl scan failed",
        {
          scanId: 88,
          userId: 42,
          source: "web",
          url: "https://example.com/",
        },
        boom,
      );
    } finally {
      errorSpy.mockRestore();
    }

    expect(failureUpdate(88)).toEqual(["db down", 88, "internal"]);
  });

  it("runs the whole crawl inside its scan's correlation context", async () => {
    const seen: Array<number | null> = [];
    mockRunSyncChecks.mockImplementation(() => {
      seen.push(currentScanId());
      return { findings: [], checksRun: 1, checksSkipped: 0, deduped: 0 };
    });

    await executeCrawlScan(baseParams({ scanId: 89 }));

    expect(seen).toEqual([89, 89]);
    expect(currentScanId()).toBeNull();
  });
});

describe("executeCrawlScan: a result that arrives after the row went terminal", () => {
  function refuseTheCompletion() {
    const base = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("status = 'completed'")) {
        return { rows: [], rowCount: 0 };
      }
      return base(sql, params);
    });
  }

  const LATE_MESSAGE =
    "[scan] crawl completed after the row was terminal; result discarded";

  it("says so when the crawl ran past its budget", async () => {
    refuseTheCompletion();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      mockRunSyncChecks.mockImplementationOnce(() => {
        vi.setSystemTime(Date.now() + 1_000_000);
        return { findings: [], checksRun: 1, checksSkipped: 0, deduped: 0 };
      });
      await executeCrawlScan(baseParams({ scanId: 90 }));
    } finally {
      vi.useRealTimers();
    }

    const late = errorSpy.mock.calls.find((call) => call[0] === LATE_MESSAGE);
    errorSpy.mockRestore();
    expect(late).toBeDefined();
    const ctx = late![1] as Record<string, number>;
    expect(ctx).toMatchObject({ scanId: 90, userId: 42, budgetSeconds: 900 });
    expect(ctx.lateByMs).toBeGreaterThan(0);
  });

  it("stays quiet when it lost to a cancel inside its budget", async () => {
    refuseTheCompletion();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await executeCrawlScan(baseParams({ scanId: 91 }));
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("notifies nobody about a result nobody will see", async () => {
    refuseTheCompletion();

    await executeCrawlScan(baseParams({ scanId: 92 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockDeliverWebhook).not.toHaveBeenCalled();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });
});

describe("executeCrawlScan: the async-checks ceiling", () => {
  it("holds a page's async race open past the branch timeout, whatever the two settings say", async () => {
    // Configured BELOW the 12s branch timeout: the outer race used to fire
    // first and replace branches that had already finished with "not checked".
    process.env.SCAN_ASYNC_CHECKS_TIMEOUT_MS = "1000";
    invalidateSettingsCache();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      mockRunAsyncChecks.mockImplementation(
        async (
          _url: string,
          _categories: unknown,
          _onProgress: unknown,
          _signal: unknown,
          scope: string = "all",
        ) =>
          scope === "page"
            ? new Promise(() => {})
            : { findings: [], incomplete: [] },
      );

      const run = executeCrawlScan(
        baseParams({ scanId: 93, selectedUrls: ["https://example.com/"] }),
      );
      await vi.advanceTimersByTimeAsync(13_999);
      expect(
        mockQuery.mock.calls.some(
          ([sql, params]) =>
            (sql as string).includes("status = 'completed'") &&
            (params as unknown[])[7] === 93,
        ),
      ).toBe(false);

      await vi.advanceTimersByTimeAsync(2_000);
      await run;
    } finally {
      vi.useRealTimers();
      delete process.env.SCAN_ASYNC_CHECKS_TIMEOUT_MS;
      invalidateSettingsCache();
    }

    expect(completedMeta(93).incomplete).toEqual(["osv-libraries"]);
  });
});
