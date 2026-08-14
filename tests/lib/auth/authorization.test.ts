import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for lib/auth/authorization.ts: the role-hierarchy checks
 * (requireStaff/requireAdmin), the team-membership role matrix
 * (verifyTeamMembership), the ownership whitelist
 * (verifyOwnership), and the audit-log email-masking helpers.
 *
 * This is the permission-checking logic other routes depend on for
 * access control, so every role/permission combination the code
 * actually defines is exercised here, not just one happy path.
 *
 * Mocked at the database boundary: pool.query. getSession is mocked
 * too (authorization.ts imports it from the "@/lib/auth" barrel; the
 * barrel's own real implementation and its cookie/DB access are
 * exercised by tests/lib/auth/auth.test.ts, not here).
 */

type Row = Record<string, unknown>;

const queries: { sql: string; params: unknown[] }[] = [];
let queryImpl: (
  sql: string,
  params: unknown[],
) => Promise<{ rows: Row[] }> = async () => ({ rows: [] });

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  return queryImpl(sql, params);
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

let mockSession: Record<string, unknown> | null = null;

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => mockSession),
}));

let mockEnforce2fa = false;
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn(async (key: string) =>
    key === "ENFORCE_STAFF_2FA" ? mockEnforce2fa : undefined,
  ),
}));

const {
  requireStaff,
  requireAdmin,
  isSuperAdminRole,
  maskEmail,
  redactEmailsInDetails,
  logAuditAction,
  logAction,
  verifyOwnership,
  verifyTeamMembership,
  getUserTeamRole,
} = await import("@/lib/auth/authorization");
const { TEAM_ROLES } = await import("@/lib/config/constants");

beforeEach(() => {
  mockQuery.mockClear();
  queries.length = 0;
  queryImpl = async () => ({ rows: [] });
  mockSession = null;
  mockEnforce2fa = false;
});

describe("requireStaff", () => {
  it("returns null when there is no session", async () => {
    mockSession = null;
    expect(await requireStaff()).toBeNull();
  });

  it("returns null when the session's user no longer exists", async () => {
    mockSession = { userId: 1, email: "a@example.com" };
    queryImpl = async () => ({ rows: [] });
    expect(await requireStaff()).toBeNull();
  });

  it("queries users by session.userId", async () => {
    mockSession = { userId: 55, email: "a@example.com" };
    queryImpl = async () => ({ rows: [{ role: "admin" }] });
    await requireStaff();
    expect(queries[0].sql).toContain(
      "SELECT role, totp_enabled FROM users WHERE id = $1",
    );
    expect(queries[0].params).toEqual([55]);
  });

  it.each([
    ["user", false],
    ["support", true],
    ["moderator", true],
    ["admin", true],
    ["super_admin", true],
  ] as const)(
    "role=%s -> staff-authorized=%s (STAFF_ROLE_HIERARCHY floor: support)",
    async (role, expected) => {
      mockSession = { userId: 1, email: "a@example.com" };
      queryImpl = async () => ({ rows: [{ role } as Row] });
      const result = await requireStaff();
      if (expected) {
        expect(result).toEqual({ ...mockSession, role });
      } else {
        expect(result).toBeNull();
      }
    },
  );

  it('defaults a missing/falsy role to "user" (denied)', async () => {
    mockSession = { userId: 1, email: "a@example.com" };
    queryImpl = async () => ({ rows: [{ role: null }] });
    expect(await requireStaff()).toBeNull();
  });

  it("rejects a role not present in the hierarchy at all", async () => {
    mockSession = { userId: 1, email: "a@example.com" };
    queryImpl = async () => ({ rows: [{ role: "totally-unknown-role" }] });
    expect(await requireStaff()).toBeNull();
  });

  describe("2FA enforcement (AUDIT-010, admin-feature-gap)", () => {
    it("allows a staff account without 2FA when ENFORCE_STAFF_2FA is off (default)", async () => {
      mockSession = { userId: 1, email: "a@example.com" };
      mockEnforce2fa = false;
      queryImpl = async () => ({
        rows: [{ role: "admin", totp_enabled: false }],
      });
      expect(await requireStaff()).not.toBeNull();
    });

    it("denies a staff account without 2FA when ENFORCE_STAFF_2FA is on", async () => {
      mockSession = { userId: 1, email: "a@example.com" };
      mockEnforce2fa = true;
      queryImpl = async () => ({
        rows: [{ role: "admin", totp_enabled: false }],
      });
      expect(await requireStaff()).toBeNull();
    });

    it("treats any non-boolean-true getSetting return as 'not enforced' (strict equality, not truthy coercion)", async () => {
      // Regression test: a getSetting mock shared across a test file for
      // unrelated settings (e.g. a numeric MAX_DESCRIPTION_LENGTH default)
      // can resolve ENFORCE_STAFF_2FA to a truthy-but-non-boolean value
      // like 1000. Only a strict `=== true` should ever deny access here.
      mockSession = { userId: 1, email: "a@example.com" };
      mockEnforce2fa = 1000 as unknown as boolean;
      queryImpl = async () => ({
        rows: [{ role: "admin", totp_enabled: false }],
      });
      expect(await requireStaff()).not.toBeNull();
    });

    it("allows a staff account WITH 2FA even when ENFORCE_STAFF_2FA is on", async () => {
      mockSession = { userId: 1, email: "a@example.com" };
      mockEnforce2fa = true;
      queryImpl = async () => ({
        rows: [{ role: "admin", totp_enabled: true }],
      });
      expect(await requireStaff()).not.toBeNull();
    });
  });
});

describe("requireAdmin", () => {
  it("returns null when there is no session", async () => {
    mockSession = null;
    expect(await requireAdmin()).toBeNull();
  });

  it("returns null when the session's user no longer exists", async () => {
    mockSession = { userId: 1, email: "a@example.com" };
    queryImpl = async () => ({ rows: [] });
    expect(await requireAdmin()).toBeNull();
  });

  it("queries id + role by session.userId", async () => {
    mockSession = { userId: 9, email: "a@example.com" };
    queryImpl = async () => ({ rows: [{ id: 9, role: "admin" }] });
    await requireAdmin();
    expect(queries[0].sql).toContain(
      "SELECT id, role, totp_enabled FROM users WHERE id = $1",
    );
    expect(queries[0].params).toEqual([9]);
  });

  it.each([
    ["user", false],
    ["support", false],
    ["moderator", false],
    ["admin", true],
    ["super_admin", true],
  ] as const)(
    "role=%s -> admin-authorized=%s (STAFF_ROLE_HIERARCHY floor: admin, super_admin sits above it)",
    async (role, expected) => {
      mockSession = { userId: 9, email: "a@example.com" };
      queryImpl = async () => ({ rows: [{ id: 9, role } as Row] });
      const result = await requireAdmin();
      if (expected) {
        expect(result).toEqual({ ...mockSession, id: 9, role });
      } else {
        expect(result).toBeNull();
      }
    },
  );

  it('defaults a missing/falsy role to "user" (denied)', async () => {
    mockSession = { userId: 1, email: "a@example.com" };
    queryImpl = async () => ({ rows: [{ id: 1, role: null }] });
    expect(await requireAdmin()).toBeNull();
  });

  describe("2FA enforcement (AUDIT-010, admin-feature-gap)", () => {
    it("denies an admin account without 2FA when ENFORCE_STAFF_2FA is on", async () => {
      mockSession = { userId: 9, email: "a@example.com" };
      mockEnforce2fa = true;
      queryImpl = async () => ({
        rows: [{ id: 9, role: "admin", totp_enabled: false }],
      });
      expect(await requireAdmin()).toBeNull();
    });

    it("allows a super_admin WITH 2FA when ENFORCE_STAFF_2FA is on", async () => {
      mockSession = { userId: 9, email: "a@example.com" };
      mockEnforce2fa = true;
      queryImpl = async () => ({
        rows: [{ id: 9, role: "super_admin", totp_enabled: true }],
      });
      expect(await requireAdmin()).not.toBeNull();
    });
  });
});

describe("isSuperAdminRole", () => {
  it("is true only for the exact 'super_admin' string", () => {
    expect(isSuperAdminRole("super_admin")).toBe(true);
  });

  it.each([
    "admin",
    "moderator",
    "support",
    "user",
    "",
    null,
    undefined,
  ] as const)("is false for role=%s", (role) => {
    expect(isSuperAdminRole(role)).toBe(false);
  });
});

describe("maskEmail", () => {
  it("masks the local part but keeps the domain visible", () => {
    expect(maskEmail("john.doe@example.com")).toBe("j******e@example.com");
  });

  it("leaves a 1-2 character local part unchanged", () => {
    expect(maskEmail("a@example.com")).toBe("a@example.com");
    expect(maskEmail("ab@example.com")).toBe("ab@example.com");
  });

  it("masks a 3-character local part with a single asterisk", () => {
    expect(maskEmail("abc@example.com")).toBe("a*c@example.com");
  });

  it('returns "[unknown]" for null, undefined, or empty string', () => {
    expect(maskEmail(null)).toBe("[unknown]");
    expect(maskEmail(undefined)).toBe("[unknown]");
    expect(maskEmail("")).toBe("[unknown]");
  });

  it('returns "[unknown]" for a non-string value', () => {
    expect(maskEmail(12345 as unknown as string)).toBe("[unknown]");
  });

  it('returns "[masked]" when there is no local part (no "@" or "@" at index 0)', () => {
    expect(maskEmail("not-an-email")).toBe("[masked]");
    expect(maskEmail("@example.com")).toBe("[masked]");
  });
});

describe("redactEmailsInDetails", () => {
  it("returns null for null, undefined, or empty string", () => {
    expect(redactEmailsInDetails(null)).toBeNull();
    expect(redactEmailsInDetails(undefined)).toBeNull();
    expect(redactEmailsInDetails("")).toBeNull();
  });

  it("leaves text with no email unchanged", () => {
    expect(redactEmailsInDetails("Granted admin access")).toBe(
      "Granted admin access",
    );
  });

  it("masks a single embedded email", () => {
    expect(redactEmailsInDetails("Granted admin to john.doe@example.com")).toBe(
      "Granted admin to j******e@example.com",
    );
  });

  it("masks every email in a string with multiple", () => {
    const result = redactEmailsInDetails(
      "alice@example.com invited bob@example.com",
    );
    expect(result).not.toContain("alice@example.com");
    expect(result).not.toContain("bob@example.com");
    expect(result).toContain("@example.com");
  });
});

describe("logAuditAction (and its logAction alias)", () => {
  it("logAction is the same function as logAuditAction", () => {
    expect(logAction).toBe(logAuditAction);
  });

  it("inserts a row with masked email details and a null ip when omitted", async () => {
    await logAuditAction(
      1,
      2,
      "grant_admin",
      "Granted admin to john.doe@example.com",
    );
    const insert = queries.find((q) =>
      q.sql.includes("INSERT INTO admin_audit_log"),
    );
    expect(insert?.params).toEqual([
      1,
      2,
      "grant_admin",
      "Granted admin to j******e@example.com",
      null,
    ]);
  });

  it("passes through the ip address and a null target when provided", async () => {
    await logAuditAction(1, null, "login", undefined, "203.0.113.5");
    const insert = queries.find((q) =>
      q.sql.includes("INSERT INTO admin_audit_log"),
    );
    expect(insert?.params).toEqual([1, null, "login", null, "203.0.113.5"]);
  });
});

describe("verifyOwnership", () => {
  it.each([
    ["scan_history", "user_id"],
    ["api_keys", "user_id"],
    ["shares", "user_id"],
    ["schedules", "user_id"],
    ["webhooks", "user_id"],
    ["notifications", "user_id"],
    ["sessions", "user_id"],
    ["teams", "owner_id"],
  ] as const)(
    "queries the whitelisted table/owner-column pair for %s",
    async (resource, ownerCol) => {
      queryImpl = async () => ({ rows: [{ id: 1 }] });
      const result = await verifyOwnership(resource, 1, 2);
      expect(result.owned).toBe(true);
      expect(result.error).toBeUndefined();
      expect(queries[0].sql).toContain(
        `FROM ${resource} WHERE id = $1 AND ${ownerCol} = $2`,
      );
      expect(queries[0].params).toEqual([1, 2]);
    },
  );

  it("returns owned:false (no error) when no row matches", async () => {
    queryImpl = async () => ({ rows: [] });
    const result = await verifyOwnership("scan_history", 1, 2);
    expect(result).toEqual({ owned: false });
  });

  it("returns owned:false with a 500 error when the query throws", async () => {
    queryImpl = async () => {
      throw new Error("db down");
    };
    const result = await verifyOwnership("scan_history", 1, 2);
    expect(result.owned).toBe(false);
    expect(result.error?.status).toBe(500);
  });
});

describe("verifyTeamMembership", () => {
  it("returns isMember:false with no error when there is no row", async () => {
    queryImpl = async () => ({ rows: [] });
    const result = await verifyTeamMembership(1, 2);
    expect(result).toEqual({ isMember: false });
  });

  it("returns isMember:true with the role when no requiredRole is given", async () => {
    queryImpl = async () => ({ rows: [{ role: "member" }] });
    const result = await verifyTeamMembership(1, 2);
    expect(result).toEqual({ isMember: true, role: "member" });
  });

  it("returns owned-style 500 error and isMember:false when the query throws", async () => {
    queryImpl = async () => {
      throw new Error("db down");
    };
    const result = await verifyTeamMembership(1, 2);
    expect(result.isMember).toBe(false);
    expect(result.error?.status).toBe(500);
  });

  // Full role-hierarchy matrix: OWNER(3) > ADMIN(2) > MEMBER(1). "viewer" is
  // a real TEAM_ROLES value but is absent from the hierarchy map inside
  // verifyTeamMembership, so it falls back to 0 -- below every named
  // requiredRole. That is intentional (a viewer has the least access), but
  // it means TEAM_ROLES.VIEWER can never satisfy any requiredRole check.
  it.each([
    [TEAM_ROLES.OWNER, TEAM_ROLES.OWNER, true],
    [TEAM_ROLES.OWNER, TEAM_ROLES.ADMIN, true],
    [TEAM_ROLES.OWNER, TEAM_ROLES.MEMBER, true],
    [TEAM_ROLES.ADMIN, TEAM_ROLES.OWNER, false],
    [TEAM_ROLES.ADMIN, TEAM_ROLES.ADMIN, true],
    [TEAM_ROLES.ADMIN, TEAM_ROLES.MEMBER, true],
    [TEAM_ROLES.MEMBER, TEAM_ROLES.OWNER, false],
    [TEAM_ROLES.MEMBER, TEAM_ROLES.ADMIN, false],
    [TEAM_ROLES.MEMBER, TEAM_ROLES.MEMBER, true],
    [TEAM_ROLES.VIEWER, TEAM_ROLES.MEMBER, false],
    [TEAM_ROLES.VIEWER, TEAM_ROLES.OWNER, false],
  ] as const)(
    "role=%s requiredRole=%s -> satisfies=%s",
    async (role, requiredRole, satisfies) => {
      queryImpl = async () => ({ rows: [{ role }] });
      const result = await verifyTeamMembership(1, 2, requiredRole);
      expect(result.isMember).toBe(true);
      expect(result.role).toBe(role);
      if (satisfies) {
        expect(result.error).toBeUndefined();
      } else {
        expect(result.error?.status).toBe(403);
      }
    },
  );
});

describe("getUserTeamRole", () => {
  it("returns the role when the user is a member", async () => {
    queryImpl = async () => ({ rows: [{ role: "admin" }] });
    expect(await getUserTeamRole(1, 2)).toBe("admin");
  });

  it("returns null when the user is not a member", async () => {
    queryImpl = async () => ({ rows: [] });
    expect(await getUserTeamRole(1, 2)).toBeNull();
  });

  it("returns null (not a throw) when the query fails", async () => {
    queryImpl = async () => {
      throw new Error("db down");
    };
    expect(await getUserTeamRole(1, 2)).toBeNull();
  });
});
