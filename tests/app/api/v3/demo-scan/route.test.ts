/**
 * Route-level tests for POST /api/v3/demo-scan.
 *
 * This is the only unauthenticated scan surface in the app, so its IP-based
 * daily limit is the thing actually standing between it and abuse. The
 * database pool is mocked, but lib/rate-limiting/rate-limit.ts's
 * checkRateLimit runs for real against that mock — the mock models the
 * rate_limits table's relevant behavior in memory, keyed off the real SQL
 * statements checkRateLimit issues — so the enforcement itself is proven,
 * not assumed.
 *
 * safeFetch and checkAccessRules are the real network/SSRF-decision
 * boundaries and are mocked. allChecks and runAsyncChecks are the actual
 * scanner engine and run for real against the mocked fetch response, same
 * as the other scan-route suites in this repo: only the fetch boundary
 * underneath the checks is mocked, never the checks themselves.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEMO_SCAN_LIMIT } from "@/lib/config/constants";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetClientIp = vi.fn();
// rateLimitIpKey stays real (importOriginal) so the per-client bucket keys the
// tests below rely on are the ones the route actually computes.
vi.mock("@/lib/api/request-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/request-utils")>()),
  getClientIp: () => mockGetClientIp(),
}));

const mockSafeFetch = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

const mockCheckAccessRules = vi.fn();
vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: (...args: unknown[]) => mockCheckAccessRules(...args),
}));

// allChecks (lib/scanner/registry) and runAsyncChecks (lib/scanner/async-checks)
// are intentionally NOT mocked: they run for real against the mocked
// safeFetch response above.

const { POST } = await import("@/app/api/v3/demo-scan/route");

/**
 * A hostname that never resolves. runAsyncChecks() is the real
 * implementation in this suite, so every DNS/TLS/live-fetch sub-check it
 * fires against this target fails fast and closed (no false-positive
 * findings) instead of depending on a real site's live configuration or
 * waiting out a network timeout.
 */
const DEAD_HOST = "https://vulnradar-test-nonexistent-host.invalid";

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/demo-scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * In-memory model of the rate_limits table's relevant behavior, driven by
 * the real SQL strings lib/rate-limiting/rate-limit.ts's checkRateLimit
 * issues: a per-key DELETE (no-op here), an UPSERT that returns the new
 * count, and a rollback UPDATE when the cap is exceeded. See that file's
 * checkRateLimit for the statements this mirrors.
 */
let settingsRows: Array<{ key: string; value: string }> = [];

function installRateLimitQueryMock() {
  const counts = new Map<string, number>();
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("DELETE FROM rate_limits")) {
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO rate_limits")) {
      const key = params[0] as string;
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { rows: [{ count: String(next) }] };
    }
    if (sql.startsWith("UPDATE rate_limits")) {
      const key = params[0] as string;
      counts.set(key, params[1] as number);
      return { rows: [] };
    }
    if (sql.startsWith("SELECT key, value FROM system_settings")) {
      return { rows: settingsRows };
    }
    return { rows: [] };
  });
  return counts;
}

beforeEach(async () => {
  mockQuery.mockReset();
  settingsRows = [];
  installRateLimitQueryMock();
  const { invalidateSettingsCache } =
    await import("@/lib/config/runtime-config");
  invalidateSettingsCache();

  mockGetClientIp.mockReset();
  mockGetClientIp.mockResolvedValue("192.0.2.1");

  mockSafeFetch.mockReset();
  // A fresh Response per call: the route reads the body stream to
  // completion, so reusing a single Response instance across repeated
  // calls (the rate-limit loop tests call POST several times) would leave
  // later calls reading an already-drained stream.
  mockSafeFetch.mockImplementation(
    async () =>
      new Response("<html><head></head><body>ok</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  );

  mockCheckAccessRules.mockReset();
  mockCheckAccessRules.mockResolvedValue({ allowed: true });
});

describe("POST /api/v3/demo-scan - FEATURE_DEMO_MODE settings wiring", () => {
  /**
   * Settings-wiring regression: FEATURE_DEMO_MODE is a registry-backed
   * kill switch. It used to resolve into a dead FEATURES.DEMO_MODE object
   * this route never read at all, so an admin turning demo mode off in
   * /admin had zero effect -- the demo scanner kept running. This proves
   * the live (database-backed, via the mocked pool) value actually gates
   * the route.
   */
  it("rejects demo scans when FEATURE_DEMO_MODE is disabled via the admin settings table", async () => {
    settingsRows = [{ key: "FEATURE_DEMO_MODE", value: "false" }];

    const res = await POST(postRequest({ url: DEAD_HOST }));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/disabled/i);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("allows demo scans when FEATURE_DEMO_MODE is left at its shipped default (enabled)", async () => {
    const res = await POST(postRequest({ url: DEAD_HOST }));
    expect(res.status).toBe(200);
  }, 20000);
});

describe("POST /api/v3/demo-scan - request validation", () => {
  it("rejects a request with no URL", async () => {
    const res = await POST(postRequest({}));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/URL is required/);
  });

  it("rejects an unparseable URL", async () => {
    const res = await POST(postRequest({ url: "not a url" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid URL/);
  });

  it("rejects a non-http(s) protocol", async () => {
    const res = await POST(postRequest({ url: "ftp://example.com/file" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/http and https/);
  });

  it("rejects a target blocked by access rules with a 403", async () => {
    mockCheckAccessRules.mockResolvedValue({ allowed: false });

    const res = await POST(postRequest({ url: "https://blocked.example.com" }));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.statusCode).toBe("BLOCKED");
    expect(json.error).toMatch(/cannot be scanned/);
  });

  it("returns 422 with the failure reason when safeFetch cannot reach the target", async () => {
    mockSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await POST(postRequest({ url: DEAD_HOST }));

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/Could not reach the target URL: ECONNREFUSED/);
  });
});

describe("POST /api/v3/demo-scan - success shape", () => {
  it("returns findings/summary/remaining/limit for a successful scan, using the real scanner engine against the mocked fetch response", async () => {
    const res = await POST(postRequest({ url: DEAD_HOST }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.findings)).toBe(true);
    expect(json.summary).toMatchObject({
      critical: expect.any(Number),
      high: expect.any(Number),
      medium: expect.any(Number),
      low: expect.any(Number),
      info: expect.any(Number),
      total: expect.any(Number),
    });
    expect(json.remaining).toBe(DEMO_SCAN_LIMIT - 1);
    expect(json.limit).toBe(DEMO_SCAN_LIMIT);
    expect(json.url).toBe(DEAD_HOST);
    expect(typeof json.duration).toBe("number");
    expect(typeof json.responseHeaders).toBe("object");
  }, 20000);
});

describe("POST /api/v3/demo-scan - IP rate limiting (real checkRateLimit against a mocked pool)", () => {
  it(`allows exactly CONFIG_DEMO_SCAN_LIMIT (${DEMO_SCAN_LIMIT}) scans for one client and rejects the ${DEMO_SCAN_LIMIT + 1}th with 429`, async () => {
    mockGetClientIp.mockResolvedValue("203.0.113.50");

    for (let i = 0; i < DEMO_SCAN_LIMIT; i++) {
      const res = await POST(postRequest({ url: DEAD_HOST }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.remaining).toBe(DEMO_SCAN_LIMIT - (i + 1));
      expect(json.limit).toBe(DEMO_SCAN_LIMIT);
    }

    const blocked = await POST(postRequest({ url: DEAD_HOST }));

    expect(blocked.status).toBe(429);
    const blockedJson = await blocked.json();
    expect(blockedJson.remaining).toBe(0);
    expect(blockedJson.limit).toBe(DEMO_SCAN_LIMIT);
    // Human-readable retry message with an hour count derived from
    // retryAfterSeconds.
    expect(blockedJson.error).toMatch(/~\d+ hours?/);
    expect(blockedJson.error).toMatch(
      new RegExp(`${DEMO_SCAN_LIMIT} scans per 12 hours`),
    );
  }, 60000);

  it("gives two different clients independent rate-limit budgets: exhausting one does not affect the other", async () => {
    const CLIENT_A = "198.51.100.5";
    const CLIENT_B = "198.51.100.6";

    // Requests below intentionally omit the URL: the rate-limit check runs
    // before body validation, so each call still consumes one slot from
    // the caller's budget even though it then fails validation with a 400.
    // This keeps the isolation proof fast while still exercising the real
    // rate-limit key derivation (`demo_scan:${ip}`).
    mockGetClientIp.mockResolvedValue(CLIENT_A);
    for (let i = 0; i < DEMO_SCAN_LIMIT; i++) {
      const res = await POST(postRequest({}));
      expect(res.status).toBe(400);
    }
    const aBlocked = await POST(postRequest({}));
    expect(aBlocked.status).toBe(429);

    // Client B has never made a request. Exhausting A's budget above must
    // not have touched B's counter: it lives under a different rate-limit
    // key (`demo_scan:${CLIENT_B}` vs `demo_scan:${CLIENT_A}`), so B gets
    // its own full, untouched budget of DEMO_SCAN_LIMIT attempts.
    mockGetClientIp.mockResolvedValue(CLIENT_B);
    for (let i = 0; i < DEMO_SCAN_LIMIT; i++) {
      const res = await POST(postRequest({}));
      expect(res.status).toBe(400);
    }
    const bBlocked = await POST(postRequest({}));
    expect(bBlocked.status).toBe(429);
  });
});
