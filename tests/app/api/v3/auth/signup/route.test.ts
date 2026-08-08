import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeHeaderStore } from "../_test-harness";

/**
 * Route-level tests for POST /api/v3/auth/signup.
 *
 * Mocked at the network/database boundary only (see tests/README.md): the
 * pg pool, outbound email sends, and the outbound fetch calls to Gravatar
 * and Cloudflare Turnstile (both real network I/O). createUser,
 * hashPassword, analyzePassword, checkPasswordRequirements, and
 * checkRateLimit all run for real against the mocked pool.
 */

const queries: { sql: string; params: unknown[] }[] = [];
const rateLimitCounts = new Map<string, number>();
let existingUserRow: Record<string, unknown> | null = null;
let createdUserId = 100;
let insertedUserCalls: unknown[][] = [];
let verificationTokenInserts: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });

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
  if (s.includes("WHERE email = $1") && s.includes("password_hash")) {
    return { rows: existingUserRow ? [existingUserRow] : [] };
  }
  if (s.startsWith("INSERT INTO users")) {
    insertedUserCalls.push(params);
    return {
      rows: [
        {
          id: createdUserId,
          email: (params[0] as string).toLowerCase().trim(),
          name: params[2] ?? null,
          plan: "free",
          beta_access: false,
          role: "user",
        },
      ],
    };
  }
  if (s.startsWith("DELETE FROM email_verification_tokens"))
    return { rows: [] };
  if (s.startsWith("INSERT INTO email_verification_tokens")) {
    verificationTokenInserts.push(params);
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO notification_preferences")) return { rows: [] };
  if (s.startsWith("UPDATE users SET avatar_url")) return { rows: [] };
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
  return { ...actual, sendEmail: (params: unknown) => mockSendEmail(params) };
});

let turnstileSuccess = true;
const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("gravatar.com")) {
    return new Response(null, { status: 404 });
  }
  if (url.includes("challenges.cloudflare.com")) {
    return new Response(JSON.stringify({ success: turnstileSuccess }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(null, { status: 404 });
});
vi.stubGlobal("fetch", mockFetch);

const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { APP_NAME } = await import("@/lib/config/constants");
const { POST } = await import("@/app/api/v3/auth/signup/route");

const STRONG_PASSWORD = "Qx7#Lm2Wdftz9";

function postSignup(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  // Drain any background setImmediate email sends left pending by the
  // previous test before resetting mocks, so a leftover callback can't
  // fire mid-test and inflate a call count assertion.
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockClear();
  mockSendEmail.mockClear();
  mockFetch.mockClear();
  queries.length = 0;
  rateLimitCounts.clear();
  headerState.clear();
  headerState.set("x-forwarded-for", "203.0.113.7");
  existingUserRow = null;
  createdUserId = 100;
  insertedUserCalls = [];
  verificationTokenInserts = [];
  turnstileSuccess = true;
  invalidateSettingsCache();
});

describe("POST /api/v3/auth/signup", () => {
  it("rejects a missing name", async () => {
    const res = await POST(
      postSignup({ email: "alex@example.com", password: STRONG_PASSWORD }),
    );
    expect(res.status).toBe(400);
    expect(insertedUserCalls).toHaveLength(0);
  });

  it("rejects a missing email", async () => {
    const res = await POST(
      postSignup({ name: "Alex Morgan", password: STRONG_PASSWORD }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a malformed email", async () => {
    const res = await POST(
      postSignup({
        name: "Alex Morgan",
        email: "not-an-email",
        password: STRONG_PASSWORD,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a password shorter than the configured minimum (12 chars)", async () => {
    const res = await POST(
      postSignup({
        name: "Alex Morgan",
        email: "alex.morgan@example.com",
        password: "Short1!",
      }),
    );
    expect(res.status).toBe(400);
    expect(insertedUserCalls).toHaveLength(0);
  });

  it("rejects a weak (low-entropy) password that passes the length floor", async () => {
    const res = await POST(
      postSignup({
        name: "Alex Morgan",
        email: "alex.morgan@example.com",
        // Long enough (>=12) but all-repeated-character -- low analyzePassword score.
        password: "aaaaaaaaaaaa",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/too weak/i);
    expect(insertedUserCalls).toHaveLength(0);
  });

  it("rejects a password that contains the user's own name", async () => {
    const res = await POST(
      postSignup({
        name: "Zorblaxx",
        email: "person@example.com",
        password: "Zorblaxx99$Kf",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("name");
    expect(insertedUserCalls).toHaveLength(0);
  });

  it("rejects a password that contains the user's own email local part", async () => {
    const res = await POST(
      postSignup({
        name: "Random Person",
        email: "thequickfox@example.com",
        password: "Thequickfox42$",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("email");
    expect(insertedUserCalls).toHaveLength(0);
  });

  it("rejects a password that contains the app name", async () => {
    const res = await POST(
      postSignup({
        name: "Random Person",
        email: "rand.person@example.com",
        password: `${APP_NAME}123$xy`,
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain(APP_NAME);
    expect(insertedUserCalls).toHaveLength(0);
  });

  it("rejects a duplicate email without creating a second account", async () => {
    existingUserRow = { id: 1, email: "alex.morgan@example.com" };
    const res = await POST(
      postSignup({
        name: "Alex Morgan",
        email: "alex.morgan@example.com",
        password: STRONG_PASSWORD,
      }),
    );
    expect(res.status).toBe(409);
    expect(insertedUserCalls).toHaveLength(0);
  });

  it("creates the account on a valid signup and stores a hashed (not raw) verification token", async () => {
    const res = await POST(
      postSignup({
        name: "Alex Morgan",
        email: "alex.morgan@example.com",
        password: STRONG_PASSWORD,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.requiresVerification).toBe(true);
    expect(insertedUserCalls).toHaveLength(1);
    // password_hash param (index 1) is a real scrypt hash, never the raw password.
    const storedHash = insertedUserCalls[0][1] as string;
    expect(storedHash).not.toBe(STRONG_PASSWORD);
    expect(storedHash.split(":")).toHaveLength(5);

    expect(verificationTokenInserts).toHaveLength(1);
    const [, tokenHash] = verificationTokenInserts[0] as [number, string];
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex digest, not a raw token

    // Verification email is queued via setImmediate.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("rate limits repeated signups from the same IP", async () => {
    rateLimitCounts.set("signup:203.0.113.7", 3); // maxAttempts is 3 -> next call is denied

    const res = await POST(
      postSignup({
        name: "Alex Morgan",
        email: "alex.morgan@example.com",
        password: STRONG_PASSWORD,
      }),
    );

    expect(res.status).toBe(429);
    expect(insertedUserCalls).toHaveLength(0);
  });

  it("rate limits repeated signups for the same email across different IPs", async () => {
    rateLimitCounts.set("signup-email:alex.morgan@example.com", 5); // maxAttempts is 5

    const res = await POST(
      postSignup({
        name: "Alex Morgan",
        email: "Alex.Morgan@Example.com", // different casing, same normalized key
        password: STRONG_PASSWORD,
      }),
    );

    expect(res.status).toBe(429);
    expect(insertedUserCalls).toHaveLength(0);
  });

  describe("Turnstile captcha gating", () => {
    const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const originalSecretKey = process.env.TURNSTILE_SECRET_KEY;

    afterEach(() => {
      if (originalSiteKey === undefined)
        delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
      else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSiteKey;
      if (originalSecretKey === undefined)
        delete process.env.TURNSTILE_SECRET_KEY;
      else process.env.TURNSTILE_SECRET_KEY = originalSecretKey;
      vi.resetModules();
    });

    it("rejects signup with no captcha token once Turnstile is configured", async () => {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "test-site-key";
      process.env.TURNSTILE_SECRET_KEY = "test-secret-key";
      vi.resetModules();
      const { POST: gatedPOST } =
        await import("@/app/api/v3/auth/signup/route");

      const res = await gatedPOST(
        postSignup({
          name: "Alex Morgan",
          email: "alex.morgan@example.com",
          password: STRONG_PASSWORD,
        }),
      );
      expect(res.status).toBe(400);
      expect(insertedUserCalls).toHaveLength(0);
    });

    it("rejects signup when Cloudflare reports the captcha token invalid", async () => {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "test-site-key";
      process.env.TURNSTILE_SECRET_KEY = "test-secret-key";
      vi.resetModules();
      turnstileSuccess = false;
      const { POST: gatedPOST } =
        await import("@/app/api/v3/auth/signup/route");

      const res = await gatedPOST(
        postSignup({
          name: "Alex Morgan",
          email: "alex.morgan@example.com",
          password: STRONG_PASSWORD,
          turnstileToken: "bad-token",
        }),
      );
      expect(res.status).toBe(400);
      expect(insertedUserCalls).toHaveLength(0);
    });

    it("allows signup once Cloudflare reports the captcha token valid", async () => {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "test-site-key";
      process.env.TURNSTILE_SECRET_KEY = "test-secret-key";
      vi.resetModules();
      turnstileSuccess = true;
      const { POST: gatedPOST } =
        await import("@/app/api/v3/auth/signup/route");

      const res = await gatedPOST(
        postSignup({
          name: "Alex Morgan",
          email: "alex.morgan@example.com",
          password: STRONG_PASSWORD,
          turnstileToken: "good-token",
        }),
      );
      expect(res.status).toBe(200);
      expect(insertedUserCalls).toHaveLength(1);
    });
  });
});
