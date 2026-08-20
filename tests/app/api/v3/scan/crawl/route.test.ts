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

vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({
      allowed: true,
      remaining: 9,
      retryAfterSeconds: 0,
    })),
  };
});

vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: vi.fn(async () => ({ allowed: true })),
}));

const mockIsUrlOwnedByUser = vi.fn();
vi.mock("@/lib/domains/scope", () => ({
  isUrlOwnedByUser: (...args: unknown[]) => mockIsUrlOwnedByUser(...args),
}));

const mockCheckConcurrentScanLimit = vi.fn();
vi.mock("@/lib/rate-limiting/concurrent-scans", () => ({
  checkConcurrentScanLimit: (...args: unknown[]) =>
    mockCheckConcurrentScanLimit(...args),
}));

const mockCheckAndRecordRequest = vi.fn();
const mockGetUserPlan = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  checkAndRecordRequest: (...args: unknown[]) =>
    mockCheckAndRecordRequest(...args),
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
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    limit: 50,
    used: 1,
    remaining: 49,
    resetsAt: new Date().toISOString(),
  })),
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

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/scan/crawl", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
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
    resetsAt: new Date().toISOString(),
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
    expect(json).toEqual({ scanId: 200, status: "running" });
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
