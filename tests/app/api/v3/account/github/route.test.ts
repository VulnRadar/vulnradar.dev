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

const mockDeleteAvatarFilesIfLocal = vi.fn();
vi.mock("@/lib/uploads/avatar-storage", () => ({
  deleteAvatarFilesIfLocal: (...args: unknown[]) =>
    mockDeleteAvatarFilesIfLocal(...args),
}));

const mockNotice = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications/profile-name-changed", () => ({
  noticeProfileNameChanged: mockNotice,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

const { encryptApiKey } = await import("@/lib/auth/crypto");
const { GET, PATCH, DELETE } =
  await import("@/app/api/v3/account/github/route");

function statusRequest(query = "") {
  return new Request(`http://localhost/api/v3/account/github${query}`);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockFetch.mockReset();
  mockConsoleError.mockClear();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 3 });
  mockDeleteAvatarFilesIfLocal.mockReset();
  mockDeleteAvatarFilesIfLocal.mockResolvedValue(undefined);
  mockNotice.mockReset();
  process.env.GITHUB_CLIENT_ID = "gh-client";
  process.env.GITHUB_CLIENT_SECRET = "gh-secret";
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

describe("GET /api/v3/account/github?include=linked-profile", () => {
  it("answers from the stored sign-in identity, with no repo-connection lookup", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          github_id: "42",
          github_name: "Real Name",
          github_avatar_url: "https://avatars.githubusercontent.com/u/42",
        },
      ],
    });

    const res = await GET(statusRequest("?include=linked-profile"));
    const json = await res.json();

    expect(json.linkedProfile).toEqual({
      name: "Real Name",
      avatarUrl: "https://avatars.githubusercontent.com/u/42",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("is null when no GitHub sign-in is linked", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ github_id: null, github_name: null, github_avatar_url: null }],
    });
    const res = await GET(statusRequest("?include=linked-profile"));
    expect((await res.json()).linkedProfile).toBeNull();
  });
});

describe("PATCH /api/v3/account/github", () => {
  function patchRequest(body: unknown) {
    return new Request("http://localhost/api/v3/account/github", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const linked = {
    github_id: "42",
    github_name: "Real Name",
    github_avatar_url: "https://avatars.githubusercontent.com/u/42",
  };

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ syncName: true }));
    expect(res.status).toBe(401);
  });

  it("no-ops when nothing was asked for", async () => {
    const res = await PATCH(patchRequest({}));
    expect(await res.json()).toEqual({ success: true, updated: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when no GitHub sign-in is linked", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ github_id: null, github_name: null, github_avatar_url: null }],
    });
    const res = await PATCH(patchRequest({ syncName: true }));
    expect(res.status).toBe(404);
  });

  it("writes the stored values and ignores anything the client sends", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [linked] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PATCH(
      patchRequest({
        syncAvatar: true,
        syncName: true,
        name: "evil",
        avatarUrl: "https://evil.example/x.png",
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.updated.sort()).toEqual(["avatar", "name"]);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("UPDATE users SET");
    expect(params).toEqual([
      "https://avatars.githubusercontent.com/u/42",
      "Real Name",
      3,
    ]);
    expect(mockDeleteAvatarFilesIfLocal).toHaveBeenCalledWith(3);
  });

  it.each([
    "https://evil.example/x.png",
    "https://avatars.githubusercontent.com.evil.example/x.png",
    "https://avatars.githubusercontent.com@evil.example/x.png",
    "http://avatars.githubusercontent.com/u/42",
    "javascript:alert(1)//avatars.githubusercontent.com",
    "not a url",
  ])(
    "never stores an avatar that is not on GitHub's own CDN: %s",
    async (url) => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...linked, github_avatar_url: url }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await PATCH(
        patchRequest({ syncAvatar: true, syncName: true }),
      );

      expect((await res.json()).updated).toEqual(["name"]);
      expect(mockDeleteAvatarFilesIfLocal).not.toHaveBeenCalled();
    },
  );

  // The dialog used to save through PATCH /auth/update, which mails the owner
  // about a name change. Moving the save here must not lose that.
  it("tells the owner when a sync changes the name", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...linked, github_name: "  Real Name " }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PATCH(patchRequest({ syncName: true }));

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][1]).toEqual(["Real Name", 3]);
    expect(mockNotice).toHaveBeenCalledWith({ userId: 3 }, "Real Name");
  });

  it("does not write a name that is only whitespace", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...linked, github_name: "   " }],
    });

    const res = await PATCH(patchRequest({ syncName: true }));

    expect((await res.json()).updated).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockNotice).not.toHaveBeenCalled();
  });

  it("sends no name notice for an avatar-only sync", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [linked] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await PATCH(patchRequest({ syncAvatar: true }));

    expect(mockNotice).not.toHaveBeenCalled();
  });

  it("treats a JSON null body as nothing asked for, not a server error", async () => {
    const res = await PATCH(patchRequest(null));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, updated: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

/**
 * Disconnecting only deleted our copy. The token itself, full read/write on
 * every repo the account can reach, stayed valid at GitHub while the page said
 * access had been revoked.
 */
describe("DELETE /api/v3/account/github", () => {
  function storedToken(token = "gho_live") {
    mockQuery.mockResolvedValueOnce({
      rows: [{ access_token_encrypted: encryptApiKey(token) }],
    });
  }

  function revokeCalls() {
    return mockFetch.mock.calls.filter(
      ([url]) => url === "https://api.github.com/applications/gh-client/token",
    );
  }

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("is refused during an impersonation, before GitHub hears about it", async () => {
    mockGetSession.mockResolvedValue({ userId: 3, impersonatedBy: 1 });
    const res = await DELETE();
    expect(res.status).toBe(403);
    expect((await res.json()).impersonationBlocked).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no connection to remove", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no stored token
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const res = await DELETE();
    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("revokes the decrypted token at GitHub once, then removes the row", async () => {
    storedToken();
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await DELETE();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(revokeCalls()).toHaveLength(1);
    const [, init] = revokeCalls()[0];
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("gh-client:gh-secret").toString("base64")}`,
    );
    expect(JSON.parse(init.body)).toEqual({ access_token: "gho_live" });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM github_connections"),
      [3],
    );
  });

  it("still removes the row when GitHub is unreachable", async () => {
    storedToken();
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(mockConsoleError).toHaveBeenCalled();
  });
});
