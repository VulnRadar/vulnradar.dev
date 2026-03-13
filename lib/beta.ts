// ============================================================================
// Beta Features Module
// ============================================================================
// Manages beta feature flags using feature names (no database table needed)
// Beta access is now tracked via users.beta_access boolean column

import pool from "./db"
import { BETA_MODE, BETA_BANNER_MESSAGE } from "./constants"

export interface BetaFeature {
  name: string
  description: string | null
  enabled: boolean
}

// In-memory registry of known beta features (no DB needed)
const BETA_FEATURES_REGISTRY: Record<string, BetaFeature> = {
  advanced_reporting: {
    name: "advanced_reporting",
    description: "Advanced vulnerability reporting and analytics",
    enabled: true,
  },
  api_webhooks: {
    name: "api_webhooks",
    description: "Webhook integrations for automated scanning",
    enabled: true,
  },
  team_collaboration: {
    name: "team_collaboration",
    description: "Team management and collaboration features",
    enabled: true,
  },
  scheduled_scans: {
    name: "scheduled_scans",
    description: "Schedule recurring security scans",
    enabled: true,
  },
  custom_compliance: {
    name: "custom_compliance",
    description: "Custom compliance rule creation",
    enabled: false,
  },
}

/**
 * Get all beta features
 */
export async function getAllBetaFeatures(): Promise<BetaFeature[]> {
  return Object.values(BETA_FEATURES_REGISTRY)
}

/**
 * Get a beta feature by name
 */
export async function getBetaFeature(name: string): Promise<BetaFeature | null> {
  return BETA_FEATURES_REGISTRY[name] || null
}

/**
 * Check if a user has access to a beta feature
 */
export async function userHasBetaAccess(userId: number, featureName: string): Promise<boolean> {
  try {
    // First check if feature exists and is enabled
    const feature = BETA_FEATURES_REGISTRY[featureName]
    if (!feature || !feature.enabled) {
      return false
    }

    // Check if user has beta access enabled
    const result = await pool.query(
      `SELECT beta_access FROM users WHERE id = $1`,
      [userId]
    )

    if (result.rows.length === 0) {
      return false
    }

    return result.rows[0].beta_access === true
  } catch (error) {
    console.error("[Beta] Error checking access:", error)
    return false
  }
}

/**
 * Grant beta access to a user
 */
export async function grantBetaAccess(userId: number): Promise<void> {
  try {
    await pool.query(
      `UPDATE users SET beta_access = true WHERE id = $1`,
      [userId]
    )
  } catch (error) {
    console.error("[Beta] Error granting access:", error)
    throw error
  }
}

/**
 * Revoke beta access from a user
 */
export async function revokeBetaAccess(userId: number): Promise<void> {
  try {
    await pool.query(
      `UPDATE users SET beta_access = false WHERE id = $1`,
      [userId]
    )
  } catch (error) {
    console.error("[Beta] Error revoking access:", error)
    throw error
  }
}

/**
 * Check if the entire app is in beta mode
 */
export function isAppInBetaMode(): boolean {
  return BETA_MODE
}

/**
 * Get beta mode banner message
 */
export function getBetaBannerMessage(): string | null {
  if (!isAppInBetaMode()) return null
  return BETA_BANNER_MESSAGE
}
