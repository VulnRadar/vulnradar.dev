import { describe, it, expect } from "vitest";
import {
  STAFF_PERMISSIONS,
  hasStaffPermission,
  canAccessAdmin,
  canAccessStaffPage,
  canManageRole,
  getRoleLevel,
  isStaffRole,
  getStaffPermissions,
} from "@/lib/auth/permissions-client";
import { STAFF_ROLES } from "@/lib/config/client-constants";

/**
 * This file's ROLE_PERMISSION_MAP is what components/providers/auth-
 * provider.tsx uses to decide canAccessAdmin / hasPermission for the
 * logged-in caller across the whole admin UI (see
 * components/admin/hooks/use-admin-permissions.ts). Before adding a
 * super_admin entry here, a super_admin's role string matched no key in
 * this map, so every hasStaffPermission() call for that account silently
 * returned false, the account meant to have every permission would have
 * been locked out of the admin panel UI entirely, even though the
 * server-side hierarchy checks (STAFF_ROLE_HIERARCHY) already let it
 * through. These tests pin "super_admin passes everything admin passes."
 */
describe("permissions-client: super_admin parity with admin", () => {
  it("has every permission admin has", () => {
    const adminPerms = getStaffPermissions(STAFF_ROLES.ADMIN);
    const superAdminPerms = getStaffPermissions(STAFF_ROLES.SUPER_ADMIN);
    for (const perm of adminPerms) {
      expect(superAdminPerms).toContain(perm);
    }
  });

  it.each(Object.values(STAFF_PERMISSIONS))(
    "hasStaffPermission(super_admin, %s) is true",
    (permission) => {
      expect(hasStaffPermission(STAFF_ROLES.SUPER_ADMIN, permission)).toBe(
        true,
      );
    },
  );

  it("can access the admin panel", () => {
    expect(canAccessAdmin(STAFF_ROLES.SUPER_ADMIN)).toBe(true);
  });

  it("can access the staff page", () => {
    expect(canAccessStaffPage(STAFF_ROLES.SUPER_ADMIN)).toBe(true);
  });

  it("is considered a staff role", () => {
    expect(isStaffRole(STAFF_ROLES.SUPER_ADMIN)).toBe(true);
  });

  it("has a hierarchy level above admin", () => {
    expect(getRoleLevel(STAFF_ROLES.SUPER_ADMIN)).toBeGreaterThan(
      getRoleLevel(STAFF_ROLES.ADMIN),
    );
  });

  it("can manage every other role, including admin", () => {
    expect(canManageRole(STAFF_ROLES.SUPER_ADMIN, STAFF_ROLES.ADMIN)).toBe(
      true,
    );
    expect(canManageRole(STAFF_ROLES.SUPER_ADMIN, STAFF_ROLES.MODERATOR)).toBe(
      true,
    );
  });

  it("cannot be managed by admin (or anyone else)", () => {
    expect(canManageRole(STAFF_ROLES.ADMIN, STAFF_ROLES.SUPER_ADMIN)).toBe(
      false,
    );
  });
});
