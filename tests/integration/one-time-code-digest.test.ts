import { it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser } from "./_db";

/**
 * enc-13 against the real schema: what an emailed six-digit code leaves in
 * the database, and that the billing code is still used exactly once now
 * that it is compared in Node and consumed by a DELETE ... RETURNING.
 *
 * The unit tier checks the INSERT parameters against a faked pool; only
 * Postgres can say what the row really holds and whether two concurrent
 * verifies get one success between them.
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

const mailed: { text: string }[] = [];
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    isEmailConfigured: () => true,
    sendEmail: async (message: { text: string }) => {
      mailed.push(message);
    },
  };
});

// The verify route needs a Stripe client to exist before it reads the code;
// the test account has no subscription, so it never calls one.
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ subscriptions: { retrieve: vi.fn() } }),
}));

const { issueEmailCode } = await import("@/lib/auth/email-codes");
const { hashOneTimeCode } = await import("@/lib/auth/one-time-code");
const { createSession } = await import("@/lib/auth");
const { POST: sendBillingCode } =
  await import("@/app/api/v3/billing/verify/send/route");
const { POST: verifyBillingCode } =
  await import("@/app/api/v3/billing/verify/route");

beforeEach(() => {
  cookieJar.clear();
  mailed.length = 0;
});

function billingVerify(code: string) {
  return verifyBillingCode(
    new NextRequest("http://localhost/api/v3/billing/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  );
}

describeIntegration("emailed one-time codes", () => {
  it("an email two-factor code is stored as the keyed digest, not sha256 of salt and code", async () => {
    const user = await createUser();
    const issued = await issueEmailCode(user.id, "login", 10, 0);
    if (!issued.ok) throw new Error("code not issued");

    const { rows } = await pool.query<{ code_hash: string; code_salt: string }>(
      "SELECT code_hash, code_salt FROM email_2fa_codes WHERE user_id = $1",
      [user.id],
    );

    expect(rows).toHaveLength(1);
    const [{ code_hash, code_salt }] = rows;
    expect(code_hash).toBe(hashOneTimeCode(code_salt, issued.code));
    expect(code_hash).not.toBe(
      createHash("sha256").update(`${code_salt}:${issued.code}`).digest("hex"),
    );
  });

  it("a billing code is stored keyed, verifies once, and two at once get one success", async () => {
    const user = await createUser();
    await createSession(user.id, "198.51.100.7", "integration");

    const sent = await sendBillingCode(
      new NextRequest("http://localhost/api/v3/billing/verify/send", {
        method: "POST",
      }),
    );
    expect(sent.status).toBe(200);
    const code = /\b(\d{6})\b/.exec(mailed[0]!.text)![1];

    const { rows } = await pool.query<{ code_hash: string; salt: string }>(
      "SELECT code_hash, salt FROM billing_verification_codes WHERE user_id = $1",
      [user.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).toBe(hashOneTimeCode(rows[0].salt, code));
    expect(rows[0].code_hash).not.toBe(
      createHash("sha256").update(`${rows[0].salt}${code}`).digest("hex"),
    );

    // No subscription on the account, so a code that verifies answers 404
    // and one that does not answers 400.
    const statuses = (
      await Promise.all([billingVerify(code), billingVerify(code)])
    )
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([400, 404]);

    const left = await pool.query(
      "SELECT 1 FROM billing_verification_codes WHERE user_id = $1",
      [user.id],
    );
    expect(left.rows).toHaveLength(0);
  }, 30_000);
});
