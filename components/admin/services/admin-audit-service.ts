// Admin audit service - API calls for audit log management

import { adminApi } from "../api-client"
import type { AdminAuditResponse } from "../types.responses"

export interface FetchAuditParams {
  page?: number
  limit?: number
}

/**
 * Fetch paginated audit logs
 */
export async function fetchAuditLogs(params: FetchAuditParams = {}): Promise<AdminAuditResponse> {
  return adminApi.getAuditLogs(params)
}
