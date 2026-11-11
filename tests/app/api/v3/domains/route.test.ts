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
// RATE_LIMITS is passed through from the real module, not stubbed: the point
// of AUDIT-014#magic-08 was that the route names its limit so checkRateLimit
// can resolve the live admin value, and a hand-written stub here would let a
// regression back to inline numbers pass unnoticed.
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  };
});

const mockGetTeamResourceAccess = vi.fn();
const mockGetAssignableTeamIds = vi.fn();
vi.mock("@/lib/auth/team-resource-access", () => ({
  getTeamResourceAccess: (...args: unknown[]) =>
    mockGetTeamResourceAccess(...args),
  getAssignableTeamIds: (...args: unknown[]) =>
    mockGetAssignableTeamIds(...args),
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
  mockGetAssignableTeamIds.mockReset();
  mockGetAssignableTeamIds.mockResolvedValue([]);
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

  it("selects user_id so a caller can tell their own domain from a teammate's", async () => {
    // PATCH /domains/[id] scopes its UPDATE to the owner and 404s otherwise,
    // so the Attack Surface list has to know which rows it may offer a team
    // picker on.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET();

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("user_id, team_id");
  });
});

/**
 * gap-domain-verification-active-gating-6: the scan form's "this domain is
 * verified" hint counted every verified row in this list, including a
 * teammate's domain shared into a team where the caller is only a viewer or a
 * manager. lib/domains/scope.ts honours a team row only for a team the caller
 * may assign scans to (getAssignableTeamIds), so ticking the port sweep for
 * such a host 403'd the whole scan. Each row now says whether it would pass.
 */
describe("GET /api/v3/domains, usableForScanning", () => {
  const row = (over: Record<string, unknown>) => ({
    id: 1,
    domain: "example.com",
    user_id: 42,
    team_id: null,
    status: "verified",
    ...over,
  });

  async function usable(rows: Record<string, unknown>[]) {
    mockQuery.mockResolvedValueOnce({ rows });
    const res = await GET();
    const json = await res.json();
    return (json.domains as { id: number; usableForScanning: boolean }[]).map(
      (d) => [d.id, d.usableForScanning],
    );
  }

  it("marks the caller's own verified domain usable", async () => {
    expect(await usable([row({ id: 1 })])).toEqual([[1, true]]);
  });

  it("marks a teammate's domain usable for a member of the team it is shared with", async () => {
    // A member holds manage_scans, so getAssignableTeamIds lists the team.
    mockGetAssignableTeamIds.mockResolvedValue([5]);
    expect(await usable([row({ id: 2, user_id: 7, team_id: 5 })])).toEqual([
      [2, true],
    ]);
    expect(mockGetAssignableTeamIds).toHaveBeenCalledWith(42);
  });

  it("marks the same domain not usable for a viewer of that team", async () => {
    // A viewer can see the row (it is listed) but cannot scan under the team.
    mockGetAssignableTeamIds.mockResolvedValue([]);
    expect(await usable([row({ id: 2, user_id: 7, team_id: 5 })])).toEqual([
      [2, false],
    ]);
  });

  it("never marks a pending or lapsed row usable, not even the caller's own", async () => {
    mockGetAssignableTeamIds.mockResolvedValue([5]);
    expect(
      await usable([
        row({ id: 3, status: "pending" }),
        row({ id: 4, status: "reverify_failed", user_id: 7, team_id: 5 }),
      ]),
    ).toEqual([
      [3, false],
      [4, false],
    ]);
  });

  it("marks nothing usable while domain verification is turned off", async () => {
    // isUrlOwnedByUser fails closed with the flag off, so the hint must too.
    mockGetSetting.mockResolvedValue(false);
    expect(await usable([row({ id: 1 })])).toEqual([[1, false]]);
  });

  it("lists a teammate's row only while its owner is still on that team", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await GET();
    const [sql] = mockQuery.mock.calls[0];
    expect(String(sql).replace(/\s+/g, " ")).toMatch(
      /EXISTS \( ?SELECT 1 FROM team_members \w+ WHERE \w+\.team_id = domains\.team_id AND \w+\.user_id = domains\.user_id ?\)/,
    );
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

  // AUDIT-014#magic-08: the cap used to be two inline numbers, which meant the
  // number the API docs quote could not be edited from the admin panel.
  it("names its rate limit so checkRateLimit resolves the admin-configured cap", async () => {
    // Denied, so the route returns before the insert path this test does not
    // care about; the assertion is on what it asked the limiter for.
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 300,
    });
    await POST(postRequest({ domain: "example.com" }));

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "domain-add:42",
        limit: "domainAdd",
      }),
    );
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

  // gap-domain-verification-active-gating-7: deleting went through
  // getTeamResourceAccess's write rule, so any teammate with manage_scans
  // could destroy a domain somebody else had proven they own, although only
  // that person may decide which team it is shared with.
  it("refuses a teammate deleting a domain someone else verified, without a DELETE", async () => {
    // Member 2 of team 5 tries to delete user 1's row shared into team 5.
    mockGetSession.mockResolvedValue({ ...SESSION, userId: 2 });
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 1, team_id: 5 }] });
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: true,
    });

    const res = await DELETE(deleteRequest("9"));

    expect([403, 404]).toContain(res.status);
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM domains"),
      ),
    ).toBe(false);
  });

  it("tells a teammate who can see the row that it is not theirs to remove", async () => {
    mockGetSession.mockResolvedValue({ ...SESSION, userId: 2 });
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 1, team_id: 5 }] });
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: false,
    });

    const res = await DELETE(deleteRequest("9"));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("verified");
  });

  it("scopes the DELETE itself to the owner, not only the check above it", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 42, team_id: 5 }] });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await DELETE(deleteRequest("9"));

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("DELETE FROM domains WHERE id = $1 AND user_id = $2");
    expect(params).toEqual([9, 42]);
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
    expect(params).toEqual([1, 42]);
  });
});
