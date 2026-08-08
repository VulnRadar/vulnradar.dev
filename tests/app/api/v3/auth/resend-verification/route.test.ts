import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { makeHeaderStore } from "../_test-harness";

/**
 * Route-level tests for POST /api/v3/auth/resend-verification.
 *
 * Mocked at the network/database boundary only: the pg pool and outbound
 * email. checkRateLimit and the real emailVerificationEmail template run
 * for real.
 *
 * Regression target: this route's own comment documents that a previous
 * version stored the *raw* token while verify-email hashed it, so every
 * resend-generated link was dead on arrival. The last test below extracts
 * the raw token actually emailed to the user and independently verifies
 * its sha256 matches what got stored as token_hash -- proving the fix
 * end-to-end through the real hashing code, not a copy of it.
 */

const queries: { sql: string; params: unknown[] }[] = [];
const rateLimitCounts = new Map<string, number>();

let userRow: {
  id: number;
  name: string | null;
  email_verified_at: string | null;
} | null = null;
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
  if (
    s.startsWith(
      "SELECT id, name, email_verified_at FROM users WHERE LOWER(email) = $1",
    )
  ) {
    return { rows: userRow ? [userRow] : [] };
  }
  if (
    s.startsWith("DELETE FROM email_verification_tokens WHERE user_id = $1")
  ) {
    tokenDeleteCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO email_verification_tokens")) {
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
const { POST } = await import("@/app/api/v3/auth/resend-verification/route");

function resendRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/auth/resend-verification", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockClear();
  mockSendEmail.mockClear();
  queries.length = 0;
  rateLimitCounts.clear();
  headerState.clear();
  headerState.set("x-forwarded-for", "203.0.113.21");
  userRow = null;
  tokenDeleteCalls = [];
  tokenInsertCalls = [];
  invalidateSettingsCache();
});

describe("POST /api/v3/auth/resend-verification", () => {
  it("rejects a missing email", async () => {
    const res = await POST(resendRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed email", async () => {
    const res = await POST(resendRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("rate limits repeated requests from the same IP", async () => {
    rateLimitCounts.set("resend-verify:203.0.113.21", 3); // forgotPassword limit's maxAttempts is 3

    const res = await POST(resendRequest({ email: "someone@example.com" }));

    expect(res.status).toBe(429);
    expect(tokenInsertCalls).toHaveLength(0);
  });

  it("gives the same generic response for an unknown email and an already-verified one, without creating a token either way", async () => {
    userRow = null;
    const unknownRes = await POST(
      resendRequest({ email: "nobody@example.com" }),
    );
    const unknownJson = await unknownRes.json();
    expect(tokenInsertCalls).toHaveLength(0);

    userRow = {
      id: 8,
      name: "Verified User",
      email_verified_at: new Date().toISOString(),
    };
    const verifiedRes = await POST(
      resendRequest({ email: "verified@example.com" }),
    );
    const verifiedJson = await verifiedRes.json();

    expect(unknownRes.status).toBe(verifiedRes.status);
    expect(unknownJson).toEqual(verifiedJson);
    expect(tokenInsertCalls).toHaveLength(0);
  });

  it("issues a new token for a known, unverified account, deleting old ones first", async () => {
    userRow = { id: 8, name: "Pending User", email_verified_at: null };

    const res = await POST(resendRequest({ email: "pending@example.com" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/if an account exists/i);
    expect(tokenDeleteCalls).toEqual([[8]]);
    expect(tokenInsertCalls).toHaveLength(1);
  });

  it("regression: the raw token emailed to the user hashes (sha256) to exactly the token_hash stored in the DB", async () => {
    userRow = { id: 8, name: "Pending User", email_verified_at: null };

    await POST(resendRequest({ email: "pending@example.com" }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailedText = (mockSendEmail.mock.calls[0][0] as { text: string })
      .text;
    const match = emailedText.match(/\?token=([a-f0-9]+)/);
    expect(match).not.toBeNull();
    const rawToken = match![1];

    expect(tokenInsertCalls).toHaveLength(1);
    const [, storedTokenHash] = tokenInsertCalls[0];
    expect(storedTokenHash).toBe(
      createHash("sha256").update(rawToken).digest("hex"),
    );
  });
});
