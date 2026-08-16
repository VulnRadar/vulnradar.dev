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

const mockCheckDnsVerification = vi.fn();
vi.mock("@/lib/domains/verification", () => ({
  checkDnsVerification: (...args: unknown[]) =>
    mockCheckDnsVerification(...args),
}));

const { POST } = await import("@/app/api/v3/domains/[id]/verify/route");

const SESSION = { userId: 42, email: "u@x.com", name: null, role: "user" };

function verifyRequest(): NextRequest {
  return new NextRequest("http://localhost/api/v3/domains/1/verify", {
    method: "POST",
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue(SESSION);
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(true);
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 29,
    retryAfterSeconds: 0,
  });
  mockGetTeamResourceAccess.mockReset();
  mockGetTeamResourceAccess.mockResolvedValue({
    canRead: true,
    canWrite: true,
  });
  mockCheckDnsVerification.mockReset();
});

describe("POST /api/v3/domains/[id]/verify", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(verifyRequest(), params("1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when domain verification is disabled", async () => {
    mockGetSetting.mockResolvedValue(false);
    const res = await POST(verifyRequest(), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id", async () => {
    const res = await POST(verifyRequest(), params("not-a-number"));
    expect(res.status).toBe(400);
  });

  it("rejects when the per-user rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });
    const res = await POST(verifyRequest(), params("1"));
    expect(res.status).toBe(429);
    expect(mockCheckDnsVerification).not.toHaveBeenCalled();
  });

  it("404s when the domain doesn't exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(verifyRequest(), params("999"));
    expect(res.status).toBe(404);
  });

  it("denies verifying a domain the caller doesn't own and isn't shared with them", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: 7,
          team_id: null,
          domain: "example.com",
          verification_token: "tok",
        },
      ],
    });
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: false,
      canWrite: false,
    });
    const res = await POST(verifyRequest(), params("1"));
    expect(res.status).toBe(404);
    expect(mockCheckDnsVerification).not.toHaveBeenCalled();
  });

  it("marks the domain verified and records verified_at on success", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: 42,
          team_id: null,
          domain: "example.com",
          verification_token: "tok",
        },
      ],
    });
    mockCheckDnsVerification.mockResolvedValue({ verified: true });
    const res = await POST(verifyRequest(), params("1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ verified: true, status: "verified" });

    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toContain("SET status = $1");
    expect(updateSql).toContain("verified_at = CASE WHEN $1 = 'verified'");
    expect(updateParams).toEqual(["verified", null, 1]);
  });

  it("marks the domain failed and records the reason when the DNS check fails", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: 42,
          team_id: null,
          domain: "example.com",
          verification_token: "tok",
        },
      ],
    });
    mockCheckDnsVerification.mockResolvedValue({
      verified: false,
      error: "No TXT record found.",
    });
    const res = await POST(verifyRequest(), params("1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verified).toBe(false);
    expect(json.status).toBe("failed");
    expect(json.error).toBe("No TXT record found.");

    const [, updateParams] = mockQuery.mock.calls[1];
    expect(updateParams).toEqual(["failed", "No TXT record found.", 1]);
  });

  it("allows a team member with write access to verify a team-assigned domain", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: 7,
          team_id: 3,
          domain: "example.com",
          verification_token: "tok",
        },
      ],
    });
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: true,
    });
    mockCheckDnsVerification.mockResolvedValue({ verified: true });
    const res = await POST(verifyRequest(), params("1"));
    expect(res.status).toBe(200);
    expect(mockGetTeamResourceAccess).toHaveBeenCalledWith(42, 7, 3);
  });
});
