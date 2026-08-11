import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for GET /api/v3/account/github/connect (start the
 * GitHub repo-connect OAuth flow). Mocked at the auth boundary
 * (@/lib/auth's getSession) — signOAuthState runs for real.
 *
 * This flow redirects through the SAME callback URL as the identity
 * sign-in flow (/api/v3/auth/oauth/github/callback) because GitHub OAuth
 * Apps only accept one registered callback URL — see the comment on
 * OAuthStatePayload.purpose in lib/auth/oauth-state.ts.
 *
 * The redirect_uri is built via resolveAppUrl() (lib/config/runtime-config),
 * the same DB-admin-override-aware resolver every other OAuth-family route
 * uses, so the pg pool is mocked here the same way those routes' tests mock
 * it, with an empty system_settings table.
 */

process.env.GITHUB_CLIENT_ID = "test-github-client-id";
process.env.AUTH_SECRET = "a".repeat(64);

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockQuery = vi.fn(async (sql: string, params?: unknown[]) => {
  void params;
  if (sql.trim().startsWith("SELECT key, value FROM system_settings")) {
    return { rows: [] };
  }
  return { rows: [] };
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { GET } = await import("@/app/api/v3/account/github/connect/route");

beforeEach(() => {
  mockGetSession.mockReset();
  mockQuery.mockClear();
  invalidateSettingsCache();
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

  it("redirects to GitHub's authorize URL with the repo scope, using the shared (already-registered) callback URL", async () => {
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
    // Must be the SAME callback path the identity sign-in flow uses --
    // GitHub OAuth Apps only accept one registered callback URL, so this
    // can never point at its own dedicated .../connect/callback path.
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/v3/auth/oauth/github/callback",
    );

    // No state cookie: the state is HMAC-signed and bound to the userId,
    // re-checked against the current session in the callback (same as the
    // "link" purpose), which is equivalent replay protection without a
    // cookie only this flow understood.
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeFalsy();
  });

  // Not tested here: the "GITHUB_CLIENT_ID not configured" 500 path. Like
  // app/api/v3/auth/discord/route.ts, this route reads its client id into
  // a module-level constant at import time, so toggling the env var after
  // the module has already been imported (as every other test in this
  // file needs it to be, to exercise the happy path) has no effect —
  // consistent with that existing route's own test-harness comment.
});
