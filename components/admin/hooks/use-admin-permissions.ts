"use client";

import { useMemo } from "react";
import {
  hasStaffPermission,
  canManageRole,
  getAvailableActions,
  STAFF_PERMISSIONS,
} from "@/lib/auth/permissions-client";

/**
 * Admin permissions hook - centralizes permission checks
 * Future: role-based, team-based, feature-flag-based
 */
export function useAdminPermissions(callerRole: string) {
  const permissions = useMemo(
    () => ({
      // User management
      canViewUsers: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.VIEW_USERS,
      ),
      canEditUsers: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.EDIT_USER_NAME,
      ),
      canBanUsers: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.DISABLE_USER,
      ),
      canDeleteUsers: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.DELETE_USER,
      ),

      // Audit
      canViewAuditLog: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.VIEW_AUDIT_LOG,
      ),

      // Teams
      canManageTeams: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.MANAGE_ANY_TEAM,
      ),

      // Badges
      canManageBadges: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.CREATE_BADGE,
      ),

      // Notifications
      canSendNotifications: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.SEND_ANNOUNCEMENTS,
      ),

      // Staff management
      canViewStaff: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.ACCESS_STAFF_PAGE,
      ),
      canManageStaff: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.EDIT_USER_ROLE,
      ),

      // Role helpers
      canManageRole: (targetRole: string) =>
        canManageRole(callerRole, targetRole),
      getAvailableActions: () => getAvailableActions(callerRole),
    }),
    [callerRole],
  );

  return permissions;
}

export type AdminPermissions = ReturnType<typeof useAdminPermissions>;
