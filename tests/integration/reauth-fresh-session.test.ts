import { it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import pool from "@/lib/database/db";
import { describeIntegration, createUser } from "./_db";

/**
 * On a server that cannot send mail, an account with no password has no code
 * to step up with, so lib/auth/reauth.ts accepts a session created in the
 * last ten minutes instead: only a fresh provider sign-in makes one. Which
 * session counts is a WHERE clause on `sessions`, and a faked pool answers a
 * wrong one exactly as it answers a right one, so it is proven here.
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
  headers: async () => ({ get: () => null }),
}));

vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    isEmailConfigured: () => false,
    sendEmail: async () => {},
  };
});

const { verifyReauthPassword } = await import("@/lib/auth/reauth");
const { hashSessionId } = await import("@/lib/auth/auth");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");

const MESSAGES = { missing: "Password is required.", wrong: "Wrong." };

beforeEach(() => {
  cookieJar.clear();
});

async function passwordlessUser() {
  const user = await createUser();
  await pool.query("UPDATE users SET password_hash = NULL WHERE id = $1", [
    user.id,
  ]);
  return user;
}

/** A sessions row for this user, carried by the cookie jar. */
async function session(
  userId: number,
  opts: { ageSeconds?: number; impersonatedBy?: number } = {},
) {
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at, created_at, impersonated_by)
     VALUES ($1, $2, NOW() + INTERVAL '1 day',
             NOW() - ($3 * INTERVAL '1 second'), $4)`,
    [
      hashSessionId(token),
      userId,
      opts.ageSeconds ?? 0,
      opts.impersonatedBy ?? null,
    ],
  );
  cookieJar.set(AUTH_SESSION_COOKIE_NAME, token);
}

describeIntegration(
  "the fresh-sign-in step-up on a server without mail",
  () => {
    it("passes a session created a moment ago", async () => {
      const user = await passwordlessUser();
      await session(user.id);
      expect(await verifyReauthPassword(user.id, undefined, MESSAGES)).toEqual({
        ok: true,
      });
    });

    it("refuses a session older than ten minutes", async () => {
      const user = await passwordlessUser();
      await session(user.id, { ageSeconds: 11 * 60 });
      expect(
        await verifyReauthPassword(user.id, undefined, MESSAGES),
      ).toMatchObject({ ok: false, status: 403, stepUp: true });
    });

    it("refuses a fresh impersonation session", async () => {
      const user = await passwordlessUser();
      const admin = await createUser({ role: "admin" });
      await session(user.id, { impersonatedBy: admin.id });
      expect(
        await verifyReauthPassword(user.id, undefined, MESSAGES),
      ).toMatchObject({ ok: false, status: 403, stepUp: true });
    });

    it("refuses another user's fresh session", async () => {
      const user = await passwordlessUser();
      const other = await createUser();
      await session(other.id);
      expect(
        await verifyReauthPassword(user.id, undefined, MESSAGES),
      ).toMatchObject({ ok: false, stepUp: true });
    });
  },
);
