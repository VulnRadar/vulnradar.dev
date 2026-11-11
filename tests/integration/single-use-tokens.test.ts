import { it, expect, vi, beforeEach } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createTeam, createUser } from "./_db";
import { computeTotpCode } from "../app/api/v3/auth/_test-harness";

/**
 * Every single-use credential, raced against the real database (tests-5).
 *
 * The unit tier proves each of these only as SQL text against a faked pool,
 * and a faked pool answers a lost race exactly as it answers a won one. What
 * keeps a reset link, a verification link, a TOTP step, a backup code, an
 * emailed code or an invite single-use is a row lock, a conditional UPDATE or
 * a DELETE ... RETURNING, and only Postgres can say whether two concurrent
 * callers really get one success between them.
 *
 * The handlers belong to other areas; this suite only calls them.
 */

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === "user-agent" ? "integration" : null,
  }),
}));

// A fresh address per request keeps per-IP buckets from deciding a race.
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
    getUserAgent: async () => "integration",
  };
});

vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    isEmailConfigured: () => true,
    sendEmail: async () => {},
  };
});

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => undefined),
}));

const { issueResetLinkToken } = await import("@/lib/auth/password-reset-token");
const { hashAuthToken } = await import("@/lib/auth/token-hash");
const { hashPassword } = await import("@/lib/auth/password-hash");
const { signPendingToken } = await import("@/lib/auth/pending-2fa");
const { generateSecret } = await import("@/lib/auth/totp");
const { encryptApiKey } = await import("@/lib/auth/crypto");
const { createSession } = await import("@/lib/auth");
const { issueEmailCode } = await import("@/lib/auth/email-codes");
const { AUTH_2FA_PENDING_COOKIE } = await import("@/lib/config/constants");
const { POST: resetPassword } =
  await import("@/app/api/v3/auth/reset-password/route");
const { POST: verifyEmail } =
  await import("@/app/api/v3/auth/verify-email/route");
const { POST: verifyTwoFactor } =
  await import("@/app/api/v3/auth/2fa/verify/route");
const { POST: acceptStaffInvite } =
  await import("@/app/api/v3/auth/staff-invite/[token]/route");
const { POST: acceptTeamInvite } =
  await import("@/app/api/v3/teams/accept-invite/route");

const NEW_PASSWORD = "Kestrel-Vellum-Orbit-73%";

beforeEach(() => {
  cookieJar.clear();
});

function json(url: string, body: unknown, cookie?: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Two at once. Sorted, so the assertion reads as "one of each". */
async function race(run: () => Promise<Response>): Promise<number[]> {
  const results = await Promise.all([run(), run()]);
  return results.map((r) => r.status).sort();
}

function pendingCookie(userId: number) {
  return `${AUTH_2FA_PENDING_COOKIE}=${signPendingToken({ userId, ts: Date.now() })}`;
}

async function verifiedUser() {
  const user = await createUser();
  await pool.query("UPDATE users SET email_verified_at = NOW() WHERE id = $1", [
    user.id,
  ]);
  return user;
}

describeIntegration("single-use credentials under a concurrent replay", () => {
  it("a password reset link sets the password once", async () => {
    const user = await createUser();
    const token = await issueResetLinkToken(user.id);

    const statuses = await race(() =>
      resetPassword(
        json("http://localhost/api/v3/auth/reset-password", {
          token,
          password: NEW_PASSWORD,
        }),
      ),
    );

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.every((s) => s === 200 || s === 400)).toBe(true);
  }, 60_000);

  it("a verification link verifies once", async () => {
    const user = await createUser();
    const token = randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, email)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour', $3)`,
      [user.id, hashAuthToken(token), user.email.toLowerCase()],
    );

    const results = await Promise.all(
      [0, 1].map(() =>
        verifyEmail(
          json("http://localhost/api/v3/auth/verify-email", { token }),
        ).then(async (r) => ({ status: r.status, body: await r.json() })),
      ),
    );

    expect(results.filter((r) => r.body.verified === true)).toHaveLength(1);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  }, 30_000);

  it("a TOTP step is accepted once when totp_last_counter is already set", async () => {
    const user = await createUser();
    const secret = generateSecret();
    const step = Math.floor(Date.now() / 1000 / 30);
    await pool.query(
      `UPDATE users SET totp_enabled = true, two_factor_method = 'app',
         totp_secret = $1, totp_last_counter = $2
       WHERE id = $3`,
      [encryptApiKey(secret), String(step - 5), user.id],
    );
    const code = computeTotpCode(secret);

    const statuses = await race(() =>
      verifyTwoFactor(
        json(
          "http://localhost/api/v3/auth/2fa/verify",
          { code },
          pendingCookie(user.id),
        ),
      ),
    );

    expect(statuses).toEqual([200, 400]);
    const { rows } = await pool.query<{ totp_last_counter: string }>(
      "SELECT totp_last_counter FROM users WHERE id = $1",
      [user.id],
    );
    expect(BigInt(rows[0].totp_last_counter)).toBeGreaterThan(BigInt(step - 5));
  }, 30_000);

  it("a backup code is consumed once", async () => {
    const user = await createUser();
    const plain = "MMMMMNNNNNOOOOOPPPPP";
    await pool.query(
      `UPDATE users SET totp_enabled = true, two_factor_method = 'app',
         totp_secret = 'unused-for-backup-codes', backup_codes = $1
       WHERE id = $2`,
      [JSON.stringify([await hashPassword(plain)]), user.id],
    );

    const statuses = await race(() =>
      verifyTwoFactor(
        json(
          "http://localhost/api/v3/auth/2fa/verify",
          { backupCode: plain },
          pendingCookie(user.id),
        ),
      ),
    );

    expect(statuses).toEqual([200, 400]);
    const { rows } = await pool.query<{ backup_codes: string }>(
      "SELECT backup_codes FROM users WHERE id = $1",
      [user.id],
    );
    expect(JSON.parse(rows[0].backup_codes)).toEqual([]);
  }, 60_000);

  it("an emailed sign-in code is consumed once", async () => {
    const user = await createUser();
    await pool.query(
      "UPDATE users SET totp_enabled = true, two_factor_method = 'email' WHERE id = $1",
      [user.id],
    );
    const issued = await issueEmailCode(user.id, "login", 10, 0);
    if (!issued.ok) throw new Error("code not issued");

    const statuses = await race(() =>
      verifyTwoFactor(
        json(
          "http://localhost/api/v3/auth/2fa/verify",
          { code: issued.code },
          pendingCookie(user.id),
        ),
      ),
    );

    expect(statuses).toEqual([200, 400]);
  }, 30_000);

  // The purpose column (text NOT NULL DEFAULT 'login') is what keeps a
  // step-up code mailed to a signed-in account from finishing a sign-in.
  it("a step-up code never finishes a sign-in, and is still there for the step-up", async () => {
    const user = await createUser();
    await pool.query(
      "UPDATE users SET totp_enabled = true, two_factor_method = 'email' WHERE id = $1",
      [user.id],
    );
    const issued = await issueEmailCode(user.id, "reauth", 10, 0);
    if (!issued.ok) throw new Error("code not issued");

    const signIn = await verifyTwoFactor(
      json(
        "http://localhost/api/v3/auth/2fa/verify",
        { code: issued.code },
        pendingCookie(user.id),
      ),
    );
    expect(signIn.status).toBe(400);

    await createSession(user.id, "198.51.100.1", "integration");
    const sessionCookie = [...cookieJar.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    const statuses = await race(() =>
      verifyTwoFactor(
        json(
          "http://localhost/api/v3/auth/2fa/verify",
          { purpose: "reauth", code: issued.code },
          sessionCookie,
        ),
      ),
    );
    expect(statuses).toEqual([200, 400]);
  }, 30_000);

  it("a staff invite is accepted once", async () => {
    const invitee = await verifiedUser();
    const admin = await createUser({ role: "admin" });
    const token = randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO staff_invites (token, email, role, invited_by, expires_at)
       VALUES ($1, $2, 'support', $3, NOW() + INTERVAL '1 day')`,
      [
        createHash("sha256").update(token).digest("hex"),
        invitee.email,
        admin.id,
      ],
    );

    const statuses = await race(() =>
      acceptStaffInvite(
        new NextRequest(`http://localhost/api/v3/auth/staff-invite/${token}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        { params: Promise.resolve({ token }) },
      ),
    );

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.every((s) => s < 500)).toBe(true);
  }, 30_000);

  it("a team invite is accepted once", async () => {
    const owner = await createUser();
    const teamId = await createTeam(owner.id);
    const invitee = await verifiedUser();
    const token = randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO team_invites (team_id, email, role, token, invited_by, expires_at)
       VALUES ($1, $2, 'viewer', $3, $4, NOW() + INTERVAL '1 day')`,
      [
        teamId,
        invitee.email,
        createHash("sha256").update(token).digest("hex"),
        owner.id,
      ],
    );
    await createSession(invitee.id, "198.51.100.2", "integration");

    const statuses = await race(() =>
      acceptTeamInvite(
        new Request("http://localhost/api/v3/teams/accept-invite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        }),
      ),
    );

    expect(statuses).toEqual([200, 400]);
    const { rows } = await pool.query(
      "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2",
      [teamId, invitee.id],
    );
    expect(rows).toHaveLength(1);
  }, 30_000);
});
