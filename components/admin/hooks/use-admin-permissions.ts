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
        STAFF_PERMISSIONS.EDIT_USERS,
      ),
      canBanUsers: hasStaffPermission(callerRole, STAFF_PERMISSIONS.BAN_USERS),
      canDeleteUsers: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.DELETE_USERS,
      ),

      // Audit
      canViewAuditLog: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.VIEW_AUDIT_LOG,
      ),

      // Teams
      canManageTeams: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.MANAGE_TEAMS,
      ),

      // Badges
      canManageBadges: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.MANAGE_BADGES,
      ),

      // Notifications
      canSendNotifications: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.SEND_NOTIFICATIONS,
      ),

      // Staff management
      canViewStaff: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.VIEW_STAFF,
      ),
      canManageStaff: hasStaffPermission(
        callerRole,
        STAFF_PERMISSIONS.MANAGE_STAFF,
      ),

      // Role helpers
      canManageRole: (targetRole: string) =>
        canManageRole(callerRole, targetRole),
      getAvailableActions: (targetRole: string | null) =>
        getAvailableActions(callerRole, targetRole),
    }),
    [callerRole],
  );

  return permissions;
}

export type AdminPermissions = ReturnType<typeof useAdminPermissions>;
