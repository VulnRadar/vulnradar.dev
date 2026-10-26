import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for GET/DELETE /api/v3/account/github (connection
 * status + disconnect). The database boundary is mocked; session-gating
 * runs for real via a mocked @/lib/auth. Outbound fetch is stubbed for the
 * ?include=selected-repos lookups against GitHub.
 */

process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

const { encryptApiKey } = await import("@/lib/auth/crypto");
const { GET, DELETE } = await import("@/app/api/v3/account/github/route");

function statusRequest(query = "") {
  return new Request(`http://localhost/api/v3/account/github${query}`);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockFetch.mockReset();
  mockConsoleError.mockClear();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 3 });
});

describe("GET /api/v3/account/github", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(statusRequest());
    expect(res.status).toBe(401);
  });

  it("reports not connected when there is no row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(statusRequest());
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
          selected_repos: ["octocat/hello-world"],
        },
      ],
    });
    const res = await GET(statusRequest());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.connected).toBe(true);
    expect(json.githubUsername).toBe("octocat");
    expect(json.scopes).toBe("repo");
    expect(json.selectedRepos).toEqual(["octocat/hello-world"]);
    expect(json).not.toHaveProperty("accessToken");
    expect(json).not.toHaveProperty("access_token_encrypted");
  });

  it("defaults selectedRepos to an empty array when the column is null", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          github_user_id: "12345",
          github_username: "octocat",
          scopes: "repo",
          connected_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
          selected_repos: null,
        },
      ],
    });
    const res = await GET(statusRequest());
    const json = await res.json();
    expect(json.selectedRepos).toEqual([]);
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(statusRequest());
    expect(res.status).toBe(500);
  });
});

describe("GET /api/v3/account/github?include=selected-repos", () => {
  function connectionRow(selected: string[]) {
    return {
      rows: [
        {
          github_user_id: "12345",
          github_username: "octocat",
          scopes: "repo",
          connected_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
          selected_repos: selected,
        },
      ],
    };
  }
  const tokenRow = () => ({
    rows: [{ access_token_encrypted: encryptApiKey("gho_realtoken") }],
  });
  function repoResponse(fullName: string, extra: Record<string, unknown> = {}) {
    return new Response(
      JSON.stringify({
        full_name: fullName,
        private: false,
        default_branch: "main",
        updated_at: "2026-02-03T00:00:00Z",
        description: null,
        ...extra,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  const include = () => statusRequest("?include=selected-repos");

  it("leaves the status alone, and asks GitHub nothing, without the parameter", async () => {
    mockQuery.mockResolvedValueOnce(connectionRow(["octocat/hello-world"]));
    const res = await GET(statusRequest());
    const json = await res.json();
    expect(json.selectedRepos).toEqual(["octocat/hello-world"]);
    expect(json).not.toHaveProperty("repos");
    expect(json).not.toHaveProperty("workingSetError");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns details for the selected repos only, in the order selected", async () => {
    mockQuery
      .mockResolvedValueOnce(connectionRow(["acme/api", "octocat/hello-world"]))
      .mockResolvedValueOnce(tokenRow());
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith("/repos/acme/api")
        ? repoResponse("acme/api", { private: true, description: "the api" })
        : repoResponse("octocat/hello-world"),
    );

    const res = await GET(include());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.connected).toBe(true);
    expect(json.selectedRepos).toEqual(["acme/api", "octocat/hello-world"]);
    expect(json.repos).toEqual([
      {
        fullName: "acme/api",
        private: true,
        defaultBranch: "main",
        updatedAt: "2026-02-03T00:00:00Z",
        description: "the api",
      },
      {
        fullName: "octocat/hello-world",
        private: false,
        defaultBranch: "main",
        updatedAt: "2026-02-03T00:00:00Z",
        description: null,
      },
    ]);
    // One request per selected repo, never the account-wide listing.
    const urls = mockFetch.mock.calls.map((c) => c[0] as string).sort();
    expect(urls).toEqual([
      "https://api.github.com/repos/acme/api",
      "https://api.github.com/repos/octocat/hello-world",
    ]);
    for (const [, options] of mockFetch.mock.calls) {
      expect(options.headers.Authorization).toBe("Bearer gho_realtoken");
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    expect(json).not.toHaveProperty("workingSetError");
  });

  it("does not touch GitHub for an empty selection", async () => {
    mockQuery.mockResolvedValueOnce(connectionRow([]));
    const res = await GET(include());
    const json = await res.json();
    expect(json.repos).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("drops a selected repo that is gone and keeps the rest", async () => {
    mockQuery
      .mockResolvedValueOnce(connectionRow(["octocat/deleted", "acme/api"]))
      .mockResolvedValueOnce(tokenRow());
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith("/repos/octocat/deleted")
        ? new Response("{}", { status: 404 })
        : repoResponse("acme/api"),
    );

    const res = await GET(include());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.repos.map((r: { fullName: string }) => r.fullName)).toEqual([
      "acme/api",
    ]);
    expect(json.selectedRepos).toEqual(["octocat/deleted", "acme/api"]);
  });

  it("reports a GitHub timeout beside the status instead of as an empty selection", async () => {
    mockQuery
      .mockResolvedValueOnce(connectionRow(["octocat/hello-world"]))
      .mockResolvedValueOnce(tokenRow());
    mockFetch.mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );

    const res = await GET(include());
    const json = await res.json();

    // The connection and the names are still true, so this is not a 5xx.
    expect(res.status).toBe(200);
    expect(json.connected).toBe(true);
    expect(json.selectedRepos).toEqual(["octocat/hello-world"]);
    expect(json.workingSetError).toMatch(/did not answer in time/i);
    // Absent, not []: the page must not be able to read it as "nothing picked".
    expect(json).not.toHaveProperty("repos");
    expect(mockConsoleError).toHaveBeenCalledTimes(1);
  });

  it("reports any other GitHub failure the same way", async () => {
    mockQuery
      .mockResolvedValueOnce(connectionRow(["octocat/hello-world"]))
      .mockResolvedValueOnce(tokenRow());
    mockFetch.mockResolvedValue(new Response("{}", { status: 500 }));

    const res = await GET(include());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.workingSetError).toMatch(/could not be loaded/i);
    expect(json).not.toHaveProperty("repos");
  });

  it("reports an unreadable stored token as a working-set failure, not a 500", async () => {
    mockQuery
      .mockResolvedValueOnce(connectionRow(["octocat/hello-world"]))
      .mockResolvedValueOnce({ rows: [{ access_token_encrypted: "garbage" }] });

    const res = await GET(include());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.workingSetError).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
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
