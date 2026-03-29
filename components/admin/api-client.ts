// Centralized API client for admin endpoints

import { API } from "@/lib/config/constants"

export class ApiError extends Error {
  status: number
  
  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown
}

/**
 * Centralized API client with error handling, auth, and typed responses
 */
export async function apiClient<T>(
  url: string, 
  options?: RequestOptions
): Promise<T> {
  const { body, headers, ...rest } = options || {}
  
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    ...rest,
  })

  // Handle non-OK responses
  if (!res.ok) {
    // Try to parse error message from response
    let errorMessage = `API error: ${res.status}`
    try {
      const errorData = await res.json()
      if (errorData.error) {
        errorMessage = errorData.error
      }
    } catch {
      // Ignore JSON parse errors
    }
    throw new ApiError(errorMessage, res.status)
  }

  return res.json()
}

/**
 * GET request helper
 */
export function apiGet<T>(url: string, params?: Record<string, string | number>): Promise<T> {
  let fullUrl = url
  if (params) {
    const searchParams = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.set(key, String(value))
      }
    })
    const paramString = searchParams.toString()
    if (paramString) {
      fullUrl = `${url}${url.includes("?") ? "&" : "?"}${paramString}`
    }
  }
  return apiClient<T>(fullUrl)
}

/**
 * POST request helper
 */
export function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return apiClient<T>(url, { method: "POST", body })
}

/**
 * PATCH request helper
 */
export function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  return apiClient<T>(url, { method: "PATCH", body })
}

/**
 * DELETE request helper
 */
export function apiDelete<T>(url: string, body?: unknown): Promise<T> {
  return apiClient<T>(url, { method: "DELETE", body })
}

// Admin-specific API endpoints
export const adminApi = {
  // Users
  getUsers: (params: { page?: number; limit?: number; search?: string }) =>
    apiGet<import("./types.responses").AdminUsersResponse>(API.ADMIN, params),
  
  getUserDetail: (userId: number) =>
    apiGet<import("./types.responses").AdminUserDetailResponse>(API.ADMIN, { section: "user-detail", userId }),
  
  // Audit
  getAuditLogs: (params: { page?: number; limit?: number }) =>
    apiGet<import("./types.responses").AdminAuditResponse>(API.ADMIN, { section: "audit", ...params }),
  
  // Staff
  getActiveStaff: () =>
    apiGet<import("./types.responses").AdminStaffResponse>(API.ADMIN, { section: "active-admins" }),
  
  // Badges
  getBadges: () =>
    apiGet<import("./types.responses").AdminBadgesResponse>(API.ADMIN, { section: "badges" }),
  
  // Actions
  performAction: (userId: number, action: string, extra?: Record<string, unknown>) =>
    apiPatch<import("./types.responses").AdminActionResponse>(API.ADMIN, { userId, action, ...extra }),
  
  // Teams
  getTeams: (params: { page?: number; limit?: number; search?: string }) =>
    apiGet<import("./types.responses").AdminTeamsResponse>("/api/v2/admin/teams", params),
  
  getTeamDetail: (teamId: number) =>
    apiGet<import("./types.responses").AdminTeamDetailResponse>(`/api/v2/admin/teams/${teamId}`),
  
  renameTeam: (teamId: number, name: string) =>
    apiPatch<import("./types.responses").TeamRenameResponse>("/api/v2/admin/teams", { teamId, name }),
  
  deleteTeam: (teamId: number) =>
    apiDelete<import("./types.responses").TeamDeleteResponse>("/api/v2/admin/teams", { teamId }),
}
