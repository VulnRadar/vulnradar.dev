/**
 * Route-level tests for GET /api/v3/auth/staff-oidc/callback -- the
 * security-critical half of staff SSO. See lib/auth/staff-oidc.ts's header
 * comment for the posture this suite exists to prove: a successful
 * callback NEVER creates an account and NEVER promotes one -- it only
 * signs into an account that already exists with the IdP's returned email
 * AND is already staff-tier or above.
 *
 * Mocked at the module boundary: lib/auth/staff-oidc.ts's own exchange/
 * verify functions (already covered by real-crypto tests in
 * tests/lib/auth/staff-oidc.test.ts, so re-testing signature verification
 * here would be redundant), the pg pool, and next/headers. verifyOAuthState
 * and createSession run for real against the mocked pool/cookie jar.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeCookieStore, makeHeaderStore } from "../../_test-harness";

process.env.API_KEY_ENCRYPTION_KEY = "f".repeat(64);

let userByEmailRow:
  { id: number; role: string | null; disabled_at: string | null } | undefined;
const queries: { sql: string; params: unknown[] }[] = [];
const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.trim();
  if (s.startsWith("SELECT id, role, disabled_at FROM users")) {
    return { rows: userByEmailRow ? [userByEmailRow] : [] };
  }
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO sessions")) return { rows: [] };
  if (s.startsWith("INSERT INTO admin_audit_log")) return { rows: [] };
  return { rows: [] };
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { store: cookieStore, state: cookieState } = makeCookieStore();
const { store: headerStore } = makeHeaderStore({
  "user-agent": "test-agent",
});
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => headerStore),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "203.0.113.5"),
}));

const mockGetStaffOidcConfig = vi.fn();
const mockGetDiscoveryDocument = vi.fn();
const mockExchangeStaffOidcCode = vi.fn();
const mockVerifyStaffOidcIdToken = vi.fn();
vi.mock("@/lib/auth/staff-oidc", () => ({
  getStaffOidcConfig: (...args: unknown[]) => mockGetStaffOidcConfig(...args),
  getDiscoveryDocument: (...args: unknown[]) =>
    mockGetDiscoveryDocument(...args),
  exchangeStaffOidcCode: (...args: unknown[]) =>
    mockExchangeStaffOidcCode(...args),
  verifyStaffOidcIdToken: (...args: unknown[]) =>
    mockVerifyStaffOidcIdToken(...args),
}));

const { GET } = await import("@/app/api/v3/auth/staff-oidc/callback/route");
const { signOAuthState } = await import("@/lib/auth/oauth-state");

function makeRequest(query: string) {
  return new Request(
    `https://vulnradar.dev/api/v3/auth/staff-oidc/callback${query}`,
    { headers: { "user-agent": "test-agent" } },
  );
}

function validState() {
  return signOAuthState("staff-oidc");
}

const VALID_CONFIG = {
  issuerUrl: "https://idp.example.com",
  clientId: "id",
  clientSecret: "secret",
};
const VALID_DOC = {
  issuer: "https://idp.example.com",
  authorization_endpoint: "https://idp.example.com/authorize",
  token_endpoint: "https://idp.example.com/token",
  jwks_uri: "https://idp.example.com/jwks",
};

beforeEach(() => {
  queries.length = 0;
  mockQuery.mockClear();
  cookieState.clear();
  userByEmailRow = undefined;
  mockGetStaffOidcConfig.mockReset();
  mockGetDiscoveryDocument.mockReset();
  mockExchangeStaffOidcCode.mockReset();
  mockVerifyStaffOidcIdToken.mockReset();

  mockGetStaffOidcConfig.mockResolvedValue(VALID_CONFIG);
  mockGetDiscoveryDocument.mockResolvedValue(VALID_DOC);
  mockExchangeStaffOidcCode.mockResolvedValue({ idToken: "token" });
  mockVerifyStaffOidcIdToken.mockResolvedValue({
    email: "admin@example.com",
    emailVerified: true,
    name: "Admin",
    sub: "idp-1",
  });
  cookieState.set("staff_oidc_nonce", "the-nonce");
});

describe("GET /api/v3/auth/staff-oidc/callback", () => {
  it("rejects when the IdP reports an error (user denied consent)", async () => {
    const res = await GET(
      makeRequest(`?error=access_denied&state=${validState()}`),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=oauth_denied");
  });

  it("rejects when code or state is missing", async () => {
    const res = await GET(makeRequest(`?state=${validState()}`));
    expect(res.headers.get("location")).toContain("error=oauth_invalid");
  });

  it("rejects a tampered/invalid state", async () => {
    const res = await GET(makeRequest(`?code=abc&state=not-a-real-state`));
    expect(res.headers.get("location")).toContain("oauth_invalid_state");
  });

  it("rejects a state signed for a different provider", async () => {
    const wrongProviderState = signOAuthState("google");
    const res = await GET(makeRequest(`?code=abc&state=${wrongProviderState}`));
    expect(res.headers.get("location")).toContain("oauth_invalid_state");
  });

  it("rejects when staff SSO is not configured", async () => {
    mockGetStaffOidcConfig.mockResolvedValue(null);
    const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(res.headers.get("location")).toContain("oauth_not_configured");
  });

  it("rejects when the nonce cookie is missing (expired or never set)", async () => {
    cookieState.clear();
    const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(res.headers.get("location")).toContain("oauth_expired");
    expect(mockExchangeStaffOidcCode).not.toHaveBeenCalled();
  });

  it("rejects when the ID token's email is unverified", async () => {
    mockVerifyStaffOidcIdToken.mockResolvedValue({
      email: "admin@example.com",
      emailVerified: false,
      name: "Admin",
      sub: "idp-1",
    });
    userByEmailRow = { id: 5, role: "admin", disabled_at: null };
    const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(res.headers.get("location")).toContain("oauth_email_unverified");
  });

  it("NEVER creates an account: rejects with a generic error when no account matches the email", async () => {
    userByEmailRow = undefined; // no account at all
    const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(res.headers.get("location")).toContain("oauth_no_account");
    // No INSERT into users anywhere -- this route only ever SELECTs.
    expect(
      queries.some((q) => q.sql.trim().startsWith("INSERT INTO users")),
    ).toBe(false);
  });

  it("NEVER promotes an account: rejects a matching account whose role is below staff (support)", async () => {
    userByEmailRow = { id: 5, role: "user", disabled_at: null };
    const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(res.headers.get("location")).toContain("oauth_no_account");
    // Same error code as "no account at all" -- see this file's header
    // comment for why the distinction is deliberately not leaked.
    expect(queries.some((q) => q.sql.trim().startsWith("UPDATE users"))).toBe(
      false,
    );
  });

  it("rejects a matching staff account that is disabled", async () => {
    userByEmailRow = { id: 5, role: "admin", disabled_at: "2026-01-01" };
    const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(res.headers.get("location")).toContain("oauth_account_disabled");
  });

  it("signs in a matching staff account (support-tier, the floor) and redirects to /admin", async () => {
    userByEmailRow = { id: 5, role: "support", disabled_at: null };
    const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://vulnradar.dev/admin");
    expect(
      queries.some((q) => q.sql.trim().startsWith("INSERT INTO sessions")),
    ).toBe(true);
  });

  it("signs in a super_admin account", async () => {
    userByEmailRow = { id: 1, role: "super_admin", disabled_at: null };
    const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(res.headers.get("location")).toBe("https://vulnradar.dev/admin");
  });

  it("audit-logs the sign-in with the issuer hostname, never a raw secret", async () => {
    userByEmailRow = { id: 5, role: "admin", disabled_at: null };
    await GET(makeRequest(`?code=abc&state=${validState()}`));
    const auditInsert = queries.find((q) =>
      q.sql.trim().startsWith("INSERT INTO admin_audit_log"),
    );
    expect(auditInsert).toBeDefined();
    const details = String(auditInsert!.params[3]);
    expect(details).toContain("idp.example.com");
    expect(details).not.toContain(VALID_CONFIG.clientSecret);
  });

  it("consumes the nonce cookie -- it is deleted whether the callback succeeds or fails", async () => {
    userByEmailRow = { id: 5, role: "admin", disabled_at: null };
    await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(cookieState.has("staff_oidc_nonce")).toBe(false);
  });

  it("passes the exact cookie nonce through to verifyStaffOidcIdToken (anti-replay binding)", async () => {
    userByEmailRow = { id: 5, role: "admin", disabled_at: null };
    await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(mockVerifyStaffOidcIdToken).toHaveBeenCalledWith(
      "token",
      VALID_CONFIG,
      VALID_DOC,
      "the-nonce",
    );
  });

  it("redirects to oauth_failed and never signs in when the code exchange throws", async () => {
    userByEmailRow = { id: 5, role: "admin", disabled_at: null };
    mockExchangeStaffOidcCode.mockRejectedValue(
      new Error("token endpoint down"),
    );
    const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(res.headers.get("location")).toContain("oauth_failed");
    expect(
      queries.some((q) => q.sql.trim().startsWith("INSERT INTO sessions")),
    ).toBe(false);
  });

  it("redirects to oauth_failed and never signs in when ID token verification throws", async () => {
    userByEmailRow = { id: 5, role: "admin", disabled_at: null };
    mockVerifyStaffOidcIdToken.mockRejectedValue(
      new Error("signature verification failed"),
    );
    const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
    expect(res.headers.get("location")).toContain("oauth_failed");
    expect(
      queries.some((q) => q.sql.trim().startsWith("INSERT INTO sessions")),
    ).toBe(false);
  });
});
