import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for POST/GET/DELETE /api/v3/browser/sessions.
 *
 * The database is mocked (network/DB boundary), and the BrowserBase REST
 * client (lib/browserbase/client.ts, which does raw fetch() calls to
 * api.browserbase.com) is mocked at its module boundary, same pattern as
 * mocking getStripe() for the billing routes. Everything else, including
 * the TTL-clamping and ownership-check logic in the route itself, runs for
 * real.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMITS: { browserSession: { maxAttempts: 20, windowSeconds: 3600 } },
}));

const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
}));

// Mocked at this library boundary, same as checkRateLimit/validateScanTarget
// above: this file tests route wiring (is the quota checked before creating
// a session, is a real elapsed duration recorded when one ends), not the
// quota-math/accounting logic itself, which lib/billing/browserbase-usage.ts
// has its own dedicated tests for.
const mockCheckBrowserbaseQuota = vi.fn();
const mockRecordBrowserbaseSeconds = vi.fn();
vi.mock("@/lib/billing/browserbase-usage", () => ({
  checkBrowserbaseQuota: (...args: unknown[]) =>
    mockCheckBrowserbaseQuota(...args),
  recordBrowserbaseSeconds: (...args: unknown[]) =>
    mockRecordBrowserbaseSeconds(...args),
}));

// Mocked at this library boundary, same reasoning as checkBrowserbaseQuota
// above: this file tests route wiring (is a slot acquired before creating a
// session, is it released on every failure path), not the queue's own
// admit/priority/timeout logic, which has its own dedicated tests in
// tests/lib/browserbase/concurrency-queue.test.ts.
const mockAcquireConcurrencySlot = vi.fn();
const mockReleaseConcurrencySlot = vi.fn();
vi.mock("@/lib/browserbase/concurrency-queue", () => ({
  acquireConcurrencySlot: (...args: unknown[]) =>
    mockAcquireConcurrencySlot(...args),
  releaseConcurrencySlot: (...args: unknown[]) =>
    mockReleaseConcurrencySlot(...args),
}));

const mockGetUserPlan = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: (...args: unknown[]) => mockGetUserPlan(...args),
}));

const mockCreateBrowserSession = vi.fn();
const mockEndBrowserSession = vi.fn();
const mockGetBrowserLiveUrls = vi.fn();
const mockGetBrowserSession = vi.fn();
const mockNavigateBrowserSession = vi.fn();
vi.mock("@/lib/browserbase/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/browserbase/client")>();
  return {
    ...actual,
    createBrowserSession: (...args: unknown[]) =>
      mockCreateBrowserSession(...args),
    endBrowserSession: (...args: unknown[]) => mockEndBrowserSession(...args),
    getBrowserLiveUrls: (...args: unknown[]) => mockGetBrowserLiveUrls(...args),
    getBrowserSession: (...args: unknown[]) => mockGetBrowserSession(...args),
    navigateBrowserSession: (...args: unknown[]) =>
      mockNavigateBrowserSession(...args),
  };
});

process.env.BROWSERBASE_API_KEY = "test-key";
process.env.BROWSERBASE_PROJECT_ID = "test-project";

const { POST, GET, DELETE } =
  await import("@/app/api/v3/browser/sessions/route");
const { BrowserBaseError } = await import("@/lib/browserbase/client");

const SESSION = { userId: 42, email: "u@x.com", name: null, role: "user" };

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue(SESSION);
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 19,
    retryAfterSeconds: 0,
  });
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
  mockCheckBrowserbaseQuota.mockReset();
  mockCheckBrowserbaseQuota.mockResolvedValue({
    allowed: true,
    usedSeconds: 0,
    limitMinutes: 90,
    periodStart: new Date("2026-08-01T00:00:00Z"),
    creditBalanceSeconds: 0,
  });
  mockRecordBrowserbaseSeconds.mockReset();
  mockRecordBrowserbaseSeconds.mockResolvedValue(undefined);
  mockAcquireConcurrencySlot.mockReset();
  mockAcquireConcurrencySlot.mockResolvedValue({
    acquired: true,
    queued: false,
  });
  mockReleaseConcurrencySlot.mockReset();
  mockReleaseConcurrencySlot.mockResolvedValue(undefined);
  mockGetUserPlan.mockReset();
  mockGetUserPlan.mockResolvedValue("free");
  mockCreateBrowserSession.mockReset();
  mockEndBrowserSession.mockReset();
  mockEndBrowserSession.mockResolvedValue(undefined);
  mockGetBrowserLiveUrls.mockReset();
  mockGetBrowserLiveUrls.mockResolvedValue({
    debuggerFullscreenUrl: "https://viewer.example/full",
    debuggerUrl: "https://viewer.example/bordered",
    wsUrl: "wss://viewer.example/ws",
  });
  mockGetBrowserSession.mockReset();
  mockNavigateBrowserSession.mockReset();
  mockNavigateBrowserSession.mockResolvedValue(undefined);
});

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/browser/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(id?: string): NextRequest {
  const url = id
    ? `http://localhost/api/v3/browser/sessions?id=${encodeURIComponent(id)}`
    : "http://localhost/api/v3/browser/sessions";
  return new NextRequest(url, { method: "GET" });
}

describe("POST /api/v3/browser/sessions", () => {
  it("returns 503 when BrowserBase is not configured", async () => {
    vi.resetModules();
    const savedKey = process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_API_KEY;
    const { POST: PostDisabled } =
      await import("@/app/api/v3/browser/sessions/route");
    const res = await PostDisabled(postRequest({}));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("BrowserBase is not configured on this server.");
    process.env.BROWSERBASE_API_KEY = savedKey;
    vi.resetModules();
  });

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({}));
    expect(res.status).toBe(401);
    expect(mockCreateBrowserSession).not.toHaveBeenCalled();
  });

  it("rejects when the per-user rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 120,
    });
    const res = await POST(postRequest({}));
    expect(res.status).toBe(429);
    expect(mockCreateBrowserSession).not.toHaveBeenCalled();
  });

  it("rejects with 402 when the plan's Browserbase minute quota is exhausted", async () => {
    mockCheckBrowserbaseQuota.mockResolvedValue({
      allowed: false,
      usedSeconds: 5400,
      limitMinutes: 90,
      periodStart: new Date("2026-08-01T00:00:00Z"),
      creditBalanceSeconds: 0,
      message: "quota exceeded",
    });
    const res = await POST(postRequest({}));
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error).toBe("quota exceeded");
    expect(mockCreateBrowserSession).not.toHaveBeenCalled();
  });

  it("checks the quota before the rate-limited/validated request creates a real session", async () => {
    mockCreateBrowserSession.mockResolvedValue({
      id: "sess_quota_checked",
      status: "RUNNING",
      url: "",
    });
    await POST(postRequest({}));
    expect(mockCheckBrowserbaseQuota).toHaveBeenCalledWith(42);
  });

  describe("TTL clamping (never trusts a client-supplied duration as-is)", () => {
    beforeEach(() => {
      mockCreateBrowserSession.mockResolvedValue({
        id: "sess_ttl",
        status: "RUNNING",
        url: "",
      });
    });

    it("defaults to BROWSERBASE_DEFAULT_TTL_SECONDS (360) when no ttl is supplied", async () => {
      const res = await POST(postRequest({}));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.expiresInSeconds).toBe(360);
      expect(mockCreateBrowserSession).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutSeconds: 360 }),
      );
    });

    it("clamps a ttlSeconds far above the max down to 360", async () => {
      const res = await POST(postRequest({ ttlSeconds: 99999 }));
      const json = await res.json();
      expect(json.expiresInSeconds).toBe(360);
      expect(mockCreateBrowserSession).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutSeconds: 360 }),
      );
    });

    it("clamps a ttlSeconds below the 30s floor up to 30", async () => {
      const res = await POST(postRequest({ ttlSeconds: 5 }));
      const json = await res.json();
      expect(json.expiresInSeconds).toBe(30);
      expect(mockCreateBrowserSession).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutSeconds: 30 }),
      );
    });

    it("passes an in-range ttlSeconds through unchanged", async () => {
      const res = await POST(postRequest({ ttlSeconds: 120 }));
      const json = await res.json();
      expect(json.expiresInSeconds).toBe(120);
      expect(mockCreateBrowserSession).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutSeconds: 120 }),
      );
    });

    it("also clamps the legacy ttl field when ttlSeconds is absent", async () => {
      const res = await POST(postRequest({ ttl: 99999 }));
      const json = await res.json();
      expect(json.expiresInSeconds).toBe(360);
      expect(mockCreateBrowserSession).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutSeconds: 360 }),
      );
    });
  });

  describe("URL validation", () => {
    it("rejects a value that is neither an http(s) URL nor an IPv4 literal", async () => {
      const res = await POST(postRequest({ url: "not-a-url-and-not-an-ip" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe(
        "url must be a public http(s) URL or a public IPv4 address",
      );
      expect(mockValidateScanTarget).not.toHaveBeenCalled();
      expect(mockCreateBrowserSession).not.toHaveBeenCalled();
    });

    it("runs SSRF validation for an http(s) URL and blocks when unsafe", async () => {
      mockValidateScanTarget.mockResolvedValue({
        safe: false,
        reason: "Refused: points at a private IP range.",
      });
      const res = await POST(postRequest({ url: "http://example.com" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Refused: points at a private IP range.");
      expect(mockValidateScanTarget).toHaveBeenCalledWith("http://example.com");
      expect(mockCreateBrowserSession).not.toHaveBeenCalled();
    });

    it("accepts a bare public IPv4 literal", async () => {
      mockCreateBrowserSession.mockResolvedValue({
        id: "sess_ip",
        status: "RUNNING",
        url: "",
      });
      const res = await POST(postRequest({ url: "203.0.113.5" }));
      expect(res.status).toBe(200);
      expect(mockValidateScanTarget).toHaveBeenCalledWith("203.0.113.5");
    });

    it("skips format check and SSRF validation entirely when no url is given", async () => {
      mockCreateBrowserSession.mockResolvedValue({
        id: "sess_nourl",
        status: "RUNNING",
        url: "",
      });
      const res = await POST(postRequest({}));
      expect(res.status).toBe(200);
      expect(mockValidateScanTarget).not.toHaveBeenCalled();
    });
  });

  it("returns 502 when BrowserBase returns a session with no id, and releases the reserved slot", async () => {
    mockCreateBrowserSession.mockResolvedValue({
      status: "RUNNING",
      url: "",
    });
    const res = await POST(postRequest({}));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("BrowserBase returned a session with no id.");
    expect(mockReleaseConcurrencySlot).toHaveBeenCalledTimes(1);
  });

  describe("concurrency queue", () => {
    it("returns 503 without ever calling createBrowserSession when the queue times out", async () => {
      mockAcquireConcurrencySlot.mockResolvedValue({
        acquired: false,
        queued: true,
      });
      const res = await POST(postRequest({}));
      expect(res.status).toBe(503);
      expect(mockCreateBrowserSession).not.toHaveBeenCalled();
      expect(mockReleaseConcurrencySlot).not.toHaveBeenCalled();
    });

    it("requests a non-priority slot for a free-plan caller", async () => {
      mockGetUserPlan.mockResolvedValue("free");
      mockCreateBrowserSession.mockResolvedValue({
        id: "sess_free",
        status: "RUNNING",
        url: "",
      });
      await POST(postRequest({}));
      expect(mockAcquireConcurrencySlot).toHaveBeenCalledWith(false);
    });

    it("requests a priority slot for a paid-plan caller", async () => {
      mockGetUserPlan.mockResolvedValue("elite_supporter");
      mockCreateBrowserSession.mockResolvedValue({
        id: "sess_elite",
        status: "RUNNING",
        url: "",
      });
      await POST(postRequest({}));
      expect(mockAcquireConcurrencySlot).toHaveBeenCalledWith(true);
    });

    it("releases the reserved slot when createBrowserSession itself throws", async () => {
      mockCreateBrowserSession.mockRejectedValue(new Error("network error"));
      const res = await POST(postRequest({}));
      expect(res.status).toBe(500);
      expect(mockReleaseConcurrencySlot).toHaveBeenCalledTimes(1);
    });

    it("does NOT release the slot on a successful creation (it stays held until the session ends)", async () => {
      mockCreateBrowserSession.mockResolvedValue({
        id: "sess_ok",
        status: "RUNNING",
        url: "",
      });
      const res = await POST(postRequest({}));
      expect(res.status).toBe(200);
      expect(mockReleaseConcurrencySlot).not.toHaveBeenCalled();
    });
  });

  it("navigates using the target URL unchanged when it already has a scheme", async () => {
    mockCreateBrowserSession.mockResolvedValue({
      id: "sess_nav1",
      status: "RUNNING",
      url: "",
      connectUrl: "wss://connect.example/cdp",
    });
    const res = await POST(postRequest({ url: "http://example.com" }));
    expect(res.status).toBe(200);
    expect(mockNavigateBrowserSession).toHaveBeenCalledWith(
      "wss://connect.example/cdp",
      "http://example.com",
    );
  });

  it("prepends http:// when navigating to a scheme-less IPv4 target", async () => {
    mockCreateBrowserSession.mockResolvedValue({
      id: "sess_nav2",
      status: "RUNNING",
      url: "",
      connectUrl: "wss://connect.example/cdp",
    });
    const res = await POST(postRequest({ url: "203.0.113.5" }));
    expect(res.status).toBe(200);
    expect(mockNavigateBrowserSession).toHaveBeenCalledWith(
      "wss://connect.example/cdp",
      "http://203.0.113.5",
    );
  });

  it("records session ownership in the database on success", async () => {
    mockCreateBrowserSession.mockResolvedValue({
      id: "sess_owner",
      status: "RUNNING",
      url: "",
    });
    await POST(postRequest({}));
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO browser_sessions"),
      expect.arrayContaining(["sess_owner", 42]),
    );
  });

  it("surfaces a BrowserBaseError's own status and message instead of a generic 500", async () => {
    mockCreateBrowserSession.mockRejectedValue(
      new BrowserBaseError("quota exceeded", 402),
    );
    const res = await POST(postRequest({}));
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error).toBe("quota exceeded");
  });

  it("still returns 200 with a null liveViewerUrl when fetching live URLs fails", async () => {
    mockCreateBrowserSession.mockResolvedValue({
      id: "sess_livefail",
      status: "RUNNING",
      url: "",
    });
    mockGetBrowserLiveUrls.mockRejectedValue(new Error("debug endpoint down"));
    const res = await POST(postRequest({}));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.liveViewerUrl).toBeNull();
  });
});

describe("GET /api/v3/browser/sessions", () => {
  it("returns 503 when BrowserBase is not configured", async () => {
    vi.resetModules();
    const savedKey = process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_API_KEY;
    const { GET: GetDisabled } =
      await import("@/app/api/v3/browser/sessions/route");
    const res = await GetDisabled(getRequest("sess_1"));
    expect(res.status).toBe(503);
    process.env.BROWSERBASE_API_KEY = savedKey;
    vi.resetModules();
  });

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest("sess_1"));
    expect(res.status).toBe(401);
  });

  it("requires a session id", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Missing session id.");
  });

  it("denies access to a session owned by a different user", async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 999 }] });
    const res = await GET(getRequest("sess_other"));
    expect(res.status).toBe(403);
    expect(mockGetBrowserSession).not.toHaveBeenCalled();
    expect(mockGetBrowserLiveUrls).not.toHaveBeenCalled();
  });

  it("allows access to a session owned by the caller and merges live viewer URLs", async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 42 }] });
    mockGetBrowserSession.mockResolvedValue({
      id: "sess_mine",
      status: "RUNNING",
      url: "https://target.example",
      debuggerFullscreenUrl: "https://stale.example/full",
    });
    const res = await GET(getRequest("sess_mine"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.id).toBe("sess_mine");
    // live's debuggerFullscreenUrl overrides the stale one from data.
    expect(json.session.debuggerFullscreenUrl).toBe(
      "https://viewer.example/full",
    );
    expect(json.session.liveViewerUrl).toBe("https://viewer.example/full");
  });

  // Documented, intentional tradeoff (see the AUDIT-004#idor-01 comment in
  // app/api/v3/browser/sessions/route.ts): a session row that predates the
  // ownership check, or whose INSERT silently failed, has no owner record
  // and is allowed through rather than denied. Not a new finding, just
  // pinning the current behavior.
  it("fails open when no ownership row exists for the session id", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockGetBrowserSession.mockResolvedValue({
      id: "sess_legacy",
      status: "RUNNING",
      url: "",
    });
    const res = await GET(getRequest("sess_legacy"));
    expect(res.status).toBe(200);
    expect(mockGetBrowserSession).toHaveBeenCalledWith("sess_legacy");
  });

  it("fails open (not a 500) when the ownership lookup query itself throws", async () => {
    mockQuery.mockRejectedValue(new Error("connection reset"));
    mockGetBrowserSession.mockResolvedValue({
      id: "sess_dbfail",
      status: "RUNNING",
      url: "",
    });
    const res = await GET(getRequest("sess_dbfail"));
    expect(res.status).toBe(200);
  });

  it("surfaces a BrowserBaseError's status and message", async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 42 }] });
    mockGetBrowserSession.mockRejectedValue(
      new BrowserBaseError("not found", 404),
    );
    const res = await GET(getRequest("sess_missing"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("not found");
  });
});

describe("DELETE /api/v3/browser/sessions", () => {
  it("returns 503 when BrowserBase is not configured", async () => {
    vi.resetModules();
    const savedKey = process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_API_KEY;
    const { DELETE: DeleteDisabled } =
      await import("@/app/api/v3/browser/sessions/route");
    const res = await DeleteDisabled(getRequest("sess_1"));
    expect(res.status).toBe(503);
    process.env.BROWSERBASE_API_KEY = savedKey;
    vi.resetModules();
  });

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE(getRequest("sess_1"));
    expect(res.status).toBe(401);
  });

  it("requires a session id", async () => {
    const res = await DELETE(getRequest());
    expect(res.status).toBe(400);
  });

  it("denies ending a session owned by a different user", async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 999 }] });
    const res = await DELETE(getRequest("sess_other"));
    expect(res.status).toBe(403);
    expect(mockEndBrowserSession).not.toHaveBeenCalled();
  });

  it("ends a session owned by the caller, cleans up the ownership row, and releases its concurrency slot", async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 42 }] });
    const res = await DELETE(getRequest("sess_mine"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ended: true, id: "sess_mine" });
    expect(mockEndBrowserSession).toHaveBeenCalledWith("sess_mine");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM browser_sessions"),
      ["sess_mine"],
    );
    expect(mockReleaseConcurrencySlot).toHaveBeenCalledTimes(1);
  });

  it("fails open (ends the session) when no ownership row exists, and never releases a slot it never held", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await DELETE(getRequest("sess_legacy"));
    expect(res.status).toBe(200);
    expect(mockEndBrowserSession).toHaveBeenCalledWith("sess_legacy");
    expect(mockReleaseConcurrencySlot).not.toHaveBeenCalled();
  });

  it("records the session's real elapsed duration as plan usage on end", async () => {
    const createdAt = new Date(Date.now() - 90_000).toISOString(); // 90s ago
    mockQuery.mockResolvedValue({
      rows: [{ user_id: 42, created_at: createdAt }],
    });
    const res = await DELETE(getRequest("sess_mine"));
    expect(res.status).toBe(200);
    expect(mockRecordBrowserbaseSeconds).toHaveBeenCalledTimes(1);
    const [userId, seconds] = mockRecordBrowserbaseSeconds.mock.calls[0];
    expect(userId).toBe(42);
    expect(seconds).toBeGreaterThanOrEqual(89);
    expect(seconds).toBeLessThanOrEqual(92);
  });

  it("never records usage when no ownership row exists to compute a duration from", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await DELETE(getRequest("sess_legacy"));
    expect(mockRecordBrowserbaseSeconds).not.toHaveBeenCalled();
  });
});
