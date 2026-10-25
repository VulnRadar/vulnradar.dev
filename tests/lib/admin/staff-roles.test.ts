import { describe, it, expect } from "vitest";
import { staffRolesByRank } from "@/lib/admin/staff-roles";
import {
  STAFF_ROLES,
  STAFF_ROLE_HIERARCHY,
} from "@/lib/config/client-constants";

describe("staffRolesByRank", () => {
  it("covers every role that holds any rank, including the four specialists", () => {
    const roles = staffRolesByRank();
    // The directory query used to name super_admin, admin, moderator and
    // support, so these four never appeared on the page that invites them.
    for (const specialist of [
      STAFF_ROLES.BILLING,
      STAFF_ROLES.SECURITY_ANALYST,
      STAFF_ROLES.CONTENT_MANAGER,
      STAFF_ROLES.OPS,
    ]) {
      expect(roles).toContain(specialist);
    }
    expect(roles).toContain(STAFF_ROLES.SUPER_ADMIN);
    expect(roles).not.toContain(STAFF_ROLES.USER);
  });

  it("is exactly the hierarchy's staff roles, so a new role cannot be missed", () => {
    const expected = Object.keys(STAFF_ROLE_HIERARCHY).filter(
      (role) => STAFF_ROLE_HIERARCHY[role] > 0,
    );
    expect([...staffRolesByRank()].sort()).toEqual([...expected].sort());
  });

  it("orders highest rank first and breaks ties by name", () => {
    const roles = staffRolesByRank();
    expect(roles[0]).toBe(STAFF_ROLES.SUPER_ADMIN);
    expect(roles[roles.length - 1]).toBe(STAFF_ROLES.SUPPORT);
    const ranks = roles.map((role) => STAFF_ROLE_HIERARCHY[role]);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    // billing, content_manager, ops and security_analyst share a tier.
    const tier = roles.filter((role) => STAFF_ROLE_HIERARCHY[role] === 20);
    expect(tier).toEqual([...tier].sort());
  });
});
