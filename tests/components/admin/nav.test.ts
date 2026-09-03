import { describe, it, expect } from "vitest";
import {
  ADMIN_NAV_GROUPS,
  ALL_ADMIN_NAV_ITEMS,
  VALID_TABS,
  canSeeAdminNavItem,
  type AdminNavItem,
} from "@/components/admin/nav";
import {
  STAFF_PERMISSIONS,
  hasStaffPermission,
} from "@/lib/auth/permissions-client";

/**
 * The admin destination table used to be written out three times inside
 * app/admin/page.tsx (VALID_TABS, the ActiveTab union, NAV_GROUPS_RAW) with
 * nothing tying the three together, so a tab could be routable but absent from
 * the sidebar, or in the sidebar but rejected by the URL parser. The type
 * system now catches a nav entry naming a tab that does not exist
 * (AdminNavItem["key"] is AdminTabKey); these guard the other direction and
 * the invariants a type cannot express.
 */
describe("admin nav table", () => {
  it("puts every routable tab somewhere in the sidebar", () => {
    const navKeys = new Set(ALL_ADMIN_NAV_ITEMS.map((item) => item.key));
    const missing = VALID_TABS.filter((tab) => !navKeys.has(tab));
    expect(missing).toEqual([]);
  });

  it("lists each destination exactly once", () => {
    const keys = ALL_ADMIN_NAV_ITEMS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has no empty groups and no duplicate group labels", () => {
    const labels = ADMIN_NAV_GROUPS.map((group) => group.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const group of ADMIN_NAV_GROUPS) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it("lands on Overview first, and gates nothing on it", () => {
    // The redirect in app/admin/page.tsx sends a role that cannot see its
    // current tab to ALL_ADMIN_TABS[0]. If the first item ever acquired a
    // permission gate, a specialist role could be redirected to a tab it is
    // then filtered out of, leaving the nav with nothing highlighted.
    const first = ADMIN_NAV_GROUPS[0].items[0];
    expect(first.key).toBe("overview");
    expect(first.permission).toBeUndefined();
    expect(first.minHierarchy).toBeUndefined();
  });

  it("never carries both a permission gate and a hierarchy floor", () => {
    // Two gates on one item means two places to keep in sync with one route.
    const both = ALL_ADMIN_NAV_ITEMS.filter(
      (item) =>
        item.permission !== undefined && item.minHierarchy !== undefined,
    );
    expect(both).toEqual([]);
  });
});

describe("canSeeAdminNavItem", () => {
  const ungated: AdminNavItem = ALL_ADMIN_NAV_ITEMS.find(
    (item) => item.key === "overview",
  )!;
  const permissionGated: AdminNavItem = ALL_ADMIN_NAV_ITEMS.find(
    (item) => item.key === "users",
  )!;
  const hierarchyGated: AdminNavItem = ALL_ADMIN_NAV_ITEMS.find(
    (item) => item.key === "teams",
  )!;

  it("shows an ungated item to every role that reached the panel", () => {
    expect(canSeeAdminNavItem(ungated, "support", hasStaffPermission)).toBe(
      true,
    );
    expect(canSeeAdminNavItem(ungated, "billing", hasStaffPermission)).toBe(
      true,
    );
  });

  it("hides a permission-gated item from a role without that grant", () => {
    expect(permissionGated.permission).toBe(STAFF_PERMISSIONS.VIEW_USERS);
    expect(
      canSeeAdminNavItem(permissionGated, "admin", hasStaffPermission),
    ).toBe(true);
    expect(
      canSeeAdminNavItem(permissionGated, "user", hasStaffPermission),
    ).toBe(false);
  });

  it("hides a hierarchy-gated item from a role below the floor", () => {
    expect(hierarchyGated.minHierarchy).toBeGreaterThan(0);
    expect(
      canSeeAdminNavItem(hierarchyGated, "admin", hasStaffPermission),
    ).toBe(true);
    expect(canSeeAdminNavItem(hierarchyGated, "user", hasStaffPermission)).toBe(
      false,
    );
  });

  it("leaves at least one destination visible for every staff role", () => {
    // A role whose every nav item is filtered out renders an empty sidebar and
    // a body with no active tab, which is how a specialist role ends up on a
    // blank panel rather than on the one screen it is allowed to read.
    for (const role of [
      "admin",
      "moderator",
      "support",
      "billing",
      "security_analyst",
      "content_manager",
      "ops",
    ]) {
      const visible = ALL_ADMIN_NAV_ITEMS.filter((item) =>
        canSeeAdminNavItem(item, role, hasStaffPermission),
      );
      expect(visible.length).toBeGreaterThan(0);
    }
  });
});
