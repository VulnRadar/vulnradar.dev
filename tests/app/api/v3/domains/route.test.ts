/**
 * Route-level tests for GET/POST/DELETE /api/v3/domains.
 *
 * The database is mocked at the pool.query boundary. checkRateLimit and
 * getTeamResourceAccess are mocked at their own library boundaries (same
 * pattern tests/app/api/v3/browser/sessions/route.test.ts uses for
 * checkBrowserbaseQuota) so this file tests route wiring, not their own
 * internal logic, which have their own dedicated tests.
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

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockGetTeamResourceAccess = vi.fn();
vi.mock("@/lib/auth/team-resource-access", () => ({
  getTeamResourceAccess: (...args: unknown[]) =>
    mockGetTeamResourceAccess(...args),
}));

const { GET, POST, DELETE } = await import("@/app/api/v3/domains/route");

const SESSION = { userId: 42, email: "u@x.com", name: null, role: "user" };

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue(SESSION);
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(true); // FEATURE_DOMAIN_VERIFICATION
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 19,
    retryAfterSeconds: 0,
  });
  mockGetTeamResourceAccess.mockReset();
  mockGetTeamResourceAccess.mockResolvedValue({
    canRead: true,
    canWrite: true,
  });
});

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/domains", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(id: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/v3/domains?id=${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

describe("GET /api/v3/domains", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("lists the caller's domains, including the DNS record name to publish", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          domain: "example.com",
          team_id: null,
          status: "verified",
          verification_method: "dns_txt",
          created_at: "2026-08-01T00:00:00Z",
          verified_at: "2026-08-02T00:00:00Z",
          last_checked_at: "2026-08-02T00:00:00Z",
          last_check_error: null,
        },
      ],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.domains).toHaveLength(1);
    expect(json.domains[0].verificationRecordName).toBe(
      "_vulnradar-verify.example.com",
    );
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("user_id = $1");
    expect(sql).toContain("team_id IN");
    expect(params).toEqual([42]);
  });
});

describe("POST /api/v3/domains", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ domain: "example.com" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when domain verification is disabled", async () => {
    mockGetSetting.mockResolvedValue(false);
    const res = await POST(postRequest({ domain: "example.com" }));
    expect(res.status).toBe(403);
  });

  it("rejects when the per-user rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 300,
    });
    const res = await POST(postRequest({ domain: "example.com" }));
    expect(res.status).toBe(429);
  });

  it("requires a domain", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid domain", async () => {
    const res = await POST(postRequest({ domain: "localhost" }));
    expect(res.status).toBe(400);
  });

  it("creates a new pending domain with a fresh token and the DNS instructions", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existing-row check
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 9,
          domain: "example.com",
          status: "pending",
          created_at: "2026-08-16T00:00:00Z",
        },
      ],
    });
    const res = await POST(postRequest({ domain: "https://Example.com/" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.domain).toBe("example.com");
    expect(json.status).toBe("pending");
    expect(json.verificationRecordName).toBe("_vulnradar-verify.example.com");
    expect(json.verificationRecordValue).toMatch(
      /^vulnradar-verify=[0-9a-f]{64}$/,
    );

    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toContain("INSERT INTO domains");
    expect(insertParams[0]).toBe(42);
    expect(insertParams[1]).toBe("example.com");
  });

  it("returns the existing row's instructions instead of creating a duplicate", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 3, status: "pending", verification_token: "a".repeat(64) }],
    });
    const res = await POST(postRequest({ domain: "example.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.alreadyExists).toBe(true);
    expect(json.id).toBe(3);
    // Only the existing-row lookup ran -- no INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /api/v3/domains", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE(deleteRequest("1"));
    expect(res.status).toBe(401);
  });

  it("requires a domain id", async () => {
    const res = await DELETE(
      new NextRequest("http://localhost/api/v3/domains", { method: "DELETE" }),
    );
    expect(res.status).toBe(400);
  });

  it("404s when the domain doesn't exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await DELETE(deleteRequest("999"));
    expect(res.status).toBe(404);
  });

  it("denies removing a domain the caller doesn't own and isn't shared with them", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 7, team_id: null }],
    });
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: false,
      canWrite: false,
    });
    const res = await DELETE(deleteRequest("1"));
    expect(res.status).toBe(404);
  });

  it("removes a domain the caller owns", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 42, team_id: null }],
    });
    const res = await DELETE(deleteRequest("1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("DELETE FROM domains WHERE id = $1");
    expect(params).toEqual([1]);
  });
});
