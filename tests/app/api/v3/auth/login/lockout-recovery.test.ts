import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { makeCookieStore, makeHeaderStore } from "../_test-harness";

/**
 * ATK-8: a full per-address bucket must not keep the real owner out.
 *
 * The account bucket (login-fail:<sha256(address)>) fills from failures sent
 * from anywhere, so anyone who knows an address can fill it from a handful of
 * source addresses and refill it every window. While it was a hard gate, the
 * owner's correct password was refused for as long as someone kept doing
 * that, and nothing but a successful sign-in (which the gate prevented)
 * emptied it.
 *
 * Two ways back in now, and nothing else changes:
 *   - the right password from a browser this account already trusts
 *     (a device_trust row, set when a two-factor sign-in chose "remember");
 *   - a password reset, which proves the mailbox and empties the bucket.
 *
 * Both routes run for real against one stateful fake of the tables they
 * touch, so the reset's effect is observed through the login route the way
 * the owner would meet it.
 */

process.env.API_KEY_ENCRYPTION_KEY = "d".repeat(64);

type UserRow = {
  id: number;
  email: string;
  password_hash: string | null;
  name: string;
  plan: string;
  role: string;
  disabled_at: string | null;
  email_verified_at: string | null;
  totp_secret: string | null;
  totp_enabled: boolean;
  two_factor_method: string | null;
  tos_accepted_at: string | null;
  auth_provider: string | null;
};

const users: UserRow[] = [];
const rateLimits = new Map<string, number>();
const deviceTrust = new Set<string>();
const resetTokens = new Map<
  string,
  { id: number; user_id: number; expires_at: string; used_at: string | null }
>();
let sessionInserts: unknown[][] = [];

const userById = (id: unknown) => users.find((u) => u.id === Number(id));

async function fakeQuery(sql: string, params: unknown[] = []) {
  const s = sql.trim();

  if (s.startsWith("INSERT INTO rate_limits")) {
    const key = params[0] as string;
    const cap = params[2] as number;
    const current = rateLimits.get(key) ?? 0;
    if (current >= cap) return { rows: [] };
    rateLimits.set(key, current + 1);
    return { rows: [{ count: String(current + 1) }] };
  }
  if (s.startsWith('SELECT "count" FROM rate_limits')) {
    const count = rateLimits.get(params[0] as string);
    return { rows: count === undefined ? [] : [{ count: String(count) }] };
  }
  if (s.startsWith("DELETE FROM rate_limits WHERE key = $1 AND window_start")) {
    return { rows: [] };
  }
  if (s.startsWith("DELETE FROM rate_limits WHERE key = $1")) {
    rateLimits.delete(params[0] as string);
    return { rows: [], rowCount: 1 };
  }

  if (s.includes("FROM users WHERE LOWER(email) = $1")) {
    const u = users.find((row) => row.email.toLowerCase() === params[0]);
    return { rows: u ? [u] : [] };
  }
  if (
    s.includes(
      "SELECT totp_enabled, two_factor_method, disabled_at, email_verified_at, role FROM users",
    )
  ) {
    const u = userById(params[0]);
    return { rows: u ? [u] : [] };
  }
  if (s.startsWith("UPDATE users SET password_hash = $1 WHERE id = $2")) {
    const u = userById(params[1]);
    if (u) u.password_hash = params[0] as string;
    return { rows: [], rowCount: u ? 1 : 0 };
  }

  if (s.startsWith("SELECT 1 FROM device_trust")) {
    return deviceTrust.has(`${params[0]}:${params[1]}`)
      ? { rows: [{ "?column?": 1 }] }
      : { rows: [] };
  }
  if (s.startsWith("DELETE FROM device_trust WHERE user_id = $1")) {
    for (const row of deviceTrust) {
      if (row.startsWith(`${params[0]}:`)) deviceTrust.delete(row);
    }
    return { rows: [] };
  }

  if (s.includes("FROM password_reset_tokens prt")) {
    const hashes = params[0] as string[];
    for (const hash of hashes) {
      const t = resetTokens.get(hash);
      const u = t ? userById(t.user_id) : undefined;
      if (t && u && t.used_at === null) {
        return {
          rows: [
            {
              id: t.id,
              user_id: t.user_id,
              expires_at: t.expires_at,
              email: u.email,
              name: u.name,
              totp_enabled: u.totp_enabled,
              auth_provider: u.auth_provider,
            },
          ],
        };
      }
    }
    return { rows: [] };
  }
  if (s.startsWith("UPDATE password_reset_tokens SET used_at = NOW()")) {
    for (const t of resetTokens.values()) {
      if (t.id === params[0]) t.used_at = new Date().toISOString();
    }
    return { rows: [] };
  }

  if (s.startsWith("INSERT INTO sessions")) {
    sessionInserts.push(params);
    return { rows: [] };
  }
  if (s.startsWith("SELECT unsubscribe_token FROM users WHERE id")) {
    return { rows: [{ unsubscribe_token: null }] };
  }
  return { rows: [] };
}

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => fakeQuery(sql, params),
    connect: async () => ({
      query: (sql: string, params?: unknown[]) => fakeQuery(sql, params),
      release: () => {},
    }),
  },
}));

const { store: cookieStore, state: cookieState } = makeCookieStore();
const { store: headerStore, state: headerState } = makeHeaderStore();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => headerStore),
}));

vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return { ...actual, sendEmail: vi.fn(async () => {}) };
});

const { hashPassword } = await import("@/lib/auth/password-hash");
const { hashDeviceFingerprint } = await import("@/lib/auth/device-trust");
const { hashAuthToken } = await import("@/lib/auth/token-hash");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { DEVICE_TRUST_COOKIE_NAME } = await import("@/lib/config/constants");
const { POST: login } = await import("@/app/api/v3/auth/login/route");
const { POST: resetPassword } =
  await import("@/app/api/v3/auth/reset-password/route");

const OWNER_EMAIL = "owner@example.com";
const OWNER_PASSWORD = "Correct-Horse-Battery-92!";
const NEW_PASSWORD = "Nx8&Qvrmpz3Ldk-later";
// The per-IP login cap is 5 per 15 minutes; the account bucket is five of
// those over four windows.
const PER_IP_CAP = 5;
const ACCOUNT_CAP = 25;

const accountKey = (email: string) =>
  `login-fail:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;

let ownerHash: string;
let otherHash: string;
const ownerDevice = randomBytes(32).toString("hex");
const otherDevice = randomBytes(32).toString("hex");

beforeAll(async () => {
  ownerHash = await hashPassword(OWNER_PASSWORD);
  otherHash = await hashPassword("Another-Account-Password-7");
}, 20_000);

function account(overrides: Partial<UserRow>): UserRow {
  return {
    id: 1,
    email: OWNER_EMAIL,
    password_hash: ownerHash,
    name: "Owner",
    plan: "free",
    role: "user",
    disabled_at: null,
    email_verified_at: "2026-01-01T00:00:00.000Z",
    totp_secret: null,
    totp_enabled: true,
    two_factor_method: "app",
    tos_accepted_at: null,
    auth_provider: "password",
    ...overrides,
  };
}

let addressCounter = 0;
function fromAddress(ip: string) {
  headerState.set("x-forwarded-for", ip);
}
function freshAddress() {
  addressCounter += 1;
  fromAddress(`198.51.100.${addressCounter}`);
}

function loginRequest(
  email: string,
  password: string,
  cookies: Record<string, string> = {},
) {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest("http://localhost/api/v3/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ email, password }),
  });
}

// What the caller can observe, minus the per-response request id.
async function observable(res: Response) {
  const { requestId, ...body } = await res.json();
  expect(typeof requestId).toBe("string");
  return {
    status: res.status,
    body,
    retryAfter: res.headers.get("retry-after"),
    setCookie: res.headers.getSetCookie(),
  };
}

beforeEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  users.length = 0;
  users.push(
    account({}),
    account({ id: 2, email: "other@example.com", password_hash: otherHash }),
    account({
      id: 3,
      email: "social@example.com",
      password_hash: null,
      auth_provider: "google",
    }),
  );
  rateLimits.clear();
  deviceTrust.clear();
  deviceTrust.add(`1:${hashDeviceFingerprint(ownerDevice)}`);
  deviceTrust.add(`2:${hashDeviceFingerprint(otherDevice)}`);
  resetTokens.clear();
  sessionInserts = [];
  cookieState.clear();
  headerState.clear();
  headerState.set("user-agent", "vitest-agent");
  invalidateSettingsCache();
  // One clock for every request, so two refusals compared below are
  // computed from the same instant and their Retry-After cannot drift.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-21T10:20:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function fillOwnerBucket() {
  rateLimits.set(accountKey(OWNER_EMAIL), ACCOUNT_CAP);
}

describe("a full account bucket", () => {
  it("fills after 25 failures from five addresses and refuses the 26th from a sixth", async () => {
    for (let ip = 0; ip < 5; ip++) {
      freshAddress();
      for (let n = 0; n < PER_IP_CAP; n++) {
        const res = await login(loginRequest(OWNER_EMAIL, `wrong-${ip}-${n}`));
        expect(res.status).toBe(401);
      }
    }
    expect(rateLimits.get(accountKey(OWNER_EMAIL))).toBe(ACCOUNT_CAP);

    freshAddress();
    const sixth = await login(loginRequest(OWNER_EMAIL, "wrong-sixth"));
    expect(sixth.status).toBe(429);

    // And the owner, from a seventh address with no trusted device, is
    // refused with the right password: that much of the lock stays.
    freshAddress();
    const owner = await login(loginRequest(OWNER_EMAIL, OWNER_PASSWORD));
    expect(owner.status).toBe(429);
    expect(sessionInserts).toHaveLength(0);
  }, 60_000);

  it("lets the owner in with the right password from a device the account trusts, and empties the bucket", async () => {
    fillOwnerBucket();
    freshAddress();

    const res = await login(
      loginRequest(OWNER_EMAIL, OWNER_PASSWORD, {
        [DEVICE_TRUST_COOKIE_NAME]: ownerDevice,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    // Down the normal path: a trusted device on a two-factor account goes
    // straight to a session.
    expect(json.user.email).toBe(OWNER_EMAIL);
    expect(json.requires2FA).toBeUndefined();
    expect(sessionInserts).toHaveLength(1);
    expect(rateLimits.has(accountKey(OWNER_EMAIL))).toBe(false);
  });

  it("still refuses a suspended account that passes the lock", async () => {
    users[0].disabled_at = "2026-11-01T00:00:00.000Z";
    fillOwnerBucket();
    freshAddress();

    const res = await login(
      loginRequest(OWNER_EMAIL, OWNER_PASSWORD, {
        [DEVICE_TRUST_COOKIE_NAME]: ownerDevice,
      }),
    );

    expect(res.status).toBe(403);
    expect(sessionInserts).toHaveLength(0);
  });

  describe("answers every other combination with the one refusal", () => {
    let baseline: Awaited<ReturnType<typeof observable>>;

    beforeEach(async () => {
      fillOwnerBucket();
      freshAddress();
      baseline = await observable(
        await login(loginRequest(OWNER_EMAIL, "definitely-wrong")),
      );
    });

    it("a wrong password, which is a 429 that names no account", () => {
      expect(baseline.status).toBe(429);
      expect(baseline.retryAfter).toMatch(/^\d+$/);
      expect(baseline.body.error).not.toMatch(/account/i);
      expect(baseline.setCookie).toEqual([]);
    });

    it.each([
      ["the right password and no device cookie", OWNER_PASSWORD, undefined],
      [
        "the right password and another account's trusted device",
        OWNER_PASSWORD,
        otherDevice,
      ],
      [
        "the right password and a device cookie nobody trusts",
        OWNER_PASSWORD,
        randomBytes(32).toString("hex"),
      ],
      ["a wrong password from the owner's trusted device", "nope", ownerDevice],
    ])("%s", async (_label, password, device) => {
      freshAddress();
      const res = await login(
        loginRequest(
          OWNER_EMAIL,
          password,
          device ? { [DEVICE_TRUST_COOKIE_NAME]: device } : {},
        ),
      );

      expect(await observable(res)).toEqual(baseline);
      expect(sessionInserts).toHaveLength(0);
      expect(rateLimits.get(accountKey(OWNER_EMAIL))).toBe(ACCOUNT_CAP);
    });

    it("the right password from a device whose trust was revoked", async () => {
      deviceTrust.delete(`1:${hashDeviceFingerprint(ownerDevice)}`);
      freshAddress();

      const res = await login(
        loginRequest(OWNER_EMAIL, OWNER_PASSWORD, {
          [DEVICE_TRUST_COOKIE_NAME]: ownerDevice,
        }),
      );

      expect(await observable(res)).toEqual(baseline);
      expect(sessionInserts).toHaveLength(0);
    });

    it("an unknown address and an OAuth-only account, each with a full bucket", async () => {
      for (const email of ["nobody@example.com", "social@example.com"]) {
        rateLimits.set(accountKey(email), ACCOUNT_CAP);
        freshAddress();
        const res = await login(
          loginRequest(email, "definitely-wrong", {
            [DEVICE_TRUST_COOKIE_NAME]: ownerDevice,
          }),
        );
        expect(await observable(res)).toEqual(baseline);
      }
      expect(sessionInserts).toHaveLength(0);
    });
  });
});

describe("a password reset", () => {
  it("empties the bucket, so the new password signs in from a device nobody trusts", async () => {
    users[0].totp_enabled = false;
    fillOwnerBucket();
    const rawToken = randomBytes(32).toString("hex");
    resetTokens.set(hashAuthToken(rawToken), {
      id: 11,
      user_id: 1,
      expires_at: "2026-11-21T11:00:00.000Z",
      used_at: null,
    });

    freshAddress();
    const before = await login(loginRequest(OWNER_EMAIL, OWNER_PASSWORD));
    expect(before.status).toBe(429);

    const reset = await resetPassword(
      new NextRequest("http://localhost/api/v3/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: rawToken, password: NEW_PASSWORD }),
      }) as never,
    );
    expect(reset.status).toBe(200);
    expect(rateLimits.has(accountKey(OWNER_EMAIL))).toBe(false);

    freshAddress();
    const after = await login(loginRequest(OWNER_EMAIL, NEW_PASSWORD));
    const json = await after.json();
    expect(after.status).toBe(200);
    expect(json.user.email).toBe(OWNER_EMAIL);
    expect(sessionInserts).toHaveLength(1);
  }, 30_000);

  it("empties the bucket of a mixed-case stored address under the key login uses", async () => {
    users[0].email = "Owner@Example.com";
    fillOwnerBucket();
    const rawToken = randomBytes(32).toString("hex");
    resetTokens.set(hashAuthToken(rawToken), {
      id: 12,
      user_id: 1,
      expires_at: "2026-11-21T11:00:00.000Z",
      used_at: null,
    });

    const reset = await resetPassword(
      new NextRequest("http://localhost/api/v3/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: rawToken, password: NEW_PASSWORD }),
      }) as never,
    );

    expect(reset.status).toBe(200);
    expect(rateLimits.has(accountKey(OWNER_EMAIL))).toBe(false);
  }, 30_000);

  it("leaves the bucket alone when the token is wrong", async () => {
    fillOwnerBucket();

    const reset = await resetPassword(
      new NextRequest("http://localhost/api/v3/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "not-a-token", password: NEW_PASSWORD }),
      }) as never,
    );

    expect(reset.status).toBe(400);
    expect(rateLimits.get(accountKey(OWNER_EMAIL))).toBe(ACCOUNT_CAP);
  });
});
