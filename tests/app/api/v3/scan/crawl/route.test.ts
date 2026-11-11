/**
 * Route-level tests for POST /api/v3/scan/crawl.
 *
 * The actual crawl work (lib/scanner/execute-crawl-scan.ts) has its own
 * suite; this exercises only what the route itself is responsible for:
 * creating the tracker scan_history row immediately and dispatching the
 * job without awaiting it, rather than holding the request open through
 * discovery and every page scan.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { SETTINGS_REGISTRY } from "@/lib/config/registry";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// Runtime-config resolves settings via pool.query under the hood in
// production; mocked here at the module boundary so it does not consume the
// mockQuery call sequence the tracker-row assertions below depend on. The
// shipped registry default keeps the resolved value identical to the old
// static SCANNING.MAX_URL_LENGTH constant. Exposed as controllable spies so
// the authenticated-crawl tests below can flip SCAN_AUTH_ENABLED to false.
type SettingKey = keyof typeof SETTINGS_REGISTRY;
const registryDefault = (key: SettingKey) => SETTINGS_REGISTRY[key].default;
const mockGetSetting = vi.fn(async (key: SettingKey) => registryDefault(key));
const mockGetSettings = vi.fn(async (keys: SettingKey[]) =>
  Object.fromEntries(keys.map((k) => [k, registryDefault(k)])),
);
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...(args as [SettingKey])),
  getSettings: (...args: unknown[]) =>
    mockGetSettings(...(args as [SettingKey[]])),
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: () => mockGetSession() };
});

const mockBurstLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockBurstLimit(...args),
  };
});

// attachNewScanTeams swallows its own failures today; the handle lets a test
// make it throw anyway, which is the case the route must survive without
// leaving a pending tracker row behind.
const mockAttachNewScanTeams = vi.fn();
vi.mock("@/lib/teams/scan-teams", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/teams/scan-teams")>();
  return {
    ...actual,
    attachNewScanTeams: (...args: unknown[]) => mockAttachNewScanTeams(...args),
  };
});

// Module-scope handle rather than an inline always-allow factory: the
// blocklist could be deleted from this route with the whole suite still
// green, because no test could drive a refusal and none asserted the call.
// See the matching block in tests/app/api/v3/scan/route.test.ts.
const mockCheckAccessRules = vi.fn();
vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: (...args: unknown[]) => mockCheckAccessRules(...args),
}));

const mockIsUrlOwnedByUser = vi.fn();
vi.mock("@/lib/domains/scope", () => ({
  isUrlOwnedByUser: (...args: unknown[]) => mockIsUrlOwnedByUser(...args),
}));

const mockCheckConcurrentScanLimit = vi.fn();
// reserveConcurrentScanSlot now performs the scan_history INSERT inside a
// locked transaction. The real helper uses pool.connect(); here we run the
// caller's insertRow against a fake client that delegates to mockQuery, so
// the tracker-row INSERT still flows through the same mock the assertions
// below inspect.
const mockReserveConcurrentScanSlot = vi.fn(
  async (
    _userId: number,
    insertRow: (client: {
      query: (...a: unknown[]) => unknown;
    }) => Promise<number>,
  ) => {
    const scanId = await insertRow({
      query: (...a: unknown[]) => mockQuery(...a),
    });
    return { ok: true as const, scanId, publicId: `public-${scanId}` };
  },
);
vi.mock("@/lib/rate-limiting/concurrent-scans", () => ({
  checkConcurrentScanLimit: (...args: unknown[]) =>
    mockCheckConcurrentScanLimit(...args),
  reserveConcurrentScanSlot: (...args: unknown[]) =>
    mockReserveConcurrentScanSlot(
      ...(args as [
        number,
        (client: { query: (...a: unknown[]) => unknown }) => Promise<number>,
      ]),
    ),
}));

const mockCheckAndRecordRequest = vi.fn();
const mockGetUserPlan = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  // The crawl route's quota gate is now the read-only canMakeRequest (the
  // executor does the per-page recording); it returns the same shape, so the
  // existing gate mock fn drives it. checkAndRecordRequest is kept for any
  // other importer but the route no longer calls it.
  checkAndRecordRequest: (...args: unknown[]) =>
    mockCheckAndRecordRequest(...args),
  canMakeRequest: (...args: unknown[]) => mockCheckAndRecordRequest(...args),
  getRateLimitHeaders: () => ({}),
  getUserPlan: (...args: unknown[]) => mockGetUserPlan(...args),
}));

const mockExecuteCrawlScan = vi.fn();
vi.mock("@/lib/scanner/execute-crawl-scan", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/execute-crawl-scan")>();
  return {
    ...actual,
    executeCrawlScan: (...args: unknown[]) => mockExecuteCrawlScan(...args),
  };
});

const mockValidateApiKey = vi.fn();
const mockCheckApiKeyRateLimit = vi.fn();
const mockPeekRateLimit = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  UNLIMITED_API_KEY_DAILY_LIMIT: 999999,
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
  checkRateLimit: (...args: unknown[]) => mockCheckApiKeyRateLimit(...args),
  peekRateLimit: (...args: unknown[]) => mockPeekRateLimit(...args),
  recordUsage: vi.fn(async () => undefined),
}));

// The route establishes the session in-process; the login mechanics have
// their own suites (tests/lib/scanner/auth/), so this replaces the whole
// module and drives outcomes from the test body.
const mockEstablishScanSession = vi.fn();
vi.mock("@/lib/scanner/auth/login", () => ({
  establishScanSession: (...args: unknown[]) =>
    mockEstablishScanSession(...args),
}));

const mockLogAction = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return { ...actual, logAction: mockLogAction };
});

const { POST } = await import("@/app/api/v3/scan/crawl/route");

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/scan/crawl", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockBurstLimit.mockReset();
  mockBurstLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterSeconds: 0,
  });
  mockAttachNewScanTeams.mockReset();
  mockAttachNewScanTeams.mockResolvedValue(undefined);
  mockCheckApiKeyRateLimit.mockReset();
  mockCheckApiKeyRateLimit.mockResolvedValue({
    allowed: true,
    limit: 50,
    used: 1,
    remaining: 49,
    resetsAt: new Date().toISOString(),
  });
  mockPeekRateLimit.mockReset();
  mockPeekRateLimit.mockResolvedValue({
    allowed: true,
    limit: 50,
    used: 2,
    remaining: 48,
    resetsAt: "2030-01-02T03:04:05.000Z",
  });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockExecuteCrawlScan.mockReset();
  mockExecuteCrawlScan.mockResolvedValue(undefined);
  mockValidateApiKey.mockReset();
  mockIsUrlOwnedByUser.mockReset();
  mockIsUrlOwnedByUser.mockResolvedValue(true);
  mockCheckConcurrentScanLimit.mockReset();
  mockCheckConcurrentScanLimit.mockResolvedValue({
    allowed: true,
    current: 0,
    limit: 3,
  });
  mockCheckAndRecordRequest.mockReset();
  mockCheckAndRecordRequest.mockResolvedValue({
    allowed: true,
    used: 1,
    limit: 150,
    remaining: 149,
    resetsAt: "2030-01-02T00:00:00.000Z",
  });
  mockGetUserPlan.mockReset();
  mockGetUserPlan.mockResolvedValue("free");
  mockEstablishScanSession.mockReset();
  mockLogAction.mockClear();
  mockGetSetting.mockReset();
  mockGetSetting.mockImplementation(async (key: SettingKey) =>
    registryDefault(key),
  );
  mockGetSettings.mockReset();
  mockGetSettings.mockImplementation(async (keys: SettingKey[]) =>
    Object.fromEntries(keys.map((k) => [k, registryDefault(k)])),
  );
  mockCheckAccessRules.mockReset();
  mockCheckAccessRules.mockResolvedValue({ allowed: true });
});

describe("POST /api/v3/scan/crawl - access rules", () => {
  it("returns 403 BLOCKED and never starts the crawl when the target is on the blocklist", async () => {
    mockCheckAccessRules.mockResolvedValue({ allowed: false });

    const res = await POST(postRequest({ url: "https://blocked.test" }));

    expect(res.status).toBe(403);
    expect((await res.json()).statusCode).toBe("BLOCKED");
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
    // A crawl multiplies the request volume against the target, so this
    // must refuse before any row is written, not after.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("consults the blocklist with the normalized URL on the happy path", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });

    await POST(postRequest({ url: "example.com" }));

    // The crawl route normalizes through the URL constructor, which adds the
    // trailing slash; asserting the exact string is the point, since
    // checking the raw input instead would let a bare host past a blocklist
    // that only matches absolute URLs.
    expect(mockCheckAccessRules).toHaveBeenCalledWith("https://example.com/");
  });
});

describe("POST /api/v3/scan/crawl", () => {
  it("creates a pending tracker row and returns immediately without waiting for the crawl", async () => {
    let resolveExecute: () => void = () => {};
    mockExecuteCrawlScan.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveExecute = resolve;
        }),
    );
    // resolveScanIsPublic's account-default lookup, then the tracker INSERT.
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 200 }] });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      scanId: 200,
      publicId: "public-200",
      status: "running",
      quota: {
        scans: {
          limit: 150,
          used: 1,
          remaining: 149,
          resetsAt: "2030-01-02T00:00:00.000Z",
        },
        requests: null,
      },
    });
    expect(mockExecuteCrawlScan).toHaveBeenCalledTimes(1);
    resolveExecute();
  });

  it("passes the tracker scanId and main-origin context to executeCrawlScan", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 201 }] });

    await POST(postRequest({ url: "https://example.com/start" }));

    expect(mockExecuteCrawlScan).toHaveBeenCalledWith(
      expect.objectContaining({
        scanId: 201,
        normalizedMainUrl: "https://example.com/start",
        mainOrigin: "https://example.com",
        authedUserId: 42,
      }),
    );
  });

  it("inserts is_public=true by default and false when the request asks for a private crawl", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 202 }] });
    await POST(postRequest({ url: "https://example.com" }));
    let insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(insertCall![0]).toContain("is_public");
    expect(insertCall![1][4]).toBe(true);

    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 203 }] });
    await POST(postRequest({ url: "https://example.com", isPublic: false }));
    // An explicit isPublic in the request skips the account-default lookup
    // entirely, so this is the only query call.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    insertCall = mockQuery.mock.calls[0];
    expect(insertCall[1][4]).toBe(false);
  });

  it("falls back to the account's scans_private_by_default setting when the request omits isPublic", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: true }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 204 }] });

    await POST(postRequest({ url: "https://example.com" }));

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(insertCall![1][4]).toBe(false);
  });

  it("rejects a non-http(s) URL before creating a row", async () => {
    const res = await POST(postRequest({ url: "ftp://example.com" }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
  });

  it("returns 500 and never dispatches a crawl when the tracker row cannot be created", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(500);
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
  });
});

describe("daily scan quota gate", () => {
  it("rejects with 429 when the caller has no remaining daily quota, for either auth method", async () => {
    mockCheckAndRecordRequest.mockResolvedValue({
      allowed: false,
      used: 150,
      limit: 150,
      remaining: 0,
      resetsAt: new Date().toISOString(),
    });
    const res = await POST(postRequest({ url: "https://example.com" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/daily scan limit reached/i);
    expect(json.code).toBe("DAILY_LIMIT");
    expect(mockCheckAndRecordRequest).toHaveBeenCalledWith(42);
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
    // Checked before the concurrency gate -- neither DB call for the
    // tracker row nor the concurrency check should ever run.
    expect(mockCheckConcurrentScanLimit).not.toHaveBeenCalled();
  });

  it("proceeds normally when daily quota remains", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    const res = await POST(postRequest({ url: "https://example.com" }));
    expect(res.status).toBe(200);
    expect(mockExecuteCrawlScan).toHaveBeenCalledTimes(1);
  });
});

describe("concurrent-scan capacity gate", () => {
  it("rejects with 429 when the caller is already at their plan's concurrent-scan limit", async () => {
    mockCheckConcurrentScanLimit.mockResolvedValue({
      allowed: false,
      current: 3,
      limit: 3,
      message: "capacity message",
    });
    const res = await POST(postRequest({ url: "https://example.com" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.statusCode).toBe("CONCURRENT_SCAN_LIMIT");
    expect(json.code).toBe("CONCURRENT_SCAN_LIMIT");
    expect(res.headers.get("Retry-After")).toBe("10");
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
  });

  it("proceeds normally when under the concurrent-scan limit", async () => {
    mockCheckConcurrentScanLimit.mockResolvedValue({
      allowed: true,
      current: 1,
      limit: 3,
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 6 }] });
    const res = await POST(postRequest({ url: "https://example.com" }));
    expect(res.status).toBe(200);
    expect(mockExecuteCrawlScan).toHaveBeenCalledTimes(1);
  });
});

describe("active-probes domain ownership gate", () => {
  it("never checks domain ownership for an ordinary crawl that doesn't request active-probes", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await POST(postRequest({ url: "https://example.com" }));
    expect(mockIsUrlOwnedByUser).not.toHaveBeenCalled();
  });

  it("rejects with 403 when active-probes is requested against an unverified domain", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(false);
    const res = await POST(
      postRequest({
        url: "https://example.com",
        scanners: ["headers", "active-probes"],
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.statusCode).toBe("DOMAIN_NOT_VERIFIED");
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
  });

  it("proceeds normally when active-probes is requested against a verified domain", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 2 }] });
    const res = await POST(
      postRequest({
        url: "https://example.com",
        scanners: ["active-probes"],
      }),
    );
    expect(res.status).toBe(200);
    expect(mockExecuteCrawlScan).toHaveBeenCalledTimes(1);
  });
});

describe("port-scan domain ownership gate", () => {
  it("never checks domain ownership for a crawl that doesn't opt into a port scan", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await POST(postRequest({ url: "https://example.com" }));
    expect(mockIsUrlOwnedByUser).not.toHaveBeenCalled();
  });

  it("rejects with 403 (DOMAIN_NOT_VERIFIED) when a port scan is requested against an unverified domain", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(false);
    const res = await POST(
      postRequest({ url: "https://example.com", portScan: true }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.statusCode).toBe("DOMAIN_NOT_VERIFIED");
    expect(json.error).toMatch(/port scan/i);
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
  });

  it("proceeds and threads portScan:true through to executeCrawlScan against a verified domain", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 2 }] });
    const res = await POST(
      postRequest({ url: "https://example.com", portScan: true }),
    );
    expect(res.status).toBe(200);
    expect(mockExecuteCrawlScan).toHaveBeenCalledWith(
      expect.objectContaining({ portScan: true }),
    );
  });
});

describe("authenticated crawl", () => {
  const FORM_AUTH = {
    method: "form" as const,
    username: "admin",
    password: "hunter2-super-secret",
  };

  it("establishes a session and threads it (plus authenticated:true) into executeCrawlScan", async () => {
    const fakeSession = {
      lost: false,
      reason: null as string | null,
      authType: "form" as const,
    };
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: fakeSession,
    });
    // No account-default lookup for an authenticated crawl: only the tracker
    // INSERT runs.
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 500 }] });

    const res = await POST(
      postRequest({
        url: "https://app.example.com/dashboard",
        auth: FORM_AUTH,
      }),
    );

    expect(res.status).toBe(200);
    // The session was established against the normalized main URL.
    expect(mockEstablishScanSession).toHaveBeenCalledTimes(1);
    expect(mockEstablishScanSession.mock.calls[0][1]).toBe(
      "https://app.example.com/dashboard",
    );
    // ...and threaded into the crawl job alongside the authenticated flag.
    expect(mockExecuteCrawlScan).toHaveBeenCalledWith(
      expect.objectContaining({ authenticated: true, session: fakeSession }),
    );
  });

  it("aborts with 422 BEFORE creating a scan row when the login fails, and never dispatches a crawl", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: false,
      reason: "The target answered 401 to the authenticated request.",
    });

    const res = await POST(
      postRequest({
        url: "https://app.example.com/dashboard",
        auth: FORM_AUTH,
      }),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.authReport.status).toBe("failed");
    expect(json.authReport.method).toBe("form");
    expect(json.authReport.reason).toMatch(/401/);
    // No scan_history INSERT, no crawl dispatch: the login never succeeded.
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
    // The plaintext password never appears in the aborted response.
    expect(JSON.stringify(json)).not.toContain("hunter2-super-secret");
  });

  it("is private by default (is_public=false) and skips the account-default lookup unless isPublic:true", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null, authType: "form" },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 501 }] });

    await POST(
      postRequest({
        url: "https://app.example.com/dashboard",
        auth: FORM_AUTH,
      }),
    );

    // Only the tracker INSERT ran -- no resolveScanIsPublic account lookup.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[0]).toContain("INSERT INTO scan_history");
    // is_public is the 5th bound param ($5).
    expect(insertCall[1][4]).toBe(false);

    // Explicit opt-in flips it to public.
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 502 }] });
    await POST(
      postRequest({
        url: "https://app.example.com/dashboard",
        auth: FORM_AUTH,
        isPublic: true,
      }),
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1][4]).toBe(true);
  });

  it("persists and logs only the non-secret fact, never any credential value", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null, authType: "form" },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 503 }] });

    await POST(
      postRequest({
        url: "https://app.example.com/dashboard",
        auth: FORM_AUTH,
      }),
    );

    // No bound value in any DB call carries the username or password.
    const allDbArgs = JSON.stringify(mockQuery.mock.calls);
    expect(allDbArgs).not.toContain("hunter2-super-secret");
    expect(allDbArgs).not.toContain("admin");

    // The audit line records only origin, method, and outcome.
    expect(mockLogAction).toHaveBeenCalledTimes(1);
    const [, , action, details] = mockLogAction.mock.calls[0];
    expect(action).toBe("scan.authenticated");
    expect(String(details)).not.toContain("hunter2-super-secret");
    expect(String(details)).not.toContain("admin");
    expect(String(details)).toMatch(/authenticated/i);
    expect(String(details)).toContain("https://app.example.com");
  });

  it("gates on SCAN_AUTH_ENABLED: 403 when disabled, before any login attempt or scan row", async () => {
    mockGetSetting.mockImplementation(async (key: SettingKey) =>
      key === "SCAN_AUTH_ENABLED" ? false : registryDefault(key),
    );

    const res = await POST(
      postRequest({
        url: "https://app.example.com/dashboard",
        auth: FORM_AUTH,
      }),
    );

    expect(res.status).toBe(403);
    expect(mockEstablishScanSession).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
  });

  it("leaves an ordinary crawl (no auth block) completely unchanged", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 504 }] });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    // Never touches the login layer or the audit log.
    expect(mockEstablishScanSession).not.toHaveBeenCalled();
    expect(mockLogAction).not.toHaveBeenCalled();
    // No session/authenticated flag reaches the crawl job.
    const params = mockExecuteCrawlScan.mock.calls[0][0];
    expect(params.session).toBeUndefined();
    expect(params.authenticated).toBeUndefined();
  });
});

describe("crawl page-selection plan cap", () => {
  it("rejects a selectedUrls array longer than the caller's plan limit, before any row is created", async () => {
    mockGetUserPlan.mockResolvedValue("free"); // free selection cap = 25
    const urls = Array.from(
      { length: 26 },
      (_, i) => `https://example.com/p${i}`,
    );

    const res = await POST(postRequest({ url: "https://example.com", urls }));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.statusCode).toBe("CRAWL_PAGE_LIMIT");
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("accepts a selectedUrls array within the plan limit and threads crawlPageLimit into the job", async () => {
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 601 }] });
    const urls = Array.from(
      { length: 10 },
      (_, i) => `https://example.com/p${i}`,
    );

    const res = await POST(postRequest({ url: "https://example.com", urls }));

    expect(res.status).toBe(200);
    expect(mockExecuteCrawlScan).toHaveBeenCalledWith(
      expect.objectContaining({ crawlPageLimit: 25 }),
    );
  });

  it("does not cap selection when billing is disabled (self-hosted)", async () => {
    mockGetSetting.mockImplementation(async (key: SettingKey) =>
      key === "BILLING_ENABLED" ? false : registryDefault(key),
    );
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 602 }] });
    const urls = Array.from(
      { length: 300 },
      (_, i) => `https://example.com/p${i}`,
    );

    const res = await POST(postRequest({ url: "https://example.com", urls }));

    expect(res.status).toBe(200);
    // Billing off resolves to -1 (unlimited); the plan lookup is never made.
    expect(mockGetUserPlan).not.toHaveBeenCalled();
    expect(mockExecuteCrawlScan).toHaveBeenCalledWith(
      expect.objectContaining({ crawlPageLimit: -1 }),
    );
  });
});

describe("POST /api/v3/scan/crawl - error handling and logging", () => {
  it("answers an unexpected throw with a JSON 500 instead of rejecting", async () => {
    // The route used to be a bare handler, so anything it threw before
    // reaching its own try blocks escaped to Next as an unhandled error with
    // no request id on the row it wrote.
    mockCheckAndRecordRequest.mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(postRequest({ url: "https://example.com" }));

      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({
        error: "An unexpected error occurred",
      });
      expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("runs the dispatched crawl inside the request's correlation context", async () => {
    const { currentRequestId } = await import("@/lib/database/request-context");
    let seen: string | null = null;
    mockExecuteCrawlScan.mockImplementation(async () => {
      seen = currentRequestId();
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 700 }] });

    await POST(postRequest({ url: "https://example.com" }));

    // The detached job inherits the id withErrorHandling entered, so the error
    // rows it writes can be tied back to the request that started it.
    expect(seen).toEqual(expect.any(String));
  });

  it("logs a crawl that escapes its own handling with the scan id and the Error, and marks the row failed", async () => {
    const boom = new Error("settings unavailable");
    mockExecuteCrawlScan.mockRejectedValue(boom);
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 701 }] });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(postRequest({ url: "https://example.com" }));
      expect(res.status).toBe(200);
      // The dispatch is detached; let its rejection handler run.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(errorSpy).toHaveBeenCalledWith(
        "[scan] crawl dispatch failed",
        {
          scanId: 701,
          userId: 42,
          source: "web",
          url: "https://example.com/",
        },
        boom,
      );
    } finally {
      errorSpy.mockRestore();
    }

    const failure = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("status = 'failed'"),
    );
    expect(failure![1]).toEqual(["settings unavailable", 701, "internal"]);
  });

  it("logs a tracker row that could not be created with the user and the Error", async () => {
    const boom = new Error("insert failed");
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockRejectedValueOnce(boom);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(postRequest({ url: "https://example.com" }));
      expect(res.status).toBe(500);

      expect(errorSpy).toHaveBeenCalledWith(
        "[scan] could not create the crawl's tracker row",
        { userId: 42, source: "web", url: "https://example.com/" },
        boom,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("POST /api/v3/scan/crawl - 429 answers", () => {
  it("answers the session burst limiter with RATE_LIMITED and Retry-After", async () => {
    mockBurstLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 23,
    });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("23");
    const json = await res.json();
    expect(json.code).toBe("RATE_LIMITED");
    expect(json.error).toMatch(/crawl rate limit reached/i);
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
  });

  it("answers an exhausted daily scan quota with DAILY_LIMIT, the quota fields and a Retry-After to the reset", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T23:00:00.000Z"));
    try {
      mockCheckAndRecordRequest.mockResolvedValue({
        allowed: false,
        used: 150,
        limit: 150,
        remaining: 0,
        resetsAt: "2030-01-02T00:00:00.000Z",
      });

      const res = await POST(postRequest({ url: "https://example.com" }));

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("3600");
      expect(res.headers.get("X-RateLimit-Policy")).toBe("daily");
      expect(await res.json()).toEqual({
        error:
          "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.",
        limit: 150,
        used: 150,
        remaining: 0,
        resets_at: "2030-01-02T00:00:00.000Z",
        code: "DAILY_LIMIT",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the key's own budget separate: its 429 is API_QUOTA_EXCEEDED with a Retry-After", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockCheckApiKeyRateLimit.mockResolvedValue({
      allowed: false,
      limit: 50,
      used: 50,
      remaining: 0,
      resetsAt: new Date(Date.now() + 7200_000).toISOString(),
    });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("API_QUOTA_EXCEEDED");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(7000);
  });

  it("carries CONCURRENT_SCAN_LIMIT in both statusCode and code when the reservation refuses", async () => {
    mockReserveConcurrentScanSlot.mockResolvedValueOnce({
      ok: false,
      check: { allowed: false, current: 1, limit: 1, message: "one at a time" },
    } as unknown as { ok: true; scanId: number; publicId: string });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("10");
    expect(await res.json()).toMatchObject({
      error: "one at a time",
      statusCode: "CONCURRENT_SCAN_LIMIT",
      code: "CONCURRENT_SCAN_LIMIT",
    });
  });
});

describe("POST /api/v3/scan/crawl - create response", () => {
  it("returns the opaque publicId beside scanId, with status 200", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 301 }] });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scanId).toBe(301);
    expect(json.publicId).toBe("public-301");
    expect(json.status).toBe("running");
  });

  it("adds the key's request budget to quota.requests and keeps the single charge", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 302 }] });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    const json = await res.json();
    expect(json.quota.requests).toEqual({
      limit: 50,
      used: 2,
      remaining: 48,
      resetsAt: "2030-01-02T03:04:05.000Z",
    });
    expect(mockPeekRateLimit).toHaveBeenCalledWith(9, 50);
    expect(mockCheckApiKeyRateLimit).toHaveBeenCalledTimes(1);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("49");
  });

  it("still answers 200 with the crawl when the quota cannot be read", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 303 }] });
    mockCheckAndRecordRequest
      .mockResolvedValueOnce({
        allowed: true,
        used: 1,
        limit: 150,
        remaining: 149,
        resetsAt: "2030-01-02T00:00:00.000Z",
      })
      .mockRejectedValueOnce(new Error("db down"));

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scanId).toBe(303);
    expect(json.publicId).toBe("public-303");
    expect(json.quota).toBeUndefined();
    errSpy.mockRestore();
  });
});

describe("POST /api/v3/scan/crawl - request body", () => {
  const cases: Array<[string, string]> = [
    ["not JSON", "{nope"],
    ["null", "null"],
    ["an array", "[]"],
    ["a string", '"https://example.com"'],
    ["empty", ""],
  ];

  it.each(cases)(
    "answers 400 INVALID_REQUEST for a body that is %s",
    async (_label, raw) => {
      const res = await POST(
        new NextRequest("http://localhost/api/v3/scan/crawl", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: raw,
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("INVALID_REQUEST");
      expect(json.error).toBe("Invalid request body.");
      expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );

  it("tells a caller with no credentials so before saying anything about the body", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(
      new NextRequest("http://localhost/api/v3/scan/crawl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{nope",
      }),
    );

    expect(res.status).toBe(401);
  });
});

describe("POST /api/v3/scan/crawl - key authentication", () => {
  it("reads a lowercase bearer scheme as a key, not as a missing one", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 305 }] });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockValidateApiKey).toHaveBeenCalledWith("vr_live_testkey");
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("refuses an account behind on the Terms with 403 TERMS_ACCEPTANCE_REQUIRED", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      dailyLimit: 50,
      needsTermsAcceptance: true,
    });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("TERMS_ACCEPTANCE_REQUIRED");
    expect(mockCheckApiKeyRateLimit).not.toHaveBeenCalled();
  });

  it("refuses a key without scan:write with SCOPE_MISSING before charging it", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      dailyLimit: 50,
      needsTermsAcceptance: false,
      scopes: ["scan:read"],
    });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("SCOPE_MISSING");
    expect(json.error).toContain("scan:write");
    expect(mockCheckApiKeyRateLimit).not.toHaveBeenCalled();
  });

  it("never falls back to the session cookie when the key is bad", async () => {
    mockValidateApiKey.mockResolvedValue(null);

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_nope" },
      ),
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid or revoked API key.");
    expect(mockGetSession).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/crawl - a failure after the slot was reserved", () => {
  async function failedWrite() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("status = 'failed'"),
    );
  }

  it("marks the tracker row failed when attaching the teams throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAttachNewScanTeams.mockRejectedValueOnce(new Error("teams down"));
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 401 }] });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(500);
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
    const write = await failedWrite();
    expect(write?.[1]).toEqual([
      "The crawl could not be started.",
      401,
      "internal",
    ]);
    errSpy.mockRestore();
  });

  it("writes no failure when the tracker row was never inserted", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(500);
    expect(await failedWrite()).toBeUndefined();
    errSpy.mockRestore();
  });
});
