import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * Email verification is bound to the address it was mailed to, against the
 * real schema.
 *
 * OAuth sign-in and staff invites trust users.email_verified_at to say the
 * account holder controls users.email. The attack this closes: sign up as
 * attacker@x, keep the link from attacker@x's inbox, change the account to
 * victim@y, and click the link. Before the binding, the link set
 * email_verified_at on whatever address the row held by then, so the account
 * came out "verified" for an inbox its holder never saw.
 *
 * The unit tier proves which statements run. These prove what Postgres does
 * with them: the address match in the UPDATE, the transaction that changes
 * the address and kills the old links together, and the row locks that order
 * a click and a change racing each other.
 */

const cookieJar = new Map<string, string>();
const headerJar = new Map<string, string>([["user-agent", "integration"]]);

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
    get: (name: string) => headerJar.get(name.toLowerCase()) ?? null,
  }),
}));

// A fresh address per request keeps the per-IP signup and profile buckets from
// carrying over between cases.
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

const sentMail: { to: string; text: string }[] = [];
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    // With no mail transport, createUser marks a signup verified on the spot,
    // and the signup case below would prove nothing about its link.
    isEmailConfigured: () => true,
    sendEmail: async (params: { to: string; text?: string }) => {
      sentMail.push({ to: params.to, text: params.text ?? "" });
    },
  };
});

// Issuing the new link is the real code unless a case makes it fail: the
// change has to leave no old link live even then.
let issueVerificationError: Error | null = null;
vi.mock("@/lib/auth/email-verification", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/email-verification")>();
  return {
    ...actual,
    sendEmailVerification: async (
      ...args: Parameters<typeof actual.sendEmailVerification>
    ) => {
      if (issueVerificationError) throw issueVerificationError;
      return actual.sendEmailVerification(...args);
    },
  };
});

const { sendEmailVerification } = await import("@/lib/auth/email-verification");
const { createSession } = await import("@/lib/auth");
const { hashPassword } = await import("@/lib/auth/password-hash");
const { hashAuthToken } = await import("@/lib/auth/token-hash");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { POST: verifyEmail } =
  await import("@/app/api/v3/auth/verify-email/route");
const { PATCH: updateProfile } = await import("@/app/api/v3/auth/update/route");
const { POST: signup } = await import("@/app/api/v3/auth/signup/route");

const PASSWORD = "Kestrel-Vellum-Orbit-73%";
let passwordHash: string;

beforeEach(async () => {
  sentMail.length = 0;
  cookieJar.clear();
  issueVerificationError = null;
  passwordHash ??= await hashPassword(PASSWORD);
  // Gravatar is probed in the background after a signup; it never leaves CI.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Drain setImmediate callbacks so queued mail has been "sent". */
async function flushMail() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/** The raw token in the newest verification link mailed to `to`. */
function lastLinkTo(to: string): string {
  const hits = sentMail
    .filter((m) => m.to === to.toLowerCase())
    .map((m) => /\/verify-email\?token=([0-9a-f]{64})/.exec(m.text)?.[1])
    .filter((t): t is string => Boolean(t));
  expect(hits.length).toBeGreaterThan(0);
  return hits[hits.length - 1];
}

async function signedInAccount() {
  const user = await createUser();
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
    passwordHash,
    user.id,
  ]);
  cookieJar.clear();
  await createSession(user.id, "198.51.100.1", "integration");
  expect(cookieJar.get(AUTH_SESSION_COOKIE_NAME)).toBeTruthy();
  return user;
}

async function linkFor(user: { id: number; email: string }) {
  await sendEmailVerification(user.id, null, user.email);
  await flushMail();
  return lastLinkTo(user.email);
}

function clickLink(token: string) {
  return verifyEmail(
    new NextRequest("http://localhost/api/v3/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }),
  );
}

function changeEmail(email: string) {
  return updateProfile(
    new NextRequest("http://localhost/api/v3/auth/update", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "user-agent": "integration",
      },
      body: JSON.stringify({ email, currentPassword: PASSWORD }),
    }),
  );
}

async function accountState(userId: number) {
  const { rows } = await pool.query<{
    email: string;
    email_verified_at: Date | null;
  }>("SELECT email, email_verified_at FROM users WHERE id = $1", [userId]);
  return rows[0];
}

describeIntegration("email verification is bound to the mailed address", () => {
  it("records the address on every token it issues", async () => {
    const user = await createUser();
    await sendEmailVerification(user.id, null, user.email.toUpperCase());

    const { rows } = await pool.query<{ email: string | null }>(
      "SELECT email FROM email_verification_tokens WHERE user_id = $1",
      [user.id],
    );
    expect(rows).toEqual([{ email: user.email.toLowerCase() }]);
  });

  // The window the transaction in auth/update now closes, held open by hand:
  // the address has changed and the old link is still in the table. The
  // binding alone has to refuse it.
  it("refuses an old address's link once the account holds another address", async () => {
    const user = await createUser();
    const token = await linkFor(user);
    const victim = `${unique("victim")}@example.test`;
    await pool.query("UPDATE users SET email = $1 WHERE id = $2", [
      victim,
      user.id,
    ]);

    const res = await clickLink(token);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/request a new one/i);
    expect(await accountState(user.id)).toEqual({
      email: victim,
      email_verified_at: null,
    });
  });

  it("refuses a link issued before tokens recorded their address", async () => {
    const user = await createUser();
    const token = randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.id, hashAuthToken(token)],
    );

    const res = await clickLink(token);

    expect(res.status).toBe(400);
    expect((await accountState(user.id)).email_verified_at).toBeNull();
  });

  describe("change the address, then replay the old link", () => {
    it("the old link is gone", async () => {
      const user = await signedInAccount();
      const token = await linkFor(user);
      const victim = `${unique("victim")}@example.test`;

      expect((await changeEmail(victim)).status).toBe(200);
      const res = await clickLink(token);

      expect(res.status).toBe(400);
      expect(await accountState(user.id)).toEqual({
        email: victim,
        email_verified_at: null,
      });
    });

    // Issuing the new link used to be the only thing that deleted the old
    // one, so a failure there left it live with no race needed at all.
    it("the old link is gone even when issuing the new one failed", async () => {
      const user = await signedInAccount();
      const token = await linkFor(user);
      const victim = `${unique("victim")}@example.test`;
      issueVerificationError = new Error("settings unavailable");
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      await changeEmail(victim);
      issueVerificationError = null;
      const res = await clickLink(token);

      expect(res.status).toBe(400);
      expect(await accountState(user.id)).toEqual({
        email: victim,
        email_verified_at: null,
      });
      const { rows } = await pool.query(
        "SELECT id FROM email_verification_tokens WHERE user_id = $1",
        [user.id],
      );
      expect(rows).toHaveLength(0);
      logged.mockRestore();
    });
  });

  it("replay the old link, then change the address: the new address starts unverified", async () => {
    const user = await signedInAccount();
    const token = await linkFor(user);
    const victim = `${unique("victim")}@example.test`;

    // The link is for the address the account holds right now, so it
    // verifies that address, which its holder does control.
    expect((await clickLink(token)).status).toBe(200);
    expect((await changeEmail(victim)).status).toBe(200);

    expect(await accountState(user.id)).toEqual({
      email: victim,
      email_verified_at: null,
    });
  });

  // Both at once, the way the attack fires them. Whichever commits first, the
  // account never ends up verified for the address it was moved to.
  it("never verifies the new address when the click and the change race", async () => {
    for (let round = 0; round < 6; round += 1) {
      const user = await signedInAccount();
      const token = await linkFor(user);
      const victim = `${unique("victim")}@example.test`;

      await Promise.all([changeEmail(victim), clickLink(token)]);

      const state = await accountState(user.id);
      expect(state.email).toBe(victim);
      expect(state.email_verified_at).toBeNull();
    }
  });

  it("still verifies a fresh signup from the link it mails", async () => {
    const email = `${unique("signup")}@example.test`;
    const res = await signup(
      new NextRequest("http://localhost/api/v3/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Rowan Ellis",
          email,
          password: PASSWORD,
        }),
      }),
    );
    expect(res.status).toBe(200);
    await flushMail();

    const verified = await clickLink(lastLinkTo(email));

    expect(verified.status).toBe(200);
    expect((await verified.json()).verified).toBe(true);
    const { rows } = await pool.query<{ email_verified_at: Date | null }>(
      "SELECT email_verified_at FROM users WHERE email = $1",
      [email],
    );
    expect(rows[0].email_verified_at).not.toBeNull();
  });

  it("still verifies the new address from the link the change mails", async () => {
    const user = await signedInAccount();
    const next = `${unique("moved")}@example.test`;

    expect((await changeEmail(next)).status).toBe(200);
    await flushMail();
    const res = await clickLink(lastLinkTo(next));

    expect(res.status).toBe(200);
    expect((await res.json()).verified).toBe(true);
    const state = await accountState(user.id);
    expect(state.email).toBe(next);
    expect(state.email_verified_at).not.toBeNull();
  });
});
