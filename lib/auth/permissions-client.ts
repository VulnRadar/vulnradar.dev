/**
 * CLIENT-SIDE PERMISSION HELPERS
 * No database imports - safe for client-side usage
 */

import {
  STAFF_ROLES,
  STAFF_ROLE_HIERARCHY,
} from "@/lib/config/client-constants";

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

  // Scans. VIEW_SCAN_STATS was removed: it gated nothing anywhere, and the
  // panel's scan counters are part of the stats payload the default section
  // of app/api/v3/admin/route.ts already serves to any staff role. A
  // permission that changes nothing when granted or withheld is worse than
  // no permission, because an operator reasonably believes it does something.
  VIEW_ALL_SCANS: "view_all_scans",
  DELETE_ANY_SCAN: "delete_any_scan",
  EXPORT_SCAN_DATA: "export_scan_data",

  // Subscriptions. VIEW_SUBSCRIPTIONS and MANAGE_SUBSCRIPTIONS were removed
  // for the same reason: nothing ever checked either one. The capabilities
  // that actually exist are GRANT_PREMIUM/REVOKE_PREMIUM (the gift
  // subscription actions), EDIT_USER_PLAN, and VIEW_BILLING_OVERVIEW.
  GRANT_PREMIUM: "grant_premium",
  REVOKE_PREMIUM: "revoke_premium",
  // Aggregate, site-wide revenue/plan-distribution dashboard (Admin >
  // Billing Overview). Narrower than "may look at a user's account": SUPPORT
  // holds VIEW_USERS, and so can see one user's plan and status on that
  // user's own record, but must not see site-wide billing numbers.
  VIEW_BILLING_OVERVIEW: "view_billing_overview",

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

  // Teams. DELETE_ANY_TEAM was removed: DELETE /api/v3/admin/teams gates on
  // requireAdmin(), not on a grant, and no other caller ever looked this up.
  VIEW_ALL_TEAMS: "view_all_teams",
  MANAGE_ANY_TEAM: "manage_any_team",

  // Moderation. VIEW_REPORTS and RESOLVE_REPORTS were removed: there is no
  // user-reports feature and no table behind it, so those two were granted to
  // four roles for a surface that has never existed. (The identically named
  // "view_reports" in TEAM_ROLE_PERMISSIONS is a different, live namespace:
  // team roles, not staff roles.)
  MODERATE_CONTENT: "moderate_content",

  // Communication
  SEND_ANNOUNCEMENTS: "send_announcements",
  SEND_USER_EMAILS: "send_user_emails",
  MANAGE_SUPPORT_TICKETS: "manage_support_tickets",

  // Notifications Management
  MANAGE_NOTIFICATIONS: "manage_notifications",

  // Development. VIEW_DEBUG_INFO and CLEAR_CACHE were removed: neither was
  // ever checked. The OPS role's real admin-panel reach is VIEW_SYSTEM_STATS,
  // VIEW_ERROR_LOGS and MANAGE_ENGINE_FEEDBACK.
  TRIGGER_MAINTENANCE: "trigger_maintenance",

  // Scanner check quality: false-positive feedback triage and AI tag
  // candidate review (app/admin/page.tsx's "Engine Feedback" tab). Its own
  // permission rather than reusing VIEW_ALL_SCANS -- it's the one thing the
  // OPS role needs that no existing permission covers.
  MANAGE_ENGINE_FEEDBACK: "manage_engine_feedback",

  // User data management (webhooks/schedules/notes/avatar are each their own
  // resource, distinct from scans/badges above -- reusing an unrelated
  // existing permission for these would silently grant them to whatever role
  // already has that permission, e.g. MODERATOR already has DELETE_ANY_SCAN).
  //
  // MANAGE_SCAN_LIMIT was removed with the same broom as the eight above. It
  // outlived its action: "set_scan_limit" was deleted when it turned out
  // nothing enforces users.daily_scan_limit (getDailyLimit resolves the cap
  // from the plan), so this had been the permission for a capability the
  // panel could not perform.
  DELETE_USER_WEBHOOKS: "delete_user_webhooks",
  DELETE_USER_SCHEDULES: "delete_user_schedules",
  /**
   * Write a NEW staff note on a user. Split out of MANAGE_USER_NOTES so the
   * moderator tier can be granted it without also being granted the power to
   * rewrite or delete an admin's note -- a distinction the codebase already
   * enforced (see the "moderator cannot edit or delete an admin note" case in
   * tests/app/api/v3/admin/route.test.ts) but could only express through the
   * hand-maintained action list that app/api/v3/admin/route.ts used to keep
   * beside this map. With that list gone, the map has to be able to say it.
   */
  ADD_USER_NOTE: "add_user_note",
  /** Edit or delete an existing staff note, including someone else's. */
  MANAGE_USER_NOTES: "manage_user_notes",
  CLEAR_USER_AVATAR: "clear_user_avatar",

  // Super-admin protection. Never granted to ADMIN (see the explicit
  // filter on ROLE_PERMISSION_MAP[STAFF_ROLES.ADMIN] below) -- this is
  // the single, named source of truth for "this account can never be
  // acted on by anyone but itself," replacing the isSuperAdminRole()
  // checks scattered across admin routes. hasStaffPermission(target.role,
  // GOD_MODE) is the check to use when deciding whether a TARGET account
  // may be modified by someone else, not whether the CALLER may act.
  GOD_MODE: "god_mode",
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
    STAFF_PERMISSIONS.MANAGE_SUPPORT_TICKETS,
  ],
  // The four specialist roles below sit at the same hierarchy tier
  // (STAFF_ROLE_HIERARCHY: support < these four === each other < moderator)
  // -- each scoped to one admin-panel nav section rather than a broad
  // slice of MODERATOR's user-facing power. See app/admin/page.tsx's
  // NAV_GROUPS for the tab <-> permission mapping these back.
  [STAFF_ROLES.BILLING]: [
    STAFF_PERMISSIONS.ACCESS_STAFF_PAGE,
    STAFF_PERMISSIONS.ACCESS_ADMIN_PANEL,
    STAFF_PERMISSIONS.VIEW_USERS,
    STAFF_PERMISSIONS.VIEW_BILLING_OVERVIEW,
    STAFF_PERMISSIONS.GRANT_PREMIUM,
    STAFF_PERMISSIONS.REVOKE_PREMIUM,
  ],
  [STAFF_ROLES.SECURITY_ANALYST]: [
    STAFF_PERMISSIONS.ACCESS_STAFF_PAGE,
    STAFF_PERMISSIONS.ACCESS_ADMIN_PANEL,
    STAFF_PERMISSIONS.VIEW_USERS,
    STAFF_PERMISSIONS.VIEW_USER_SESSIONS,
    STAFF_PERMISSIONS.REVOKE_USER_SESSIONS,
    STAFF_PERMISSIONS.RESET_USER_2FA,
    STAFF_PERMISSIONS.VIEW_ALL_SCANS,
    STAFF_PERMISSIONS.VIEW_AUDIT_LOG,
    STAFF_PERMISSIONS.MODERATE_CONTENT,
  ],
  [STAFF_ROLES.CONTENT_MANAGER]: [
    STAFF_PERMISSIONS.ACCESS_STAFF_PAGE,
    STAFF_PERMISSIONS.ACCESS_ADMIN_PANEL,
    STAFF_PERMISSIONS.VIEW_USERS,
    STAFF_PERMISSIONS.MODERATE_CONTENT,
    STAFF_PERMISSIONS.SEND_ANNOUNCEMENTS,
    STAFF_PERMISSIONS.SEND_USER_EMAILS,
    STAFF_PERMISSIONS.MANAGE_NOTIFICATIONS,
  ],
  [STAFF_ROLES.OPS]: [
    STAFF_PERMISSIONS.ACCESS_STAFF_PAGE,
    STAFF_PERMISSIONS.ACCESS_ADMIN_PANEL,
    STAFF_PERMISSIONS.VIEW_SYSTEM_STATS,
    STAFF_PERMISSIONS.VIEW_ERROR_LOGS,
    STAFF_PERMISSIONS.VIEW_ALL_SCANS,
    STAFF_PERMISSIONS.MANAGE_ENGINE_FEEDBACK,
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
    STAFF_PERMISSIONS.VIEW_AUDIT_LOG,
    STAFF_PERMISSIONS.MODERATE_CONTENT,
    // Content moderation in the literal sense: an offensive profile picture
    // is the thing this role exists to remove, and MODERATE_CONTENT above
    // does not cover it.
    STAFF_PERMISSIONS.CLEAR_USER_AVATAR,
    // A role that can disable an account has to be able to record why. Only
    // the ADD half: MANAGE_USER_NOTES (edit/delete, including someone else's
    // note) stays admin-only, which is the split the route's old parallel
    // action list encoded by listing add_note and not edit_note/delete_note.
    STAFF_PERMISSIONS.ADD_USER_NOTE,
    // app/api/v3/admin/route.ts's canPerformAction now consults this map for
    // moderators too, rather than a parallel hand-maintained list; these
    // four resets were already on both sides of that split.
    STAFF_PERMISSIONS.RESET_USER_DAILY_LIMIT,
    STAFF_PERMISSIONS.RESET_USER_AI_USAGE,
    STAFF_PERMISSIONS.RESET_USER_GITHUB_REVIEW_USAGE,
    STAFF_PERMISSIONS.RESET_USER_FREE_GITHUB_TRIAL,
  ],
  // GOD_MODE excluded: even a full admin must never be able to act on the
  // super-admin account. See the permission's own comment above.
  [STAFF_ROLES.ADMIN]: Object.values(STAFF_PERMISSIONS).filter(
    (p) => p !== STAFF_PERMISSIONS.GOD_MODE,
  ),
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
 * Whether an account with this role can be modified by anyone but itself.
 * Use this to gate the TARGET of an action (a target with GOD_MODE can
 * never be disabled/deleted/re-roled/removed-from-a-team/etc. by another
 * caller, no matter that caller's own role), not the caller's own
 * permission to perform the action.
 */
export function hasGodMode(role: string | null | undefined): boolean {
  return hasStaffPermission(role, STAFF_PERMISSIONS.GOD_MODE);
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
    // Permanently disabled server-side (account-takeover hardening -- see
    // app/api/v3/admin/route.ts's "reset_2fa" case, which now always 400s).
    // Kept registered, not removed, so the ADMIN_ACTIONS/route sync test
    // still has an entry for the case label that still exists in the
    // switch statement. No UI trigger calls this id anymore.
    id: "reset_2fa",
    label: "Reset 2FA",
    description: "Disabled: admins can never remove a user's 2FA",
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
  // "revoke_all_sessions" used to be registered here as a second entry
  // "distinct from revoke_sessions". It was not: app/api/v3/admin/route.ts's
  // case ran the same DELETE without the notification email, no UI ever
  // dispatched it, and its name did not match what the panel actually sends,
  // which is why it also escaped the password gate. The route case is gone;
  // the registry entry goes with it so the two cannot claim different sets
  // of actions exist.
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
  // "set_scan_limit" used to be registered here. Its route case wrote
  // users.daily_scan_limit and audit-logged the change, but nothing enforces
  // that column: getDailyLimit resolves the cap from the user's plan. The
  // action reported success and changed nothing. The route case is gone, so
  // the registry entry goes too rather than continuing to advertise a
  // capability the panel cannot perform.
  {
    id: "add_note",
    label: "Add Note",
    description: "Add an internal admin note",
    permission: STAFF_PERMISSIONS.ADD_USER_NOTE,
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
    // No current UI trigger (user-detail-panel.tsx's saveAllChanges calls
    // this itself, server-side batching isn't a distinct button) -- still
    // registered so it's not "stale" relative to app/api/v3/admin/route.ts's
    // "case \"notify_account_changes\":", which sends the consolidated
    // "your account was updated" email. Grouped under MANAGE_NOTIFICATIONS
    // like "send_notification" above, since this is the same kind of
    // notification dispatch, not a distinct user-editing permission.
    id: "notify_account_changes",
    label: "Notify Account Changes",
    description: "Send a consolidated account-updated email",
    permission: STAFF_PERMISSIONS.MANAGE_NOTIFICATIONS,
    category: "communication",
    icon: "Mail",
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
