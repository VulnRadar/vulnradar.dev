import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../../_test-harness";

/**
 * Route-level tests for GET and POST /api/v3/auth/2fa/backup-codes.
 *
 * Mocked at the network/database boundary only: the pg pool and outbound
 * email. getSession, hashPassword, and verifyPassword all run for real.
 */

const rateLimitCounts = new Map<string, number>();
let sessionRow: Record<string, unknown> | null = null;
let userRow: {
  password_hash: string;
  totp_enabled: boolean;
  backup_codes?: string | null;
} | null = null;
let backupCodesUpdateCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
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
  if (
    s.startsWith("SELECT backup_codes, totp_enabled FROM users WHERE id = $1")
  ) {
    return { rows: userRow ? [userRow] : [] };
  }
  if (
    s.startsWith("SELECT password_hash, totp_enabled FROM users WHERE id = $1")
  ) {
    return { rows: userRow ? [userRow] : [] };
  }
  // The route no longer selects password_hash itself: re-auth moved into
  // verifyReauthPassword (lib/auth/reauth.ts), which runs its own
  // SELECT password_hash. That indirection is what lets an OAuth-only
  // account (password_hash NULL) re-auth with its session instead of a
  // password it does not have. Both queries are served here so the real
  // re-auth logic stays under test rather than being mocked away.
  if (s.startsWith("SELECT totp_enabled FROM users WHERE id = $1")) {
    return { rows: userRow ? [userRow] : [] };
  }
  if (s.startsWith("SELECT password_hash FROM users WHERE id = $1")) {
    return { rows: userRow ? [userRow] : [] };
  }
  if (s.startsWith("UPDATE users SET backup_codes = $1 WHERE id = $2")) {
    backupCodesUpdateCalls.push(params);
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
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { GET, POST } = await import("@/app/api/v3/auth/2fa/backup-codes/route");

const REAL_PASSWORD = "Hy6#Wqnprtlv84";
let realPasswordHash: string;

beforeAll(async () => {
  realPasswordHash = await hashPassword(REAL_PASSWORD);
}, 20_000);

function postReq(body?: unknown) {
  return new NextRequest("http://localhost/api/v3/auth/2fa/backup-codes", {
    method: "POST",
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
  rateLimitCounts.clear();
  cookieState.clear();
  headerState.clear();
  headerState.set("user-agent", "vitest-agent");
  sessionRow = null;
  userRow = null;
  backupCodesUpdateCalls = [];
  invalidateSettingsCache();
});

describe("GET /api/v3/auth/2fa/backup-codes", () => {
  it("requires a session", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 0 remaining when 2FA isn't enabled", async () => {
    login();
    userRow = { password_hash: realPasswordHash, totp_enabled: false };
    const res = await GET();
    const json = await res.json();
    expect(json.remaining).toBe(0);
  });

  it("returns the count of remaining backup codes", async () => {
    login();
    userRow = {
      password_hash: realPasswordHash,
      totp_enabled: true,
      backup_codes: JSON.stringify(["hash1", "hash2", "hash3"]),
    };
    const res = await GET();
    const json = await res.json();
    expect(json.remaining).toBe(3);
  });
});

describe("POST /api/v3/auth/2fa/backup-codes", () => {
  it("requires a session", async () => {
    const res = await POST(postReq({ password: REAL_PASSWORD }));
    expect(res.status).toBe(401);
  });

  it("rate limits repeated attempts", async () => {
    login(1);
    rateLimitCounts.set("backup-codes:1:unknown", 5);
    const res = await POST(postReq({ password: REAL_PASSWORD }));
    expect(res.status).toBe(429);
  });

  it("requires a password", async () => {
    login();
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
  });

  it("rejects when 2FA isn't enabled", async () => {
    login();
    userRow = { password_hash: realPasswordHash, totp_enabled: false };
    const res = await POST(postReq({ password: REAL_PASSWORD }));
    expect(res.status).toBe(400);
  });

  it("rejects an incorrect password", async () => {
    login();
    userRow = { password_hash: realPasswordHash, totp_enabled: true };
    const res = await POST(postReq({ password: "totally-wrong" }));
    expect(res.status).toBe(401);
    expect(backupCodesUpdateCalls).toHaveLength(0);
  });

  it("regenerates 8 real backup codes on the correct password", async () => {
    login(1);
    userRow = { password_hash: realPasswordHash, totp_enabled: true };

    const res = await POST(postReq({ password: REAL_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.backupCodes).toHaveLength(8);
    expect(new Set(json.backupCodes).size).toBe(8);
    expect(backupCodesUpdateCalls).toHaveLength(1);
    const [hashedCodesJson, userId] = backupCodesUpdateCalls[0];
    expect(userId).toBe(1);
    const hashedCodes = JSON.parse(hashedCodesJson as string);
    expect(hashedCodes).toHaveLength(8);
    for (const h of hashedCodes) expect(String(h).split(":")).toHaveLength(5);
  }, 20_000);

  it("sends a backup-codes-regenerated notification email", async () => {
    login(1);
    userRow = { password_hash: realPasswordHash, totp_enabled: true };

    await POST(postReq({ password: REAL_PASSWORD }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  }, 20_000);
});
