import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for GET/DELETE /api/v3/account/github (connection
 * status + disconnect). The database boundary is mocked; session-gating
 * runs for real via a mocked @/lib/auth.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { GET, DELETE } = await import("@/app/api/v3/account/github/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 3 });
});

describe("GET /api/v3/account/github", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("reports not connected when there is no row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ connected: false });
  });

  it("returns connection details when connected, without the access token", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          github_user_id: "12345",
          github_username: "octocat",
          scopes: "repo",
          connected_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.connected).toBe(true);
    expect(json.githubUsername).toBe("octocat");
    expect(json.scopes).toBe("repo");
    expect(json).not.toHaveProperty("accessToken");
    expect(json).not.toHaveProperty("access_token_encrypted");
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/v3/account/github", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("returns 404 when there is no connection to remove", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const res = await DELETE();
    expect(res.status).toBe(404);
  });

  it("disconnects the account", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const res = await DELETE();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM github_connections"),
      [3],
    );
  });
});
