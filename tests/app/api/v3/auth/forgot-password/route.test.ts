import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeHeaderStore } from "../_test-harness";

/**
 * Route-level tests for POST /api/v3/auth/forgot-password.
 *
 * Mocked at the network/database boundary only (see tests/README.md): the
 * pg pool and outbound email sends. checkRateLimit and the token hashing
 * (sha256, real node:crypto) run for real against the mocked pool.
 *
 * The route's whole point is not revealing whether an email exists, so the
 * central test here compares the full response (status + body) for an
 * unknown email against a known one.
 */

const queries: { sql: string; params: unknown[] }[] = [];
const rateLimitCounts = new Map<string, number>();

const knownUsers = new Map<string, { id: number; totp_enabled: boolean }>();
let tokenDeleteCalls: unknown[][] = [];
let tokenInsertCalls: unknown[][] = [];

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
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("SELECT id, totp_enabled FROM users WHERE email = $1")) {
    const row = knownUsers.get(params[0] as string);
    return { rows: row ? [row] : [] };
  }
  if (s.startsWith("DELETE FROM password_reset_tokens WHERE user_id = $1")) {
    tokenDeleteCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO password_reset_tokens")) {
    tokenInsertCalls.push(params);
    return { rows: [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { store: headerStore, state: headerState } = makeHeaderStore();
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
  return {
    ...actual,
    sendEmail: (params: unknown) => mockSendEmail(params),
  };
});

const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { POST } = await import("@/app/api/v3/auth/forgot-password/route");

function forgotRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  // Drain any queueMicrotask/setImmediate email sends left pending by the
  // previous test before resetting mocks.
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockClear();
  mockSendEmail.mockClear();
  queries.length = 0;
  rateLimitCounts.clear();
  headerState.clear();
  headerState.set("x-forwarded-for", "203.0.113.11");
  knownUsers.clear();
  tokenDeleteCalls = [];
  tokenInsertCalls = [];
  invalidateSettingsCache();
});

describe("POST /api/v3/auth/forgot-password", () => {
  it("rejects a missing email", async () => {
    const res = await POST(forgotRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed email", async () => {
    const res = await POST(forgotRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("returns the exact same response for an unknown email as for a known one, and only creates a token for the real account", async () => {
    knownUsers.set("account-owner@example.com", {
      id: 55,
      totp_enabled: false,
    });

    const unknownRes = await POST(
      forgotRequest({ email: "nobody@example.com" }),
    );
    const unknownJson = await unknownRes.json();
    expect(tokenInsertCalls).toHaveLength(0);

    const knownRes = await POST(
      forgotRequest({ email: "account-owner@example.com" }),
    );
    const knownJson = await knownRes.json();

    expect(unknownRes.status).toBe(knownRes.status);
    expect(unknownJson).toEqual(knownJson);
    expect(tokenInsertCalls).toHaveLength(1);
  });

  it("stores a hashed token, never the raw one, for a known email", async () => {
    knownUsers.set("account-owner@example.com", {
      id: 55,
      totp_enabled: false,
    });

    await POST(forgotRequest({ email: "account-owner@example.com" }));

    expect(tokenInsertCalls).toHaveLength(1);
    const [userId, tokenHash] = tokenInsertCalls[0];
    expect(userId).toBe(55);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("deletes any pre-existing reset tokens for the account before issuing a new one", async () => {
    knownUsers.set("account-owner@example.com", {
      id: 55,
      totp_enabled: false,
    });

    await POST(forgotRequest({ email: "account-owner@example.com" }));

    expect(tokenDeleteCalls).toEqual([[55]]);
  });

  it("queues the reset email for a known account", async () => {
    knownUsers.set("account-owner@example.com", {
      id: 55,
      totp_enabled: false,
    });

    await POST(forgotRequest({ email: "account-owner@example.com" }));
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
      to: "account-owner@example.com",
    });
  });

  it("does not send an email for an unknown account", async () => {
    await POST(forgotRequest({ email: "nobody@example.com" }));
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("rate limits repeated requests from the same IP", async () => {
    rateLimitCounts.set("forgot:203.0.113.11", 3); // maxAttempts is 3 -> next call denied

    const res = await POST(
      forgotRequest({ email: "account-owner@example.com" }),
    );

    expect(res.status).toBe(429);
    expect(tokenInsertCalls).toHaveLength(0);
  });

  it("rate limits repeated requests for the same email across different IPs", async () => {
    knownUsers.set("account-owner@example.com", {
      id: 55,
      totp_enabled: false,
    });
    rateLimitCounts.set("forgot-email:account-owner@example.com", 3); // maxAttempts is 3

    const res = await POST(
      forgotRequest({ email: "Account-Owner@Example.com" }),
    );

    expect(res.status).toBe(429);
    expect(tokenInsertCalls).toHaveLength(0);
  });

  it("checks the IP rate limit before even parsing the request body", async () => {
    rateLimitCounts.set("forgot:203.0.113.11", 3);

    // A malformed body would normally 400 on parseBody/Validate.email, but
    // the IP rate limit check runs first in the route, so this must still
    // be a 429, not a 400.
    const res = await POST(
      new NextRequest("http://localhost/api/v3/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      }),
    );

    expect(res.status).toBe(429);
  });
});
