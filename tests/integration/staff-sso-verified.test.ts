import { it, expect, vi, beforeEach } from "vitest";
import pool from "@/lib/database/db";
import { describeIntegration, createUser } from "./_db";
import {
  makeCookieStore,
  makeHeaderStore,
} from "../app/api/v3/auth/_test-harness";

/**
 * Staff SSO sign-in against the real schema.
 *
 * The unit tier proves which statements run; these prove what they do. A
 * staff row that never verified its address must get no session, and the
 * alert's NOT EXISTS has to keep a retried sign-in from filing a row per
 * attempt, which is a claim about the casts on an INSERT ... SELECT that a
 * faked pool cannot make.
 *
 * Only the IdP half is faked (discovery, code exchange, ID token checks have
 * their own real-crypto suite in tests/lib/auth/staff-oidc.test.ts), plus the
 * cookie jar the route reads its nonce from.
 */

const { store: cookieStore, state: cookieState } = makeCookieStore();
const { store: headerStore } = makeHeaderStore({ "user-agent": "integration" });
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => headerStore),
}));

vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return { ...actual, getClientIp: async () => "203.0.113.9" };
});

let idpEmail = "";
let idpEmailVerified = true;
vi.mock("@/lib/auth/staff-oidc", () => ({
  getStaffOidcConfig: async () => ({
    issuerUrl: "https://idp.example.test",
    clientId: "id",
    clientSecret: "secret",
  }),
  getDiscoveryDocument: async () => ({
    issuer: "https://idp.example.test",
    authorization_endpoint: "https://idp.example.test/authorize",
    token_endpoint: "https://idp.example.test/token",
    jwks_uri: "https://idp.example.test/jwks",
  }),
  exchangeStaffOidcCode: async () => ({ idToken: "token" }),
  verifyStaffOidcIdToken: async () => ({
    email: idpEmail,
    emailVerified: idpEmailVerified,
    name: null,
    sub: "idp-subject",
  }),
}));

const { GET } = await import("@/app/api/v3/auth/staff-oidc/callback/route");
const { signOAuthState } = await import("@/lib/auth/oauth-state");

beforeEach(() => {
  cookieState.clear();
  cookieState.set("staff_oidc_nonce", "the-nonce");
  idpEmailVerified = true;
});

function callback() {
  return GET(
    new Request(
      `http://localhost/api/v3/auth/staff-oidc/callback?code=abc&state=${signOAuthState("staff-oidc")}`,
      { headers: { "user-agent": "integration" } },
    ),
  );
}

async function sessionCount(userId: number): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1",
    [userId],
  );
  return rows[0].n;
}

async function alertsFor(userId: number) {
  const { rows } = await pool.query<{
    details: { issuer: string; reason?: string };
    ip_address: string | null;
    severity: string;
  }>(
    `SELECT details, host(ip_address) AS ip_address, severity
       FROM security_alerts
      WHERE user_id = $1 AND alert_type = 'staff_sso_unverified_email'`,
    [userId],
  );
  return rows;
}

describeIntegration("staff SSO signs into a verified staff row only", () => {
  it("refuses an unverified staff account: no session, one alert without the requester's IP", async () => {
    const staff = await createUser({ role: "admin" });
    idpEmail = staff.email;

    const res = await callback();

    expect(
      new URL(res.headers.get("location")!).searchParams.get("error"),
    ).toBe("oauth_no_account");
    expect(await sessionCount(staff.id)).toBe(0);
    const alerts = await alertsFor(staff.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].details).toEqual({ issuer: "idp.example.test" });
    expect(alerts[0].ip_address).toBeNull();
    expect(alerts[0].severity).toBe("high");
  });

  it("files one open alert however many times the sign-in is retried", async () => {
    const staff = await createUser({ role: "support" });
    idpEmail = staff.email;

    await callback();
    cookieState.set("staff_oidc_nonce", "the-nonce");
    await callback();

    expect(await alertsFor(staff.id)).toHaveLength(1);
  });

  it("files a fresh alert once the previous one was resolved", async () => {
    const staff = await createUser({ role: "admin" });
    idpEmail = staff.email;

    await callback();
    await pool.query(
      "UPDATE security_alerts SET resolved_at = NOW() WHERE user_id = $1",
      [staff.id],
    );
    cookieState.set("staff_oidc_nonce", "the-nonce");
    await callback();

    expect(await alertsFor(staff.id)).toHaveLength(2);
  });

  it("signs the same account in once it has verified the address", async () => {
    const staff = await createUser({ role: "admin" });
    idpEmail = staff.email;
    await pool.query(
      "UPDATE users SET email_verified_at = NOW() WHERE id = $1",
      [staff.id],
    );

    const res = await callback();

    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin");
    expect(await sessionCount(staff.id)).toBe(1);
    expect(await alertsFor(staff.id)).toHaveLength(0);
  });
});

describeIntegration(
  "staff SSO refuses an address the provider did not vouch for",
  () => {
    it("refuses a verified staff account: no session, one alert naming the reason", async () => {
      const staff = await createUser({ role: "admin" });
      await pool.query(
        "UPDATE users SET email_verified_at = NOW() WHERE id = $1",
        [staff.id],
      );
      idpEmail = staff.email;
      idpEmailVerified = false;

      const res = await callback();
      cookieState.set("staff_oidc_nonce", "the-nonce");
      await callback();

      expect(
        new URL(res.headers.get("location")!).searchParams.get("error"),
      ).toBe("oauth_email_unverified");
      expect(await sessionCount(staff.id)).toBe(0);
      const alerts = await alertsFor(staff.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].details).toEqual({
        issuer: "idp.example.test",
        reason: "provider_unverified",
      });
      expect(alerts[0].ip_address).toBeNull();
    });

    it("shares the one open alert with an account that never verified the address", async () => {
      const staff = await createUser({ role: "support" });
      idpEmail = staff.email;

      await callback();
      idpEmailVerified = false;
      cookieState.set("staff_oidc_nonce", "the-nonce");
      await callback();

      const alerts = await alertsFor(staff.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].details).toEqual({ issuer: "idp.example.test" });
    });
  },
);
