import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../../_test-harness";

/**
 * Route-level tests for POST /api/v3/auth/2fa/disable.
 *
 * Mocked at the network/database boundary only: the pg pool and outbound
 * email. getSession and verifyPassword run for real.
 */

const rateLimitCounts = new Map<string, number>();
let sessionRow: Record<string, unknown> | null = null;
let passwordHashRow: { password_hash: string } | null = null;
let disableUpdateCalls: unknown[][] = [];
let deviceTrustDeleteCalls: unknown[][] = [];

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
  if (s.startsWith("SELECT password_hash FROM users WHERE id = $1")) {
    return { rows: passwordHashRow ? [passwordHashRow] : [] };
  }
  if (s.startsWith("UPDATE users SET totp_enabled = false")) {
    disableUpdateCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("DELETE FROM device_trust WHERE user_id")) {
    deviceTrustDeleteCalls.push(params);
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
const { POST } = await import("@/app/api/v3/auth/2fa/disable/route");

const REAL_PASSWORD = "Zb3!Kqorvmtp62";
let realPasswordHash: string;

beforeAll(async () => {
  realPasswordHash = await hashPassword(REAL_PASSWORD);
}, 20_000);

function req(body?: unknown) {
  return new NextRequest("http://localhost/api/v3/auth/2fa/disable", {
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
  passwordHashRow = { password_hash: realPasswordHash };
  disableUpdateCalls = [];
  deviceTrustDeleteCalls = [];
  invalidateSettingsCache();
});

describe("POST /api/v3/auth/2fa/disable", () => {
  it("requires a session", async () => {
    const res = await POST(req({ password: REAL_PASSWORD }));
    expect(res.status).toBe(401);
  });

  it("rate limits repeated attempts", async () => {
    login(1);
    rateLimitCounts.set("2fa-disable:1:unknown", 5);
    const res = await POST(req({ password: REAL_PASSWORD }));
    expect(res.status).toBe(429);
  });

  it("requires a password", async () => {
    login();
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("rejects an incorrect password with 401 (not 403)", async () => {
    login();
    const res = await POST(req({ password: "totally-wrong" }));
    expect(res.status).toBe(401);
    expect(disableUpdateCalls).toHaveLength(0);
  });

  it("disables 2FA on the correct password and clears all 2FA fields in one update", async () => {
    login(1);
    const res = await POST(req({ password: REAL_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBeTruthy();
    expect(disableUpdateCalls).toEqual([[1]]);
  });

  it("clears every trusted device so re-enabling 2FA is not silently skipped", async () => {
    login(1);
    await POST(req({ password: REAL_PASSWORD }));
    // A device_trust row is a standing "skip the second factor here" grant.
    // Leaving them behind meant turning 2FA off and back on re-honoured every
    // previously trusted browser, an attacker's planted one included.
    expect(deviceTrustDeleteCalls).toEqual([[1]]);
  });

  it("sends a 2FA-disabled notification email", async () => {
    login(1);
    await POST(req({ password: REAL_PASSWORD }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });
});
