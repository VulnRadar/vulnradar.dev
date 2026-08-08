import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for GET /api/v3/account/github/connect (start the
 * GitHub repo-connect OAuth flow). Mocked at the auth boundary
 * (@/lib/auth's getSession) — signGithubState runs for real.
 */

process.env.GITHUB_CLIENT_ID = "test-github-client-id";
process.env.AUTH_SECRET = "a".repeat(64);

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { GET } = await import("@/app/api/v3/account/github/connect/route");

beforeEach(() => {
  mockGetSession.mockReset();
});

function req() {
  return new Request("http://localhost/api/v3/account/github/connect");
}

describe("GET /api/v3/account/github/connect", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("redirects to GitHub's authorize URL with the repo scope and sets a state cookie", async () => {
    mockGetSession.mockResolvedValue({ userId: 7 });
    const res = await GET(req());
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);

    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const url = new URL(location!);
    expect(url.hostname).toBe("github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-github-client-id");
    expect(url.searchParams.get("scope")).toBe("repo");
    expect(url.searchParams.get("state")).toBeTruthy();

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toMatch(/github_connect_state=/);
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  // Not tested here: the "GITHUB_CLIENT_ID not configured" 500 path. Like
  // app/api/v3/auth/discord/route.ts, this route reads its client id into
  // a module-level constant at import time, so toggling the env var after
  // the module has already been imported (as every other test in this
  // file needs it to be, to exercise the happy path) has no effect —
  // consistent with that existing route's own test-harness comment.
});
