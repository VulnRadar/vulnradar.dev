/**
 * Route-level tests for POST /api/v3/teams/accept-invite. Covers both the
 * pre-existing token-based path (emailed link) and the new inviteId-based
 * path (bell "Accept" button), and that accepting either way marks the
 * corresponding bell notification handled.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// This route only calls getSession() from @/lib/auth, so mock the module
// outright rather than pulling in the real one (importOriginal), which
// transitively loads lib/config/registry.ts and other modules this suite
// doesn't need to exercise.
const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockMarkHandled = vi.fn();
vi.mock("@/lib/notifications/user-notifications", () => ({
  markTeamInviteNotificationsHandled: (...args: unknown[]) =>
    mockMarkHandled(...args),
}));

// FEATURE_TEAMS is the deployment-wide kill switch every /api/v3/teams
// handler now checks (lib/teams/feature-gate.ts). Mocked at the settings
// resolver so it doesn't consume an entry from this suite's ordered
// pool.query queue.
const mockFeatureTeams = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: async (key: string) =>
    key === "FEATURE_TEAMS" ? mockFeatureTeams() : undefined,
}));

// The accept path is rate limited (AUDIT-002#secrets-02). Mocked here so the
// limiter's own two pool.query calls don't consume entries from this suite's
// ordered queue; the limit itself is asserted in its own test below.
const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMITS: { teamInvite: { limit: "teamInvite" } },
}));

const { POST } = await import("@/app/api/v3/teams/accept-invite/route");

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/teams/accept-invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function invite(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    team_id: 3,
    email: "bob@example.com",
    role: "viewer",
    expires_at: FUTURE,
    team_name: "Acme",
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockMarkHandled.mockReset();
  mockMarkHandled.mockResolvedValue(undefined);
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockFeatureTeams.mockReset();
  mockFeatureTeams.mockResolvedValue(true);
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 19,
    retryAfterSeconds: 0,
  });
});

describe("POST /api/v3/teams/accept-invite", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ token: "abc" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 and touches no data when FEATURE_TEAMS is off", async () => {
    mockFeatureTeams.mockResolvedValue(false);
    const res = await POST(postRequest({ token: "abc" }));
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // AUDIT-002#secrets-02: sending invites was capped and accepting them was
  // not, so the small sequential inviteId could be walked to learn which
  // invites exist and which are still open (the two failure messages
  // differ).
  it("rejects with 429 and touches no invite data once the accept limiter trips", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 600,
    });
    const res = await POST(postRequest({ inviteId: 7 }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("keys the accept limiter on the caller, not on the invite", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await POST(postRequest({ inviteId: 7 }));
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "team-accept-invite:42" }),
    );
  });

  it("requires a token or an inviteId", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("accepts via the emailed token link and marks the notification handled", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [invite()] }); // find by token hash
    mockQuery.mockResolvedValueOnce({ rows: [{ email: "bob@example.com" }] }); // user's email
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingMember
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE accepted_at
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT team_members

    const res = await POST(postRequest({ token: "plaintext-token" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.teamId).toBe(3);
    expect(mockMarkHandled).toHaveBeenCalledWith(7);
    // The token flow queries by hash, never plaintext.
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ti.token = $1");
    expect(params[0]).not.toBe("plaintext-token");
  });

  it("accepts via inviteId (the bell's in-app Accept button) and marks the notification handled", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [invite()] }); // find by id
    mockQuery.mockResolvedValueOnce({ rows: [{ email: "bob@example.com" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingMember
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE accepted_at
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT team_members

    const res = await POST(postRequest({ inviteId: 7 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.teamId).toBe(3);
    expect(mockMarkHandled).toHaveBeenCalledWith(7);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ti.id = $1");
    expect(params).toEqual([7]);
  });

  it("rejects an inviteId whose email doesn't match the logged-in user, even though the id is valid", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [invite({ email: "someone-else@example.com" })],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ email: "bob@example.com" }] });

    const res = await POST(postRequest({ inviteId: 7 }));

    expect(res.status).toBe(403);
    expect(mockMarkHandled).not.toHaveBeenCalled();
  });

  it("rejects an expired invite", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [invite({ expires_at: past })] });

    const res = await POST(postRequest({ inviteId: 7 }));

    expect(res.status).toBe(400);
    expect(mockMarkHandled).not.toHaveBeenCalled();
  });

  it("rejects an unknown or already-used invite", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ inviteId: 999 }));

    expect(res.status).toBe(400);
  });

  it("a failure marking the notification handled does not fail the accept response", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [invite()] });
    mockQuery.mockResolvedValueOnce({ rows: [{ email: "bob@example.com" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockMarkHandled.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(postRequest({ inviteId: 7 }));
    expect(res.status).toBe(200);
  });
});
