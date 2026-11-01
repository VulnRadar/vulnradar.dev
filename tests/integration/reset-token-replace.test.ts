import { it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser } from "./_db";

/**
 * A password reset never leaves two live links for one account, against the
 * real schema.
 *
 * forgot-password and the admin "send reset link" action both replaced the
 * account's token as DELETE then INSERT, two autocommit statements. Two
 * requests for the same account could run both DELETEs before either INSERT,
 * and each then inserted its own row: two links in the inbox, both able to
 * set the password. Wrapping the pair in a plain transaction does not close
 * it under READ COMMITTED, because when the table holds no row for the
 * account yet, neither DELETE has anything to lock and neither waits.
 *
 * The unit tier proves the statements run in one transaction behind a
 * per-account lock. These prove what Postgres does with that: the second
 * request waits, its DELETE sees the first one's row, and exactly one link
 * survives, which is the one that still resets the password.
 */

const headerJar = new Map<string, string>([["user-agent", "integration"]]);
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => ({
    get: (name: string) => headerJar.get(name.toLowerCase()) ?? null,
  }),
}));

// A fresh address per request keeps the per-IP forgot and reset buckets from
// filling up across the rounds below.
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
    sendEmail: async (params: { to: string; text?: string }) => {
      sentMail.push({ to: params.to, text: params.text ?? "" });
    },
  };
});

const { issuePasswordResetToken } =
  await import("@/lib/auth/password-reset-token");
const { hashAuthToken } = await import("@/lib/auth/token-hash");
const { POST: forgotPassword } =
  await import("@/app/api/v3/auth/forgot-password/route");
const { POST: resetPassword } =
  await import("@/app/api/v3/auth/reset-password/route");

const NEW_PASSWORD = "Kestrel-Vellum-Orbit-73%";

beforeEach(() => {
  sentMail.length = 0;
});

/** Let the queued reset mail "send". */
async function flushMail() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function requestReset(email: string) {
  return forgotPassword(
    new NextRequest("http://localhost/api/v3/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
}

function followResetLink(token: string) {
  return resetPassword(
    new NextRequest("http://localhost/api/v3/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password: NEW_PASSWORD }),
    }),
  );
}

/** Every raw reset token mailed to `to`, oldest first. */
function linksTo(to: string): string[] {
  return sentMail
    .filter((m) => m.to === to)
    .map((m) => /\/reset-password\?token=([0-9a-f]{64})/.exec(m.text)?.[1])
    .filter((t): t is string => Boolean(t));
}

async function liveTokenHashes(userId: number): Promise<string[]> {
  const { rows } = await pool.query<{ token_hash: string }>(
    `SELECT token_hash FROM password_reset_tokens
      WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [userId],
  );
  return rows.map((r) => r.token_hash);
}

describeIntegration("a reset token is replaced atomically", () => {
  it("two concurrent forgot-password requests leave exactly one live link, and it works", async () => {
    for (let round = 0; round < 6; round += 1) {
      sentMail.length = 0;
      const user = await createUser();

      const responses = await Promise.all([
        requestReset(user.email),
        requestReset(user.email),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      await flushMail();

      const mailed = linksTo(user.email);
      expect(mailed).toHaveLength(2);
      const live = await liveTokenHashes(user.id);
      expect(live).toHaveLength(1);

      const survivor = mailed.find((t) => hashAuthToken(t) === live[0]);
      const replaced = mailed.find((t) => hashAuthToken(t) !== live[0]);
      expect(survivor).toBeDefined();
      expect(replaced).toBeDefined();

      expect((await followResetLink(replaced as string)).status).toBe(400);
      expect((await followResetLink(survivor as string)).status).toBe(200);
      const { rows } = await pool.query<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE id = $1",
        [user.id],
      );
      expect(rows[0].password_hash).not.toBe("not-a-real-hash");
    }
  });

  // The admin action goes through the same helper. Many callers at once is
  // the case a plain transaction gets wrong most often.
  it("many concurrent issues for one account leave exactly one live token", async () => {
    const user = await createUser();

    const tokens = await Promise.all(
      Array.from({ length: 8 }, () => issuePasswordResetToken(user.id)),
    );

    const live = await liveTokenHashes(user.id);
    expect(live).toHaveLength(1);
    expect(tokens.map((t) => hashAuthToken(t))).toContain(live[0]);
    const { rows } = await pool.query(
      "SELECT id FROM password_reset_tokens WHERE user_id = $1",
      [user.id],
    );
    expect(rows).toHaveLength(1);
  });

  // The lock is per account: one account's reset never waits on, or
  // replaces, another's.
  it("leaves another account's live token alone", async () => {
    const [a, b] = await Promise.all([createUser(), createUser()]);

    await Promise.all([
      issuePasswordResetToken(a.id),
      issuePasswordResetToken(b.id),
    ]);

    expect(await liveTokenHashes(a.id)).toHaveLength(1);
    expect(await liveTokenHashes(b.id)).toHaveLength(1);
  });

  // A reset in progress and a new request racing it. The consuming route
  // locks the token row and then the user row; the issue must not take those
  // in the opposite order, or the two deadlock and one of them fails.
  it("a new request racing a link being used neither deadlocks nor leaves two live links", async () => {
    for (let round = 0; round < 6; round += 1) {
      const user = await createUser();
      const first = await issuePasswordResetToken(user.id);

      const [used, second] = await Promise.all([
        followResetLink(first),
        issuePasswordResetToken(user.id),
      ]);

      expect([200, 400]).toContain(used.status);
      const live = await liveTokenHashes(user.id);
      expect(live).toEqual([hashAuthToken(second)]);
    }
  });
});
