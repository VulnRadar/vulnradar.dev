/**
 * Integration tests for the service-probe dispatch inside executeScan
 * (lib/scanner/execute-scan.ts): given a probe result from banner.ts,
 * does the right Vulnerability finding come out the other end for each
 * of the newly-added services (MongoDB, Redis, Elasticsearch, Memcached)
 * plus the upgraded SSH and SMTP/IMAP/POP3 STARTTLS checks.
 *
 * Mocks the database pool, the network (safeFetch/validateScanTarget),
 * the check engines, and the network-touching parts of protocols/banner
 * (grabBanner, grabCapabilityBanner, probeMongoUnauthenticated) — the
 * pure interpreters in banner.ts (assessSshBanner, detectStartTls,
 * isRedisPingUnauthenticated, isMemcachedStatsUnauthenticated,
 * validateBannerTarget) run for real, so this exercises the actual
 * wiring between a probe result and the finding it produces, matching
 * this repo's "mock at the network boundary, not below it" convention.
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
const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/safe-fetch")>();
  return {
    ...actual,
    safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
    validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
  };
});

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

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(),
}));

vi.mock("@/lib/email/email", () => ({
  scanCompleteEmail: () => ({}),
  criticalFindingsEmail: () => ({}),
}));

const mockGrabBanner = vi.fn();
const mockGrabCapabilityBanner = vi.fn();
const mockProbeMongoUnauthenticated = vi.fn();
vi.mock("@/lib/scanner/protocols/banner", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/protocols/banner")>();
  return {
    ...actual,
    grabBanner: (...args: unknown[]) => mockGrabBanner(...args),
    grabCapabilityBanner: (...args: unknown[]) =>
      mockGrabCapabilityBanner(...args),
    probeMongoUnauthenticated: (...args: unknown[]) =>
      mockProbeMongoUnauthenticated(...args),
  };
});

const { executeScan } = await import("@/lib/scanner/execute-scan");

function installDefaultQueryMock() {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT email FROM users")) return { rows: [] };
    if (sql.includes("SELECT url, type FROM webhooks")) return { rows: [] };
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
    isRawIpTarget: true, // skip the main HTTP fetch; this file only exercises probes
    selectedScanners: null,
    requestedProbes: [],
    authedUserId: 42,
    categoriesTotal: 0,
    ...overrides,
  };
}

/** Pull the findings array persisted by the terminal `status = 'completed'`
 *  UPDATE, decoding the JSON the same way scan-jobs.ts wrote it. */
function getPersistedFindings(): Array<{ title: string; severity: string }> {
  const completedCall = mockQuery.mock.calls.find(([sql]) =>
    (sql as string).includes("status = 'completed'"),
  );
  expect(completedCall).toBeDefined();
  const params = completedCall![1] as unknown[];
  return JSON.parse(params[0] as string);
}

beforeEach(() => {
  mockQuery.mockReset();
  installDefaultQueryMock();
  mockSafeFetch.mockReset();
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
  mockRunSyncChecks.mockReset();
  mockRunSyncChecks.mockReturnValue({
    findings: [],
    checksRun: 0,
    checksSkipped: 0,
    deduped: 0,
  });
  mockRunAsyncChecksDetailed.mockReset();
  mockRunAsyncChecksDetailed.mockResolvedValue({
    findings: [],
    incomplete: [],
  });
  mockGrabBanner.mockReset();
  mockGrabCapabilityBanner.mockReset();
  mockProbeMongoUnauthenticated.mockReset();
});

describe("executeScan probe dispatch: MongoDB", () => {
  it("produces a critical finding when MongoDB allows unauthenticated access", async () => {
    mockProbeMongoUnauthenticated.mockResolvedValue({
      reachable: true,
      unauthenticatedAccess: true,
      detail: "listDatabases succeeded without authentication (ok=1).",
    });

    await executeScan(
      baseParams({ requestedProbes: [{ service: "mongodb", port: 27017 }] }),
    );

    const findings = getPersistedFindings();
    const finding = findings.find(
      (f) => f.title === "MongoDB Allows Unauthenticated Access",
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
  });

  it("produces an info finding (not critical) when MongoDB requires authentication", async () => {
    mockProbeMongoUnauthenticated.mockResolvedValue({
      reachable: true,
      unauthenticatedAccess: false,
      detail: "listDatabases was rejected: not authorized.",
    });

    await executeScan(
      baseParams({ requestedProbes: [{ service: "mongodb", port: 27017 }] }),
    );

    const findings = getPersistedFindings();
    expect(
      findings.some((f) => f.title === "MongoDB Allows Unauthenticated Access"),
    ).toBe(false);
    const finding = findings.find(
      (f) => f.title === "MongoDB Requires Authentication",
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("info");
  });
});

describe("executeScan probe dispatch: Redis", () => {
  it("produces a critical finding when Redis answers PING unauthenticated", async () => {
    mockGrabBanner.mockResolvedValue({
      protocol: "redis",
      host: "example.com",
      port: 6379,
      banner: "+PONG\r\n",
      secure: false,
    });

    await executeScan(
      baseParams({ requestedProbes: [{ service: "redis", port: 6379 }] }),
    );

    const findings = getPersistedFindings();
    const finding = findings.find(
      (f) => f.title === "Redis Allows Unauthenticated Access",
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
  });

  it("produces an info finding when Redis rejects PING with NOAUTH", async () => {
    mockGrabBanner.mockResolvedValue({
      protocol: "redis",
      host: "example.com",
      port: 6379,
      banner: "-NOAUTH Authentication required.\r\n",
      secure: false,
    });

    await executeScan(
      baseParams({ requestedProbes: [{ service: "redis", port: 6379 }] }),
    );

    const findings = getPersistedFindings();
    expect(
      findings.some((f) => f.title === "Redis Allows Unauthenticated Access"),
    ).toBe(false);
    expect(
      findings.some((f) => f.title === "Redis Requires Authentication"),
    ).toBe(true);
  });
});

describe("executeScan probe dispatch: Memcached", () => {
  it("produces a critical finding when Memcached answers stats unauthenticated", async () => {
    mockGrabBanner.mockResolvedValue({
      protocol: "memcached",
      host: "example.com",
      port: 11211,
      banner: "STAT pid 12345\r\n",
      secure: false,
    });

    await executeScan(
      baseParams({ requestedProbes: [{ service: "memcached", port: 11211 }] }),
    );

    const findings = getPersistedFindings();
    const finding = findings.find(
      (f) => f.title === "Memcached Allows Unauthenticated Access",
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
  });

  it("produces no unauthenticated-access finding when the stats command fails", async () => {
    mockGrabBanner.mockResolvedValue({
      protocol: "memcached",
      host: "example.com",
      port: 11211,
      banner: "ERROR\r\n",
      secure: false,
    });

    await executeScan(
      baseParams({ requestedProbes: [{ service: "memcached", port: 11211 }] }),
    );

    const findings = getPersistedFindings();
    expect(
      findings.some(
        (f) => f.title === "Memcached Allows Unauthenticated Access",
      ),
    ).toBe(false);
  });
});

describe("executeScan probe dispatch: Elasticsearch", () => {
  it("produces a critical finding when the root endpoint exposes cluster info with no auth", async () => {
    mockSafeFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          cluster_name: "prod-cluster",
          tagline: "You Know, for Search",
        }),
        { status: 200 },
      ),
    );

    await executeScan(
      baseParams({
        requestedProbes: [{ service: "elasticsearch", port: 9200 }],
      }),
    );

    const esCall = mockSafeFetch.mock.calls.find(([url]) =>
      (url as string).includes(":9200"),
    );
    expect(esCall).toBeDefined();

    const findings = getPersistedFindings();
    const finding = findings.find(
      (f) => f.title === "Elasticsearch Allows Unauthenticated Access",
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
  });

  it("produces an info finding when the root endpoint requires authentication", async () => {
    mockSafeFetch.mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    await executeScan(
      baseParams({
        requestedProbes: [{ service: "elasticsearch", port: 9200 }],
      }),
    );

    const findings = getPersistedFindings();
    expect(
      findings.some(
        (f) => f.title === "Elasticsearch Allows Unauthenticated Access",
      ),
    ).toBe(false);
    expect(
      findings.some((f) => f.title === "Elasticsearch Requires Authentication"),
    ).toBe(true);
  });
});

describe("executeScan probe dispatch: SSH", () => {
  it("flags SSH protocol-1 support and a known-vulnerable version range together", async () => {
    mockGrabBanner.mockResolvedValue({
      protocol: "ssh",
      host: "example.com",
      port: 22,
      banner: "SSH-1.99-OpenSSH_3.9\r\n",
      secure: false,
    });

    await executeScan(
      baseParams({ requestedProbes: [{ service: "ssh", port: 22 }] }),
    );

    const findings = getPersistedFindings();
    expect(findings.some((f) => f.title === "SSH Protocol 1 Supported")).toBe(
      true,
    );
    expect(
      findings.some(
        (f) =>
          f.title === "SSH Banner Matches a Known-Vulnerable Version Range",
      ),
    ).toBe(true);
  });

  it("produces no SSH vuln findings for a current, patched OpenSSH release", async () => {
    mockGrabBanner.mockResolvedValue({
      protocol: "ssh",
      host: "example.com",
      port: 22,
      banner: "SSH-2.0-OpenSSH_9.9\r\n",
      secure: false,
    });

    await executeScan(
      baseParams({ requestedProbes: [{ service: "ssh", port: 22 }] }),
    );

    const findings = getPersistedFindings();
    expect(findings.some((f) => f.title === "SSH Protocol 1 Supported")).toBe(
      false,
    );
    expect(
      findings.some((f) =>
        f.title.startsWith("SSH Banner Matches a Known-Vulnerable"),
      ),
    ).toBe(false);
  });
});

describe("executeScan probe dispatch: SMTP STARTTLS", () => {
  it("flags missing STARTTLS on a plaintext SMTP capability response", async () => {
    mockGrabCapabilityBanner.mockResolvedValue({
      protocol: "smtp",
      host: "example.com",
      port: 25,
      banner:
        "220 mail.example.com ESMTP\r\n250-mail.example.com\r\n250 PIPELINING\r\n",
      secure: false,
    });

    await executeScan(
      baseParams({ requestedProbes: [{ service: "smtp", port: 25 }] }),
    );

    const findings = getPersistedFindings();
    const finding = findings.find(
      (f) => f.title === "SMTP Does Not Offer STARTTLS",
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
  });

  it("does not flag STARTTLS when it is offered and AUTH is not advertised pre-TLS", async () => {
    mockGrabCapabilityBanner.mockResolvedValue({
      protocol: "smtp",
      host: "example.com",
      port: 25,
      banner:
        "220 mail.example.com ESMTP\r\n250-mail.example.com\r\n250 STARTTLS\r\n",
      secure: false,
    });

    await executeScan(
      baseParams({ requestedProbes: [{ service: "smtp", port: 25 }] }),
    );

    const findings = getPersistedFindings();
    expect(
      findings.some((f) => f.title === "SMTP Does Not Offer STARTTLS"),
    ).toBe(false);
    expect(
      findings.some((f) =>
        f.title.startsWith("SMTP May Allow Authentication Before STARTTLS"),
      ),
    ).toBe(false);
  });
});

describe("executeScan probe dispatch: unreachable port", () => {
  it("emits exactly one info finding when a selected probe cannot be reached", async () => {
    // A closed/filtered port is the norm for a normal website (only 80/443
    // open); grabBanner returns null. The probe must still produce a visible
    // line rather than nothing, so the feature never looks broken.
    mockGrabBanner.mockResolvedValue(null);

    await executeScan(
      baseParams({ requestedProbes: [{ service: "ssh", port: 22 }] }),
    );

    const findings = getPersistedFindings();
    const unreachable = findings.filter(
      (f) => f.title === "No SSH service reachable on port 22",
    );
    expect(unreachable).toHaveLength(1);
    expect(unreachable[0].severity).toBe("info");
  });
});
