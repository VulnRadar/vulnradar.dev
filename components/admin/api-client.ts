// Centralized API client for admin endpoints

import { API } from "@/lib/config/constants";
// R9/D3: generic fetch helpers moved to lib/api/client.ts. Re-exported
// here so existing imports (`import { apiClient, ApiError } from
// "@/components/admin/api-client"`) keep working unchanged.
import {
  ApiError,
  apiClient,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
} from "@/lib/api/client";
export { ApiError, apiClient, apiGet, apiPost, apiPatch, apiDelete };

// Admin-specific API endpoints
export const adminApi = {
  // Users
  getUsers: (params: { page?: number; limit?: number; search?: string }) =>
    apiGet<import("./types.responses").AdminUsersResponse>(API.ADMIN, params),

  getUserDetail: (userId: number) =>
    apiGet<import("./types.responses").AdminUserDetailResponse>(API.ADMIN, {
      section: "user-detail",
      userId,
    }),

  // Audit
  getAuditLogs: (params: { page?: number; limit?: number }) =>
    apiGet<import("./types.responses").AdminAuditResponse>(API.ADMIN, {
      section: "audit",
      ...params,
    }),

  // Staff
  getActiveStaff: () =>
    apiGet<import("./types.responses").AdminStaffResponse>(API.ADMIN, {
      section: "active-admins",
    }),

  // Badges
  getBadges: () =>
    apiGet<import("./types.responses").AdminBadgesResponse>(API.ADMIN, {
      section: "badges",
    }),

  // Actions
  performAction: (
    userId: number,
    action: string,
    extra?: Record<string, unknown>,
  ) =>
    apiPatch<import("./types.responses").AdminActionResponse>(API.ADMIN, {
      userId,
      action,
      ...extra,
    }),

  // Teams
  getTeams: (params: { page?: number; limit?: number; search?: string }) =>
    apiGet<import("./types.responses").AdminTeamsResponse>(
      "/api/v3/admin/teams",
      params,
    ),

  getTeamDetail: (teamId: number) =>
    apiGet<import("./types.responses").AdminTeamDetailResponse>(
      `/api/v3/admin/teams/${teamId}`,
    ),

  renameTeam: (teamId: number, name: string) =>
    apiPatch<import("./types.responses").TeamRenameResponse>(
      "/api/v3/admin/teams",
      { teamId, name },
    ),

  deleteTeam: (teamId: number) =>
    apiDelete<import("./types.responses").TeamDeleteResponse>(
      "/api/v3/admin/teams",
      { teamId },
    ),
};
