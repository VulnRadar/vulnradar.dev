import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STAFF_PERMISSIONS,
  hasStaffPermission,
  canAccessAdmin,
  canAccessStaffPage,
  canManageRole,
  getRoleLevel,
  isStaffRole,
  getStaffPermissions,
  canPerformAction,
  ADMIN_ACTIONS,
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

/**
 * ADMIN_ACTIONS drift regression guard.
 *
 * This module's ADMIN_ACTIONS/canPerformAction/getAvailableActions are
 * consumed client-side only: components/admin/hooks/use-admin-permissions.ts
 * exposes getAvailableActions() via the perms object, but nothing in the
 * app actually calls it -- every real permission flag components check
 * (perms.canDeleteUsers, etc.) is computed directly from
 * hasStaffPermission(role, SOME_SPECIFIC_PERMISSION), bypassing this array
 * entirely. app/api/v3/admin/route.ts's PATCH handler, the thing that
 * actually gates every admin action server-side, has its OWN, separate,
 * locally-defined canPerformAction() (route.ts's own file, not this
 * module) that short-circuits true for admin/super_admin regardless of
 * the action string -- so this array being wrong never actually 403'd
 * anyone for those roles in practice. (The real "Delete Account does
 * nothing" bug was a foreign-key violation elsewhere in the delete case
 * itself -- see that case's own comment in route.ts.)
 *
 * ADMIN_ACTIONS had still drifted badly out of sync with the route's
 * actual switch statement and what the UI actually sends: at the time
 * this test was added, 20 of the 34 real actions (delete, make_admin,
 * remove_admin, update_password, revoke_all_sessions, delete_badge,
 * gift_subscription, revoke_gift, clear_rate_limits, toggle_ai_ban,
 * send_notification, verify_email, unverify_email, delete_webhooks,
 * delete_schedules, force_logout_all, set_scan_limit, add_note, edit_note,
 * delete_note, clear_avatar) either had no ADMIN_ACTIONS entry at all or
 * were registered under a different, stale id (e.g. "delete_user" instead
 * of "delete", "grant_premium" instead of "gift_subscription"). Harmless
 * today given the above, but real drift, and a landmine for MODERATOR-
 * level UI or any future code path that starts relying on
 * getAvailableActions() for real gating instead of just display metadata.
 *
 * This test reads app/api/v3/admin/route.ts's own source and extracts
 * every `case "...":` id directly, so it fails the moment a new action is
 * added to the route without a matching ADMIN_ACTIONS registration --
 * exactly the class of change that caused the original bug -- rather than
 * only pinning today's fixed list.
 */
describe("ADMIN_ACTIONS stays in sync with app/api/v3/admin/route.ts", () => {
  const routeSource = readFileSync(
    join(__dirname, "..", "..", "..", "app", "api", "v3", "admin", "route.ts"),
    "utf8",
  );
  const caseIds = [
    ...new Set(
      // [a-z0-9_]+, not just [a-z_]+ -- "reset_2fa" has a digit in it.
      [...routeSource.matchAll(/case "([a-z0-9_]+)":/g)].map((m) => m[1]),
    ),
  ];
  // Case labels that exist only as fallthrough aliases onto another,
  // already-covered case (e.g. `case "enable": case "enable_user": {`) --
  // nothing in this codebase actually sends these alternate strings, only
  // the primary label does, so they're intentionally excluded rather than
  // requiring their own ADMIN_ACTIONS entry.
  const aliasIds = new Set(["enable_user", "delete_user", "delete_account"]);
  const realActionIds = caseIds.filter((id) => !aliasIds.has(id));

  it("found a non-trivial number of real action cases in the route (sanity check the extraction itself)", () => {
    expect(realActionIds.length).toBeGreaterThan(20);
  });

  it.each(realActionIds)(
    'admin can perform every real action the route implements: "%s"',
    (actionId) => {
      expect(canPerformAction(STAFF_ROLES.ADMIN, actionId)).toBe(true);
    },
  );

  it("every ADMIN_ACTIONS entry has a corresponding route case (no stale/renamed ids left behind)", () => {
    // send_email is a known, pre-existing exception: registered here and
    // referenced in an unreachable client-side whitelist, but the route
    // never implemented a "send_email" case (only "send_notification").
    // Not part of this fix -- flagged, not silently allowed to spread.
    const knownStaleIds = new Set(["send_email"]);
    const caseSet = new Set(caseIds);
    const staleIds = ADMIN_ACTIONS.map((a) => a.id).filter(
      (id) => !caseSet.has(id) && !knownStaleIds.has(id),
    );
    expect(staleIds).toEqual([]);
  });
});
