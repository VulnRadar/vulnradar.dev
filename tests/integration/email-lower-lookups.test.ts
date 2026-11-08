import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import {
  clearSettings,
  createTeam,
  createUser,
  describeIntegration,
  setSettings,
  unique,
} from "./_db";
import {
  makeCookieStore,
  makeHeaderStore,
} from "../app/api/v3/auth/_test-harness";

/**
 * Every route that finds an account by address finds one saved with capitals,
 * against the real schema.
 *
 * Uniqueness on users is enforced on lower(email), and rows stored before
 * writers lowercased can still hold Bob@Example.com. email-case-lookup.test.ts
 * covers getUserByEmail and the staff-invite GET; these cover the routes that
 * ran their own `email = $1`. Such a row could sign in with its password but
 * could not get a reset link, an OAuth or staff SSO sign-in missed it and then
 * hit the index (or made a second account where the index could not be built),
 * a team invite did not see the account, and the account did not see its
 * invites.
 *
 * The unit tier proves which SQL text runs. Whether Postgres finds the row is
 * a claim about the query and the data, so it lives here.
 */

process.env.GOOGLE_CLIENT_ID = "google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";

const { store: cookieStore, state: cookieState } = makeCookieStore();
const { store: headerStore } = makeHeaderStore({ "user-agent": "integration" });
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => headerStore),
}));

let sessionUserId: number | null = null;
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () =>
      sessionUserId === null ? null : { userId: sessionUserId },
  };
});

// A fresh address per request keeps the per-IP buckets from filling up.
let ipCounter = 0;
vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return {
    ...actual,
    getClientIp: async () => {
      ipCounter += 1;
      return `198.51.100.${(ipCounter % 250) + 1}`;
    },
  };
});

const sentTo: string[] = [];
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    sendEmail: async (params: { to: string }) => {
      sentTo.push(params.to);
    },
  };
});

let idpEmail = "";
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
    emailVerified: true,
    name: null,
    sub: "idp-subject",
  }),
}));

// Google's two endpoints, the only network this suite would otherwise reach.
let googleEmail = "";
let googleSub = "";
const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url === "https://oauth2.googleapis.com/token") {
    return new Response(JSON.stringify({ access_token: "fake" }), {
      status: 200,
    });
  }
  if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
    return new Response(
      JSON.stringify({
        sub: googleSub,
        email: googleEmail,
        email_verified: true,
        name: "Legacy Owner",
        picture: "https://example.test/avatar.png",
      }),
      { status: 200 },
    );
  }
  return new Response(null, { status: 404 });
});

const { signOAuthState, OAUTH_NONCE_COOKIE } =
  await import("@/lib/auth/oauth-state");
const { POST: forgotPassword } =
  await import("@/app/api/v3/auth/forgot-password/route");
const { GET: oauthCallback } =
  await import("@/app/api/v3/auth/oauth/[provider]/callback/route");
const { GET: staffOidcCallback } =
  await import("@/app/api/v3/auth/staff-oidc/callback/route");
const { POST: acceptStaffInvite } =
  await import("@/app/api/v3/auth/staff-invite/[token]/route");
const { POST: sendTeamInvite } =
  await import("@/app/api/v3/teams/members/route");
const { GET: listInvitations, DELETE: declineInvitation } =
  await import("@/app/api/v3/teams/invitations/route");

/** A row as it was stored before every writer lowercased the address. */
async function createLegacyUser(
  opts: {
    role?: string;
    authProvider?: string | null;
    verified?: boolean;
  } = {},
) {
  const email = `Legacy-${unique("mixed")}@Example.Test`;
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, role, auth_provider, email_verified_at)
     VALUES ($1, 'not-a-real-hash', $2, $3, CASE WHEN $4::boolean THEN NOW() END)
     RETURNING id`,
    [
      email,
      opts.role ?? "user",
      opts.authProvider ?? null,
      opts.verified ?? true,
    ],
  );
  return { id: rows[0].id, email };
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(sql, params);
  return rows[0].n;
}

const sessionsOf = (userId: number) =>
  count("SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1", [userId]);

const accountsAt = (email: string) =>
  count("SELECT COUNT(*)::int AS n FROM users WHERE LOWER(email) = LOWER($1)", [
    email,
  ]);

function errorOf(res: Response): string | null {
  return new URL(res.headers.get("location")!).searchParams.get("error");
}

function googleCallback(intent: "login" | "signup"): Promise<Response> {
  const nonce = `nonce-${unique("oauth")}`;
  cookieState.set(OAUTH_NONCE_COOKIE, nonce);
  const state = signOAuthState("google", { intent, nonce });
  return oauthCallback(
    new Request(
      `http://localhost/api/v3/auth/oauth/google/callback?code=abc&state=${state}`,
      { headers: { "user-agent": "integration" } },
    ),
    { params: Promise.resolve({ provider: "google" }) },
  );
}

function ssoCallback(): Promise<Response> {
  return staffOidcCallback(
    new Request(
      `http://localhost/api/v3/auth/staff-oidc/callback?code=abc&state=${signOAuthState("staff-oidc")}`,
      { headers: { "user-agent": "integration" } },
    ),
  );
}

/** A staff invite addressed to the lowercased spelling. Returns the raw token. */
async function insertStaffInvite(email: string): Promise<string> {
  const admin = await createUser({ role: "admin" });
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO staff_invites (token, email, role, invited_by, expires_at)
     VALUES ($1, $2, 'support', $3, NOW() + INTERVAL '1 day')`,
    [createHash("sha256").update(token).digest("hex"), email, admin.id],
  );
  return token;
}

function postStaffInvite(token: string, body: unknown): Promise<Response> {
  return acceptStaffInvite(
    new NextRequest(`http://localhost/api/v3/auth/staff-invite/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

/** A team whose owner is signed in and may invite. */
async function signInAsTeamOwner(): Promise<number> {
  const owner = await createUser();
  const teamId = await createTeam(owner.id);
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')",
    [teamId, owner.id],
  );
  sessionUserId = owner.id;
  return teamId;
}

function postTeamInvite(teamId: number, email: string): Promise<Response> {
  return sendTeamInvite(
    new NextRequest("http://localhost/api/v3/teams/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamId, email, role: "viewer" }),
    }),
  );
}

/** A pending invite to `email`, written lowercased as the route writes it. */
async function insertTeamInvite(email: string): Promise<number> {
  const owner = await createUser();
  const teamId = await createTeam(owner.id);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO team_invites (team_id, email, role, invited_by, token, expires_at)
     VALUES ($1, $2, 'viewer', $3, $4, NOW() + INTERVAL '1 day')
     RETURNING id`,
    [
      teamId,
      email.toLowerCase(),
      owner.id,
      createHash("sha256").update(randomBytes(32)).digest("hex"),
    ],
  );
  return rows[0].id;
}

function decline(inviteId: number) {
  return declineInvitation(
    new Request("http://localhost/api/v3/teams/invitations", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inviteId }),
    }),
  );
}

const inviteExists = async (id: number) =>
  (await count("SELECT COUNT(*)::int AS n FROM team_invites WHERE id = $1", [
    id,
  ])) === 1;

async function flushMail() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describeIntegration("every account lookup by address folds case", () => {
  // The seat cap and the teams switch are not what these prove.
  beforeAll(async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await setSettings({ BILLING_ENABLED: false, FEATURE_TEAMS: true });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await clearSettings();
  });

  beforeEach(() => {
    sentTo.length = 0;
    sessionUserId = null;
    cookieState.clear();
    cookieState.set("staff_oidc_nonce", "the-nonce");
    googleSub = `google-${unique("sub")}`;
  });

  it("forgot-password issues a reset and mails the address on file", async () => {
    const legacy = await createLegacyUser();

    const res = await forgotPassword(
      new NextRequest("http://localhost/api/v3/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: legacy.email.toLowerCase() }),
      }),
    );
    await flushMail();

    expect(res.status).toBe(200);
    expect(
      await count(
        `SELECT COUNT(*)::int AS n FROM password_reset_tokens
          WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
        [legacy.id],
      ),
    ).toBe(1);
    expect(sentTo).toEqual([legacy.email]);
  });

  it("OAuth signs in to the existing account and backfills its identity", async () => {
    const legacy = await createLegacyUser({ authProvider: "google" });
    googleEmail = legacy.email.toLowerCase();

    const res = await googleCallback("login");

    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
    expect(await sessionsOf(legacy.id)).toBe(1);
    expect(await accountsAt(legacy.email)).toBe(1);
    const { rows } = await pool.query<{ google_id: string | null }>(
      "SELECT google_id FROM users WHERE id = $1",
      [legacy.id],
    );
    expect(rows[0].google_id).toBe(googleSub);
  });

  it("OAuth signup reports the account instead of failing on the unique index", async () => {
    const legacy = await createLegacyUser({ authProvider: "google" });
    googleEmail = legacy.email.toLowerCase();

    const res = await googleCallback("signup");

    expect(errorOf(res)).toBe("oauth_already_exists");
    expect(await sessionsOf(legacy.id)).toBe(0);
    expect(await accountsAt(legacy.email)).toBe(1);
  });

  it("OAuth still will not open a password account or an unverified one", async () => {
    const password = await createLegacyUser();
    googleEmail = password.email.toLowerCase();
    expect(errorOf(await googleCallback("login"))).toBe("oauth_email_in_use");
    expect(await sessionsOf(password.id)).toBe(0);

    const unverified = await createLegacyUser({
      authProvider: "google",
      verified: false,
    });
    googleEmail = unverified.email.toLowerCase();
    expect(errorOf(await googleCallback("login"))).toBe("oauth_email_in_use");
    expect(await sessionsOf(unverified.id)).toBe(0);
  });

  it("staff SSO signs in to the existing staff account", async () => {
    const legacy = await createLegacyUser({ role: "admin" });
    idpEmail = legacy.email.toLowerCase();

    const res = await ssoCallback();

    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin");
    expect(await sessionsOf(legacy.id)).toBe(1);
    expect(await accountsAt(legacy.email)).toBe(1);
  });

  it("staff SSO still refuses a matching row that never verified the address", async () => {
    const legacy = await createLegacyUser({ role: "admin", verified: false });
    idpEmail = legacy.email.toLowerCase();

    const res = await ssoCallback();

    expect(errorOf(res)).toBe("oauth_no_account");
    expect(await sessionsOf(legacy.id)).toBe(0);
  });

  it("the staff-invite POST promotes the existing account without a password", async () => {
    const legacy = await createLegacyUser();
    const token = await insertStaffInvite(legacy.email.toLowerCase());

    const res = await postStaffInvite(token, {});

    expect(res.status).toBe(200);
    expect((await res.json()).createdAccount).toBe(false);
    const { rows } = await pool.query<{ role: string }>(
      "SELECT role FROM users WHERE id = $1",
      [legacy.id],
    );
    expect(rows[0].role).toBe("support");
    expect(await accountsAt(legacy.email)).toBe(1);
  });

  it("the staff-invite POST still refuses a matching row that never verified the address", async () => {
    const legacy = await createLegacyUser({ verified: false });
    const token = await insertStaffInvite(legacy.email.toLowerCase());

    const res = await postStaffInvite(token, {});

    expect(res.status).toBe(400);
    const { rows } = await pool.query<{ role: string }>(
      "SELECT role FROM users WHERE id = $1",
      [legacy.id],
    );
    expect(rows[0].role).toBe("user");
  });

  it("a team invite finds the account and rings its bell", async () => {
    const teamId = await signInAsTeamOwner();
    const legacy = await createLegacyUser();

    const res = await postTeamInvite(teamId, legacy.email.toLowerCase());

    expect(res.status).toBe(200);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM team_invites WHERE team_id = $1 AND email = $2",
        [teamId, legacy.email.toLowerCase()],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT COUNT(*)::int AS n FROM user_notifications
          WHERE user_id = $1 AND type = 'team_invite'`,
        [legacy.id],
      ),
    ).toBe(1);
  });

  it("a team invite sees that the account is already a member", async () => {
    const teamId = await signInAsTeamOwner();
    const legacy = await createLegacyUser();
    await pool.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'viewer')",
      [teamId, legacy.id],
    );

    const res = await postTeamInvite(teamId, legacy.email.toLowerCase());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already a team member/i);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM team_invites WHERE team_id = $1",
        [teamId],
      ),
    ).toBe(0);
  });

  it("the account sees the team invites sent to its address and can decline one", async () => {
    const legacy = await createLegacyUser();
    const inviteId = await insertTeamInvite(legacy.email);
    sessionUserId = legacy.id;

    const listed = await (await listInvitations()).json();
    expect(listed.invitations.map((i: { id: number }) => i.id)).toEqual([
      inviteId,
    ]);

    const res = await decline(inviteId);

    expect(res.status).toBe(200);
    expect(await inviteExists(inviteId)).toBe(false);
  });

  it("the invitations route still ignores another address and an unverified account", async () => {
    const legacy = await createLegacyUser();
    const someoneElses = await insertTeamInvite(
      `${unique("other")}@example.test`,
    );
    sessionUserId = legacy.id;

    expect((await (await listInvitations()).json()).invitations).toEqual([]);
    expect((await decline(someoneElses)).status).toBe(404);
    expect(await inviteExists(someoneElses)).toBe(true);

    const unverified = await createLegacyUser({ verified: false });
    const claimed = await insertTeamInvite(unverified.email);
    sessionUserId = unverified.id;

    expect((await (await listInvitations()).json()).invitations).toEqual([]);
    expect((await decline(claimed)).status).toBe(403);
    expect(await inviteExists(claimed)).toBe(true);
  });
});
