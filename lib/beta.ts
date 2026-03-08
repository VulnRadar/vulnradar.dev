// ============================================================================
// Beta Features System
// ============================================================================
// Manages beta feature flags and user access to beta features
// ============================================================================

import pool from "./db"

export interface BetaFeature {
  id: number
  name: string
  description: string | null
  enabled: boolean
  rolloutPercentage: number
  createdAt: Date
}

/**
 * Get all beta features
 */
export async function getAllBetaFeatures(): Promise<BetaFeature[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM beta_features ORDER BY name`
    )
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      enabled: row.enabled,
      rolloutPercentage: row.rollout_percentage,
      createdAt: row.created_at,
    }))
  } catch (error) {
    console.error("[Beta] Error getting features:", error)
    return []
  }
}

/**
 * Get a beta feature by name
 */
export async function getBetaFeature(name: string): Promise<BetaFeature | null> {
  try {
    const result = await pool.query(
      `SELECT * FROM beta_features WHERE name = $1`,
      [name]
    )
    if (!result.rows[0]) return null
    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      enabled: row.enabled,
      rolloutPercentage: row.rollout_percentage,
      createdAt: row.created_at,
    }
  } catch (error) {
    console.error("[Beta] Error getting feature:", error)
    return null
  }
}

/**
 * Create or update a beta feature
 */
export async function upsertBetaFeature(
  name: string,
  description?: string,
  enabled?: boolean,
  rolloutPercentage?: number
): Promise<BetaFeature | null> {
  try {
    const result = await pool.query(
      `INSERT INTO beta_features (name, description, enabled, rollout_percentage)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) 
       DO UPDATE SET 
         description = COALESCE($2, beta_features.description),
         enabled = COALESCE($3, beta_features.enabled),
         rollout_percentage = COALESCE($4, beta_features.rollout_percentage)
       RETURNING *`,
      [name, description || null, enabled ?? false, rolloutPercentage ?? 0]
    )
    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      enabled: row.enabled,
      rolloutPercentage: row.rollout_percentage,
      createdAt: row.created_at,
    }
  } catch (error) {
    console.error("[Beta] Error upserting feature:", error)
    return null
  }
}

/**
 * Check if a user has access to a beta feature
 */
export async function userHasBetaAccess(userId: number, featureName: string): Promise<boolean> {
  try {
    // First check if feature exists and is enabled
    const feature = await getBetaFeature(featureName)
    if (!feature || !feature.enabled) {
      return false
    }

    // Check if user has explicit access
    const result = await pool.query(
      `SELECT 1 FROM user_beta_access uba
       JOIN beta_features bf ON uba.feature_id = bf.id
       WHERE uba.user_id = $1 AND bf.name = $2`,
      [userId, featureName]
    )
    if (result.rows.length > 0) {
      return true
    }

    // Check rollout percentage (use user ID for deterministic random)
    if (feature.rolloutPercentage > 0) {
      // Simple hash of user ID for consistent random distribution
      const hash = userId % 100
      return hash < feature.rolloutPercentage
    }

    return false
  } catch (error) {
    console.error("[Beta] Error checking access:", error)
    return false
  }
}

/**
 * Grant beta access to a user
 */
export async function grantBetaAccess(
  userId: number,
  featureId: number,
  grantedBy?: number
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO user_beta_access (user_id, feature_id, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, feature_id) DO NOTHING`,
      [userId, featureId, grantedBy || null]
    )
  } catch (error) {
    console.error("[Beta] Error granting access:", error)
    throw error
  }
}

/**
 * Revoke beta access from a user
 */
export async function revokeBetaAccess(userId: number, featureId: number): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM user_beta_access WHERE user_id = $1 AND feature_id = $2`,
      [userId, featureId]
    )
  } catch (error) {
    console.error("[Beta] Error revoking access:", error)
    throw error
  }
}

/**
 * Get all beta features a user has access to
 */
export async function getUserBetaFeatures(userId: number): Promise<BetaFeature[]> {
  try {
    const result = await pool.query(
      `SELECT bf.* FROM beta_features bf
       JOIN user_beta_access uba ON bf.id = uba.feature_id
       WHERE uba.user_id = $1 AND bf.enabled = true`,
      [userId]
    )
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      enabled: row.enabled,
      rolloutPercentage: row.rollout_percentage,
      createdAt: row.created_at,
    }))
  } catch (error) {
    console.error("[Beta] Error getting user features:", error)
    return []
  }
}

/**
 * Get all users with access to a beta feature
 */
export async function getBetaFeatureUsers(featureId: number): Promise<{
  userId: number
  grantedAt: Date
  grantedBy: number | null
}[]> {
  try {
    const result = await pool.query(
      `SELECT user_id, granted_at, granted_by 
       FROM user_beta_access 
       WHERE feature_id = $1`,
      [featureId]
    )
    return result.rows.map((row) => ({
      userId: row.user_id,
      grantedAt: row.granted_at,
      grantedBy: row.granted_by,
    }))
  } catch (error) {
    console.error("[Beta] Error getting feature users:", error)
    return []
  }
}

/**
 * Delete a beta feature
 */
export async function deleteBetaFeature(featureId: number): Promise<void> {
  try {
    await pool.query(`DELETE FROM beta_features WHERE id = $1`, [featureId])
  } catch (error) {
    console.error("[Beta] Error deleting feature:", error)
    throw error
  }
}

/**
 * Check if the entire app is in beta mode
 */
export function isAppInBetaMode(): boolean {
  return process.env.BETA_MODE === "true"
}

/**
 * Get beta mode banner message
 */
export function getBetaBannerMessage(): string | null {
  if (!isAppInBetaMode()) return null
  return process.env.BETA_BANNER_MESSAGE || "This is a beta version. Some features may be unstable."
}
