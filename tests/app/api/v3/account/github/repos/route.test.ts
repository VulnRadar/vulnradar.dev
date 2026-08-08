import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for GET /api/v3/account/github/repos. Mocked at the
 * network/database boundary: the pg pool (for the stored, encrypted
 * token) and outbound fetch (GitHub's repo list endpoint).
 */

process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { encryptApiKey } = await import("@/lib/auth/crypto");
const { GET } = await import("@/app/api/v3/account/github/repos/route");

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 3 });
  mockQuery.mockReset();
  mockFetch.mockReset();
});

describe("GET /api/v3/account/github/repos", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("requires a GitHub connection first", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET();
    expect(res.status).toBe(400);
  });

  it("lists repos using the decrypted token", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ access_token_encrypted: encryptApiKey("gho_realtoken") }],
    });
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            full_name: "octocat/hello-world",
            private: false,
            default_branch: "main",
            updated_at: "2026-01-01T00:00:00Z",
            description: "test repo",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.repos).toEqual([
      {
        fullName: "octocat/hello-world",
        private: false,
        defaultBranch: "main",
        updatedAt: "2026-01-01T00:00:00Z",
        description: "test repo",
      },
    ]);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer gho_realtoken");
  });

  it("returns 500 when the GitHub API call fails", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ access_token_encrypted: encryptApiKey("gho_realtoken") }],
    });
    mockFetch.mockResolvedValueOnce(new Response("", { status: 401 }));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
