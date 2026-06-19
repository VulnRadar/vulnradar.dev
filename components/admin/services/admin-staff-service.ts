// Admin staff service - API calls for staff management

import { adminApi } from "../api-client";
import type { AdminStaffResponse } from "../types.responses";

/**
 * Fetch list of active admins/staff
 */
export async function fetchActiveStaff(): Promise<AdminStaffResponse> {
  return adminApi.getActiveStaff();
}
