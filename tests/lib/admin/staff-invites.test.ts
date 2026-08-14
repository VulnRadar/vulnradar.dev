import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for lib/admin/staff-invites.ts. Mocked at the database
 * boundary only (the pg pool); the token/hash helpers run for real.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const {
  ensureStaffInvitesTable,
  generateStaffInviteToken,
  hashStaffInviteToken,
  staffInviteExpiresAt,
} = await import("@/lib/admin/staff-invites");
const { STAFF_INVITE_EXPIRY_DAYS } = await import("@/lib/config/constants");

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe("ensureStaffInvitesTable", () => {
  it("creates the staff_invites table with the expected columns and indexes", async () => {
    await ensureStaffInvitesTable();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS staff_invites");
    expect(sql).toContain("token VARCHAR(64) NOT NULL UNIQUE");
    expect(sql).toContain("email VARCHAR(255) NOT NULL");
    expect(sql).toContain("role VARCHAR(20) NOT NULL");
    expect(sql).toContain(
      "invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE",
    );
    expect(sql).toContain("expires_at TIMESTAMP WITH TIME ZONE NOT NULL");
    expect(sql).toContain("accepted_at TIMESTAMP WITH TIME ZONE");
    expect(sql).toContain("idx_staff_invites_token");
    expect(sql).toContain("idx_staff_invites_email");
  });

  it("is idempotent (IF NOT EXISTS / IF NOT EXISTS on every statement)", async () => {
    await ensureStaffInvitesTable();
    const [sql] = mockQuery.mock.calls[0];
    // Every CREATE in this block must be guarded, otherwise a second call
    // (this function runs on every boot) throws on an existing DB.
    const creates = sql.match(/CREATE (TABLE|INDEX)(?! IF NOT EXISTS)/g);
    expect(creates).toBeNull();
  });
});

describe("generateStaffInviteToken", () => {
  it("returns 64 hex characters (32 bytes, same shape as team_invites' token)", () => {
    const token = generateStaffInviteToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns a different value on every call", () => {
    const a = generateStaffInviteToken();
    const b = generateStaffInviteToken();
    expect(a).not.toBe(b);
  });
});

describe("hashStaffInviteToken", () => {
  it("is deterministic for the same input", () => {
    const token = generateStaffInviteToken();
    expect(hashStaffInviteToken(token)).toBe(hashStaffInviteToken(token));
  });

  it("never returns the plaintext token back", () => {
    const token = generateStaffInviteToken();
    expect(hashStaffInviteToken(token)).not.toBe(token);
  });

  it("matches the real SHA-256 hex digest", async () => {
    const { createHash } = await import("node:crypto");
    const token = "known-plaintext-value";
    const expected = createHash("sha256").update(token).digest("hex");
    expect(hashStaffInviteToken(token)).toBe(expected);
  });
});

describe("staffInviteExpiresAt", () => {
  it("returns a timestamp STAFF_INVITE_EXPIRY_DAYS days in the future", () => {
    const before = Date.now();
    const expiresAt = staffInviteExpiresAt();
    const after = Date.now();

    const expectedMin = before + STAFF_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const expectedMax = after + STAFF_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
  });
});
