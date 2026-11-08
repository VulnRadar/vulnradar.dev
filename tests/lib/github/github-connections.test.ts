/**
 * What happens to a GitHub token when its row goes away or is replaced.
 *
 * GitHub keeps a token valid until it is told otherwise, and a token issued for
 * the `repo` scope can write to every repository the account can reach. Every
 * path here deletes or overwrites the only copy we have, so each one revokes
 * first or the token can never be revoked at all.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";

process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { encryptApiKey, decryptApiKey } = await import("@/lib/auth/crypto");
const {
  deleteGithubConnection,
  revokeStoredGithubToken,
  saveGithubConnection,
} = await import("@/lib/github/github-connections");

const REVOKE_URL = "https://api.github.com/applications/gh-client/token";
const mockFetch = vi.fn();
let errorLog: MockInstance;

const connection = {
  userId: 3,
  githubUserId: 99,
  githubUsername: "octo",
  accessToken: "gho_new",
  scopes: "repo",
};

beforeEach(() => {
  mockQuery.mockReset();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("GITHUB_CLIENT_ID", "gh-client");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "gh-secret");
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorLog.mockRestore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function revokedTokens(): string[] {
  return mockFetch.mock.calls
    .filter(([url]) => url === REVOKE_URL)
    .map(([, init]) => JSON.parse(init.body).access_token);
}

function storedRow(token: string) {
  return { rows: [{ access_token_encrypted: encryptApiKey(token) }] };
}

describe("revokeStoredGithubToken", () => {
  it("calls GitHub's revoke endpoint with application credentials", async () => {
    mockQuery.mockResolvedValueOnce(storedRow("gho_old"));

    await revokeStoredGithubToken(3);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(REVOKE_URL);
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("gh-client:gh-secret").toString("base64")}`,
    );
    expect(JSON.parse(init.body)).toEqual({ access_token: "gho_old" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("treats GitHub's 404 as already revoked, not as a failure", async () => {
    mockQuery.mockResolvedValueOnce(storedRow("gho_old"));
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));

    await revokeStoredGithubToken(3);

    expect(errorLog).not.toHaveBeenCalled();
  });

  it("logs a refusal without the token and does not throw", async () => {
    mockQuery.mockResolvedValueOnce(storedRow("gho_old"));
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 500 }));

    await expect(revokeStoredGithubToken(3)).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("gho_old");
  });

  it("does not throw on an undecryptable row, a network failure or a dead database", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ access_token_encrypted: "not-a-ciphertext" }],
    });
    await expect(revokeStoredGithubToken(3)).resolves.toBeUndefined();

    mockQuery.mockResolvedValueOnce(storedRow("gho_old"));
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    await expect(revokeStoredGithubToken(3)).resolves.toBeUndefined();

    mockQuery.mockRejectedValueOnce(new Error("db down"));
    await expect(revokeStoredGithubToken(3)).resolves.toBeUndefined();
  });

  it("logs and calls nothing when the server has no GitHub client", async () => {
    vi.stubEnv("GITHUB_CLIENT_SECRET", "");
    mockQuery.mockResolvedValueOnce(storedRow("gho_old"));

    await revokeStoredGithubToken(3);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
  });

  it("does nothing without a connection", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await revokeStoredGithubToken(3);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });
});

describe("deleteGithubConnection", () => {
  it("revokes before the row is gone, since the row is the only copy", async () => {
    const order: string[] = [];
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("DELETE")) {
        order.push("delete");
        return { rowCount: 1 };
      }
      return storedRow("gho_old");
    });
    mockFetch.mockImplementation(async () => {
      order.push("revoke");
      return new Response(null, { status: 204 });
    });

    await expect(deleteGithubConnection(3)).resolves.toBe(true);

    expect(order).toEqual(["revoke", "delete"]);
  });

  it("removes the row even when the revoke fails", async () => {
    mockQuery.mockResolvedValueOnce(storedRow("gho_old"));
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await expect(deleteGithubConnection(3)).resolves.toBe(true);
  });
});

describe("saveGithubConnection", () => {
  it("revokes the token it replaced, after the new one is safely stored", async () => {
    const order: string[] = [];
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO github_connections")) {
        order.push("upsert");
        return { rowCount: 1 };
      }
      return storedRow("gho_old");
    });
    mockFetch.mockImplementation(async () => {
      order.push("revoke");
      return new Response(null, { status: 204 });
    });

    await saveGithubConnection(connection);

    expect(order).toEqual(["upsert", "revoke"]);
    expect(revokedTokens()).toEqual(["gho_old"]);
    const upsert = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO github_connections"),
    )!;
    expect(decryptApiKey(upsert[1][3])).toBe("gho_new");
  });

  it("revokes nothing on a first connection", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await saveGithubConnection(connection);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not revoke when GitHub handed the same token back", async () => {
    // Revoking it here would kill the connection that was just saved.
    mockQuery.mockResolvedValueOnce(storedRow("gho_new"));
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await saveGithubConnection(connection);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps the old token working when the new one could not be stored", async () => {
    // A 23505 on github_user_id: this GitHub account belongs to someone else.
    mockQuery.mockResolvedValueOnce(storedRow("gho_old"));
    mockQuery.mockRejectedValueOnce(
      Object.assign(new Error("duplicate"), { code: "23505" }),
    );

    await expect(saveGithubConnection(connection)).rejects.toThrow("duplicate");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("still saves when the previous token cannot be read", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db blip"));
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await expect(saveGithubConnection(connection)).resolves.toBeUndefined();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
