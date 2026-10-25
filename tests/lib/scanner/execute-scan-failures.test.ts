/**
 * How executeScan ends a scan that did not simply succeed: what it records,
 * what it logs, and what it deliberately does not log.
 *
 * The envelope and the happy path have their own suite (execute-scan.test.ts).
 * This one is about the three kinds of ending that used to look identical:
 * the user stopped it, the watchdog stopped it, and the engine broke. They all
 * wrote status = 'failed' with free text, all but the last were logged as a
 * scan failure, and none of the logs carried the scan.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

// The budgets are the point of several tests here, so they are controlled
// directly instead of read from a faked system_settings row.
const mockSettings = {
  SCAN_TIMEOUT_SECONDS: 300,
  SCANNER_MAX_RESPONSE_BODY_BYTES: 1_000_000,
  SCANNER_ASYNC_BRANCH_TIMEOUT_MS: 12_000,
  SCAN_ASYNC_CHECKS_TIMEOUT_MS: 15_000,
  SCAN_FETCH_TIMEOUT_MS: 15_000,
};
vi.mock("@/lib/config/runtime-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/runtime-config")>()),
  getSettings: async () => ({ ...mockSettings }),
}));

const mockSafeFetch = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  validateScanTarget: vi.fn(async () => ({ safe: true })),
}));

const mockRunSyncChecks = vi.fn();
vi.mock("@/lib/scanner/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scanner/engine")>()),
  runSyncChecksYielding: async (...args: unknown[]) =>
    mockRunSyncChecks(...args),
}));

const mockRunAsyncChecksDetailed = vi.fn();
vi.mock("@/lib/scanner/async-checks", () => ({
  runAsyncChecksDetailed: (...args: unknown[]) =>
    mockRunAsyncChecksDetailed(...args),
  getPlannedAsyncBranches: () => ["dns", "tls", "live-fetch"],
}));

vi.mock("@/lib/scanner/protocols", () => ({
  getProtocolFromUrl: () => "https",
  getProtocolFindings: () => [],
}));

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(),
}));
vi.mock("@/lib/email/email", () => ({
  scanCompleteEmail: () => ({}),
  criticalFindingsEmail: () => ({}),
}));
vi.mock("@/lib/webhooks/delivery", () => ({
  deliverWebhook: vi.fn(async () => undefined),
}));
vi.mock("@/lib/scanner/port-scan", () => ({
  scanPorts: vi.fn(async () => null),
  buildRiskyPortFindings: vi.fn(() => []),
}));
vi.mock("@/lib/scanner/subdomain-auto", () => ({
  autoDiscoverSubdomains: vi.fn(async () => {}),
  readSubdomains: vi.fn(() => undefined),
}));
vi.mock("@/lib/scanner/cve-enrichment", () => ({
  enrichFindingsWithExploitIntel: vi.fn(async (findings: unknown) => findings),
}));

const { executeScan } = await import("@/lib/scanner/execute-scan");
const { requestCancel, clearCancel } = await import("@/lib/scanner/scan-jobs");
const { currentScanId } = await import("@/lib/database/request-context");

/** Every UPDATE ... RETURNING in scan-jobs.ts applies unless a test says otherwise. */
function installDefaultQueryMock(
  overrides: (sql: string, params?: unknown[]) => unknown = () => undefined,
) {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const custom = overrides(sql, params);
    if (custom !== undefined) return custom;
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
  overrides: Partial<Parameters<typeof executeScan>[0]> = {},
) {
  return {
    scanId: 1,
    url: "example.com",
    normalizedUrl: "https://example.com/",
    protocolType: "http" as const,
    isRawIpTarget: false,
    selectedScanners: null,
    authedUserId: 42,
    categoriesTotal: 2,
    ...overrides,
  };
}

function okPage() {
  return new Response("<html><body>ok</body></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

function cleanChecks() {
  mockRunSyncChecks.mockReturnValue({
    findings: [],
    checksRun: 5,
    checksSkipped: 0,
    checksErrored: 0,
    erroredChecks: [],
    deduped: 0,
  });
  mockRunAsyncChecksDetailed.mockResolvedValue({
    findings: [],
    incomplete: [],
  });
}

/** The statements that recorded a failure, with their kind. */
function failureWrites() {
  return mockQuery.mock.calls
    .filter(([sql]) => (sql as string).includes("status = 'failed'"))
    .map(([, params]) => ({
      reason: (params as unknown[])[0] as string,
      scanId: (params as unknown[])[1] as number,
      kind: (params as unknown[])[2] as string,
    }));
}

/** The finalize UPDATE, not the regression lookup that also names the status. */
function completedWrites() {
  return mockQuery.mock.calls.filter(([sql]) =>
    (sql as string).includes("SET status = 'completed'"),
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockQuery.mockReset();
  installDefaultQueryMock();
  mockSafeFetch.mockReset();
  mockRunSyncChecks.mockReset();
  mockRunAsyncChecksDetailed.mockReset();
  mockSettings.SCAN_TIMEOUT_SECONDS = 300;
  mockSettings.SCANNER_ASYNC_BRANCH_TIMEOUT_MS = 12_000;
  mockSettings.SCAN_ASYNC_CHECKS_TIMEOUT_MS = 15_000;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.useRealTimers();
});

describe("executeScan: a scan that is cancelled", () => {
  // A cancel during the page fetch does not surface as a ScanCancelledError.
  // It is the fetch's own abort error, which executeScan wrapped as "Could not
  // reach the target URL", so the user's cancel was logged as a scan failure
  // and counted against the health alarm.
  it("records a cancel that lands mid-fetch as cancelled and logs nothing", async () => {
    mockSafeFetch.mockImplementation(async () => {
      requestCancel(11);
      throw Object.assign(new Error("This operation was aborted"), {
        name: "AbortError",
      });
    });

    await executeScan(baseParams({ scanId: 11 }));

    expect(failureWrites()).toEqual([
      { reason: "Cancelled", scanId: 11, kind: "cancelled" },
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(completedWrites()).toHaveLength(0);
    clearCancel(11);
  });

  it("records a cancel that lands between categories the same way", async () => {
    requestCancel(12);
    mockSafeFetch.mockResolvedValue(okPage());
    mockRunSyncChecks.mockImplementation(
      (_url, _headers, _body, _categories, onProgress) => {
        onProgress?.("headers", "start");
        return { findings: [], checksRun: 0, checksSkipped: 0, deduped: 0 };
      },
    );
    mockRunAsyncChecksDetailed.mockImplementation(
      async (_url, _categories, onProgress) => {
        onProgress?.("dns", "start");
        return { findings: [], incomplete: [] };
      },
    );

    await executeScan(baseParams({ scanId: 12 }));

    expect(failureWrites()).toEqual([
      { reason: "Cancelled", scanId: 12, kind: "cancelled" },
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
    clearCancel(12);
  });
});

describe("executeScan: a scan the engine fails", () => {
  it("logs the Error itself with the scan, the user, the source and the URL", async () => {
    const boom = new Error("detector exploded");
    mockSafeFetch.mockResolvedValue(okPage());
    mockRunSyncChecks.mockImplementation(() => {
      throw boom;
    });
    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [],
      incomplete: [],
    });

    await executeScan(baseParams({ scanId: 21, source: "api" }));

    // One line, with the stack (the Error object, not its message) and the
    // ids that find the row again. It used to be `.message` alone.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, context, err] = errorSpy.mock.calls[0];
    expect(String(message)).toBe("[scan] scan failed");
    expect(context).toEqual({
      scanId: 21,
      userId: 42,
      source: "api",
      url: "https://example.com/",
    });
    expect(err).toBe(boom);

    expect(failureWrites()).toEqual([
      { reason: "detector exploded", scanId: 21, kind: "internal" },
    ]);
  });

  it("runs the whole job inside the scan's own context", async () => {
    // So every console.error a check or a safeFetch raises on the way is
    // attributed to this scan without being handed the id.
    const seen: Array<number | null> = [];
    mockSafeFetch.mockImplementation(async () => {
      seen.push(currentScanId());
      return okPage();
    });
    mockRunSyncChecks.mockImplementation(() => {
      seen.push(currentScanId());
      return {
        findings: [],
        checksRun: 0,
        checksSkipped: 0,
        checksErrored: 0,
        erroredChecks: [],
        deduped: 0,
      };
    });
    mockRunAsyncChecksDetailed.mockImplementation(async () => {
      seen.push(currentScanId());
      return { findings: [], incomplete: [] };
    });

    await executeScan(baseParams({ scanId: 22 }));

    expect(seen).toEqual([22, 22, 22]);
    expect(currentScanId()).toBeNull();
  });
});

describe("executeScan: the watchdog", () => {
  // The watchdog calls requestCancel, so the job's own catch sees a cancel
  // that looks exactly like the user's. The two must not be recorded as each
  // other, or every timeout reads as "Cancelled by the user".
  it("records timeout, not cancelled, when the watchdog's abort stops the job", async () => {
    vi.useFakeTimers();
    mockSettings.SCAN_TIMEOUT_SECONDS = 1;
    // A fetch that hangs until the scan's abort signal fires, as a stalled
    // target does.
    mockSafeFetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(
              Object.assign(new Error("This operation was aborted"), {
                name: "AbortError",
              }),
            ),
          );
        }),
    );

    const done = executeScan(baseParams({ scanId: 31 }));
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    const writes = failureWrites();
    expect(writes.length).toBeGreaterThanOrEqual(1);
    for (const write of writes) {
      expect(write).toEqual({
        reason: "Scan exceeded the 1s time limit.",
        scanId: 31,
        kind: "timeout",
      });
    }
    expect(writes.some((w) => w.kind === "cancelled")).toBe(false);
    // Logged once, by the watchdog, and not a second time as "scan failed".
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("time limit");
    clearCancel(31);
  });

  it("logs a scan that finished its work after the watchdog had already closed the row", async () => {
    vi.useFakeTimers();
    mockSettings.SCAN_TIMEOUT_SECONDS = 1;
    mockSafeFetch.mockResolvedValue(okPage());
    mockRunSyncChecks.mockReturnValue({
      findings: [],
      checksRun: 5,
      checksSkipped: 0,
      checksErrored: 0,
      erroredChecks: [],
      deduped: 0,
    });
    // The checks finish at 1.5s: past the watchdog, and (as the real ones do
    // in their final phase) without noticing the cancel.
    mockRunAsyncChecksDetailed.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ findings: [], incomplete: [] }), 1500),
        ),
    );
    // The row is terminal: the guarded completion matches nothing.
    installDefaultQueryMock((sql) =>
      sql.includes("status = 'completed'")
        ? { rows: [], rowCount: 0 }
        : undefined,
    );

    const done = executeScan(baseParams({ scanId: 32, source: "web" }));
    await vi.advanceTimersByTimeAsync(2000);
    await done;

    const calls = errorSpy.mock.calls as unknown[][];
    const lines = calls.map(([message]) => String(message));
    expect(lines.some((m) => m.includes("time limit"))).toBe(true);
    const late = calls.find(([message]) =>
      String(message).includes("result discarded"),
    );
    expect(late).toBeDefined();
    expect(late![1]).toMatchObject({
      scanId: 32,
      userId: 42,
      source: "web",
      findingsCount: 0,
    });
    expect((late![1] as { lateByMs: number }).lateByMs).toBeGreaterThanOrEqual(
      500,
    );
    clearCancel(32);
  });

  it("stays silent about a late result when the row was closed by the user's cancel", async () => {
    mockSafeFetch.mockResolvedValue(okPage());
    cleanChecks();
    // The cancel lands during the checks and the work finishes anyway.
    mockRunAsyncChecksDetailed.mockImplementation(async () => {
      requestCancel(33);
      return { findings: [], incomplete: [] };
    });
    installDefaultQueryMock((sql) =>
      sql.includes("status = 'completed'")
        ? { rows: [], rowCount: 0 }
        : undefined,
    );

    await executeScan(baseParams({ scanId: 33 }));

    expect(errorSpy).not.toHaveBeenCalled();
    clearCancel(33);
  });

  it("logs a late result when nothing cancelled and nothing timed out, i.e. a sweep got there first", async () => {
    mockSafeFetch.mockResolvedValue(okPage());
    cleanChecks();
    installDefaultQueryMock((sql) =>
      sql.includes("status = 'completed'")
        ? { rows: [], rowCount: 0 }
        : undefined,
    );

    await executeScan(baseParams({ scanId: 34 }));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("result discarded");
  });
});

describe("executeScan: the async-checks race", () => {
  // The outer race and one branch's own ceiling are separate admin settings
  // with no cross-check. Set the race below the branch ceiling and it wins
  // while a branch is still working, returning an empty finding list with
  // every branch marked not checked, which discards the DNS, TLS and
  // reputation findings that had already finished.
  const dnsFinding = {
    id: "spf-missing",
    title: "SPF record missing",
    severity: "medium",
    category: "dns",
    description: "d",
    evidence: "e",
    riskImpact: "r",
    explanation: "x",
    fixSteps: [],
    codeExamples: [],
  };

  function slowAsyncChecks(afterMs: number) {
    mockRunAsyncChecksDetailed.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ findings: [dnsFinding], incomplete: [] }),
            afterMs,
          ),
        ),
    );
  }

  it("keeps the finished findings when the race is configured shorter than a branch", async () => {
    vi.useFakeTimers();
    mockSettings.SCAN_ASYNC_CHECKS_TIMEOUT_MS = 1000;
    mockSettings.SCANNER_ASYNC_BRANCH_TIMEOUT_MS = 5000;
    mockSafeFetch.mockResolvedValue(okPage());
    cleanChecks();
    slowAsyncChecks(3000);

    const done = executeScan(baseParams({ scanId: 41 }));
    await vi.advanceTimersByTimeAsync(3500);
    await done;

    const [, params] = completedWrites()[0];
    const findings = JSON.parse((params as unknown[])[0] as string);
    expect(findings.map((f: { id: string }) => f.id)).toEqual(["spf-missing"]);
    const meta = JSON.parse((params as unknown[])[6] as string);
    expect(meta.incomplete).toBeUndefined();
  });

  it("does not fire the race before one branch's ceiling plus the margin", async () => {
    vi.useFakeTimers();
    mockSettings.SCAN_ASYNC_CHECKS_TIMEOUT_MS = 1000;
    mockSettings.SCANNER_ASYNC_BRANCH_TIMEOUT_MS = 5000;
    mockSafeFetch.mockResolvedValue(okPage());
    cleanChecks();
    // Never settles on its own.
    mockRunAsyncChecksDetailed.mockImplementation(() => new Promise(() => {}));

    const done = executeScan(baseParams({ scanId: 42 }));
    // Past the configured 1s race, short of 5s + the margin.
    await vi.advanceTimersByTimeAsync(6000);
    expect(completedWrites()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1500);
    await done;

    const [, params] = completedWrites()[0];
    const meta = JSON.parse((params as unknown[])[6] as string);
    expect(meta.incomplete).toEqual(
      expect.arrayContaining(["dns", "tls", "live-fetch"]),
    );
  });

  it("leaves a race that is already the longer of the two alone", async () => {
    vi.useFakeTimers();
    mockSettings.SCAN_ASYNC_CHECKS_TIMEOUT_MS = 20_000;
    mockSettings.SCANNER_ASYNC_BRANCH_TIMEOUT_MS = 5000;
    mockSafeFetch.mockResolvedValue(okPage());
    cleanChecks();
    mockRunAsyncChecksDetailed.mockImplementation(() => new Promise(() => {}));

    const done = executeScan(baseParams({ scanId: 43 }));
    await vi.advanceTimersByTimeAsync(19_000);
    expect(completedWrites()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1500);
    await done;

    expect(completedWrites()).toHaveLength(1);
  });
});
