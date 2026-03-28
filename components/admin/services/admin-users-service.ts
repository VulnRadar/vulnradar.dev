// Admin users service - API calls for user management

import { adminApi, ApiError } from "../api-client"
import type { AdminUsersResponse, AdminUserDetailResponse, AdminActionResponse } from "../types.responses"

export interface FetchUsersParams {
  page?: number
  limit?: number
  search?: string
}

/**
 * Fetch paginated list of users with stats
 */
export async function fetchAdminUsers(params: FetchUsersParams = {}): Promise<AdminUsersResponse> {
  return adminApi.getUsers(params)
}

/**
 * Fetch detailed information for a single user
 */
export async function fetchUserDetail(userId: number): Promise<AdminUserDetailResponse> {
  return adminApi.getUserDetail(userId)
}

/**
 * Perform an admin action on a user
 */
export async function performUserAction(
  userId: number, 
  action: string, 
  extra?: Record<string, unknown>
): Promise<AdminActionResponse> {
  return adminApi.performAction(userId, action, extra)
}

/**
 * Update user role
 */
export async function updateUserRole(userId: number, role: string, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "set_role", { role, notifyUser })
}

/**
 * Reset user password
 */
export async function resetUserPassword(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "reset_password", { notifyUser })
}

/**
 * Revoke all user sessions
 */
export async function revokeUserSessions(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "revoke_sessions", { notifyUser })
}

/**
 * Revoke all user API keys
 */
export async function revokeUserApiKeys(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "revoke_api_keys", { notifyUser })
}

/**
 * Disable user account
 */
export async function disableUser(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "disable", { notifyUser })
}

/**
 * Enable user account
 */
export async function enableUser(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "enable", { notifyUser })
}

/**
 * Delete user account
 */
export async function deleteUser(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "delete", { notifyUser })
}

/**
 * Update user name
 */
export async function updateUserName(userId: number, name: string, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "update_name", { name, notifyUser })
}

/**
 * Update user email
 */
export async function updateUserEmail(userId: number, email: string, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "update_email", { email, notifyUser })
}

/**
 * Update user plan
 */
export async function updateUserPlan(userId: number, plan: string, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "update_plan", { plan, notifyUser })
}

/**
 * Reset user 2FA
 */
export async function resetUser2FA(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "reset_2fa", { notifyUser })
}

/**
 * Clear user rate limits
 */
export async function clearUserRateLimits(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "clear_rate_limits", { notifyUser })
}

/**
 * Gift subscription to user
 */
export async function giftSubscription(
  userId: number, 
  giftPlan: string, 
  giftEndDate: string,
  notifyUser = true
): Promise<AdminActionResponse> {
  return performUserAction(userId, "gift_subscription", { giftPlan, giftEndDate, notifyUser })
}

/**
 * Revoke gifted subscription
 */
export async function revokeGiftedSubscription(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "revoke_gift", { notifyUser })
}

/**
 * Verify user email
 */
export async function verifyUserEmail(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "verify_email", { notifyUser })
}

/**
 * Unverify user email
 */
export async function unverifyUserEmail(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "unverify_email", { notifyUser })
}

/**
 * Clear user avatar
 */
export async function clearUserAvatar(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "clear_avatar", { notifyUser })
}

/**
 * Toggle user beta access
 */
export async function toggleBetaAccess(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "toggle_beta_access", { notifyUser })
}

/**
 * Delete all user scans
 */
export async function deleteUserScans(userId: number, notifyUser = true): Promise<AdminActionResponse> {
  return performUserAction(userId, "delete_scans", { notifyUser })
}

// Re-export ApiError for error handling
export { ApiError }
