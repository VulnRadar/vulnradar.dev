/**
 * CLIENT-SIDE PERMISSION HELPERS
 * No database imports - safe for client-side usage
 */

import { STAFF_ROLES, STAFF_ROLE_HIERARCHY } from "./constants"

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
  
  // Development
  VIEW_DEBUG_INFO: "view_debug_info",
  TRIGGER_MAINTENANCE: "trigger_maintenance",
  CLEAR_CACHE: "clear_cache",
} as const

export type StaffPermission = (typeof STAFF_PERMISSIONS)[keyof typeof STAFF_PERMISSIONS]

// Role -> Permissions mapping (client-side)
const ROLE_PERMISSION_MAP: Record<string, StaffPermission[]> = {
  [STAFF_ROLES.USER]: [],
  [STAFF_ROLES.BETA_TESTER]: [],
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
  ],
  [STAFF_ROLES.ADMIN]: Object.values(STAFF_PERMISSIONS),
}

/**
 * Check if a staff role has a specific permission (client-side)
 */
export function hasStaffPermission(role: string | null | undefined, permission: StaffPermission): boolean {
  if (!role) return false
  const perms = ROLE_PERMISSION_MAP[role]
  return perms ? perms.includes(permission) : false
}

/**
 * Check if role has any of the specified permissions
 */
export function hasAnyStaffPermission(role: string | null | undefined, permissions: StaffPermission[]): boolean {
  return permissions.some(p => hasStaffPermission(role, p))
}

/**
 * Check if role has all specified permissions
 */
export function hasAllStaffPermissions(role: string | null | undefined, permissions: StaffPermission[]): boolean {
  return permissions.every(p => hasStaffPermission(role, p))
}

/**
 * Get all permissions for a role
 */
export function getStaffPermissions(role: string | null | undefined): StaffPermission[] {
  if (!role) return []
  return ROLE_PERMISSION_MAP[role] || []
}

/**
 * Check if role is a staff role (has any staff permissions)
 */
export function isStaffRole(role: string | null | undefined): boolean {
  if (!role) return false
  const perms = ROLE_PERMISSION_MAP[role]
  return perms && perms.length > 0
}

/**
 * Check if roleA can manage roleB (based on hierarchy)
 */
export function canManageRole(managerRole: string | null | undefined, targetRole: string | null | undefined): boolean {
  if (!managerRole) return false
  const managerLevel = STAFF_ROLE_HIERARCHY[managerRole] ?? 0
  const targetLevel = STAFF_ROLE_HIERARCHY[targetRole || "user"] ?? 0
  return managerLevel > targetLevel
}

/**
 * Get role hierarchy level
 */
export function getRoleLevel(role: string | null | undefined): number {
  if (!role) return 0
  return STAFF_ROLE_HIERARCHY[role] ?? 0
}

/**
 * Check if role can access admin panel
 */
export function canAccessAdmin(role: string | null | undefined): boolean {
  return hasStaffPermission(role, STAFF_PERMISSIONS.ACCESS_ADMIN_PANEL)
}

/**
 * Check if role can access staff page
 */
export function canAccessStaffPage(role: string | null | undefined): boolean {
  return hasStaffPermission(role, STAFF_PERMISSIONS.ACCESS_STAFF_PAGE)
}

// ============================================================================
// ADMIN ACTION DEFINITIONS
// ============================================================================

export interface AdminAction {
  id: string
  label: string
  description: string
  permission: StaffPermission
  icon: string
  category: string
  dangerous?: boolean
  requiresConfirmation?: boolean
}

export const ADMIN_ACTIONS: AdminAction[] = [
  // User Management
  { id: "update_name", label: "Update Name", description: "Change user's display name", permission: STAFF_PERMISSIONS.EDIT_USER_NAME, category: "user", icon: "User" },
  { id: "update_email", label: "Update Email", description: "Change user's email address", permission: STAFF_PERMISSIONS.EDIT_USER_EMAIL, category: "user", icon: "Mail", requiresConfirmation: true },
  { id: "update_plan", label: "Update Plan", description: "Change subscription plan", permission: STAFF_PERMISSIONS.EDIT_USER_PLAN, category: "subscription", icon: "CreditCard" },
  { id: "set_role", label: "Set Role", description: "Change staff role", permission: STAFF_PERMISSIONS.EDIT_USER_ROLE, category: "user", icon: "Shield", requiresConfirmation: true },
  { id: "disable", label: "Disable Account", description: "Suspend account", permission: STAFF_PERMISSIONS.DISABLE_USER, category: "user", icon: "Ban", dangerous: true, requiresConfirmation: true },
  { id: "enable", label: "Enable Account", description: "Reactivate account", permission: STAFF_PERMISSIONS.ENABLE_USER, category: "user", icon: "Check" },
  { id: "reset_password", label: "Reset Password", description: "Generate temp password", permission: STAFF_PERMISSIONS.RESET_USER_PASSWORD, category: "security", icon: "Key", requiresConfirmation: true },
  { id: "reset_2fa", label: "Reset 2FA", description: "Remove 2FA", permission: STAFF_PERMISSIONS.RESET_USER_2FA, category: "security", icon: "Smartphone", requiresConfirmation: true },
  { id: "delete_user", label: "Delete User", description: "Permanently delete", permission: STAFF_PERMISSIONS.DELETE_USER, category: "user", icon: "Trash", dangerous: true, requiresConfirmation: true },
  { id: "impersonate", label: "Impersonate", description: "Login as user", permission: STAFF_PERMISSIONS.IMPERSONATE_USER, category: "debug", icon: "Eye", requiresConfirmation: true },
  
  // Session Management
  { id: "revoke_sessions", label: "Revoke Sessions", description: "Log out everywhere", permission: STAFF_PERMISSIONS.REVOKE_USER_SESSIONS, category: "security", icon: "LogOut", requiresConfirmation: true },
  { id: "revoke_api_keys", label: "Revoke API Keys", description: "Revoke all keys", permission: STAFF_PERMISSIONS.REVOKE_USER_API_KEYS, category: "security", icon: "Key", dangerous: true, requiresConfirmation: true },
  
  // Badge Management
  { id: "award_badge", label: "Award Badge", description: "Give badge", permission: STAFF_PERMISSIONS.AWARD_BADGE, category: "badge", icon: "Award" },
  { id: "revoke_badge", label: "Revoke Badge", description: "Remove badge", permission: STAFF_PERMISSIONS.REVOKE_BADGE, category: "badge", icon: "X" },
  { id: "create_badge", label: "Create Badge", description: "Create and award", permission: STAFF_PERMISSIONS.CREATE_BADGE, category: "badge", icon: "Plus" },
  
  // Subscription Management
  { id: "grant_premium", label: "Grant Premium", description: "Give premium access", permission: STAFF_PERMISSIONS.GRANT_PREMIUM, category: "subscription", icon: "Star" },
  { id: "revoke_premium", label: "Revoke Premium", description: "Remove premium", permission: STAFF_PERMISSIONS.REVOKE_PREMIUM, category: "subscription", icon: "StarOff", requiresConfirmation: true },
  
  // Scan Management
  { id: "delete_scans", label: "Delete All Scans", description: "Remove all scans", permission: STAFF_PERMISSIONS.DELETE_ANY_SCAN, category: "data", icon: "Trash", dangerous: true, requiresConfirmation: true },
  { id: "export_data", label: "Export Data", description: "Export user data", permission: STAFF_PERMISSIONS.EXPORT_SCAN_DATA, category: "data", icon: "Download" },
  
  // Communication
  { id: "send_email", label: "Send Email", description: "Email user", permission: STAFF_PERMISSIONS.SEND_USER_EMAILS, category: "communication", icon: "Send" },
  
  // System
  { id: "clear_rate_limit", label: "Clear Rate Limit", description: "Reset rate limits", permission: STAFF_PERMISSIONS.MANAGE_RATE_LIMITS, category: "system", icon: "RefreshCw" },
  { id: "force_logout", label: "Force Logout", description: "End all sessions", permission: STAFF_PERMISSIONS.REVOKE_USER_SESSIONS, category: "security", icon: "LogOut", requiresConfirmation: true },
]

/**
 * Get available actions for a role
 */
export function getAvailableActions(role: string | null | undefined): AdminAction[] {
  if (!role) return []
  return ADMIN_ACTIONS.filter(action => hasStaffPermission(role, action.permission))
}

/**
 * Check if role can perform an action
 */
export function canPerformAction(role: string | null | undefined, actionId: string): boolean {
  const action = ADMIN_ACTIONS.find(a => a.id === actionId)
  if (!action) return false
  return hasStaffPermission(role, action.permission)
}

/**
 * Get actions grouped by category
 */
export function getActionsByCategory(role: string | null | undefined): Record<string, AdminAction[]> {
  const available = getAvailableActions(role)
  const grouped: Record<string, AdminAction[]> = {}
  for (const action of available) {
    if (!grouped[action.category]) grouped[action.category] = []
    grouped[action.category].push(action)
  }
  return grouped
}
