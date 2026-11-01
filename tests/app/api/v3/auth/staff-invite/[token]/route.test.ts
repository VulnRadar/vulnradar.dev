/**
 * Route-level tests for the public staff-invite acceptance endpoints
 * (GET/POST /api/v3/auth/staff-invite/[token], AUDIT-010 admin-feature-gap).
 * No session required by design -- knowledge of the emailed token proves
 * control of the invited inbox, same trust model as
 * app/api/v3/auth/reset-password/route.ts.
 *
 * Mocked at the network/database boundary only: the pg pool (including
 * pool.connect()'s transactional client), the audit writer, and
 * getSetting(). hashPassword, analyzePassword, checkPasswordRequirements,
 * and the token hashing all run for real; hashPassword is wrapped only to
 * record WHEN it runs relative to the transaction.
 *
 * The fake answers by statement rather than by call order, so these tests say
 * what the route reads and writes, not the sequence it happens to use.
 *
 * Primary focus areas:
 *  - Replay protection: an already-accepted or expired invite is rejected,
 *    and the token is looked up by its SHA-256 hash, never plaintext.
 *  - Email binding: accepting an invite only ever creates or promotes the
 *    account matching the invite's own email -- the request body has no
 *    email field for a caller to redirect the promotion elsewhere.
 *  - Verified binding (sec-auth-2): an account that merely LISTS the invited
 *    address is not the invitee. PATCH /api/v3/auth/update lets any account
 *    move to an unclaimed address, clearing email_verified_at, so promoting
 *    whatever row held the address made a plain user staff, up to admin.
 *  - super_admin account-integrity regression: an invite can never be used
 *    to change an existing super_admin's role, even if one somehow exists
 *    (defense in depth behind the create-side guard).
 *  - The password is hashed before the transaction opens, so the scrypt
 *    limiter's queue never holds a pool connection and the invite row lock.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

interface InviteRow {
  id: number;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
}
interface UserRow {
  id: number;
  role: string;
  email_verified_at: string | null;
}

const VERIFIED_AT = "2026-01-01T00:00:00.000Z";

let inviteRow: InviteRow | null = null;
let userRow: UserRow | null = null;
// What the transaction sees when it differs from the read before it, for the
// races between the two.
let userRowInTx: UserRow | null | undefined = undefined;
let userLookupFails = false;

const events: string[] = [];
const poolCalls: { sql: string; params: unknown[] }[] = [];
const clientCalls: { sql: string; params: unknown[] }[] = [];

function usersByEmail(sql: string): boolean {
  return /FROM users\s+WHERE email = \$1/.test(sql);
}

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  poolCalls.push({ sql, params });
  if (sql.includes("FROM staff_invites")) {
    return { rows: inviteRow ? [inviteRow] : [] };
  }
  if (usersByEmail(sql)) {
    if (userLookupFails) throw new Error("connection terminated");
    return { rows: userRow ? [{ email: inviteRow?.email, ...userRow }] : [] };
  }
  if (sql.includes("INSERT INTO security_alerts")) events.push("alert");
  return { rows: [] };
});

const mockClientQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  clientCalls.push({ sql, params });
  if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
    events.push(sql);
    return { rows: [] };
  }
  if (sql.includes("FROM staff_invites")) {
    return { rows: inviteRow ? [inviteRow] : [] };
  }
  if (usersByEmail(sql)) {
    const row = userRowInTx === undefined ? userRow : userRowInTx;
    return { rows: row ? [row] : [] };
  }
  if (sql.includes("INSERT INTO users")) return { rows: [{ id: 900 }] };
  return { rows: [] };
});
const mockClientRelease = vi.fn(() => {
  events.push("release");
});
const mockConnect = vi.fn(async () => {
  events.push("connect");
  return { query: mockClientQuery, release: mockClientRelease };
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
    connect: () => mockConnect(),
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    hashPassword: async (password: string) => {
      events.push("hash");
      return actual.hashPassword(password);
    },
  };
});

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const { GET, POST } =
  await import("@/app/api/v3/auth/staff-invite/[token]/route");
const { createHash } = await import("node:crypto");

const STRONG_PASSWORD = "Qx7#Lm2Wdftz9";
const PLAINTEXT_TOKEN = "a".repeat(64);
const TOKEN_HASH = createHash("sha256").update(PLAINTEXT_TOKEN).digest("hex");
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

function invite(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: 7,
    email: "invitee@example.com",
    role: "support",
    expires_at: FUTURE,
    accepted_at: null,
    ...overrides,
  };
}

function ctx() {
  return { params: Promise.resolve({ token: PLAINTEXT_TOKEN }) };
}

function getRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/v3/auth/staff-invite/${PLAINTEXT_TOKEN}`,
    { headers: { "user-agent": "vitest-agent" } },
  );
}

function postRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(
    `http://localhost/api/v3/auth/staff-invite/${PLAINTEXT_TOKEN}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "vitest-agent",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

const allCalls = () => [...poolCalls, ...clientCalls];
const callsMatching = (fragment: string) =>
  allCalls().filter((c) => c.sql.includes(fragment));

beforeEach(() => {
  inviteRow = invite();
  userRow = null;
  userRowInTx = undefined;
  userLookupFails = false;
  events.length = 0;
  poolCalls.length = 0;
  clientCalls.length = 0;
  mockQuery.mockClear();
  mockClientQuery.mockClear();
  mockClientRelease.mockClear();
  mockConnect.mockClear();
  mockLogAction.mockReset();
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(8);
});

describe("GET /api/v3/auth/staff-invite/[token]", () => {
  it("looks the invite up by the SHA-256 hash of the token, never the plaintext", async () => {
    await GET(getRequest(), ctx());

    const lookup = poolCalls.find((c) => c.sql.includes("FROM staff_invites"));
    expect(lookup!.sql).toContain("WHERE token = $1");
    expect(lookup!.params[0]).toBe(TOKEN_HASH);
    expect(lookup!.params[0]).not.toBe(PLAINTEXT_TOKEN);
  });

  it("returns 404 for an unknown token", async () => {
    inviteRow = null;
    const res = await GET(getRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("rejects an already-accepted invite (replay protection)", async () => {
    inviteRow = invite({ accepted_at: new Date().toISOString() });
    const res = await GET(getRequest(), ctx());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already been accepted/i);
  });

  it("rejects an expired invite", async () => {
    inviteRow = invite({ expires_at: PAST });
    const res = await GET(getRequest(), ctx());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/expired/i);
  });

  it("reports an existing verified account for the invited email", async () => {
    userRow = { id: 3, role: "user", email_verified_at: VERIFIED_AT };
    const res = await GET(getRequest(), ctx());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.email).toBe("invitee@example.com");
    expect(json.role).toBe("support");
    expect(json.hasAccount).toBe(true);
  });

  it("reports no account when the invited email has none", async () => {
    const res = await GET(getRequest(), ctx());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.hasAccount).toBe(false);
  });

  it("refuses, and raises an alert, when the account holding the address never verified it", async () => {
    userRow = { id: 3, role: "user", email_verified_at: null };

    const res = await GET(getRequest(), ctx());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("This invite can no longer be accepted.");
    expect(json).not.toHaveProperty("hasAccount");
    // The invitee's GET is usually the only request this case ever sees: the
    // account that claimed the address has no token to POST with.
    const alerts = callsMatching("INSERT INTO security_alerts");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].params[0]).toBe(3);
  });

  it("answers 500, not hasAccount: false, when the account lookup fails", async () => {
    // getUserByEmail used to swallow the error and return null, so an outage
    // told an existing account holder they had no account and sent them to the
    // create-a-password form.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    userLookupFails = true;

    const res = await GET(getRequest(), ctx());

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).not.toHaveProperty("hasAccount");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("POST /api/v3/auth/staff-invite/[token] — replay & lookup", () => {
  it("re-reads the invite FOR UPDATE by the token hash inside the transaction", async () => {
    userRow = { id: 55, role: "user", email_verified_at: VERIFIED_AT };

    await POST(postRequest({}), ctx());

    const locked = clientCalls.find((c) => c.sql.includes("FOR UPDATE"));
    expect(locked!.sql).toContain("FROM staff_invites");
    expect(locked!.params[0]).toBe(TOKEN_HASH);
    for (const c of allCalls().filter((x) =>
      x.sql.includes("FROM staff_invites"),
    )) {
      expect(c.params[0]).not.toBe(PLAINTEXT_TOKEN);
    }
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown token", async () => {
    inviteRow = null;
    const res = await POST(postRequest({}), ctx());
    expect(res.status).toBe(400);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects an already-accepted invite (replay protection)", async () => {
    inviteRow = invite({ accepted_at: new Date().toISOString() });
    const res = await POST(postRequest({}), ctx());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already been accepted/i);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects an expired invite", async () => {
    inviteRow = invite({ expires_at: PAST });
    const res = await POST(postRequest({}), ctx());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/expired/i);
  });

  it("still rejects an invite accepted between the first read and the lock", async () => {
    userRow = { id: 55, role: "user", email_verified_at: VERIFIED_AT };
    // The read before the transaction sees it open; the locked read does not.
    mockClientQuery.mockImplementationOnce(async (sql: string) => {
      clientCalls.push({ sql, params: [] });
      events.push(sql);
      return { rows: [] };
    }); // BEGIN
    mockClientQuery.mockImplementationOnce(async (sql: string) => {
      clientCalls.push({ sql, params: [] });
      return { rows: [invite({ accepted_at: new Date().toISOString() })] };
    });

    const res = await POST(postRequest({}), ctx());

    expect(res.status).toBe(400);
    expect(callsMatching("UPDATE users SET role")).toHaveLength(0);
    expect(events).toContain("ROLLBACK");
  });
});

describe("POST /api/v3/auth/staff-invite/[token] — super_admin account protection", () => {
  it("refuses to change an existing super_admin's role, even for an invite that exists targeting them", async () => {
    inviteRow = invite({ email: "root@example.com", role: "admin" });
    userRow = { id: 1, role: "super_admin", email_verified_at: VERIFIED_AT };

    const res = await POST(postRequest({}), ctx());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/can no longer be accepted/i);
    // No UPDATE users, no accepted_at write, no commit -- just rollback.
    expect(events).toContain("ROLLBACK");
    expect(events).not.toContain("COMMIT");
    expect(callsMatching("UPDATE users SET role")).toHaveLength(0);
    expect(mockLogAction).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/auth/staff-invite/[token] — verified binding (sec-auth-2)", () => {
  it("refuses an unverified account holding the invited address: no promotion, invite stays open, alert raised", async () => {
    // The attack: a plain user points their account at the invitee's address
    // (allowed, it just clears email_verified_at). Whoever holds the token
    // then accepts, and the route promoted the squatter instead.
    inviteRow = invite({ role: "admin" });
    userRow = { id: 66, role: "user", email_verified_at: null };

    const res = await POST(postRequest({}), ctx());

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const json = await res.json();
    expect(json.error).toBe("This invite can no longer be accepted.");
    expect(callsMatching("UPDATE users SET role")).toHaveLength(0);
    expect(callsMatching("SET accepted_at")).toHaveLength(0);
    expect(events).not.toContain("COMMIT");
    expect(mockLogAction).not.toHaveBeenCalled();

    const alerts = callsMatching("INSERT INTO security_alerts");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].params[0]).toBe(66);
    // Written once the transaction has let go of its connection, not while
    // holding the invite row lock.
    expect(events.indexOf("release")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("release")).toBeLessThan(events.indexOf("alert"));
  });

  it("refuses when the address lost its verification between the first read and the lock", async () => {
    userRow = { id: 66, role: "user", email_verified_at: VERIFIED_AT };
    userRowInTx = { id: 66, role: "user", email_verified_at: null };

    const res = await POST(postRequest({}), ctx());

    expect(res.status).toBe(400);
    expect(callsMatching("UPDATE users SET role")).toHaveLength(0);
    expect(callsMatching("SET accepted_at")).toHaveLength(0);
  });

  it("locks the account row it checks, so the address cannot change before the promotion", async () => {
    userRow = { id: 55, role: "user", email_verified_at: VERIFIED_AT };

    await POST(postRequest({}), ctx());

    const lookup = clientCalls.find((c) => usersByEmail(c.sql));
    expect(lookup!.sql).toContain("email_verified_at");
    expect(lookup!.sql).toContain("FOR UPDATE");
  });

  it("still promotes a verified account", async () => {
    inviteRow = invite({ role: "admin" });
    userRow = { id: 55, role: "user", email_verified_at: VERIFIED_AT };

    const res = await POST(postRequest({}), ctx());

    expect(res.status).toBe(200);
    const update = callsMatching("UPDATE users SET role");
    expect(update).toHaveLength(1);
    expect(update[0].params).toEqual(["admin", 55]);
    expect(callsMatching("SET accepted_at")).toHaveLength(1);
    expect(callsMatching("INSERT INTO security_alerts")).toHaveLength(0);
  });
});

describe("POST /api/v3/auth/staff-invite/[token] — accept lifecycle", () => {
  it("promotes an existing (non-protected) account matching the invite email, without requiring a password", async () => {
    inviteRow = invite({ email: "existing@example.com", role: "moderator" });
    userRow = { id: 55, role: "support", email_verified_at: VERIFIED_AT };

    const res = await POST(postRequest({}), ctx());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.createdAccount).toBe(false);
    expect(json.email).toBe("existing@example.com");

    const updateCall = callsMatching("UPDATE users SET role")[0];
    expect(updateCall.params).toEqual(["moderator", 55]);
    expect(events).not.toContain("hash");

    expect(mockLogAction).toHaveBeenCalledWith(
      55,
      55,
      "staff_invite_accepted",
      expect.stringContaining("Promoted own account"),
      "127.0.0.1",
    );
  });

  it("creates a brand new account from the invite when none exists, requiring a valid password", async () => {
    inviteRow = invite({ email: "brandnew@example.com", role: "support" });

    const res = await POST(
      postRequest({ password: STRONG_PASSWORD, name: "New Person" }),
      ctx(),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.createdAccount).toBe(true);

    const insertCall = callsMatching("INSERT INTO users")[0];
    const [email, passwordHash, name, role] = insertCall.params as string[];
    expect(email).toBe("brandnew@example.com");
    expect(passwordHash).not.toBe(STRONG_PASSWORD);
    expect(name).toBe("New Person");
    expect(role).toBe("support");

    expect(mockLogAction).toHaveBeenCalledWith(
      900,
      900,
      "staff_invite_accepted",
      expect.stringContaining("Created staff account"),
      "127.0.0.1",
    );
  });

  it("hashes the password before the transaction opens, not while holding the invite lock", async () => {
    // scrypt runs behind a two-at-a-time limiter. Hashing inside the
    // transaction held a pool connection and the invite row lock for the
    // whole wait plus the hash.
    inviteRow = invite({ email: "brandnew@example.com" });

    const res = await POST(
      postRequest({ password: STRONG_PASSWORD, name: "New Person" }),
      ctx(),
    );

    expect(res.status).toBe(200);
    expect(events.indexOf("hash")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("hash")).toBeLessThan(events.indexOf("connect"));
    expect(events.indexOf("hash")).toBeLessThan(events.indexOf("BEGIN"));
  });

  it("refuses rather than hashing inside the transaction when the account it expected is gone", async () => {
    // The read before the transaction saw an account, so no password was
    // hashed; by the locked read it had been deleted.
    userRow = { id: 55, role: "user", email_verified_at: VERIFIED_AT };
    userRowInTx = null;

    const res = await POST(postRequest({ password: STRONG_PASSWORD }), ctx());

    expect(res.status).toBe(409);
    expect(events).not.toContain("hash");
    expect(callsMatching("INSERT INTO users")).toHaveLength(0);
    expect(callsMatching("SET accepted_at")).toHaveLength(0);
  });

  it("promotes a verified account created between the first read and the lock, wasting only the hash", async () => {
    userRow = null;
    userRowInTx = { id: 77, role: "user", email_verified_at: VERIFIED_AT };

    const res = await POST(
      postRequest({ password: STRONG_PASSWORD, name: "New Person" }),
      ctx(),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).createdAccount).toBe(false);
    expect(callsMatching("UPDATE users SET role")[0].params).toEqual([
      "support",
      77,
    ]);
    expect(callsMatching("INSERT INTO users")).toHaveLength(0);
  });

  it("saves the language of the browser that accepted the invite on the new account", async () => {
    inviteRow = invite({ email: "brandnew@example.com", role: "support" });

    const res = await POST(
      postRequest(
        { password: STRONG_PASSWORD, name: "New Person" },
        { "accept-language": "ja,en;q=0.5" },
      ),
      ctx(),
    );
    expect(res.status).toBe(200);

    const insertCall = callsMatching("INSERT INTO users")[0];
    // Written in the same INSERT, so the account never exists without it and
    // every mail after the first is in the language it was accepted in.
    expect(insertCall.sql).toContain("locale");
    expect((insertCall.params as string[])[4]).toBe("ja");
  });

  it("defaults the saved language to English when the browser says nothing", async () => {
    inviteRow = invite({ email: "brandnew@example.com", role: "support" });

    await POST(
      postRequest({ password: STRONG_PASSWORD, name: "New Person" }),
      ctx(),
    );

    const insertCall = callsMatching("INSERT INTO users")[0];
    expect((insertCall.params as string[])[4]).toBe("en");
  });

  it("rejects a weak password when creating a new account, and never opens a transaction", async () => {
    inviteRow = invite({ email: "brandnew@example.com", role: "support" });

    const res = await POST(postRequest({ password: "password" }), ctx());
    expect(res.status).toBe(400);

    expect(callsMatching("INSERT INTO users")).toHaveLength(0);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("is single-use: marks the invite accepted inside the same transaction as the role/account change", async () => {
    inviteRow = invite({ email: "existing@example.com", role: "moderator" });
    userRow = { id: 55, role: "support", email_verified_at: VERIFIED_AT };

    await POST(postRequest({}), ctx());

    const acceptedCall = clientCalls.find((c) =>
      c.sql.includes("SET accepted_at = NOW()"),
    );
    expect(acceptedCall!.params).toEqual([7]);
    // On the transaction's client, so it commits or rolls back with the role.
    expect(poolCalls.some((c) => c.sql.includes("SET accepted_at"))).toBe(
      false,
    );
    expect(events).toContain("COMMIT");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});
