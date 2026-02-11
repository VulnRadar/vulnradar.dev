import pool from "./db"
import { ApiResponse } from "./api-utils"
import { TEAM_ROLES } from "./constants"

/**
 * Common authorization checks for resource ownership
 */

/**
 * Verify user owns a resource (scan history, team, etc.)
 */
export async function verifyOwnership(
  resourceTable: string,
  resourceId: number,
  userId: number,
  userIdColumn = "user_id",
): Promise<{ owned: boolean; error?: any }> {
  try {
    const result = await pool.query(
      `SELECT id FROM ${resourceTable} WHERE id = $1 AND ${userIdColumn} = $2`,
      [resourceId, userId],
    )

    return {
      owned: result.rows.length > 0,
    }
  } catch (err) {
    return {
      owned: false,
      error: ApiResponse.serverError("Failed to verify ownership"),
    }
  }
}

/**
 * Verify user is member of a team
 */
export async function verifyTeamMembership(
  teamId: number,
  userId: number,
  requiredRole?: string,
): Promise<{ isMember: boolean; role?: string; error?: any }> {
  try {
    const result = await pool.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId],
    )

    if (result.rows.length === 0) {
      return { isMember: false }
    }

    const { role } = result.rows[0]

    if (requiredRole) {
      const roleHierarchy: Record<string, number> = {
        [TEAM_ROLES.OWNER]: 3,
        [TEAM_ROLES.ADMIN]: 2,
        [TEAM_ROLES.MEMBER]: 1,
      }

      if ((roleHierarchy[role] || 0) < (roleHierarchy[requiredRole] || 0)) {
        return {
          isMember: true,
          role,
          error: ApiResponse.forbidden(`Requires ${requiredRole} role`),
        }
      }
    }

    return { isMember: true, role }
  } catch (err) {
    return {
      isMember: false,
      error: ApiResponse.serverError("Failed to verify team membership"),
    }
  }
}

/**
 * Verify user has permission (owner/admin) in team
 */
export async function verifyTeamAdmin(teamId: number, userId: number): Promise<{ isAdmin: boolean; error?: any }> {
  const result = await verifyTeamMembership(teamId, userId, TEAM_ROLES.ADMIN)
  return {
    isAdmin: result.isMember && [TEAM_ROLES.OWNER, TEAM_ROLES.ADMIN].includes(result.role || ""),
    error: result.error,
  }
}

/**
 * Verify user is team owner
 */
export async function verifyTeamOwner(teamId: number, userId: number): Promise<{ isOwner: boolean; error?: any }> {
  const result = await verifyTeamMembership(teamId, userId, TEAM_ROLES.OWNER)
  return {
    isOwner: result.isMember && result.role === TEAM_ROLES.OWNER,
    error: result.error,
  }
}

/**
 * Get user's role in a team
 */
export async function getUserTeamRole(teamId: number, userId: number): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId],
    )
    return result.rows[0]?.role || null
  } catch {
    return null
  }
}
