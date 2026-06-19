// Admin badges service - API calls for badge management

import { adminApi } from "../api-client";
import type {
  AdminBadgesResponse,
  AdminActionResponse,
} from "../types.responses";

/**
 * Fetch all available badges
 */
export async function fetchBadges(): Promise<AdminBadgesResponse> {
  return adminApi.getBadges();
}

/**
 * Award a badge to a user
 */
export async function awardBadge(
  userId: number,
  badgeId: number,
): Promise<AdminActionResponse> {
  return adminApi.performAction(userId, "award_badge", { badgeId });
}

/**
 * Revoke a badge from a user
 */
export async function revokeBadge(
  userId: number,
  badgeId: number,
): Promise<AdminActionResponse> {
  return adminApi.performAction(userId, "revoke_badge", { badgeId });
}

/**
 * Create a new badge
 */
export async function createBadge(badge: {
  name: string;
  display_name: string;
  description?: string;
  icon?: string;
  color?: string;
  priority?: number;
  is_limited?: boolean;
}): Promise<AdminActionResponse> {
  // Use any userId (0) since this is a system action
  return adminApi.performAction(0, "create_badge", badge);
}

/**
 * Delete a badge
 */
export async function deleteBadge(
  badgeId: number,
): Promise<AdminActionResponse> {
  return adminApi.performAction(0, "delete_badge", { badgeId });
}
