import { it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser } from "./_db";
import {
  makeCookieStore,
  makeHeaderStore,
} from "../app/api/v3/auth/_test-harness";

/**
 * Backup-code sign-in against the real schema (perf-server-6).
 *
 * Each stored code is checked with a 128 MiB scrypt, up to eight of them, two
 * at a time under the password-hash limiter. Those comparisons used to run
 * inside a transaction holding SELECT ... FOR UPDATE on the users row, so one
 * sign-in parked a pooled connection and blocked every writer of that row for
 * seconds. The route now compares first and opens the transaction only to
 * re-read, confirm and splice. What only Postgres can prove is the other half
 * of that bargain: with the comparisons outside the lock, two requests can
 * both match the same code, and the re-read under the lock is all that stops
 * the code being used twice.
 */

const { store: cookieStore } = makeCookieStore();
const { store: headerStore } = makeHeaderStore({ "user-agent": "integration" });
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => headerStore),
}));

vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return {
    ...actual,
    getClientIp: async () => "203.0.113.9",
    getUserAgent: async () => "integration",
  };
});

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => undefined),
}));

/** What the route did, in order: transaction statements and hash checks. */
const events: string[] = [];

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    verifyPassword: async (
      ...args: Parameters<typeof actual.verifyPassword>
    ) => {
      events.push("verify:start");
      try {
        return await actual.verifyPassword(...args);
      } finally {
        events.push("verify:end");
      }
    },
  };
});

const { hashPassword } = await import("@/lib/auth/password-hash");
const { signPendingToken } = await import("@/lib/auth/pending-2fa");
const { AUTH_2FA_PENDING_COOKIE } = await import("@/lib/config/constants");
const { POST } = await import("@/app/api/v3/auth/2fa/verify/route");

const CODES = ["AAAAABBBBBCCCCCDDDDD", "EEEEEFFFFFGGGGGHHHHH"];
let hashes: string[];

beforeAll(async () => {
  hashes = await Promise.all(CODES.map((c) => hashPassword(c)));
}, 30_000);

beforeEach(() => {
  events.length = 0;
  const connect = pool.connect.bind(pool);
  vi.spyOn(pool, "connect").mockImplementation((async () => {
    const client = await connect();
    const query = client.query.bind(client);
    client.query = ((text: unknown, ...rest: unknown[]) => {
      if (typeof text === "string") {
        const word = text.trim().split(/\s+/)[0].toUpperCase();
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(word)) events.push(word);
      }
      return (query as (...a: unknown[]) => unknown)(text, ...rest);
    }) as typeof client.query;
    return client;
  }) as typeof pool.connect);
  return () => vi.restoreAllMocks();
});

async function enrolledUser() {
  const user = await createUser();
  await pool.query(
    `UPDATE users SET totp_enabled = true, two_factor_method = 'app',
       totp_secret = 'unused-for-backup-codes', backup_codes = $1
     WHERE id = $2`,
    [JSON.stringify(hashes), user.id],
  );
  return user;
}

function verify(userId: number, backupCode: string) {
  const pending = signPendingToken({ userId, ts: Date.now() });
  return POST(
    new NextRequest("http://localhost/api/v3/auth/2fa/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${AUTH_2FA_PENDING_COOKIE}=${pending}`,
      },
      body: JSON.stringify({ backupCode }),
    }),
  );
}

async function storedCodes(userId: number): Promise<string[]> {
  const { rows } = await pool.query<{ backup_codes: string }>(
    "SELECT backup_codes FROM users WHERE id = $1",
    [userId],
  );
  return JSON.parse(rows[0].backup_codes);
}

describeIntegration("2FA backup-code verification", () => {
  it("accepts a code, removes only it, and never hashes while holding the row lock", async () => {
    const user = await enrolledUser();

    const res = await verify(user.id, CODES[1]);

    expect(res.status).toBe(200);
    expect(await storedCodes(user.id)).toEqual([hashes[0]]);
    const begin = events.indexOf("BEGIN");
    const commit = events.indexOf("COMMIT");
    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(begin);
    expect(events.slice(begin, commit)).not.toContain("verify:start");
    expect(events.slice(begin, commit)).not.toContain("verify:end");
    expect(events.filter((e) => e === "verify:start")).toHaveLength(2);
  }, 30_000);

  it("lets one of two concurrent uses of the same code through, never both", async () => {
    const user = await enrolledUser();

    const results = await Promise.all([
      verify(user.id, CODES[0]),
      verify(user.id, CODES[0]),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await storedCodes(user.id)).toEqual([hashes[1]]);
  }, 60_000);

  it("rejects an unknown code without opening a transaction", async () => {
    const user = await enrolledUser();

    const res = await verify(user.id, "ZZZZZZZZZZZZZZZZZZZZ");

    expect(res.status).toBe(400);
    expect(events).not.toContain("BEGIN");
    expect(await storedCodes(user.id)).toEqual(hashes);
  }, 30_000);
});
