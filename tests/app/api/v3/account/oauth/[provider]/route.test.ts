/**
 * Route-level tests for GET/DELETE /api/v3/account/oauth/[provider] --
 * Google/GitHub account-linking status + disconnect (Connections tab).
 * Mirrors tests/app/api/v3/account/discord/route.test.ts's mocking shape:
 * the pg pool and getSession are mocked directly, session-gating and
 * lock-out logic run for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { GET, DELETE } =
  await import("@/app/api/v3/account/oauth/[provider]/route");

function ctx(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

const req = new Request("http://localhost/api/v3/account/oauth/google");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 3 });
});

describe("GET /api/v3/account/oauth/[provider]", () => {
  it("returns 404 for an unknown provider", async () => {
    const res = await GET(req, ctx("facebook"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for discord (it has its own dedicated endpoint)", async () => {
    const res = await GET(req, ctx("discord"));
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(req, ctx("google"));
    expect(res.status).toBe(401);
  });

  it("reports not connected when the column is null", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: null, email: null, name: null, avatar_url: null }],
    });
    const res = await GET(req, ctx("google"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ connected: false });
  });

  it("returns the linked identity when connected", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "goog-1",
          email: "ada@example.com",
          name: "Ada Lovelace",
          avatar_url: "https://example.com/a.png",
        },
      ],
    });
    const res = await GET(req, ctx("google"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({
      connected: true,
      id: "goog-1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      avatarUrl: "https://example.com/a.png",
    });
  });

  it("queries the github_* columns for the github provider", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "gh-1", email: null, name: "ada", avatar_url: null }],
    });
    await GET(req, ctx("github"));
    expect(mockQuery.mock.calls[0][0]).toContain("github_id");
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(req, ctx("google"));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/v3/account/oauth/[provider]", () => {
  it("returns 404 for an unknown provider", async () => {
    const res = await DELETE(req, ctx("facebook"));
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE(req, ctx("google"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the account has no row at all", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await DELETE(req, ctx("google"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when this provider isn't currently connected", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          google_id: null,
          github_id: null,
          discord_id: null,
          has_password: true,
        },
      ],
    });
    const res = await DELETE(req, ctx("google"));
    expect(res.status).toBe(404);
  });

  it("refuses to disconnect the user's only sign-in method", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          google_id: "goog-1",
          github_id: null,
          discord_id: null,
          has_password: false,
        },
      ],
    });
    const res = await DELETE(req, ctx("google"));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("only way to sign in");
    // Only the lookup query ran -- no UPDATE.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("allows disconnecting when the account also has a password", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          google_id: "goog-1",
          github_id: null,
          discord_id: null,
          has_password: true,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await DELETE(req, ctx("google"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toContain("google_id = NULL");
  });

  it("allows disconnecting Google when GitHub is also connected", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          google_id: "goog-1",
          github_id: "gh-1",
          discord_id: null,
          has_password: false,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await DELETE(req, ctx("google"));
    expect(res.status).toBe(200);
  });

  it("allows disconnecting Google when Discord is also connected", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          google_id: "goog-1",
          github_id: null,
          discord_id: "disc-1",
          has_password: false,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await DELETE(req, ctx("google"));
    expect(res.status).toBe(200);
  });

  it("clears the github_* columns for the github provider", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          google_id: null,
          github_id: "gh-1",
          discord_id: null,
          has_password: true,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await DELETE(req, ctx("github"));
    expect(mockQuery.mock.calls[1][0]).toContain("github_id = NULL");
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await DELETE(req, ctx("google"));
    expect(res.status).toBe(500);
  });
});
