/**
 * Route-level tests for GET /api/v3/scan/reputation.
 *
 * Extension-facing endpoint: dual auth (API key or session cookie, same
 * pattern as POST /api/v3/scan), rate-limited via
 * lib/rate-limiting/rate-limit.ts, backed by a mocked database pool. The
 * response shape is a contract another agent (the extension) codes
 * against directly, so several assertions pin the exact field names.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMITS: { api: { maxAttempts: 100, windowSeconds: 3600 } },
}));

const { GET } = await import("@/app/api/v3/scan/reputation/route");

function getRequest(host?: string, headers: Record<string, string> = {}) {
  const url = host
    ? `http://localhost/api/v3/scan/reputation?host=${encodeURIComponent(host)}`
    : "http://localhost/api/v3/scan/reputation";
  return new NextRequest(url, { method: "GET", headers });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
  mockValidateApiKey.mockReset();
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 99,
    retryAfterSeconds: 0,
  });
});

describe("GET /api/v3/scan/reputation", () => {
  it("401s with no API key and no session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest("example.com"));
    expect(res.status).toBe(401);
  });

  it("401s on an invalid API key", async () => {
    mockValidateApiKey.mockResolvedValue(null);
    const res = await GET(
      getRequest("example.com", { authorization: "Bearer bad-key" }),
    );
    expect(res.status).toBe(401);
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("403s when the API key holder needs to accept updated terms", async () => {
    mockValidateApiKey.mockResolvedValue({
      userId: 7,
      needsTermsAcceptance: true,
    });
    const res = await GET(
      getRequest("example.com", { authorization: "Bearer good-key" }),
    );
    expect(res.status).toBe(403);
  });

  it("authenticates via a valid API key", async () => {
    mockValidateApiKey.mockResolvedValue({ userId: 9 });
    const res = await GET(
      getRequest("example.com", { authorization: "Bearer good-key" }),
    );
    expect(res.status).toBe(200);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "scan-reputation:9" }),
    );
  });

  it("429s when the rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 120,
    });
    const res = await GET(getRequest("example.com"));
    expect(res.status).toBe(429);
  });

  it("400s when host is missing", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(400);
  });

  it("400s for a raw-IP host (host_reputation only tracks domains)", async () => {
    const res = await GET(getRequest("192.168.1.1"));
    expect(res.status).toBe(400);
  });

  it("normalizes the host the same way storage does before looking it up", async () => {
    await GET(getRequest("https://www.Example.com:8443/some/path"));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM host_reputation");
    expect(params).toEqual(["example.com"]);
  });

  it("returns known: false with all-null fields when the host has never been scanned", async () => {
    const res = await GET(getRequest("neverseen.com"));
    const body = await res.json();
    expect(body).toEqual({
      known: false,
      host: "neverseen.com",
      dangerScore: null,
      severityCounts: null,
      lastScannedAt: null,
      scanId: null,
      matchType: null,
      scannedUrl: null,
    });
  });

  it("returns the cached reputation with the exact contract shape when known", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          danger_score: 8,
          severity_counts: { critical: 1, high: 2, medium: 0, low: 3, info: 5 },
          last_scanned_at: "2026-01-01T00:00:00.000Z",
          source_scan_id: 42,
          scanned_url: "https://bad-site.com/some/page",
        },
      ],
      rowCount: 1,
    });
    const res = await GET(getRequest("bad-site.com"));
    const body = await res.json();
    expect(body).toEqual({
      known: true,
      host: "bad-site.com",
      dangerScore: 8,
      severityCounts: { critical: 1, high: 2, medium: 0, low: 3, info: 5 },
      lastScannedAt: "2026-01-01T00:00:00.000Z",
      scanId: 42,
      matchType: "host",
      // Never the row's real scanned_url on a host-level fallback match --
      // that would leak an unrelated user's scanned URL (and its query
      // string) to any caller who only knows the hostname
      // (AUDIT-009#reputation-01).
      scannedUrl: null,
    });
  });

  it("reports scanId: null when source_scan_id has been auto-nulled (source scan deleted)", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          danger_score: 3,
          severity_counts: { critical: 0, high: 0, medium: 1, low: 0, info: 0 },
          last_scanned_at: "2026-01-01T00:00:00.000Z",
          source_scan_id: null,
        },
      ],
      rowCount: 1,
    });
    const res = await GET(getRequest("dangling.com"));
    const body = await res.json();
    expect(body.known).toBe(true);
    expect(body.scanId).toBeNull();
  });

  it("500s and does not leak the raw error when the query throws", async () => {
    mockQuery.mockRejectedValue(new Error("db exploded"));
    const res = await GET(getRequest("example.com"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("db exploded");
  });
});
