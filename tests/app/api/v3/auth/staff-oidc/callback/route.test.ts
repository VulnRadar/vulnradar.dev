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

// email_verified_at is optional here and filled in as verified by the mock
// below, so every fixture that is not about it reads as the ordinary staff
// account it always was.
let userByEmailRow:
  | {
      id: number;
      role: string | null;
      disabled_at: string | null;
      email_verified_at?: string | null;
    }
  | undefined;
const VERIFIED_AT = "2026-01-01T00:00:00.000Z";
let securityAlertInsertFails = false;
const queries: { sql: string; params: unknown[] }[] = [];
const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.trim();
  if (s.startsWith("SELECT id, role, disabled_at")) {
    return {
      rows: userByEmailRow
        ? [{ email_verified_at: VERIFIED_AT, ...userByEmailRow }]
        : [],
    };
  }
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO security_alerts")) {
    if (securityAlertInsertFails) throw new Error("db unavailable");
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
  securityAlertInsertFails = false;
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

  // The provider's own word on the address. verifyStaffOidcIdToken decides
  // what counts as verified (tests/lib/auth/staff-oidc.test.ts has the claim
  // matrix); this is what the route does with a "no".
  describe("an address the provider does not vouch for", () => {
    beforeEach(() => {
      mockVerifyStaffOidcIdToken.mockResolvedValue({
        email: "admin@example.com",
        emailVerified: false,
        name: "Admin",
        sub: "idp-1",
      });
    });

    function securityAlertInserts() {
      return queries.filter((q) =>
        q.sql.trim().startsWith("INSERT INTO security_alerts"),
      );
    }

    it("is refused without a session", async () => {
      userByEmailRow = { id: 5, role: "admin", disabled_at: null };
      const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
      expect(res.headers.get("location")).toBe(
        "https://vulnradar.dev/login?error=oauth_email_unverified",
      );
      expect(
        queries.some((q) => q.sql.trim().startsWith("INSERT INTO sessions")),
      ).toBe(false);
      expect(
        queries.some((q) =>
          q.sql.trim().startsWith("INSERT INTO admin_audit_log"),
        ),
      ).toBe(false);
    });

    // Someone at the provider holding a staff member's address without having
    // proved it is the case this refusal exists for, and an admin should hear
    // about it the same way as a staff row that never verified its address.
    it("files the staff_sso_unverified_email alert against the staff account it matched", async () => {
      userByEmailRow = { id: 5, role: "support", disabled_at: null };
      await GET(makeRequest(`?code=abc&state=${validState()}`));

      const inserts = securityAlertInserts();
      expect(inserts).toHaveLength(1);
      const params = inserts[0]!.params;
      expect(params[0]).toBe(5);
      expect(params[1]).toBe("staff_sso_unverified_email");
      expect(JSON.parse(String(params[3]))).toEqual({
        issuer: "idp.example.com",
        reason: "provider_unverified",
      });
      expect(JSON.stringify(params)).not.toContain("203.0.113.5");
      expect(inserts[0]!.sql).toContain("NOT EXISTS");
    });

    it.each([
      ["no account holds the address", undefined],
      ["the account is not staff", { id: 6, role: "user", disabled_at: null }],
    ])(
      "gives the same answer and files nothing when %s",
      async (_label, row) => {
        userByEmailRow = row;
        const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
        expect(res.headers.get("location")).toBe(
          "https://vulnradar.dev/login?error=oauth_email_unverified",
        );
        expect(securityAlertInserts()).toHaveLength(0);
      },
    );

    it("still refuses, with the same answer, when the alert cannot be written", async () => {
      userByEmailRow = { id: 5, role: "admin", disabled_at: null };
      securityAlertInsertFails = true;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
        expect(res.headers.get("location")).toBe(
          "https://vulnradar.dev/login?error=oauth_email_unverified",
        );
      } finally {
        errorSpy.mockRestore();
      }
      expect(
        queries.some((q) => q.sql.trim().startsWith("INSERT INTO sessions")),
      ).toBe(false);
    });
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

  // An email match only says the row CLAIMS the address. PATCH
  // /api/v3/auth/update lets any account move to an unclaimed address and
  // only clears email_verified_at, so a staff row holding an unverified
  // address may belong to someone other than the IdP user who proved it.
  describe("a staff account whose address was never verified", () => {
    function securityAlertInserts() {
      return queries.filter((q) =>
        q.sql.trim().startsWith("INSERT INTO security_alerts"),
      );
    }

    it("is not signed into, and the refusal looks like any other", async () => {
      userByEmailRow = {
        id: 5,
        role: "admin",
        disabled_at: null,
        email_verified_at: null,
      };
      const res = await GET(makeRequest(`?code=abc&state=${validState()}`));

      // The same code as "no account" and "not staff", so the refusal does
      // not tell an IdP user which addresses belong to staff here.
      expect(res.headers.get("location")).toBe(
        "https://vulnradar.dev/login?error=oauth_no_account",
      );
      expect(
        queries.some((q) => q.sql.trim().startsWith("INSERT INTO sessions")),
      ).toBe(false);
      expect(
        queries.some((q) =>
          q.sql.trim().startsWith("INSERT INTO admin_audit_log"),
        ),
      ).toBe(false);
      expect(queries.some((q) => q.sql.trim().startsWith("UPDATE users"))).toBe(
        false,
      );
    });

    it("files a security alert against the account, without the requester's IP", async () => {
      userByEmailRow = {
        id: 5,
        role: "support",
        disabled_at: null,
        email_verified_at: null,
      };
      await GET(makeRequest(`?code=abc&state=${validState()}`));

      const inserts = securityAlertInserts();
      expect(inserts).toHaveLength(1);
      const params = inserts[0]!.params;
      expect(params[0]).toBe(5);
      expect(params[1]).toBe("staff_sso_unverified_email");
      expect(JSON.stringify(params)).not.toContain("203.0.113.5");
      expect(JSON.parse(String(params[3]))).toEqual({
        issuer: "idp.example.com",
      });
      // One open alert per account: a repeated attempt must not stack rows.
      expect(inserts[0]!.sql).toContain("NOT EXISTS");
    });

    it("refuses before the disabled check, so an unproven claim learns nothing about the row", async () => {
      userByEmailRow = {
        id: 5,
        role: "admin",
        disabled_at: "2026-01-01",
        email_verified_at: null,
      };
      const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
      expect(res.headers.get("location")).toContain("oauth_no_account");
    });

    it("files no alert for an unverified account that is not staff", async () => {
      userByEmailRow = {
        id: 5,
        role: "user",
        disabled_at: null,
        email_verified_at: null,
      };
      const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
      expect(res.headers.get("location")).toContain("oauth_no_account");
      expect(securityAlertInserts()).toHaveLength(0);
    });

    it("still refuses, with the same answer, when the alert cannot be written", async () => {
      userByEmailRow = {
        id: 5,
        role: "admin",
        disabled_at: null,
        email_verified_at: null,
      };
      securityAlertInsertFails = true;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const res = await GET(makeRequest(`?code=abc&state=${validState()}`));
        expect(res.headers.get("location")).toBe(
          "https://vulnradar.dev/login?error=oauth_no_account",
        );
      } finally {
        errorSpy.mockRestore();
      }
      expect(
        queries.some((q) => q.sql.trim().startsWith("INSERT INTO sessions")),
      ).toBe(false);
    });
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
