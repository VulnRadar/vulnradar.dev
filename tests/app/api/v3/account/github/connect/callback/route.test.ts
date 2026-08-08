import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeCookieStore } from "../../../../auth/_test-harness";

/**
 * Route-level tests for GET /api/v3/account/github/connect/callback.
 * Mocked at the network/database boundary: outbound fetch (GitHub's token
 * + user endpoints), the pg pool, and getSession. signGithubState /
 * verifyGithubState run for real.
 */

process.env.GITHUB_CLIENT_ID = "test-github-client-id";
process.env.GITHUB_CLIENT_SECRET = "test-github-client-secret";
process.env.AUTH_SECRET = "a".repeat(64);
process.env.API_KEY_ENCRYPTION_KEY = "b".repeat(64);

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { store: cookieStore, state: cookieState } = makeCookieStore();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { signGithubState } = await import("@/lib/github/github-state");
const { GET } =
  await import("@/app/api/v3/account/github/connect/callback/route");

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockFetch.mockReset();
  cookieState.clear();
});

function callbackReq(params: Record<string, string>) {
  const url = new URL(
    "http://localhost/api/v3/account/github/connect/callback",
  );
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

describe("GET /api/v3/account/github/connect/callback", () => {
  it("redirects with github_error=denied when GitHub reports an OAuth error", async () => {
    const res = await GET(callbackReq({ error: "access_denied" }));
    const location = res.headers.get("location")!;
    expect(location).toContain("github_error=denied");
  });

  it("redirects with github_error=invalid when code or state is missing", async () => {
    const res = await GET(callbackReq({ code: "abc" }));
    expect(res.headers.get("location")).toContain("github_error=invalid");
  });

  it("redirects with github_error=invalid_state when the state cookie doesn't match the query param", async () => {
    const state = signGithubState(7);
    cookieStore.set("github_connect_state", "different-value");
    const res = await GET(callbackReq({ code: "abc", state }));
    expect(res.headers.get("location")).toContain("github_error=invalid_state");
  });

  it("redirects with github_error=invalid_state when the signed state doesn't verify", async () => {
    cookieStore.set("github_connect_state", "not-a-real-state");
    const res = await GET(
      callbackReq({ code: "abc", state: "not-a-real-state" }),
    );
    expect(res.headers.get("location")).toContain("github_error=invalid_state");
  });

  it("redirects with github_error=session_expired when there is no session", async () => {
    mockGetSession.mockResolvedValue(null);
    const state = signGithubState(7);
    cookieStore.set("github_connect_state", state);
    const res = await GET(callbackReq({ code: "abc", state }));
    expect(res.headers.get("location")).toContain(
      "github_error=session_expired",
    );
  });

  it("exchanges the code, fetches the GitHub user, saves the connection, and redirects with success", async () => {
    const state = signGithubState(7);
    cookieStore.set("github_connect_state", state);

    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("login/oauth/access_token")) {
        return new Response(
          JSON.stringify({ access_token: "gho_faketoken", scope: "repo" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (String(url).includes("api.github.com/user")) {
        return new Response(JSON.stringify({ id: 12345, login: "octocat" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    const res = await GET(callbackReq({ code: "abc", state }));
    const location = res.headers.get("location")!;
    expect(location).toContain("github_connected=true");

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO github_connections"),
    );
    expect(insertCall).toBeDefined();
    const [, params] = insertCall!;
    expect(params[0]).toBe(7); // userId
    expect(params[1]).toBe(12345); // githubUserId
    expect(params[2]).toBe("octocat"); // githubUsername
    expect(params[3]).not.toBe("gho_faketoken"); // encrypted, not plaintext
  });

  it("redirects with github_error=failed when the token exchange fails", async () => {
    const state = signGithubState(7);
    cookieStore.set("github_connect_state", state);
    mockFetch.mockResolvedValue(new Response("", { status: 401 }));

    const res = await GET(callbackReq({ code: "abc", state }));
    expect(res.headers.get("location")).toContain("github_error=failed");
  });
});
