// ============================================================================
// Roles & Permissions System (Clean Schema)
// ============================================================================
// Uses the `role` field on users table instead of separate tables.
// Roles: 'user', 'beta_tester', 'support', 'moderator', 'admin'
// ============================================================================

import pool from "./db"

// Define available roles and their properties
export const ROLES = {
  user: { displayName: "User", color: null, priority: 0 },
  beta_tester: { displayName: "Beta Tester", color: "#10b981", priority: 1 },
  support: { displayName: "Support", color: "#3b82f6", priority: 2 },
  moderator: { displayName: "Moderator", color: "#f59e0b", priority: 3 },
  admin: { displayName: "Admin", color: "#ef4444", priority: 4 },
} as const

export type RoleName = keyof typeof ROLES

// Define permissions per role (hardcoded, no DB lookups needed)
export const ROLE_PERMISSIONS: Record<RoleName, string[]> = {
  user: [
    "scan.create", "scan.view", "scan.delete",
    "api.access", "api.keys.create",
  ],
  beta_tester: [
    "scan.create", "scan.view", "scan.delete", "scan.bulk",
    "api.access", "api.keys.create",
    "webhook.manage", "schedule.manage", "beta.access",
  ],
  support: [
    "scan.create", "scan.view",
    "api.access",
    "admin.users.view", "admin.scans.view",
  ],
  moderator: [
    "scan.create", "scan.view", "scan.delete", "scan.bulk",
    "api.access", "api.keys.create",
    "admin.users.view", "admin.users.edit", "admin.scans.view", "admin.audit.view",
  ],
  admin: [
    "scan.create", "scan.view", "scan.delete", "scan.bulk",
    "api.access", "api.keys.create",
    "webhook.manage", "schedule.manage",
    "team.create", "team.manage",
    "admin.users.view", "admin.users.edit", "admin.users.delete",
    "admin.scans.view", "admin.audit.view", "admin.settings",
    "beta.access",
  ],
}

export interface Role {
  name: RoleName
  displayName: string
  color: string | null
  priority: number
}

/**
 * Get role info by name
 */
export function getRoleInfo(roleName: string): Role {
  const role = ROLES[roleName as RoleName]
  if (!role) {
    return { name: "user", displayName: "User", color: null, priority: 0 }
  }
  return { name: roleName as RoleName, ...role }
}

/**
 * Get all available roles
 */
export function getAllRoles(): Role[] {
  return Object.entries(ROLES).map(([name, props]) => ({
    name: name as RoleName,
    ...props,
  }))
}

/**
 * Get user's role from the users table
 */
export async function getUserRole(userId: number): Promise<RoleName> {
  try {
    const result = await pool.query(
      `SELECT role FROM users WHERE id = $1`,
      [userId]
    )
    const role = result.rows[0]?.role
    return (role && role in ROLES) ? role as RoleName : "user"
  } catch (error) {
    console.error("[Permissions] Error getting user role:", error)
    return "user"
  }
}

/**
 * Get all permissions for a user based on their role
 */
export function getPermissionsForRole(roleName: RoleName): string[] {
  return ROLE_PERMISSIONS[roleName] || ROLE_PERMISSIONS.user
}

/**
 * Get all permissions for a user
 */
export async function getUserPermissions(userId: number): Promise<string[]> {
  const role = await getUserRole(userId)
  return getPermissionsForRole(role)
}

/**
 * Check if user has a specific permission
 */
export async function userHasPermission(userId: number, permissionName: string): Promise<boolean> {
  const permissions = await getUserPermissions(userId)
  return permissions.includes(permissionName)
}

/**
 * Check if user has any of the specified permissions
 */
export async function userHasAnyPermission(userId: number, permissionNames: string[]): Promise<boolean> {
  const permissions = await getUserPermissions(userId)
  return permissionNames.some(p => permissions.includes(p))
}

/**
 * Check if a role has a specific permission (sync, no DB)
 */
export function roleHasPermission(roleName: RoleName, permissionName: string): boolean {
  const permissions = ROLE_PERMISSIONS[roleName] || []
  return permissions.includes(permissionName)
}

/**
 * Set user's role
 */
export async function setUserRole(userId: number, roleName: RoleName): Promise<void> {
  try {
    await pool.query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`,
      [roleName, userId]
    )
  } catch (error) {
    console.error("[Permissions] Error setting user role:", error)
    throw error
  }
}

/**
 * Check if role can manage another role (based on priority)
 */
export function canManageRole(managerRole: RoleName, targetRole: RoleName): boolean {
  return ROLES[managerRole].priority > ROLES[targetRole].priority
}

/**
 * Check if user can access admin panel
 */
export async function canAccessAdmin(userId: number): Promise<boolean> {
  const role = await getUserRole(userId)
  return ["admin", "moderator", "support"].includes(role)
}

/**
 * Get role level/priority
 */
export function getRoleLevel(roleName: RoleName): number {
  return ROLES[roleName]?.priority || 0
}

/**
 * Check if role is a staff role
 */
export function isStaffRole(roleName: string): boolean {
  return ["admin", "moderator", "support"].includes(roleName)
}

// Re-export client-side helpers
export {
  STAFF_PERMISSIONS,
  hasStaffPermission,
  hasAnyStaffPermission,
  hasAllStaffPermissions,
  getStaffPermissions,
  canAccessStaffPage,
  ADMIN_ACTIONS,
  getAvailableActions,
  canPerformAction,
  getActionsByCategory,
  type StaffPermission,
  type AdminAction,
} from "./permissions-client"
