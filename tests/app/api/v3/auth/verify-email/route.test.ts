import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash, createHmac } from "node:crypto";
import { ALL_COLUMNS } from "@/lib/notifications/columns";

/**
 * Route-level tests for /api/v3/auth/verify-email (POST and GET).
 *
 * Mocked at the network/database boundary only: the pg pool and the
 * outbound mail send. The route has no rate limiting and no session; the
 * headers it reads for the change notice come from next/headers.
 */

const queries: { sql: string; params: unknown[] }[] = [];

let tokenRow: {
  id: number;
  user_id: number;
  expires_at: string;
  token_email: string | null;
  email: string;
  pending_email?: string | null;
  name: string | null;
  email_verified_at: string | null;
} | null = null;
let usedTokenRow: { id: number; used_at: string | null } | null = null;

let deletedTokenIds: unknown[][] = [];
let verifiedUserCalls: unknown[][] = [];
let tokenUsedCalls: unknown[][] = [];
let verifiedUserRowCount = 1;
let swapCalls: unknown[][] = [];
let swapRowCount = 1;
let swapError: (Error & { code?: string }) | null = null;
let addressOwnerRow: { id: number } | null = null;
let pendingDroppedCalls: unknown[][] = [];
let prefsRow: Record<string, boolean> | null = null;

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });

  if (
    s.includes("FROM email_verification_tokens evt") &&
    s.includes("FOR UPDATE")
  ) {
    return { rows: tokenRow ? [tokenRow] : [] };
  }
  if (s.startsWith("SELECT id, used_at FROM email_verification_tokens")) {
    return { rows: usedTokenRow ? [usedTokenRow] : [] };
  }
  if (s.startsWith("DELETE FROM email_verification_tokens WHERE id = $1")) {
    deletedTokenIds.push(params);
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET email_verified_at = NOW()")) {
    verifiedUserCalls.push(params);
    return { rows: [], rowCount: verifiedUserRowCount };
  }
  if (s.startsWith("UPDATE users SET email = pending_email")) {
    if (swapError) throw swapError;
    swapCalls.push(params);
    return { rows: [], rowCount: swapRowCount };
  }
  if (
    s.startsWith("SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2")
  ) {
    return { rows: addressOwnerRow ? [addressOwnerRow] : [] };
  }
  if (s.startsWith("UPDATE users SET pending_email = NULL")) {
    pendingDroppedCalls.push(params);
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith("UPDATE email_verification_tokens SET used_at = NOW()")) {
    tokenUsedCalls.push(params);
    return { rows: [] };
  }
  if (s.includes("FROM notification_preferences WHERE user_id")) {
    return { rows: prefsRow ? [prefsRow] : [] };
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

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === "user-agent" ? "vitest-agent" : null,
  }),
  cookies: async () => ({ get: () => undefined }),
}));

const sentMail: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    sendEmail: async (params: {
      to: string;
      subject: string;
      text: string;
    }) => {
      sentMail.push(params);
    },
  };
});

async function flushMail() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

// A configured secret, so the keyed digest and the old unkeyed one differ and
// a test can tell which of the two the route looked up.
const SECRET = "verify-email-test-secret-0123456789abcdef";
vi.stubEnv("AUTH_SECRET", SECRET);
afterAll(() => {
  vi.unstubAllEnvs();
});

const { POST, GET } = await import("@/app/api/v3/auth/verify-email/route");

function verifyPostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/auth/verify-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validToken(overrides: Partial<NonNullable<typeof tokenRow>> = {}) {
  return {
    id: 3,
    user_id: 10,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    token_email: "new-user@example.com",
    email: "new-user@example.com",
    name: "New User",
    email_verified_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockClear();
  queries.length = 0;
  tokenRow = null;
  usedTokenRow = null;
  deletedTokenIds = [];
  verifiedUserCalls = [];
  tokenUsedCalls = [];
  verifiedUserRowCount = 1;
  swapCalls = [];
  swapRowCount = 1;
  swapError = null;
  addressOwnerRow = null;
  pendingDroppedCalls = [];
  prefsRow = null;
  sentMail.length = 0;
});

describe("POST /api/v3/auth/verify-email", () => {
  it("rejects a missing token", async () => {
    const res = await POST(verifyPostRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects a non-string token", async () => {
    const res = await POST(verifyPostRequest({ token: 12345 }));
    expect(res.status).toBe(400);
  });

  // An unknown link gets the reply an expired one gets: there is nothing the
  // reader can do with "invalid" that "request a new one" does not cover, and
  // a link minted before the keyed digest now lands here too.
  it("answers a token that matches no row the way it answers an expired one", async () => {
    tokenRow = null;
    usedTokenRow = null;

    const res = await POST(verifyPostRequest({ token: "never-issued" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(
      "This verification link has expired. Please request a new one.",
    );
    expect(verifiedUserCalls).toHaveLength(0);
  });

  it("rejects an already-used token with a distinct message", async () => {
    tokenRow = null; // the used_at IS NULL lookup finds nothing
    usedTokenRow = { id: 3, used_at: new Date().toISOString() }; // but the row exists

    const res = await POST(verifyPostRequest({ token: "already-used" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/already been used/i);
    expect(verifiedUserCalls).toHaveLength(0);
  });

  it("returns alreadyVerified without re-updating anything when the account is already verified", async () => {
    tokenRow = validToken({ email_verified_at: new Date().toISOString() });

    const res = await POST(verifyPostRequest({ token: "valid-token" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.alreadyVerified).toBe(true);
    expect(verifiedUserCalls).toHaveLength(0);
    expect(tokenUsedCalls).toHaveLength(0);
  });

  it("rejects an expired token and deletes it", async () => {
    tokenRow = validToken({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const res = await POST(verifyPostRequest({ token: "expired-token" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/expired/i);
    expect(deletedTokenIds).toEqual([[3]]);
    expect(verifiedUserCalls).toHaveLength(0);
  });

  it("verifies the account on a valid token and marks the token used", async () => {
    tokenRow = validToken();

    const res = await POST(verifyPostRequest({ token: "valid-token" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.verified).toBe(true);
    expect(json.user).toEqual({
      email: "new-user@example.com",
      name: "New User",
    });
    expect(verifiedUserCalls).toEqual([[10, "new-user@example.com"]]);
    expect(tokenUsedCalls).toEqual([[3]]);
  });

  // A token proves control of the address it was mailed to, nothing else.
  // Sign up as attacker@x, change the account to victim@y, then click the
  // link from attacker@x's inbox: without the binding that set
  // email_verified_at on victim@y, and a verified address is what OAuth
  // sign-in and staff invites trust to pick the account.
  it("refuses a token mailed to an address the account no longer has", async () => {
    tokenRow = validToken({
      token_email: "attacker@example.com",
      email: "victim@example.com",
    });

    const res = await POST(verifyPostRequest({ token: "old-address-token" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/request a new one/i);
    expect(verifiedUserCalls).toHaveLength(0);
    expect(tokenUsedCalls).toHaveLength(0);
    expect(deletedTokenIds).toEqual([[3]]);
  });

  it("refuses a token issued before tokens recorded their address", async () => {
    tokenRow = validToken({ token_email: null });

    const res = await POST(verifyPostRequest({ token: "unbound-token" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/request a new one/i);
    expect(verifiedUserCalls).toHaveLength(0);
    expect(tokenUsedCalls).toHaveLength(0);
  });

  it("matches the account's address case-insensitively", async () => {
    tokenRow = validToken({ email: "New-User@Example.com" });

    const res = await POST(verifyPostRequest({ token: "valid-token" }));

    expect(res.status).toBe(200);
    expect(verifiedUserCalls).toEqual([[10, "new-user@example.com"]]);
  });

  // The UPDATE carries the address too, so the flag can only land on the
  // address the token was mailed to even if the row changed after the lookup.
  it("sets the flag only where the account still holds the token's address", async () => {
    tokenRow = validToken();
    verifiedUserRowCount = 0;

    const res = await POST(verifyPostRequest({ token: "valid-token" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/request a new one/i);
    const update = queries.find((q) =>
      q.sql.startsWith("UPDATE users SET email_verified_at = NOW()"),
    );
    expect(update?.sql).toMatch(/WHERE id = \$1 AND LOWER\(email\) = \$2/);
    expect(tokenUsedCalls).toHaveLength(0);
    expect(queries.map((q) => q.sql)).toContain("ROLLBACK");
  });

  // AUDIT-002#secrets-03 made the stored digest HMAC-SHA256 keyed with the
  // server secret. The lookup used to try the old unkeyed sha256 too, for
  // links already in an inbox when that shipped, but every such row predates
  // the address binding and is refused anyway, so the keyed digest is the
  // only thing a link is matched by now.
  it("looks the token up by its keyed hash only, never the raw value or the unkeyed digest", async () => {
    tokenRow = validToken();
    const rawToken = "plaintext-verification-token";

    await POST(verifyPostRequest({ token: rawToken }));

    const keyed = createHmac("sha256", SECRET).update(rawToken).digest("hex");
    const unkeyed = createHash("sha256").update(rawToken).digest("hex");
    const lookups = queries.filter((q) =>
      /FROM email_verification_tokens/.test(q.sql),
    );
    expect(lookups.length).toBeGreaterThan(0);
    for (const lookup of lookups) {
      expect(JSON.stringify(lookup.params)).not.toContain(rawToken);
      expect(JSON.stringify(lookup.params)).not.toContain(unkeyed);
    }
    const select = lookups.find((q) => q.sql.includes("FOR UPDATE"));
    expect(select?.params).toEqual([keyed]);
  });

  it("checks for an already-used link by the keyed hash only", async () => {
    tokenRow = null;
    usedTokenRow = { id: 3, used_at: new Date().toISOString() };
    const rawToken = "used-verification-token";

    await POST(verifyPostRequest({ token: rawToken }));

    const keyed = createHmac("sha256", SECRET).update(rawToken).digest("hex");
    const usedLookup = queries.find((q) =>
      q.sql.startsWith("SELECT id, used_at FROM email_verification_tokens"),
    );
    expect(usedLookup?.params).toEqual([keyed]);
  });
});

// sec-auth-3. A profile email change waits in users.pending_email, and the
// link mailed to the new address is what moves the account onto it. Until
// then the account keeps signing in, recovering and receiving mail at the
// address it has.
describe("POST /api/v3/auth/verify-email for a pending address", () => {
  function pendingToken(overrides: Partial<NonNullable<typeof tokenRow>> = {}) {
    return validToken({
      token_email: "moved@example.com",
      email: "old@example.com",
      pending_email: "moved@example.com",
      email_verified_at: new Date().toISOString(),
      ...overrides,
    });
  }

  it("swaps the pending address in, verified, and marks the token used", async () => {
    tokenRow = pendingToken();

    const res = await POST(verifyPostRequest({ token: "pending-token" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.verified).toBe(true);
    expect(json.emailChanged).toBe(true);
    expect(json.user.email).toBe("moved@example.com");
    expect(swapCalls).toEqual([[10, "moved@example.com"]]);
    const swap = queries.find((q) =>
      q.sql.startsWith("UPDATE users SET email = pending_email"),
    );
    // The address, the flag and the pending column move together, and only
    // while the row still holds the address the link was mailed to.
    expect(swap?.sql).toMatch(/pending_email = NULL/);
    expect(swap?.sql).toMatch(/email_verified_at = NOW\(\)/);
    expect(swap?.sql).toMatch(
      /WHERE id = \$1 AND LOWER\(pending_email\) = \$2/,
    );
    expect(tokenUsedCalls).toEqual([[3]]);
    // Not the "already verified" short cut: the account's old address being
    // verified says nothing about the new one.
    expect(json.alreadyVerified).toBeUndefined();
    expect(verifiedUserCalls).toHaveLength(0);
  });

  // Every preference switched off, account changes included: the notice is
  // the mail that tells an owner their account moved, so it is sent as the
  // security type, which no preference silences. Sent as account_changes it
  // would be held back here.
  it("tells the old address, as a security notice, and confirms to the new one", async () => {
    tokenRow = pendingToken();
    prefsRow = Object.fromEntries(ALL_COLUMNS.map((c) => [c, false]));

    await POST(verifyPostRequest({ token: "pending-token" }));
    await flushMail();

    const toOld = sentMail.filter((m) => m.to === "old@example.com");
    expect(toOld).toHaveLength(1);
    expect(toOld[0].subject).toMatch(/email was changed/i);
    expect(toOld[0].text).toContain("moved@example.com");
    expect(sentMail.some((m) => m.to === "moved@example.com")).toBe(true);
  });

  it("refuses a link for a pending address that was replaced since", async () => {
    tokenRow = pendingToken({ pending_email: "third@example.com" });

    const res = await POST(verifyPostRequest({ token: "pending-token" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/request a new one/i);
    expect(swapCalls).toHaveLength(0);
    expect(deletedTokenIds).toEqual([[3]]);
  });

  it("refuses an expired link for a pending address", async () => {
    tokenRow = pendingToken({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const res = await POST(verifyPostRequest({ token: "pending-token" }));

    expect(res.status).toBe(400);
    expect(swapCalls).toHaveLength(0);
  });

  // A pending address reserves nothing. Someone else can sign up with it
  // meanwhile, and then the link cannot hand them the same address twice.
  it("drops the pending address when another account has taken it since", async () => {
    tokenRow = pendingToken();
    addressOwnerRow = { id: 99 };

    const res = await POST(verifyPostRequest({ token: "pending-token" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/another account/i);
    expect(swapCalls).toHaveLength(0);
    expect(pendingDroppedCalls).toEqual([[10, "moved@example.com"]]);
    expect(deletedTokenIds).toEqual([[3]]);
    expect(queries.map((q) => q.sql)).toContain("COMMIT");
  });

  it("drops the pending address when the swap loses a race for it", async () => {
    tokenRow = pendingToken();
    swapError = Object.assign(new Error("duplicate key"), { code: "23505" });

    const res = await POST(verifyPostRequest({ token: "pending-token" }));

    expect(res.status).toBe(409);
    expect(pendingDroppedCalls).toEqual([[10, "moved@example.com"]]);
    expect(deletedTokenIds).toEqual([[3]]);
    expect(tokenUsedCalls).toHaveLength(0);
  });

  it("refuses when the row no longer holds the pending address at the write", async () => {
    tokenRow = pendingToken();
    swapRowCount = 0;

    const res = await POST(verifyPostRequest({ token: "pending-token" }));

    expect(res.status).toBe(400);
    expect(tokenUsedCalls).toHaveLength(0);
    expect(queries.map((q) => q.sql)).toContain("ROLLBACK");
  });
});

describe("GET /api/v3/auth/verify-email", () => {
  it("redirects to /login with an error when no token is present", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/v3/auth/verify-email"),
    );
    expect([307, 308]).toContain(res.status);
    const location = res.headers.get("location") || "";
    expect(location).toContain("/login");
    expect(location).toContain("error=invalid_token");
  });

  it("redirects to the verify-email page with the token when present", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/v3/auth/verify-email?token=abc123"),
    );
    expect([307, 308]).toContain(res.status);
    const location = res.headers.get("location") || "";
    expect(location).toContain("/verify-email?token=abc123");
  });
});
