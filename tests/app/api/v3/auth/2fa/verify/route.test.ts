import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeCookieStore,
  makeHeaderStore,
  computeTotpCode,
} from "../../_test-harness";

/**
 * Route-level tests for POST /api/v3/auth/2fa/verify.
 *
 * Mocked at the network/database boundary only: the pg pool and outbound
 * email. verifyTOTP, decryptApiKey/encryptApiKey, verifyPassword,
 * createSession, and upsertTrustedDevice all run for real against the
 * mocked pool.
 *
 * The backup-code path is the regression target called out in the task:
 * app/api/v3/auth/2fa/verify/route.ts compares the submitted code against
 * every stored backup-code hash via `Promise.all(storedHashes.map(hash =>
 * verifyPassword(...)))` and then `comparisons.indexOf(true)` to find the
 * match. A prior version of this comparison only checked index 0. The
 * "matches a backup code that is not the first one" test below is a
 * regression test for that fix.
 */

process.env.API_KEY_ENCRYPTION_KEY = "b".repeat(64);

const queries: { sql: string; params: unknown[] }[] = [];
const rateLimitCounts = new Map<string, number>();

let userRow: {
  totp_secret: string | null;
  totp_enabled: boolean;
  backup_codes: string | null;
  two_factor_method: string;
} | null = null;
let totpLastCounter: string | null = null;
let userEmailRow: { email: string } | null = null;
let emailCodeCandidates: { id: number; code_salt: string }[] = [];
let emailCodeHashes: Record<number, string> = {};

let sessionInsertCalls: unknown[][] = [];
let backupCodesUpdateCalls: unknown[][] = [];
let totpCounterUpdateCalls: unknown[][] = [];
let deviceTrustInsertCalls: unknown[][] = [];
let emailCodeDeleteCalls: number[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });

  if (s.startsWith("DELETE FROM rate_limits")) return { rows: [] };
  if (s.startsWith("UPDATE rate_limits")) return { rows: [] };
  if (s.startsWith("INSERT INTO rate_limits")) {
    const key = params[0] as string;
    const next = (rateLimitCounts.get(key) ?? 0) + 1;
    rateLimitCounts.set(key, next);
    return { rows: [{ count: String(next) }] };
  }
  if (s.includes("SELECT backup_codes FROM users WHERE id = $1 FOR UPDATE")) {
    return { rows: userRow ? [{ backup_codes: userRow.backup_codes }] : [] };
  }
  if (
    s.includes("totp_secret, totp_enabled, backup_codes, two_factor_method")
  ) {
    return { rows: userRow ? [userRow] : [] };
  }
  if (s.startsWith("UPDATE users SET backup_codes = $1")) {
    backupCodesUpdateCalls.push(params);
    return { rows: [] };
  }
  if (
    s.startsWith("SELECT totp_last_counter FROM users WHERE id = $1 FOR UPDATE")
  ) {
    return { rows: [{ totp_last_counter: totpLastCounter }] };
  }
  if (s.startsWith("UPDATE users SET totp_last_counter = $1")) {
    totpCounterUpdateCalls.push(params);
    totpLastCounter = params[0] as string;
    return { rows: [] };
  }
  if (s.startsWith("SELECT id, code_salt FROM email_2fa_codes")) {
    return { rows: emailCodeCandidates };
  }
  if (s.startsWith("SELECT code_hash FROM email_2fa_codes WHERE id = $1")) {
    const id = params[0] as number;
    return {
      rows: emailCodeHashes[id] ? [{ code_hash: emailCodeHashes[id] }] : [],
    };
  }
  if (s.startsWith("DELETE FROM email_2fa_codes WHERE id = $1 RETURNING id")) {
    const id = params[0] as number;
    emailCodeDeleteCalls.push(id);
    return { rows: [{ id }] };
  }
  if (s.startsWith("INSERT INTO sessions")) {
    sessionInsertCalls.push(params);
    return { rows: [] };
  }
  if (s === "SELECT email FROM users WHERE id = $1") {
    return { rows: userEmailRow ? [userEmailRow] : [] };
  }
  if (s.includes("FROM notification_preferences WHERE user_id"))
    return { rows: [] };
  if (s.startsWith("SELECT unsubscribe_token FROM users WHERE id")) {
    return { rows: [{ unsubscribe_token: null }] };
  }
  if (s.startsWith("INSERT INTO device_trust")) {
    deviceTrustInsertCalls.push(params);
    return { rows: [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
    connect: async () => ({
      query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
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

const mockSendEmail = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return { ...actual, sendEmail: (params: unknown) => mockSendEmail(params) };
});

const { hashPassword } = await import("@/lib/auth/password-hash");
const { generateSecret } = await import("@/lib/auth/totp");
const { encryptApiKey } = await import("@/lib/auth/crypto");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_2FA_PENDING_COOKIE, DEVICE_TRUST_COOKIE_NAME } =
  await import("@/lib/config/constants");
const { POST } = await import("@/app/api/v3/auth/2fa/verify/route");

const TOTP_SECRET = generateSecret();
let backupCodeHashes: string[];
const BACKUP_CODES_PLAIN = [
  "AAAAA-BBBBB-CCCCC-DDDDD",
  "EEEEE-FFFFF-GGGGG-HHHHH",
  "IIIII-JJJJJ-KKKKK-LLLLL",
];

beforeAll(async () => {
  backupCodeHashes = await Promise.all(
    BACKUP_CODES_PLAIN.map((c) => hashPassword(c.replace(/-/g, ""))),
  );
}, 20_000);

function verifyRequest(
  body: unknown,
  cookies: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/v3/auth/2fa/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  // Drain any background setImmediate email sends left pending by the
  // previous test before resetting mocks, so a leftover callback can't
  // fire mid-test and inflate a call count assertion.
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockClear();
  queries.length = 0;
  cookieState.clear();
  headerState.clear();
  headerState.set("user-agent", "vitest-agent");
  mockSendEmail.mockClear();
  rateLimitCounts.clear();
  userRow = null;
  totpLastCounter = null;
  userEmailRow = { email: "user@example.com" };
  emailCodeCandidates = [];
  emailCodeHashes = {};
  sessionInsertCalls = [];
  backupCodesUpdateCalls = [];
  totpCounterUpdateCalls = [];
  deviceTrustInsertCalls = [];
  emailCodeDeleteCalls = [];
  invalidateSettingsCache();
});

describe("POST /api/v3/auth/2fa/verify", () => {
  it("rejects a request with neither a code nor a backup code", async () => {
    const res = await POST(
      verifyRequest({ userId: 1 }, { [AUTH_2FA_PENDING_COOKIE]: "1" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a missing userId with no pending cookie context", async () => {
    const res = await POST(verifyRequest({ code: "123456" }));
    expect(res.status).toBe(400);
  });

  it("rejects when the pending 2FA cookie doesn't match the submitted userId", async () => {
    const res = await POST(
      verifyRequest(
        { userId: 1, code: "123456" },
        { [AUTH_2FA_PENDING_COOKIE]: "2" },
      ),
    );
    expect(res.status).toBe(401);
    expect(sessionInsertCalls).toHaveLength(0);
  });

  it("rejects when there is no pending cookie at all", async () => {
    const res = await POST(verifyRequest({ userId: 1, code: "123456" }));
    expect(res.status).toBe(401);
  });

  describe("TOTP (authenticator app)", () => {
    beforeEach(() => {
      userRow = {
        totp_secret: encryptApiKey(TOTP_SECRET),
        totp_enabled: true,
        backup_codes: JSON.stringify(backupCodeHashes),
        two_factor_method: "app",
      };
    });

    it("accepts a correct TOTP code and creates a real session", async () => {
      const code = computeTotpCode(TOTP_SECRET);
      const res = await POST(
        verifyRequest({ userId: 1, code }, { [AUTH_2FA_PENDING_COOKIE]: "1" }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(sessionInsertCalls).toHaveLength(1);
      expect(sessionInsertCalls[0][1]).toBe(1);
      expect(totpCounterUpdateCalls).toHaveLength(1);
      // The pending-2FA cookie is cleared on the response.
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).toContain(AUTH_2FA_PENDING_COOKIE);
    });

    it("rejects an incorrect TOTP code", async () => {
      const wrongCode =
        computeTotpCode(TOTP_SECRET) === "000000" ? "111111" : "000000";
      const res = await POST(
        verifyRequest(
          { userId: 1, code: wrongCode },
          { [AUTH_2FA_PENDING_COOKIE]: "1" },
        ),
      );
      expect(res.status).toBe(400);
      expect(sessionInsertCalls).toHaveLength(0);
    });

    it("rejects a reused TOTP code within the same 30-second step (replay prevention)", async () => {
      const step = String(BigInt(Math.floor(Date.now() / 1000 / 30)));
      totpLastCounter = step; // simulate this step already having been consumed
      const code = computeTotpCode(TOTP_SECRET);

      const res = await POST(
        verifyRequest({ userId: 1, code }, { [AUTH_2FA_PENDING_COOKIE]: "1" }),
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/already used/i);
      expect(sessionInsertCalls).toHaveLength(0);
    });
  });

  describe("backup codes", () => {
    beforeEach(() => {
      userRow = {
        totp_secret: encryptApiKey(TOTP_SECRET),
        totp_enabled: true,
        backup_codes: JSON.stringify(backupCodeHashes),
        two_factor_method: "app",
      };
    });

    it("accepts a valid backup code and removes only that code", async () => {
      const res = await POST(
        verifyRequest(
          { userId: 1, backupCode: BACKUP_CODES_PLAIN[0] },
          { [AUTH_2FA_PENDING_COOKIE]: "1" },
        ),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(backupCodesUpdateCalls).toHaveLength(1);
      const remaining = JSON.parse(backupCodesUpdateCalls[0][0] as string);
      expect(remaining).toHaveLength(2);
      expect(remaining).not.toContain(backupCodeHashes[0]);
    }, 15_000);

    // Regression test: the verify route checks a submitted backup code
    // against every stored hash via
    //   Promise.all(storedHashes.map(hash => verifyPassword(input, hash)))
    //   matchIndex = comparisons.indexOf(true)
    // A prior version of this only worked when the match happened to be at
    // index 0. This exercises a match at index 2 (the last of three) to
    // prove the comparison isn't silently only checking the first hash.
    it("matches a backup code that is not the first one in the stored list", async () => {
      const res = await POST(
        verifyRequest(
          { userId: 1, backupCode: BACKUP_CODES_PLAIN[2] },
          { [AUTH_2FA_PENDING_COOKIE]: "1" },
        ),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      const remaining = JSON.parse(backupCodesUpdateCalls[0][0] as string);
      expect(remaining).toHaveLength(2);
      // The code at index 2 was removed; the other two (index 0 and 1) remain.
      expect(remaining).toContain(backupCodeHashes[0]);
      expect(remaining).toContain(backupCodeHashes[1]);
      expect(remaining).not.toContain(backupCodeHashes[2]);
    }, 15_000);

    it("rejects an unknown backup code and leaves the stored codes untouched", async () => {
      const res = await POST(
        verifyRequest(
          { userId: 1, backupCode: "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ" },
          { [AUTH_2FA_PENDING_COOKIE]: "1" },
        ),
      );
      expect(res.status).toBe(400);
      expect(backupCodesUpdateCalls).toHaveLength(0);
      expect(sessionInsertCalls).toHaveLength(0);
    }, 15_000);

    it("accepts a backup code typed with different casing and separators", async () => {
      const loose = BACKUP_CODES_PLAIN[1].toLowerCase().replace(/-/g, " ");
      const res = await POST(
        verifyRequest(
          { userId: 1, backupCode: loose },
          { [AUTH_2FA_PENDING_COOKIE]: "1" },
        ),
      );
      expect(res.status).toBe(200);
    }, 15_000);
  });

  describe("email 2FA", () => {
    beforeEach(() => {
      userRow = {
        totp_secret: null,
        totp_enabled: true,
        backup_codes: null,
        two_factor_method: "email",
      };
    });

    it("accepts the matching emailed code and deletes it", async () => {
      const { createHash, randomBytes } = await import("node:crypto");
      const salt = randomBytes(32).toString("hex");
      const code = "654321";
      const hash = createHash("sha256").update(`${salt}:${code}`).digest("hex");
      emailCodeCandidates = [{ id: 9, code_salt: salt }];
      emailCodeHashes = { 9: hash };

      const res = await POST(
        verifyRequest({ userId: 1, code }, { [AUTH_2FA_PENDING_COOKIE]: "1" }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(emailCodeDeleteCalls).toEqual([9]);
      expect(sessionInsertCalls).toHaveLength(1);
    });

    it("rejects an incorrect emailed code", async () => {
      const { createHash, randomBytes } = await import("node:crypto");
      const salt = randomBytes(32).toString("hex");
      const hash = createHash("sha256").update(`${salt}:654321`).digest("hex");
      emailCodeCandidates = [{ id: 9, code_salt: salt }];
      emailCodeHashes = { 9: hash };

      const res = await POST(
        verifyRequest(
          { userId: 1, code: "000000" },
          { [AUTH_2FA_PENDING_COOKIE]: "1" },
        ),
      );
      expect(res.status).toBe(400);
      expect(sessionInsertCalls).toHaveLength(0);
    });
  });

  it("rate limits repeated verify attempts for the same user", async () => {
    userRow = {
      totp_secret: encryptApiKey(TOTP_SECRET),
      totp_enabled: true,
      backup_codes: JSON.stringify(backupCodeHashes),
      two_factor_method: "app",
    };
    rateLimitCounts.set("2fa-verify:1:unknown", 5); // maxAttempts is 5 -> next call denied

    const res = await POST(
      verifyRequest(
        { userId: 1, code: computeTotpCode(TOTP_SECRET) },
        { [AUTH_2FA_PENDING_COOKIE]: "1" },
      ),
    );

    expect(res.status).toBe(429);
    expect(sessionInsertCalls).toHaveLength(0);
  });

  it("sets a device-trust cookie when rememberDevice is true", async () => {
    userRow = {
      totp_secret: encryptApiKey(TOTP_SECRET),
      totp_enabled: true,
      backup_codes: JSON.stringify(backupCodeHashes),
      two_factor_method: "app",
    };
    const code = computeTotpCode(TOTP_SECRET);

    const res = await POST(
      verifyRequest(
        { userId: 1, code, rememberDevice: true },
        { [AUTH_2FA_PENDING_COOKIE]: "1" },
      ),
    );

    expect(res.status).toBe(200);
    expect(deviceTrustInsertCalls).toHaveLength(1);
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain(DEVICE_TRUST_COOKIE_NAME);
  });

  describe("Discord pending login", () => {
    it("rejects an expired Discord pending login", async () => {
      const pending = JSON.stringify({
        userId: 1,
        ts: Date.now() - 6 * 60 * 1000,
      });
      const res = await POST(
        verifyRequest(
          { code: "123456" },
          { discord_pending_login: encodeURIComponent(pending) },
        ),
      );
      expect(res.status).toBe(401);
      expect(sessionInsertCalls).toHaveLength(0);
    });

    it("accepts a valid TOTP code via a fresh Discord pending login", async () => {
      userRow = {
        totp_secret: encryptApiKey(TOTP_SECRET),
        totp_enabled: true,
        backup_codes: JSON.stringify(backupCodeHashes),
        two_factor_method: "app",
      };
      const pending = JSON.stringify({ userId: 1, ts: Date.now() });
      const code = computeTotpCode(TOTP_SECRET);

      const res = await POST(
        verifyRequest(
          { code },
          { discord_pending_login: encodeURIComponent(pending) },
        ),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(sessionInsertCalls).toHaveLength(1);
    });
  });
});
