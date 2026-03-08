// ============================================================================
// Roles & Permissions System
// ============================================================================
// Manages user roles, permissions, and permission tags
// ============================================================================

import pool from "./db"

export interface Role {
  id: number
  name: string
  displayName: string
  description: string | null
  color: string | null
  priority: number
  isSystem: boolean
  createdAt: Date
}

export interface Permission {
  id: number
  name: string
  displayName: string
  description: string | null
  category: string | null
  createdAt: Date
}

/**
 * Get all roles
 */
export async function getAllRoles(): Promise<Role[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM roles ORDER BY priority DESC`
    )
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      color: row.color,
      priority: row.priority,
      isSystem: row.is_system,
      createdAt: row.created_at,
    }))
  } catch (error) {
    console.error("[Permissions] Error getting roles:", error)
    return []
  }
}

/**
 * Get a role by name
 */
export async function getRoleByName(name: string): Promise<Role | null> {
  try {
    const result = await pool.query(
      `SELECT * FROM roles WHERE name = $1`,
      [name]
    )
    if (!result.rows[0]) return null
    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      color: row.color,
      priority: row.priority,
      isSystem: row.is_system,
      createdAt: row.created_at,
    }
  } catch (error) {
    console.error("[Permissions] Error getting role:", error)
    return null
  }
}

/**
 * Get all permissions for a role
 */
export async function getRolePermissions(roleId: number): Promise<Permission[]> {
  try {
    const result = await pool.query(
      `SELECT p.* FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       WHERE rp.role_id = $1`,
      [roleId]
    )
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      category: row.category,
      createdAt: row.created_at,
    }))
  } catch (error) {
    console.error("[Permissions] Error getting role permissions:", error)
    return []
  }
}

/**
 * Get all roles assigned to a user
 */
export async function getUserRoles(userId: number): Promise<Role[]> {
  try {
    const result = await pool.query(
      `SELECT r.* FROM roles r
       JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = $1
       ORDER BY r.priority DESC`,
      [userId]
    )
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      color: row.color,
      priority: row.priority,
      isSystem: row.is_system,
      createdAt: row.created_at,
    }))
  } catch (error) {
    console.error("[Permissions] Error getting user roles:", error)
    return []
  }
}

/**
 * Get all permissions for a user (from all their roles)
 */
export async function getUserPermissions(userId: number): Promise<string[]> {
  try {
    const result = await pool.query(
      `SELECT DISTINCT p.name FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       JOIN user_roles ur ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1`,
      [userId]
    )
    return result.rows.map((row) => row.name)
  } catch (error) {
    console.error("[Permissions] Error getting user permissions:", error)
    return []
  }
}

/**
 * Check if user has a specific permission
 */
export async function userHasPermission(userId: number, permissionName: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT 1 FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       JOIN user_roles ur ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1 AND p.name = $2
       LIMIT 1`,
      [userId, permissionName]
    )
    return result.rows.length > 0
  } catch (error) {
    console.error("[Permissions] Error checking permission:", error)
    return false
  }
}

/**
 * Check if user has any of the specified permissions
 */
export async function userHasAnyPermission(userId: number, permissionNames: string[]): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT 1 FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       JOIN user_roles ur ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1 AND p.name = ANY($2)
       LIMIT 1`,
      [userId, permissionNames]
    )
    return result.rows.length > 0
  } catch (error) {
    console.error("[Permissions] Error checking permissions:", error)
    return false
  }
}

/**
 * Assign a role to a user
 */
export async function assignRoleToUser(userId: number, roleId: number, assignedBy?: number): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, roleId, assignedBy || null]
    )
  } catch (error) {
    console.error("[Permissions] Error assigning role:", error)
    throw error
  }
}

/**
 * Remove a role from a user
 */
export async function removeRoleFromUser(userId: number, roleId: number): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, roleId]
    )
  } catch (error) {
    console.error("[Permissions] Error removing role:", error)
    throw error
  }
}

/**
 * Get user's permission tag (visible badge)
 */
export async function getUserPermissionTag(userId: number): Promise<Role | null> {
  try {
    const result = await pool.query(
      `SELECT r.* FROM roles r
       JOIN user_permission_tags upt ON r.id = upt.tag_role_id
       WHERE upt.user_id = $1`,
      [userId]
    )
    if (!result.rows[0]) return null
    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      color: row.color,
      priority: row.priority,
      isSystem: row.is_system,
      createdAt: row.created_at,
    }
  } catch (error) {
    console.error("[Permissions] Error getting permission tag:", error)
    return null
  }
}

/**
 * Set user's permission tag (visible badge)
 * Users can only have ONE visible permission tag at a time
 */
export async function setUserPermissionTag(userId: number, roleId: number): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO user_permission_tags (user_id, tag_role_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id) 
       DO UPDATE SET tag_role_id = $2, assigned_at = NOW()`,
      [userId, roleId]
    )
  } catch (error) {
    console.error("[Permissions] Error setting permission tag:", error)
    throw error
  }
}

/**
 * Remove user's permission tag
 */
export async function removeUserPermissionTag(userId: number): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM user_permission_tags WHERE user_id = $1`,
      [userId]
    )
  } catch (error) {
    console.error("[Permissions] Error removing permission tag:", error)
    throw error
  }
}

/**
 * Get highest priority role for a user (for display purposes)
 */
export async function getHighestUserRole(userId: number): Promise<Role | null> {
  try {
    const result = await pool.query(
      `SELECT r.* FROM roles r
       JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = $1
       ORDER BY r.priority DESC
       LIMIT 1`,
      [userId]
    )
    if (!result.rows[0]) return null
    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      color: row.color,
      priority: row.priority,
      isSystem: row.is_system,
      createdAt: row.created_at,
    }
  } catch (error) {
    console.error("[Permissions] Error getting highest role:", error)
    return null
  }
}

/**
 * Create a new role (for custom roles)
 */
export async function createRole(
  name: string,
  displayName: string,
  description?: string,
  color?: string,
  priority?: number
): Promise<Role | null> {
  try {
    const result = await pool.query(
      `INSERT INTO roles (name, display_name, description, color, priority, is_system)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING *`,
      [name, displayName, description || null, color || null, priority || 0]
    )
    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      color: row.color,
      priority: row.priority,
      isSystem: row.is_system,
      createdAt: row.created_at,
    }
  } catch (error) {
    console.error("[Permissions] Error creating role:", error)
    return null
  }
}

/**
 * Get all permissions grouped by category
 */
export async function getPermissionsByCategory(): Promise<Record<string, Permission[]>> {
  try {
    const result = await pool.query(
      `SELECT * FROM permissions ORDER BY category, name`
    )
    const grouped: Record<string, Permission[]> = {}
    for (const row of result.rows) {
      const category = row.category || "other"
      if (!grouped[category]) grouped[category] = []
      grouped[category].push({
        id: row.id,
        name: row.name,
        displayName: row.display_name,
        description: row.description,
        category: row.category,
        createdAt: row.created_at,
      })
    }
    return grouped
  } catch (error) {
    console.error("[Permissions] Error getting permissions:", error)
    return {}
  }
}
