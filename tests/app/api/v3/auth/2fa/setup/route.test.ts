import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
  computeTotpCode,
} from "../../_test-harness";

/**
 * Route-level tests for GET and POST /api/v3/auth/2fa/setup.
 *
 * Mocked at the network/database boundary only: the pg pool and outbound
 * email. getSession, hashPassword, verifyPassword, encryptApiKey,
 * decryptApiKey, generateSecret, and verifyTOTP all run for real.
 */

process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);

const queries: { sql: string; params: unknown[] }[] = [];
const rateLimitCounts = new Map<string, number>();

let sessionRow: Record<string, unknown> | null = null;
let totpEnabledRow: { totp_enabled: boolean } | null = null;
let passwordHashRow: { password_hash: string } | null = null;
let storedTotpSecretRow: { totp_secret: string | null } | null = null;

let totpSecretUpdateCalls: unknown[][] = [];
let enableUpdateCalls: unknown[][] = [];
let clearSecretCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });

  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.includes("SELECT s.user_id"))
    return { rows: sessionRow ? [sessionRow] : [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("DELETE FROM rate_limits")) return { rows: [] };
  if (s.startsWith("UPDATE rate_limits")) return { rows: [] };
  if (s.startsWith("INSERT INTO rate_limits")) {
    const key = params[0] as string;
    const next = (rateLimitCounts.get(key) ?? 0) + 1;
    rateLimitCounts.set(key, next);
    return { rows: [{ count: String(next) }] };
  }
  if (s.startsWith("SELECT totp_enabled FROM users WHERE id = $1")) {
    return { rows: totpEnabledRow ? [totpEnabledRow] : [] };
  }
  if (s.startsWith("UPDATE users SET totp_secret = $1 WHERE id = $2")) {
    totpSecretUpdateCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("SELECT password_hash FROM users WHERE id = $1")) {
    return { rows: passwordHashRow ? [passwordHashRow] : [] };
  }
  if (s.startsWith("SELECT totp_secret FROM users WHERE id = $1")) {
    return { rows: storedTotpSecretRow ? [storedTotpSecretRow] : [] };
  }
  if (s.startsWith("UPDATE users SET totp_secret = NULL WHERE id = $1")) {
    clearSecretCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET totp_enabled = true")) {
    enableUpdateCalls.push(params);
    return { rows: [] };
  }
  if (s.includes("FROM notification_preferences WHERE user_id"))
    return { rows: [] };
  if (s.startsWith("SELECT unsubscribe_token FROM users WHERE id")) {
    return { rows: [{ unsubscribe_token: null }] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
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
const { decryptApiKey } = await import("@/lib/auth/crypto");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { GET, POST } = await import("@/app/api/v3/auth/2fa/setup/route");

const REAL_PASSWORD = "Qv8&Trmzln42Xq";
let realPasswordHash: string;

beforeAll(async () => {
  realPasswordHash = await hashPassword(REAL_PASSWORD);
}, 20_000);

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v3/auth/2fa/setup", {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function login(userId = 1) {
  cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
  sessionRow = defaultSessionRow({ user_id: userId });
}

beforeEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockClear();
  mockSendEmail.mockClear();
  queries.length = 0;
  rateLimitCounts.clear();
  cookieState.clear();
  headerState.clear();
  headerState.set("user-agent", "vitest-agent");
  sessionRow = null;
  totpEnabledRow = { totp_enabled: false };
  passwordHashRow = { password_hash: realPasswordHash };
  storedTotpSecretRow = null;
  totpSecretUpdateCalls = [];
  enableUpdateCalls = [];
  clearSecretCalls = [];
  invalidateSettingsCache();
});

describe("GET /api/v3/auth/2fa/setup", () => {
  it("requires a session", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("refuses to overwrite an already-enabled 2FA setup", async () => {
    login();
    totpEnabledRow = { totp_enabled: true };
    const res = await GET();
    expect(res.status).toBe(400);
    expect(totpSecretUpdateCalls).toHaveLength(0);
  });

  it("fails closed (503) when server-side encryption isn't configured", async () => {
    login();
    const original = process.env.API_KEY_ENCRYPTION_KEY;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    try {
      const res = await GET();
      expect(res.status).toBe(503);
    } finally {
      process.env.API_KEY_ENCRYPTION_KEY = original;
    }
  });

  it("generates a secret, stores it encrypted, and returns a usable otpauth URI", async () => {
    login();
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.secret).toMatch(/^[A-Z2-7]+$/);
    expect(json.uri).toMatch(/^otpauth:\/\/totp\//);

    expect(totpSecretUpdateCalls).toHaveLength(1);
    const storedEncrypted = totpSecretUpdateCalls[0][0] as string;
    expect(storedEncrypted).not.toBe(json.secret);
    // Encryption round-trips back to the same secret returned to the client.
    expect(decryptApiKey(storedEncrypted)).toBe(json.secret);
  });
});

describe("POST /api/v3/auth/2fa/setup", () => {
  it("requires a session", async () => {
    const res = await POST(
      req("POST", { code: "123456", currentPassword: "x" }),
    );
    expect(res.status).toBe(401);
  });

  it("rate limits repeated attempts", async () => {
    login(1);
    rateLimitCounts.set("2fa-setup:1:unknown", 5); // login limit is 5/15min

    const res = await POST(
      req("POST", { code: "123456", currentPassword: REAL_PASSWORD }),
    );
    expect(res.status).toBe(429);
  });

  it("requires currentPassword", async () => {
    login();
    const res = await POST(req("POST", { code: "123456" }));
    expect(res.status).toBe(400);
  });

  it("rejects an incorrect currentPassword", async () => {
    login();
    const res = await POST(
      req("POST", { code: "123456", currentPassword: "totally-wrong" }),
    );
    expect(res.status).toBe(403);
    expect(enableUpdateCalls).toHaveLength(0);
  });

  it("rejects a malformed code", async () => {
    login();
    const res = await POST(
      req("POST", { code: "12", currentPassword: REAL_PASSWORD }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects when there is no setup in progress", async () => {
    login();
    storedTotpSecretRow = null;
    const res = await POST(
      req("POST", { code: "123456", currentPassword: REAL_PASSWORD }),
    );
    expect(res.status).toBe(400);
  });

  it("clears a legacy plaintext-prefixed secret and asks the user to restart setup", async () => {
    login(1);
    storedTotpSecretRow = { totp_secret: "plain:some-old-secret" };
    const res = await POST(
      req("POST", { code: "123456", currentPassword: REAL_PASSWORD }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/restarted/i);
    expect(clearSecretCalls).toEqual([[1]]);
  });

  it("rejects an incorrect TOTP code", async () => {
    login();
    const { encryptApiKey, generateSecret } =
      await import("@/lib/auth/totp").then(async (totp) => ({
        generateSecret: totp.generateSecret,
        encryptApiKey: (await import("@/lib/auth/crypto")).encryptApiKey,
      }));
    const secret = generateSecret();
    storedTotpSecretRow = { totp_secret: encryptApiKey(secret) };
    const realCode = computeTotpCode(secret);
    const wrongCode = realCode === "000000" ? "111111" : "000000";

    const res = await POST(
      req("POST", { code: wrongCode, currentPassword: REAL_PASSWORD }),
    );
    expect(res.status).toBe(400);
    expect(enableUpdateCalls).toHaveLength(0);
  });

  it("enables 2FA on a correct code and returns 8 real backup codes", async () => {
    login(1);
    const { generateSecret } = await import("@/lib/auth/totp");
    const secret = generateSecret();
    storedTotpSecretRow = {
      totp_secret: (await import("@/lib/auth/crypto")).encryptApiKey(secret),
    };
    const code = computeTotpCode(secret);

    const res = await POST(
      req("POST", { code, currentPassword: REAL_PASSWORD }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.backupCodes).toHaveLength(8);
    expect(new Set(json.backupCodes).size).toBe(8); // all distinct
    expect(enableUpdateCalls).toHaveLength(1);
    const [hashedCodesJson, counter, userId] = enableUpdateCalls[0];
    expect(userId).toBe(1);
    const hashedCodes = JSON.parse(hashedCodesJson as string);
    expect(hashedCodes).toHaveLength(8);
    // Stored codes are scrypt hashes ("N:r:p:salt:hash"), never plaintext.
    for (const h of hashedCodes) expect(String(h).split(":")).toHaveLength(5);
    expect(typeof counter).toBe("string");
  }, 20_000);
});
