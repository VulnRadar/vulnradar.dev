/**
 * Tests for the single-URL background scan job body (lib/scanner/execute-scan.ts).
 *
 * Mocks the database pool, the network (safeFetch/validateScanTarget), and
 * the check engines (runSyncChecks/runAsyncChecksDetailed) — the actual
 * detection logic has its own suites. This exercises the job envelope:
 * pending -> running -> completed with real progress writes in between, a
 * failed fetch marking the row failed with a real reason, and cancellation
 * aborting before the result is ever persisted as completed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    // finalizeScanSuccess (lib/scanner/scan-jobs.ts) runs its status-flip
    // UPDATE and auto-tags INSERT on a dedicated transactional client --
    // route it through the same mockQuery so the existing SQL-text-based
    // branching in installDefaultQueryMock below still answers it.
    connect: () =>
      Promise.resolve({
        query: (...args: unknown[]) => mockQuery(...args),
        release: () => {},
      }),
  },
}));

const mockSafeFetch = vi.fn();
const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
}));

const mockRunSyncChecks = vi.fn();
vi.mock("@/lib/scanner/engine", () => ({
  runSyncChecks: (...args: unknown[]) => mockRunSyncChecks(...args),
}));

const mockRunAsyncChecksDetailed = vi.fn();
vi.mock("@/lib/scanner/async-checks", () => ({
  runAsyncChecksDetailed: (...args: unknown[]) =>
    mockRunAsyncChecksDetailed(...args),
}));

vi.mock("@/lib/scanner/protocols", () => ({
  getProtocolFromUrl: () => "https",
  getProtocolFindings: () => [],
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

const { executeScan } = await import("@/lib/scanner/execute-scan");
const { requestCancel, clearCancel } = await import("@/lib/scanner/scan-jobs");

/** Route every pool.query call by statement shape so tests stay short. */
function installDefaultQueryMock() {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT email FROM users")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("SELECT id, url, type, secret FROM webhooks")) {
      return { rows: [], rowCount: 0 };
    }
    // Every UPDATE ... RETURNING id in scan-jobs.ts guards on status; treat
    // every call as applying successfully by default.
    const last = Array.isArray(params) ? params[params.length - 1] : 1;
    return { rows: [{ id: last }], rowCount: 1 };
  });
}

function baseParams(
  overrides: Partial<Parameters<typeof executeScan>[0]> = {},
) {
  return {
    scanId: 1,
    url: "example.com",
    normalizedUrl: "https://example.com/",
    protocolType: "http" as const,
    isRawIpTarget: false,
    selectedScanners: null,
    requestedProbes: [],
    authedUserId: 42,
    categoriesTotal: 2,
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  installDefaultQueryMock();
  mockSafeFetch.mockReset();
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
  mockRunSyncChecks.mockReset();
  mockRunAsyncChecksDetailed.mockReset();
  mockSendNotificationEmail.mockReset();
});

describe("executeScan", () => {
  it("goes pending -> running -> completed, persisting real progress in between", async () => {
    mockSafeFetch.mockResolvedValue(
      new Response("<html><body>ok</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    mockRunSyncChecks.mockImplementation(
      (_url, _headers, _body, _categories, onProgress) => {
        onProgress?.("headers", "start");
        onProgress?.("headers", "done");
        return { findings: [], checksRun: 5, checksSkipped: 0, deduped: 0 };
      },
    );
    mockRunAsyncChecksDetailed.mockImplementation(
      async (_url, _categories, onProgress) => {
        onProgress?.("dns", "start");
        onProgress?.("dns", "done");
        return { findings: [], incomplete: [] };
      },
    );

    await executeScan(baseParams());

    const calls = mockQuery.mock.calls;
    const runningCall = calls.find(([sql]) =>
      (sql as string).includes("status = 'running'"),
    );
    expect(runningCall).toBeDefined();

    const progressCalls = calls.filter(([sql]) =>
      (sql as string).includes("current_category = $1"),
    );
    expect(progressCalls.length).toBe(2); // headers + dns "start" events

    const completedCall = calls.find(([sql]) =>
      (sql as string).includes("status = 'completed'"),
    );
    expect(completedCall).toBeDefined();
    const [, completedParams] = completedCall!;
    // findings JSON, count, summary JSON, duration, scannedAt, headers JSON, resultMeta JSON, finalUrl, id
    expect((completedParams as unknown[])[7]).toBeNull(); // no redirect in this fixture
    expect((completedParams as unknown[])[8]).toBe(1);
  });

  it("attaches a sourcemap-sourcescontent-exposed finding when the page references a .map file whose sourcesContent is live and non-empty", async () => {
    // First safeFetch call is the main page (execute-scan.ts's own fetch);
    // the second is checkSourceMapSourcesExposed's own follow-up fetch of
    // the referenced .map file (lib/scanner/checks/content.ts), triggered
    // by the sourceMappingURL comment in this page's body.
    mockSafeFetch
      .mockResolvedValueOnce(
        new Response(
          "<html><body>ok</body></html><script>//# sourceMappingURL=app.js.map</script>",
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 3,
            sources: ["app.ts"],
            sourcesContent: ["export const secret = 1;"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    mockRunSyncChecks.mockReturnValue({
      findings: [],
      checksRun: 5,
      checksSkipped: 0,
      deduped: 0,
    });
    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [],
      incomplete: [],
    });

    await executeScan(baseParams({ scanId: 10 }));

    const completedCall = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes("status = 'completed'"),
    );
    expect(completedCall).toBeDefined();
    const [, completedParams] = completedCall!;
    const persistedFindings = JSON.parse(
      (completedParams as unknown[])[0] as string,
    );
    const finding = persistedFindings.find((f: { id: string }) =>
      f.id.startsWith("sourcemap-sourcescontent-exposed"),
    );
    expect(finding).toBeDefined();
    expect(finding.severity).toBe("high");
    expect(finding.evidence).toContain("app.js.map");
  });

  it("does not attach a sourcemap-sourcescontent-exposed finding when the page references no .map file", async () => {
    mockSafeFetch.mockResolvedValueOnce(
      new Response("<html><body>ok</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    mockRunSyncChecks.mockReturnValue({
      findings: [],
      checksRun: 5,
      checksSkipped: 0,
      deduped: 0,
    });
    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [],
      incomplete: [],
    });

    await executeScan(baseParams({ scanId: 11 }));

    const completedCall = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes("status = 'completed'"),
    );
    const [, completedParams] = completedCall!;
    const persistedFindings = JSON.parse(
      (completedParams as unknown[])[0] as string,
    );
    expect(persistedFindings).toEqual([]);
    // Only the main-page fetch happened -- no follow-up .map request.
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("records the post-redirect URL as finalUrl when safeFetch followed one to a different path", async () => {
    // Response.url is a read-only property the Fetch spec normally sets
    // from the real request -- the constructor ignores a `url` field in
    // its init, so it has to be overridden directly to simulate what
    // safeFetch's Response looks like after following a redirect.
    const redirectedResponse = new Response("<html><body>ok</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(redirectedResponse, "url", {
      value: "https://example.com/landing",
      configurable: true,
    });
    mockSafeFetch.mockResolvedValue(redirectedResponse);
    mockRunSyncChecks.mockImplementation(() => ({
      findings: [],
      checksRun: 5,
      checksSkipped: 0,
      deduped: 0,
    }));
    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [],
      incomplete: [],
    });

    await executeScan(baseParams());

    const completedCall = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes("status = 'completed'"),
    );
    const [, completedParams] = completedCall!;
    expect((completedParams as unknown[])[7]).toBe(
      "https://example.com/landing",
    );
  });

  it("marks the row failed with a real reason when the target is unreachable", async () => {
    mockSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await executeScan(baseParams({ scanId: 2 }));

    const calls = mockQuery.mock.calls;
    const failedCall = calls.find(([sql]) =>
      (sql as string).includes("status = 'failed'"),
    );
    expect(failedCall).toBeDefined();
    const [, failedParams] = failedCall!;
    expect(failedParams[0]).toMatch(/Could not reach the target URL/);
    expect(failedParams[1]).toBe(2);

    // Never reaches finalizeScanSuccess.
    expect(
      calls.some(([sql]) => (sql as string).includes("status = 'completed'")),
    ).toBe(false);
  });

  it("marks the row failed with a real reason when a check throws unexpectedly", async () => {
    mockSafeFetch.mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    mockRunSyncChecks.mockImplementation(() => {
      throw new Error("detector exploded");
    });
    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [],
      incomplete: [],
    });

    await executeScan(baseParams({ scanId: 3 }));

    const failedCall = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes("status = 'failed'"),
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![1][0]).toBe("detector exploded");
  });

  it("stops before persisting a result when the scan was cancelled, and marks it failed with 'Cancelled'", async () => {
    requestCancel(4);
    mockSafeFetch.mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    // Both engines call onProgress("start") first, which throws because the
    // scan is flagged cancelled — this is the real ScanCancelledError path,
    // not a simulated one.
    mockRunAsyncChecksDetailed.mockImplementation(
      async (_url, _categories, onProgress) => {
        onProgress?.("dns", "start");
        return { findings: [], incomplete: [] };
      },
    );
    mockRunSyncChecks.mockImplementation(
      (_url, _headers, _body, _categories, onProgress) => {
        onProgress?.("headers", "start");
        return { findings: [], checksRun: 0, checksSkipped: 0, deduped: 0 };
      },
    );

    await executeScan(baseParams({ scanId: 4 }));

    const calls = mockQuery.mock.calls;
    const failedCall = calls.find(([sql]) =>
      (sql as string).includes("status = 'failed'"),
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![1][0]).toBe("Cancelled");
    expect(
      calls.some(([sql]) => (sql as string).includes("status = 'completed'")),
    ).toBe(false);
    // No notification/webhook side effects for a cancelled scan.
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();

    clearCancel(4);
  });

  it("does not fire notifications when finalizeScanSuccess is a no-op (watchdog already won)", async () => {
    mockSafeFetch.mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    mockRunSyncChecks.mockReturnValue({
      findings: [],
      checksRun: 0,
      checksSkipped: 0,
      deduped: 0,
    });
    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [],
      incomplete: [],
    });
    // Simulate the watchdog having already marked the row failed: every
    // UPDATE ... RETURNING id returns no rows.
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT email FROM users")) return { rows: [] };
      if (sql.includes("SELECT id, url, type, secret FROM webhooks"))
        return { rows: [] };
      if (sql.includes("status = 'completed'"))
        return { rows: [], rowCount: 0 };
      return { rows: [{ id: 5 }], rowCount: 1 };
    });

    await executeScan(baseParams({ scanId: 5 }));

    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  describe("silenceRoutineEmail (scheduled-scan notification noise control)", () => {
    function installEmailLookupQueryMock() {
      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT email FROM users")) {
          return { rows: [{ email: "owner@example.com" }], rowCount: 1 };
        }
        if (sql.includes("SELECT id, url, type, secret FROM webhooks")) {
          return { rows: [], rowCount: 0 };
        }
        const last = Array.isArray(params) ? params[params.length - 1] : 1;
        return { rows: [{ id: last }], rowCount: 1 };
      });
    }

    it("sends the routine scan-complete email by default (a manual scan, silenceRoutineEmail unset)", async () => {
      installEmailLookupQueryMock();
      mockSafeFetch.mockResolvedValue(
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
      mockRunSyncChecks.mockReturnValue({
        findings: [],
        checksRun: 0,
        checksSkipped: 0,
        deduped: 0,
      });
      mockRunAsyncChecksDetailed.mockResolvedValue({
        findings: [],
        incomplete: [],
      });

      await executeScan(baseParams({ scanId: 6 }));
      // Let the fire-and-forget .then() chain settle.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSendNotificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ type: "scan_complete" }),
      );
    });

    it("suppresses the routine scan-complete email when silenceRoutineEmail is true and nothing critical was found", async () => {
      installEmailLookupQueryMock();
      mockSafeFetch.mockResolvedValue(
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
      mockRunSyncChecks.mockReturnValue({
        findings: [],
        checksRun: 0,
        checksSkipped: 0,
        deduped: 0,
      });
      mockRunAsyncChecksDetailed.mockResolvedValue({
        findings: [],
        incomplete: [],
      });

      await executeScan(baseParams({ scanId: 7, silenceRoutineEmail: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSendNotificationEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "scan_complete" }),
      );
    });

    it("still sends the critical/high findings alert when silenceRoutineEmail is true and something critical was found", async () => {
      installEmailLookupQueryMock();
      mockSafeFetch.mockResolvedValue(
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
      mockRunSyncChecks.mockReturnValue({
        findings: [
          {
            id: "f1",
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
      mockRunAsyncChecksDetailed.mockResolvedValue({
        findings: [],
        incomplete: [],
      });

      await executeScan(baseParams({ scanId: 8, silenceRoutineEmail: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSendNotificationEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "scan_complete" }),
      );
      expect(mockSendNotificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ type: "severity_alerts" }),
      );
    });

    it("does NOT re-send the critical/high alert when the only critical finding is a repeat from the previous scan of the same URL", async () => {
      // This is the exact regression the diff in
      // lib/scanner/regression-alert.ts exists to fix: before it existed,
      // this alert fired unconditionally whenever summary.critical > 0,
      // so a persistent finding on an hourly schedule re-alerted every run.
      const repeatFinding = {
        id: "f1",
        title: "Critical issue",
        description: "d",
        severity: "critical",
        category: "configuration",
        evidence: "",
        riskImpact: "",
        explanation: "",
        fixSteps: [],
        codeExamples: [],
      };

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT email FROM users")) {
          return { rows: [{ email: "owner@example.com" }], rowCount: 1 };
        }
        if (sql.includes("SELECT url, type FROM webhooks")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM scan_history") && sql.includes("findings")) {
          // The "previous scan" already has this exact finding.
          return { rows: [{ findings: JSON.stringify([repeatFinding]) }] };
        }
        if (sql.includes("FROM scan_finding_feedback")) {
          return { rows: [] };
        }
        const last = Array.isArray(params) ? params[params.length - 1] : 1;
        return { rows: [{ id: last }], rowCount: 1 };
      });

      mockSafeFetch.mockResolvedValue(
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
      mockRunSyncChecks.mockReturnValue({
        findings: [repeatFinding],
        checksRun: 1,
        checksSkipped: 0,
        deduped: 0,
      });
      mockRunAsyncChecksDetailed.mockResolvedValue({
        findings: [],
        incomplete: [],
      });

      await executeScan(baseParams({ scanId: 9, silenceRoutineEmail: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSendNotificationEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "severity_alerts" }),
      );
    });
  });
});
