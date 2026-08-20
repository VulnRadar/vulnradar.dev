import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeHeaderStore } from "../../_test-harness";

/**
 * Route-level tests for POST /api/v3/auth/2fa/email-send.
 *
 * This route is not session-gated at all -- it relies entirely on the
 * pending-2FA cookies set by login/discord-callback, read directly off the
 * request via request.cookies (not next/headers).
 *
 * Mocked at the network/database boundary only: the pg pool and outbound
 * email (sendEmail is awaited directly by this route, not backgrounded).
 */

let userEmailRow: { email: string } | null = null;
let recentCodeRow: { created_at: string } | null = null;
let deleteCodeCalls: unknown[][] = [];
let insertCodeCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("SELECT email FROM users WHERE id = $1")) {
    return { rows: userEmailRow ? [userEmailRow] : [] };
  }
  if (s.startsWith("SELECT created_at FROM email_2fa_codes")) {
    return { rows: recentCodeRow ? [recentCodeRow] : [] };
  }
  if (s.startsWith("DELETE FROM email_2fa_codes WHERE user_id")) {
    deleteCodeCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO email_2fa_codes")) {
    insertCodeCalls.push(params);
    return { rows: [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { store: headerStore } = makeHeaderStore();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => headerStore),
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));

const mockSendEmail = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return { ...actual, sendEmail: (params: unknown) => mockSendEmail(params) };
});

const { AUTH_2FA_PENDING_COOKIE } = await import("@/lib/config/constants");
const { signPendingToken } = await import("@/lib/auth/pending-2fa");
const { POST } = await import("@/app/api/v3/auth/2fa/email-send/route");

// email-send now derives the userId only from a signed pending cookie.
process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);
function signedPending(userId: number, ts: number = Date.now()): string {
  return signPendingToken({ userId, ts });
}

function req(cookies: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/auth/2fa/email-send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
  });
}

beforeEach(() => {
  mockQuery.mockClear();
  mockSendEmail.mockClear();
  userEmailRow = null;
  recentCodeRow = null;
  deleteCodeCalls = [];
  insertCodeCalls = [];
});

describe("POST /api/v3/auth/2fa/email-send", () => {
  it("rejects when there is no pending 2FA cookie at all", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it("rejects an expired Discord pending login", async () => {
    const pending = signedPending(1, Date.now() - 6 * 60 * 1000);
    const res = await POST(req({ discord_pending_login: pending }));
    expect(res.status).toBe(401);
  });

  it("rejects when the pending user can't be found", async () => {
    userEmailRow = null;
    const res = await POST(
      req({ [AUTH_2FA_PENDING_COOKIE]: signedPending(1) }),
    );
    expect(res.status).toBe(400);
  });

  it("rate limits a second request within 60 seconds", async () => {
    userEmailRow = { email: "user@example.com" };
    recentCodeRow = { created_at: new Date().toISOString() };

    const res = await POST(
      req({ [AUTH_2FA_PENDING_COOKIE]: signedPending(1) }),
    );

    expect(res.status).toBe(429);
    expect(insertCodeCalls).toHaveLength(0);
  });

  it("sends a fresh code, storing a salted hash rather than the plaintext", async () => {
    userEmailRow = { email: "user@example.com" };
    recentCodeRow = null;

    const res = await POST(
      req({ [AUTH_2FA_PENDING_COOKIE]: signedPending(1) }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.maskedEmail).toBe("us***@example.com");
    expect(deleteCodeCalls).toEqual([[1]]);
    expect(insertCodeCalls).toHaveLength(1);
    const [userId, codeHash, codeSalt] = insertCodeCalls[0];
    expect(userId).toBe(1);
    expect(codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(codeSalt).toMatch(/^[a-f0-9]{64}$/);
    expect(codeHash).not.toBe(codeSalt);

    // sendEmail is awaited directly (not backgrounded) by this route.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("resolves the pending user from a fresh Discord pending login cookie", async () => {
    userEmailRow = { email: "discorduser@example.com" };
    const pending = signedPending(7);

    const res = await POST(req({ discord_pending_login: pending }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.maskedEmail).toBe("di***@example.com");
    expect(insertCodeCalls[0][0]).toBe(7);
  });
});
