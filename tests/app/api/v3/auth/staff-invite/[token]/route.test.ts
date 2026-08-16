/**
 * Route-level tests for the public staff-invite acceptance endpoints
 * (GET/POST /api/v3/auth/staff-invite/[token], AUDIT-010 admin-feature-gap).
 * No session required by design -- knowledge of the emailed token proves
 * control of the invited inbox, same trust model as
 * app/api/v3/auth/reset-password/route.ts.
 *
 * Mocked at the network/database boundary only: the pg pool (including
 * pool.connect()'s transactional client), outbound email, and
 * getSetting(). hashPassword, analyzePassword, checkPasswordRequirements,
 * and the token hashing all run for real.
 *
 * Primary focus areas:
 *  - Replay protection: an already-accepted or expired invite is rejected,
 *    and the token is looked up by its SHA-256 hash, never plaintext.
 *  - Email binding: accepting an invite only ever creates or promotes the
 *    account matching the invite's own email -- the request body has no
 *    email field for a caller to redirect the promotion elsewhere.
 *  - super_admin account-integrity regression: an invite can never be used
 *    to change an existing super_admin's role, even if one somehow exists
 *    (defense in depth behind the create-side guard).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn(async () => ({
  query: mockClientQuery,
  release: mockClientRelease,
}));
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () => mockConnect(),
  },
}));

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

function invite(overrides: Record<string, unknown> = {}) {
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
  );
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/v3/auth/staff-invite/${PLAINTEXT_TOKEN}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  mockConnect.mockClear();
  mockLogAction.mockReset();
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(8);
});

describe("GET /api/v3/auth/staff-invite/[token]", () => {
  it("looks the invite up by the SHA-256 hash of the token, never the plaintext", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [invite()] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getUserByEmail

    await GET(getRequest(), ctx());

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE token = $1");
    expect(params[0]).toBe(TOKEN_HASH);
    expect(params[0]).not.toBe(PLAINTEXT_TOKEN);
  });

  it("returns 404 for an unknown token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(getRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("rejects an already-accepted invite (replay protection)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [invite({ accepted_at: new Date().toISOString() })],
    });
    const res = await GET(getRequest(), ctx());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already been accepted/i);
  });

  it("rejects an expired invite", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [invite({ expires_at: PAST })] });
    const res = await GET(getRequest(), ctx());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/expired/i);
  });

  it("reports whether an account already exists for the invited email", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [invite()] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 3, email: "invitee@example.com" }],
    });
    const res = await GET(getRequest(), ctx());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.email).toBe("invitee@example.com");
    expect(json.role).toBe("support");
    expect(json.hasAccount).toBe(true);
  });
});

describe("POST /api/v3/auth/staff-invite/[token] — replay & lookup", () => {
  it("looks the invite up FOR UPDATE by the token hash, never the plaintext", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // SELECT ... FOR UPDATE (not found)

    await POST(postRequest({}), ctx());

    const [sql, params] = mockClientQuery.mock.calls[1];
    expect(sql).toContain("FOR UPDATE");
    expect(params[0]).toBe(TOKEN_HASH);
    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown token", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // invite lookup
    const res = await POST(postRequest({}), ctx());
    expect(res.status).toBe(400);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects an already-accepted invite (replay protection)", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [invite({ accepted_at: new Date().toISOString() })],
    });
    const res = await POST(postRequest({}), ctx());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already been accepted/i);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects an expired invite", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [invite({ expires_at: PAST })],
    });
    const res = await POST(postRequest({}), ctx());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/expired/i);
  });
});

describe("POST /api/v3/auth/staff-invite/[token] — super_admin account protection", () => {
  it("refuses to change an existing super_admin's role, even for an invite that exists targeting them", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [invite({ email: "root@example.com", role: "admin" })],
    }); // invite lookup
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ id: 1, role: "super_admin" }],
    }); // existingUserRes finds the super_admin

    const res = await POST(postRequest({}), ctx());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/can no longer be accepted/i);
    // No UPDATE users, no accepted_at write, no commit -- just rollback.
    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClientQuery).not.toHaveBeenCalledWith("COMMIT");
    const updateCalls = mockClientQuery.mock.calls.filter(([sql]) =>
      typeof sql === "string" ? sql.includes("UPDATE users SET role") : false,
    );
    expect(updateCalls).toHaveLength(0);
    expect(mockLogAction).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/auth/staff-invite/[token] — accept lifecycle", () => {
  it("promotes an existing (non-protected) account matching the invite email, without requiring a password", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [invite({ email: "existing@example.com", role: "moderator" })],
    });
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ id: 55, role: "support" }],
    }); // existingUserRes
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE users SET role
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE staff_invites accepted_at
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = await POST(postRequest({}), ctx());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.createdAccount).toBe(false);
    expect(json.email).toBe("existing@example.com");

    const updateCall = mockClientQuery.mock.calls.find(([sql]) =>
      typeof sql === "string" ? sql.includes("UPDATE users SET role") : false,
    );
    expect(updateCall![1]).toEqual(["moderator", 55]);

    expect(mockLogAction).toHaveBeenCalledWith(
      55,
      55,
      "staff_invite_accepted",
      expect.stringContaining("Promoted own account"),
      "127.0.0.1",
    );
  });

  it("creates a brand new account from the invite when none exists, requiring a valid password", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [invite({ email: "brandnew@example.com", role: "support" })],
    });
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // existingUserRes: none
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 900 }] }); // INSERT INTO users
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE staff_invites accepted_at
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = await POST(
      postRequest({ password: STRONG_PASSWORD, name: "New Person" }),
      ctx(),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.createdAccount).toBe(true);

    const insertCall = mockClientQuery.mock.calls.find(([sql]) =>
      typeof sql === "string" ? sql.includes("INSERT INTO users") : false,
    );
    const [email, passwordHash, name, role] = insertCall![1] as string[];
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

  it("rejects a weak password when creating a new account, and never inserts a row", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [invite({ email: "brandnew@example.com", role: "support" })],
    });
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // existingUserRes: none

    const res = await POST(postRequest({ password: "password" }), ctx());
    expect(res.status).toBe(400);

    const insertCalls = mockClientQuery.mock.calls.filter(([sql]) =>
      typeof sql === "string" ? sql.includes("INSERT INTO users") : false,
    );
    expect(insertCalls).toHaveLength(0);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("is single-use: marks the invite accepted inside the same transaction as the role/account change", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [invite({ email: "existing@example.com", role: "moderator" })],
    });
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ id: 55, role: "support" }],
    });
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE users SET role
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE staff_invites accepted_at
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT

    await POST(postRequest({}), ctx());

    const acceptedCall = mockClientQuery.mock.calls.find(([sql]) =>
      typeof sql === "string" ? sql.includes("SET accepted_at = NOW()") : false,
    );
    expect(acceptedCall![1]).toEqual([7]);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});
