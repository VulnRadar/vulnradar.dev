/**
 * CLIENT-SIDE PERMISSION HELPERS
 * No database imports - safe for client-side usage
 */

import { STAFF_ROLES, STAFF_ROLE_HIERARCHY } from "@/lib/config/constants";

// Staff role permission definitions (client-side, no DB needed)
export const STAFF_PERMISSIONS = {
  // Access permissions
  ACCESS_ADMIN_PANEL: "access_admin_panel",
  ACCESS_STAFF_PAGE: "access_staff_page",

  // User management
  VIEW_USERS: "view_users",
  EDIT_USER_NAME: "edit_user_name",
  EDIT_USER_EMAIL: "edit_user_email",
  EDIT_USER_PLAN: "edit_user_plan",
  EDIT_USER_ROLE: "edit_user_role",
  DISABLE_USER: "disable_user",
  ENABLE_USER: "enable_user",
  RESET_USER_PASSWORD: "reset_user_password",
  DELETE_USER: "delete_user",
  IMPERSONATE_USER: "impersonate_user",

  // Session & Security
  VIEW_USER_SESSIONS: "view_user_sessions",
  REVOKE_USER_SESSIONS: "revoke_user_sessions",
  VIEW_USER_API_KEYS: "view_user_api_keys",
  REVOKE_USER_API_KEYS: "revoke_user_api_keys",
  RESET_USER_2FA: "reset_user_2fa",

  // Badges
  VIEW_BADGES: "view_badges",
  AWARD_BADGE: "award_badge",
  REVOKE_BADGE: "revoke_badge",
  CREATE_BADGE: "create_badge",
  DELETE_BADGE: "delete_badge",

  // Scans
  VIEW_ALL_SCANS: "view_all_scans",
  DELETE_ANY_SCAN: "delete_any_scan",
  VIEW_SCAN_STATS: "view_scan_stats",
  EXPORT_SCAN_DATA: "export_scan_data",

  // Subscriptions
  VIEW_SUBSCRIPTIONS: "view_subscriptions",
  MANAGE_SUBSCRIPTIONS: "manage_subscriptions",
  GRANT_PREMIUM: "grant_premium",
  REVOKE_PREMIUM: "revoke_premium",

  // System
  VIEW_AUDIT_LOG: "view_audit_log",
  VIEW_SYSTEM_STATS: "view_system_stats",
  VIEW_ERROR_LOGS: "view_error_logs",
  MANAGE_RATE_LIMITS: "manage_rate_limits",

  // Usage/limit resets -- each its own resource for the same reason the
  // "User data management" group below calls out (a shared existing
  // permission would silently grant these to whatever role already has
  // it).
  RESET_USER_DAILY_LIMIT: "reset_user_daily_limit",
  RESET_USER_AI_USAGE: "reset_user_ai_usage",
  RESET_USER_GITHUB_REVIEW_USAGE: "reset_user_github_review_usage",
  RESET_USER_FREE_GITHUB_TRIAL: "reset_user_free_github_trial",

  // Teams
  VIEW_ALL_TEAMS: "view_all_teams",
  MANAGE_ANY_TEAM: "manage_any_team",
  DELETE_ANY_TEAM: "delete_any_team",

  // Moderation
  MODERATE_CONTENT: "moderate_content",
  VIEW_REPORTS: "view_reports",
  RESOLVE_REPORTS: "resolve_reports",

  // Communication
  SEND_ANNOUNCEMENTS: "send_announcements",
  SEND_USER_EMAILS: "send_user_emails",

  // Notifications Management
  MANAGE_NOTIFICATIONS: "manage_notifications",

  // Development
  VIEW_DEBUG_INFO: "view_debug_info",
  TRIGGER_MAINTENANCE: "trigger_maintenance",
  CLEAR_CACHE: "clear_cache",

  // User data management (webhooks/schedules/notes/avatar/scan-limit are
  // each their own resource, distinct from scans/badges/subscriptions
  // above -- reusing an unrelated existing permission for these would
  // silently grant them to whatever role already has that permission,
  // e.g. MODERATOR already has DELETE_ANY_SCAN).
  DELETE_USER_WEBHOOKS: "delete_user_webhooks",
  DELETE_USER_SCHEDULES: "delete_user_schedules",
  MANAGE_SCAN_LIMIT: "manage_scan_limit",
  MANAGE_USER_NOTES: "manage_user_notes",
  CLEAR_USER_AVATAR: "clear_user_avatar",
} as const;

export type StaffPermission =
  (typeof STAFF_PERMISSIONS)[keyof typeof STAFF_PERMISSIONS];

// Role -> Permissions mapping (client-side)
const ROLE_PERMISSION_MAP: Record<string, StaffPermission[]> = {
  [STAFF_ROLES.USER]: [],
  [STAFF_ROLES.SUPPORT]: [
    STAFF_PERMISSIONS.ACCESS_STAFF_PAGE,
    STAFF_PERMISSIONS.VIEW_USERS,
    STAFF_PERMISSIONS.VIEW_USER_SESSIONS,
    STAFF_PERMISSIONS.VIEW_BADGES,
    STAFF_PERMISSIONS.VIEW_ALL_SCANS,
    STAFF_PERMISSIONS.VIEW_SCAN_STATS,
    STAFF_PERMISSIONS.VIEW_REPORTS,
    STAFF_PERMISSIONS.VIEW_SUBSCRIPTIONS,
  ],
  [STAFF_ROLES.MODERATOR]: [
    STAFF_PERMISSIONS.ACCESS_STAFF_PAGE,
    STAFF_PERMISSIONS.ACCESS_ADMIN_PANEL,
    STAFF_PERMISSIONS.VIEW_USERS,
    STAFF_PERMISSIONS.EDIT_USER_NAME,
    STAFF_PERMISSIONS.DISABLE_USER,
    STAFF_PERMISSIONS.ENABLE_USER,
    STAFF_PERMISSIONS.VIEW_USER_SESSIONS,
    STAFF_PERMISSIONS.REVOKE_USER_SESSIONS,
    STAFF_PERMISSIONS.RESET_USER_2FA,
    STAFF_PERMISSIONS.VIEW_BADGES,
    STAFF_PERMISSIONS.AWARD_BADGE,
    STAFF_PERMISSIONS.REVOKE_BADGE,
    STAFF_PERMISSIONS.VIEW_ALL_SCANS,
    STAFF_PERMISSIONS.DELETE_ANY_SCAN,
    STAFF_PERMISSIONS.VIEW_SCAN_STATS,
    STAFF_PERMISSIONS.VIEW_AUDIT_LOG,
    STAFF_PERMISSIONS.MODERATE_CONTENT,
    STAFF_PERMISSIONS.VIEW_REPORTS,
    STAFF_PERMISSIONS.RESOLVE_REPORTS,
    STAFF_PERMISSIONS.VIEW_SUBSCRIPTIONS,
    // Matches app/api/v3/admin/route.ts's canPerformAction modActions,
    // which already allows a moderator to call these 4 reset actions.
    STAFF_PERMISSIONS.RESET_USER_DAILY_LIMIT,
    STAFF_PERMISSIONS.RESET_USER_AI_USAGE,
    STAFF_PERMISSIONS.RESET_USER_GITHUB_REVIEW_USAGE,
    STAFF_PERMISSIONS.RESET_USER_FREE_GITHUB_TRIAL,
  ],
  [STAFF_ROLES.ADMIN]: Object.values(STAFF_PERMISSIONS),
  // super-admin: passes every check ADMIN passes (see
  // lib/auth/authorization.ts's STAFF_ROLE_HIERARCHY, where it sits above
  // ADMIN). Without this entry a super_admin's role string wouldn't match
  // any key here, so every hasStaffPermission() call, including
  // canAccessAdmin(), would silently return false and lock the account
  // out of the admin panel UI it's supposed to have full access to.
  [STAFF_ROLES.SUPER_ADMIN]: Object.values(STAFF_PERMISSIONS),
};

/**
 * Check if a staff role has a specific permission (client-side)
 */
export function hasStaffPermission(
  role: string | null | undefined,
  permission: StaffPermission,
): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSION_MAP[role];
  return perms ? perms.includes(permission) : false;
}

/**
 * Check if role has any of the specified permissions
 */
export function hasAnyStaffPermission(
  role: string | null | undefined,
  permissions: StaffPermission[],
): boolean {
  return permissions.some((p) => hasStaffPermission(role, p));
}

/**
 * Check if role has all specified permissions
 */
export function hasAllStaffPermissions(
  role: string | null | undefined,
  permissions: StaffPermission[],
): boolean {
  return permissions.every((p) => hasStaffPermission(role, p));
}

/**
 * Get all permissions for a role
 */
export function getStaffPermissions(
  role: string | null | undefined,
): StaffPermission[] {
  if (!role) return [];
  return ROLE_PERMISSION_MAP[role] || [];
}

/**
 * Check if role is a staff role (has any staff permissions)
 */
export function isStaffRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSION_MAP[role];
  return perms && perms.length > 0;
}

/**
 * Check if roleA can manage roleB (based on hierarchy)
 */
export function canManageRole(
  managerRole: string | null | undefined,
  targetRole: string | null | undefined,
): boolean {
  if (!managerRole) return false;
  const managerLevel = STAFF_ROLE_HIERARCHY[managerRole] ?? 0;
  const targetLevel = STAFF_ROLE_HIERARCHY[targetRole || "user"] ?? 0;
  return managerLevel > targetLevel;
}

/**
 * Get role hierarchy level
 */
export function getRoleLevel(role: string | null | undefined): number {
  if (!role) return 0;
  return STAFF_ROLE_HIERARCHY[role] ?? 0;
}

/**
 * Check if role can access admin panel
 */
export function canAccessAdmin(role: string | null | undefined): boolean {
  return hasStaffPermission(role, STAFF_PERMISSIONS.ACCESS_ADMIN_PANEL);
}

/**
 * Check if role can access staff page
 */
export function canAccessStaffPage(role: string | null | undefined): boolean {
  return hasStaffPermission(role, STAFF_PERMISSIONS.ACCESS_STAFF_PAGE);
}

// ADMIN ACTION DEFINITIONS

export interface AdminAction {
  id: string;
  label: string;
  description: string;
  permission: StaffPermission;
  icon: string;
  category: string;
  dangerous?: boolean;
  requiresConfirmation?: boolean;
}

export const ADMIN_ACTIONS: AdminAction[] = [
  // User Management
  {
    id: "update_name",
    label: "Update Name",
    description: "Change user's display name",
    permission: STAFF_PERMISSIONS.EDIT_USER_NAME,
    category: "user",
    icon: "User",
  },
  {
    id: "update_email",
    label: "Update Email",
    description: "Change user's email address",
    permission: STAFF_PERMISSIONS.EDIT_USER_EMAIL,
    category: "user",
    icon: "Mail",
    requiresConfirmation: true,
  },
  {
    id: "update_plan",
    label: "Update Plan",
    description: "Change subscription plan",
    permission: STAFF_PERMISSIONS.EDIT_USER_PLAN,
    category: "subscription",
    icon: "CreditCard",
  },
  {
    id: "set_role",
    label: "Set Role",
    description: "Change staff role",
    permission: STAFF_PERMISSIONS.EDIT_USER_ROLE,
    category: "user",
    icon: "Shield",
    requiresConfirmation: true,
  },
  {
    // No current UI trigger (app/admin/page.tsx's onAction sends "set_role"
    // for both promoting and demoting staff) -- registered for completeness
    // since app/api/v3/admin/route.ts's switch still implements this as a
    // distinct, password-gated action.
    id: "make_admin",
    label: "Promote to Admin",
    description: "Grant admin role",
    permission: STAFF_PERMISSIONS.EDIT_USER_ROLE,
    category: "user",
    icon: "Shield",
    requiresConfirmation: true,
  },
  {
    id: "remove_admin",
    label: "Remove Admin Role",
    description: "Revoke admin role",
    permission: STAFF_PERMISSIONS.EDIT_USER_ROLE,
    category: "user",
    icon: "Shield",
    requiresConfirmation: true,
  },
  {
    id: "disable",
    label: "Disable Account",
    description: "Suspend account",
    permission: STAFF_PERMISSIONS.DISABLE_USER,
    category: "user",
    icon: "Ban",
    dangerous: true,
    requiresConfirmation: true,
  },
  {
    id: "enable",
    label: "Enable Account",
    description: "Reactivate account",
    permission: STAFF_PERMISSIONS.ENABLE_USER,
    category: "user",
    icon: "Check",
  },
  {
    id: "reset_password",
    label: "Reset Password",
    description: "Generate temp password",
    permission: STAFF_PERMISSIONS.RESET_USER_PASSWORD,
    category: "security",
    icon: "Key",
    requiresConfirmation: true,
  },
  {
    // No current UI trigger -- see the "make_admin" comment above for why
    // this is still registered.
    id: "update_password",
    label: "Update Password",
    description: "Set a specific password",
    permission: STAFF_PERMISSIONS.RESET_USER_PASSWORD,
    category: "security",
    icon: "Key",
    requiresConfirmation: true,
  },
  {
    id: "reset_2fa",
    label: "Reset 2FA",
    description: "Remove 2FA",
    permission: STAFF_PERMISSIONS.RESET_USER_2FA,
    category: "security",
    icon: "Smartphone",
    requiresConfirmation: true,
  },
  {
    // Renamed from "delete_user" to match "delete", the only string
    // anything actually sends (components/admin/users/user-detail-panel.tsx's
    // "Delete Account" button, components/admin/config.ts's
    // PASSWORD_GATED_ACTIONS). Correctness fix for this module, but NOT
    // what was blocking Delete Account for an admin/super_admin caller in
    // practice: app/api/v3/admin/route.ts's PATCH handler has its OWN,
    // separate, locally-defined canPerformAction() that short-circuits
    // true for admin/super_admin regardless of the action string --
    // ADMIN_ACTIONS here is only consumed client-side (getAvailableActions,
    // called by components/admin/hooks/use-admin-permissions.ts but never
    // actually invoked by any component -- the perms.canDeleteUsers flag
    // components actually check is computed straight from
    // hasStaffPermission(role, DELETE_USER), bypassing this array
    // entirely). The real "Delete Account does nothing" bug was a
    // foreign-key violation in app/api/v3/admin/route.ts's delete case
    // itself -- see the comment on that case's logAction call.
    id: "delete",
    label: "Delete User",
    description: "Permanently delete",
    permission: STAFF_PERMISSIONS.DELETE_USER,
    category: "user",
    icon: "Trash",
    dangerous: true,
    requiresConfirmation: true,
  },
  {
    id: "impersonate",
    label: "Impersonate",
    description: "Login as user",
    permission: STAFF_PERMISSIONS.IMPERSONATE_USER,
    category: "debug",
    icon: "Eye",
    requiresConfirmation: true,
  },

  // Session Management
  {
    id: "revoke_sessions",
    label: "Revoke Sessions",
    description: "Log out everywhere",
    permission: STAFF_PERMISSIONS.REVOKE_USER_SESSIONS,
    category: "security",
    icon: "LogOut",
    requiresConfirmation: true,
  },
  {
    // Distinct from "revoke_sessions" above -- app/api/v3/admin/route.ts
    // implements both as separate switch cases. No current UI trigger for
    // this one; still registered for completeness, same reasoning as
    // "make_admin" above.
    id: "revoke_all_sessions",
    label: "Revoke All Sessions",
    description: "Log out everywhere",
    permission: STAFF_PERMISSIONS.REVOKE_USER_SESSIONS,
    category: "security",
    icon: "LogOut",
    requiresConfirmation: true,
  },
  {
    id: "revoke_api_keys",
    label: "Revoke API Keys",
    description: "Revoke all keys",
    permission: STAFF_PERMISSIONS.REVOKE_USER_API_KEYS,
    category: "security",
    icon: "Key",
    dangerous: true,
    requiresConfirmation: true,
  },

  // Badge Management
  {
    id: "award_badge",
    label: "Award Badge",
    description: "Give badge",
    permission: STAFF_PERMISSIONS.AWARD_BADGE,
    category: "badge",
    icon: "Award",
  },
  {
    id: "revoke_badge",
    label: "Revoke Badge",
    description: "Remove badge",
    permission: STAFF_PERMISSIONS.REVOKE_BADGE,
    category: "badge",
    icon: "X",
  },
  {
    id: "create_badge",
    label: "Create Badge",
    description: "Create and award",
    permission: STAFF_PERMISSIONS.CREATE_BADGE,
    category: "badge",
    icon: "Plus",
  },
  {
    id: "delete_badge",
    label: "Delete Badge",
    description: "Permanently delete a badge",
    permission: STAFF_PERMISSIONS.DELETE_BADGE,
    category: "badge",
    icon: "Trash",
    dangerous: true,
    requiresConfirmation: true,
  },

  // Subscription Management
  {
    // Renamed from "grant_premium": the feature is called "gifted
    // subscription" everywhere it's actually used (components/admin/users/
    // user-detail-panel.tsx sends "gift_subscription", matching
    // app/api/v3/admin/route.ts's "case \"gift_subscription\":") -- this
    // entry's id never matched, so canPerformAction always 403'd it.
    id: "gift_subscription",
    label: "Gift Subscription",
    description: "Give a gifted subscription",
    permission: STAFF_PERMISSIONS.GRANT_PREMIUM,
    category: "subscription",
    icon: "Star",
  },
  {
    // Renamed from "revoke_premium" -- same mismatch as gift_subscription
    // above ("case \"revoke_gift\":" server-side).
    id: "revoke_gift",
    label: "Revoke Gifted Subscription",
    description: "Remove a gifted subscription",
    permission: STAFF_PERMISSIONS.REVOKE_PREMIUM,
    category: "subscription",
    icon: "StarOff",
    requiresConfirmation: true,
  },

  // Scan Management
  {
    id: "delete_scans",
    label: "Delete All Scans",
    description: "Remove all scans",
    permission: STAFF_PERMISSIONS.DELETE_ANY_SCAN,
    category: "data",
    icon: "Trash",
    dangerous: true,
    requiresConfirmation: true,
  },
  {
    id: "export_data",
    label: "Export Data",
    description: "Export user data",
    permission: STAFF_PERMISSIONS.EXPORT_SCAN_DATA,
    category: "data",
    icon: "Download",
  },
  {
    id: "delete_webhooks",
    label: "Delete Webhooks",
    description: "Remove all webhooks",
    permission: STAFF_PERMISSIONS.DELETE_USER_WEBHOOKS,
    category: "data",
    icon: "Webhook",
    dangerous: true,
    requiresConfirmation: true,
  },
  {
    id: "delete_schedules",
    label: "Delete Schedules",
    description: "Remove scheduled scans",
    permission: STAFF_PERMISSIONS.DELETE_USER_SCHEDULES,
    category: "data",
    icon: "CalendarOff",
    dangerous: true,
    requiresConfirmation: true,
  },
  {
    id: "clear_avatar",
    label: "Clear Avatar",
    description: "Remove profile picture",
    permission: STAFF_PERMISSIONS.CLEAR_USER_AVATAR,
    category: "user",
    icon: "ImageOff",
  },
  {
    // No current UI trigger -- see the "make_admin" comment above for why
    // this is still registered.
    id: "set_scan_limit",
    label: "Set Scan Limit",
    description: "Override daily scan limit",
    permission: STAFF_PERMISSIONS.MANAGE_SCAN_LIMIT,
    category: "data",
    icon: "Gauge",
  },
  {
    id: "add_note",
    label: "Add Note",
    description: "Add an internal admin note",
    permission: STAFF_PERMISSIONS.MANAGE_USER_NOTES,
    category: "user",
    icon: "StickyNote",
  },
  {
    id: "edit_note",
    label: "Edit Note",
    description: "Edit an internal admin note",
    permission: STAFF_PERMISSIONS.MANAGE_USER_NOTES,
    category: "user",
    icon: "StickyNote",
  },
  {
    id: "delete_note",
    label: "Delete Note",
    description: "Remove an internal admin note",
    permission: STAFF_PERMISSIONS.MANAGE_USER_NOTES,
    category: "user",
    icon: "StickyNote",
  },

  // Communication
  {
    id: "send_email",
    label: "Send Email",
    description: "Email user",
    permission: STAFF_PERMISSIONS.SEND_USER_EMAILS,
    category: "communication",
    icon: "Send",
  },
  {
    id: "send_notification",
    label: "Send Notification",
    description: "Send an in-app notification",
    permission: STAFF_PERMISSIONS.MANAGE_NOTIFICATIONS,
    category: "communication",
    icon: "Bell",
  },
  {
    id: "verify_email",
    label: "Verify Email",
    description: "Mark email as verified",
    permission: STAFF_PERMISSIONS.EDIT_USER_EMAIL,
    category: "user",
    icon: "Mail",
  },
  {
    id: "unverify_email",
    label: "Unverify Email",
    description: "Mark email as unverified",
    permission: STAFF_PERMISSIONS.EDIT_USER_EMAIL,
    category: "user",
    icon: "Mail",
  },
  {
    id: "toggle_ai_ban",
    label: "Toggle AI Chat Ban",
    description: "Block or restore AI chat access",
    permission: STAFF_PERMISSIONS.MODERATE_CONTENT,
    category: "moderation",
    icon: "Ban",
  },

  // System
  {
    // Renamed from "clear_rate_limit": components/admin/users/
    // user-detail-panel.tsx sends "clear_rate_limits" (plural), matching
    // app/api/v3/admin/route.ts's "case \"clear_rate_limits\":" -- the
    // singular id here never matched, so canPerformAction always 403'd it.
    id: "clear_rate_limits",
    label: "Clear Rate Limit",
    description: "Reset rate limits",
    permission: STAFF_PERMISSIONS.MANAGE_RATE_LIMITS,
    category: "system",
    icon: "RefreshCw",
  },
  {
    // Renamed from "force_logout": app/admin/page.tsx sends
    // "force_logout_all", matching app/api/v3/admin/route.ts's
    // "case \"force_logout_all\":" -- same class of mismatch as above.
    id: "force_logout_all",
    label: "Force Logout",
    description: "End all sessions",
    permission: STAFF_PERMISSIONS.REVOKE_USER_SESSIONS,
    category: "security",
    icon: "LogOut",
    requiresConfirmation: true,
  },
  {
    id: "reset_daily_limit",
    label: "Reset Daily Scan Limit",
    description: "Zero today's scan count",
    permission: STAFF_PERMISSIONS.RESET_USER_DAILY_LIMIT,
    category: "system",
    icon: "Gauge",
  },
  {
    id: "reset_ai_usage",
    label: "Reset AI Usage",
    description: "Zero the current AI usage window",
    permission: STAFF_PERMISSIONS.RESET_USER_AI_USAGE,
    category: "system",
    icon: "Sparkles",
  },
  {
    id: "reset_github_review_usage",
    label: "Reset GitHub Review Usage",
    description: "Zero the current GitHub review window",
    permission: STAFF_PERMISSIONS.RESET_USER_GITHUB_REVIEW_USAGE,
    category: "system",
    icon: "RefreshCw",
  },
  {
    id: "reset_free_github_trial",
    label: "Reset Free GitHub Trial",
    description: "Let the daily free review run again now",
    permission: STAFF_PERMISSIONS.RESET_USER_FREE_GITHUB_TRIAL,
    category: "system",
    icon: "RefreshCw",
  },
];

/**
 * Get available actions for a role
 */
export function getAvailableActions(
  role: string | null | undefined,
): AdminAction[] {
  if (!role) return [];
  return ADMIN_ACTIONS.filter((action) =>
    hasStaffPermission(role, action.permission),
  );
}

/**
 * Check if role can perform an action
 */
export function canPerformAction(
  role: string | null | undefined,
  actionId: string,
): boolean {
  const action = ADMIN_ACTIONS.find((a) => a.id === actionId);
  if (!action) return false;
  return hasStaffPermission(role, action.permission);
}

/**
 * Get actions grouped by category
 */
export function getActionsByCategory(
  role: string | null | undefined,
): Record<string, AdminAction[]> {
  const available = getAvailableActions(role);
  const grouped: Record<string, AdminAction[]> = {};
  for (const action of available) {
    if (!grouped[action.category]) grouped[action.category] = [];
    grouped[action.category].push(action);
  }
  return grouped;
}
