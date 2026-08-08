import { describe, it, expect } from "vitest";
import {
  STAFF_ROLES,
  STAFF_ROLE_HIERARCHY,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
} from "@/lib/config/client-constants";

/**
 * Focused regression coverage for the super_admin role tier added to the
 * staff role model. The full hierarchy/permission *behavior* is exercised
 * where it's actually consumed (tests/lib/auth/authorization.test.ts,
 * tests/lib/auth/permissions-client.test.ts, and the admin route suites);
 * this file only pins the raw data these all read from, so a future edit
 * that reorders or removes super_admin fails loudly here first.
 */
describe("STAFF_ROLES / STAFF_ROLE_HIERARCHY (super_admin tier)", () => {
  it("exposes SUPER_ADMIN as 'super_admin'", () => {
    expect(STAFF_ROLES.SUPER_ADMIN).toBe("super_admin");
  });

  it("places super_admin strictly above admin, which is above every other role", () => {
    expect(STAFF_ROLE_HIERARCHY.super_admin).toBeGreaterThan(
      STAFF_ROLE_HIERARCHY.admin,
    );
    expect(STAFF_ROLE_HIERARCHY.admin).toBeGreaterThan(
      STAFF_ROLE_HIERARCHY.moderator,
    );
    expect(STAFF_ROLE_HIERARCHY.moderator).toBeGreaterThan(
      STAFF_ROLE_HIERARCHY.support,
    );
    expect(STAFF_ROLE_HIERARCHY.support).toBeGreaterThan(
      STAFF_ROLE_HIERARCHY.user,
    );
  });

  it("gives super_admin its own label distinct from admin's", () => {
    expect(STAFF_ROLE_LABELS.super_admin).toBe("Super Admin");
    expect(STAFF_ROLE_LABELS.super_admin).not.toBe(STAFF_ROLE_LABELS.admin);
  });

  it("gives super_admin its own badge style, not a reuse of admin's", () => {
    expect(ROLE_BADGE_STYLES.super_admin).toBeTruthy();
    expect(ROLE_BADGE_STYLES.super_admin).not.toBe(ROLE_BADGE_STYLES.admin);
  });
});
