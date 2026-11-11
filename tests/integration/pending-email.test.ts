import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import {
  describeIntegration,
  createUser,
  unique,
  setSettings,
  clearSettings,
} from "./_db";

/**
 * A profile email change waits in users.pending_email until the link mailed to
 * the new address is opened, against the real schema.
 *
 * Before this the change landed at once: users.email moved to whatever was
 * typed and email_verified_at went NULL. Every scan alert, team invite and
 * password reset followed the unproved address, so a typo stranded the owner
 * and somebody else's address could be claimed and sat on. The unit tier
 * proves which statements run; these prove what Postgres keeps: the address
 * the worker mails, the swap in verify-email, and what happens when another
 * account takes the pending address first (the unique index on LOWER(email)).
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

const sentMail: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    isEmailConfigured: () => true,
    sendEmail: async (params: {
      to: string;
      subject?: string;
      text?: string;
    }) => {
      sentMail.push({
        to: params.to,
        subject: params.subject ?? "",
        text: params.text ?? "",
      });
    },
  };
});

const { createSession } = await import("@/lib/auth");
const { hashPassword } = await import("@/lib/auth/password-hash");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { POST: verifyEmail } =
  await import("@/app/api/v3/auth/verify-email/route");
const { PATCH: updateProfile } = await import("@/app/api/v3/auth/update/route");
const { POST: signup } = await import("@/app/api/v3/auth/signup/route");
const { processSchedule } =
  await import("@/lib/scanner/scheduled-scans-worker");

const PASSWORD = "Kestrel-Vellum-Orbit-73%";
let passwordHash: string;

beforeEach(async () => {
  sentMail.length = 0;
  cookieJar.clear();
  passwordHash ??= await hashPassword(PASSWORD);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await clearSettings();
});

async function flushMail() {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function lastLinkTo(to: string): string {
  const hits = sentMail
    .filter((m) => m.to === to.toLowerCase())
    .map((m) => /\/verify-email\?token=([0-9a-f]{64})/.exec(m.text)?.[1])
    .filter((t): t is string => Boolean(t));
  expect(hits.length).toBeGreaterThan(0);
  return hits[hits.length - 1];
}

/** A verified password account with a live session in the cookie jar. */
async function signedInAccount() {
  const user = await createUser();
  await pool.query(
    "UPDATE users SET password_hash = $1, email_verified_at = NOW() WHERE id = $2",
    [passwordHash, user.id],
  );
  cookieJar.clear();
  await createSession(user.id, "198.51.100.1", "integration");
  expect(cookieJar.get(AUTH_SESSION_COOKIE_NAME)).toBeTruthy();
  return user;
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

function clickLink(token: string) {
  return verifyEmail(
    new NextRequest("http://localhost/api/v3/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }),
  );
}

async function accountState(userId: number) {
  const { rows } = await pool.query<{
    email: string;
    pending_email: string | null;
    verified: boolean;
  }>(
    `SELECT email, pending_email, email_verified_at IS NOT NULL AS verified
       FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0];
}

describeIntegration("a profile email change waits for its link", () => {
  it("keeps the account on its address, verified, with the new one pending", async () => {
    const user = await signedInAccount();
    const next = `${unique("moved")}@example.test`;

    const res = await changeEmail(next);
    expect(res.status).toBe(200);
    expect((await res.json()).pendingEmail).toBe(next);

    expect(await accountState(user.id)).toEqual({
      email: user.email,
      pending_email: next,
      verified: true,
    });
  });

  // bug-messaging-3: the worker reads users.email, so a change that landed at
  // once sent the next schedule mail to the unproved address (or, with the
  // flag cleared, nowhere at all).
  it("leaves the schedule worker mailing the old address", async () => {
    await setSettings({ FEATURE_EMAIL_NOTIFICATIONS: true });
    const user = await signedInAccount();
    const next = `${unique("moved")}@example.test`;
    expect((await changeEmail(next)).status).toBe(200);
    await flushMail();
    sentMail.length = 0;

    // A private target is refused at run time, which deactivates the schedule
    // and mails its owner without starting a scan.
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO scheduled_scans (user_id, url, frequency, next_run_at)
       VALUES ($1, 'http://127.0.0.1/', 'weekly', NOW())
       RETURNING id`,
      [user.id],
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await processSchedule({
      id: rows[0].id,
      user_id: user.id,
      url: "http://127.0.0.1/",
      frequency: "weekly",
      preferred_hour_utc: 0,
      preferred_day_of_week: 0,
      preferred_day_of_month: 1,
      team_id: null,
    });
    logged.mockRestore();
    await flushMail();

    expect(outcome.outcome).toBe("blocked");
    const recipients = sentMail.map((m) => m.to);
    expect(recipients).toContain(user.email.toLowerCase());
    expect(recipients).not.toContain(next);
  });

  it("swaps the address in, verified, when the link is opened", async () => {
    const user = await signedInAccount();
    const next = `${unique("moved")}@example.test`;
    expect((await changeEmail(next)).status).toBe(200);
    await flushMail();
    const token = lastLinkTo(next);
    sentMail.length = 0;

    const res = await clickLink(token);
    expect(res.status).toBe(200);
    expect((await res.json()).emailChanged).toBe(true);

    expect(await accountState(user.id)).toEqual({
      email: next,
      pending_email: null,
      verified: true,
    });
    await flushMail();
    // The notice goes to the address the account just left.
    expect(
      sentMail.some(
        (m) =>
          m.to === user.email.toLowerCase() &&
          /email was changed/i.test(m.subject),
      ),
    ).toBe(true);
  });

  it("does not reserve the address: a signup can take it and the pending value is dropped", async () => {
    const user = await signedInAccount();
    const next = `${unique("contested")}@example.test`;
    expect((await changeEmail(next)).status).toBe(200);
    await flushMail();
    const token = lastLinkTo(next);

    const created = await signup(
      new NextRequest("http://localhost/api/v3/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Rowan Ellis",
          email: next,
          password: PASSWORD,
        }),
      }),
    );
    expect(created.status).toBe(200);

    const res = await clickLink(token);
    expect(res.status).toBe(409);
    expect(await accountState(user.id)).toEqual({
      email: user.email,
      pending_email: null,
      verified: true,
    });
    const { rows } = await pool.query(
      "SELECT id FROM email_verification_tokens WHERE user_id = $1",
      [user.id],
    );
    expect(rows).toHaveLength(0);
  });

  it("a second change replaces the first, and the first link stops working", async () => {
    const user = await signedInAccount();
    const first = `${unique("first")}@example.test`;
    const second = `${unique("second")}@example.test`;
    expect((await changeEmail(first)).status).toBe(200);
    await flushMail();
    const firstToken = lastLinkTo(first);
    expect((await changeEmail(second)).status).toBe(200);

    expect((await clickLink(firstToken)).status).toBe(400);
    expect(await accountState(user.id)).toEqual({
      email: user.email,
      pending_email: second,
      verified: true,
    });
  });

  it("sending the account's own address back withdraws the change, and its link stops working", async () => {
    const user = await signedInAccount();
    const typo = `${unique("typo")}@example.test`;
    expect((await changeEmail(typo)).status).toBe(200);
    await flushMail();
    const token = lastLinkTo(typo);

    expect((await changeEmail(user.email.toUpperCase())).status).toBe(200);
    expect(await accountState(user.id)).toEqual({
      email: user.email,
      pending_email: null,
      verified: true,
    });

    expect((await clickLink(token)).status).toBe(400);
    expect(await accountState(user.id)).toEqual({
      email: user.email,
      pending_email: null,
      verified: true,
    });
  });
});
