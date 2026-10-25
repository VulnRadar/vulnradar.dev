/**
 * The user directory's filter state and the query string it becomes.
 *
 * The names mirror lib/admin/users-query.ts, which is the whitelist the route
 * enforces; anything else is a 400 there. Kept apart from the component so the
 * page that owns the fetch and the tab that draws the controls agree on one
 * shape, and so a unit test can pin it.
 */

export type UserStatusFilter = "all" | "disabled" | "unverified" | "no2fa";

export interface UserListFilters {
  status: UserStatusFilter;
  /** "all", "staff" (any staff role), or one role id. */
  role: string;
  /** "all" or a plan id. */
  plan: string;
}

export const EMPTY_USER_FILTERS: UserListFilters = {
  status: "all",
  role: "all",
  plan: "all",
};

export function userFilterParams(filters: UserListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.role !== "all") params.set("role", filters.role);
  if (filters.plan !== "all") params.set("plan", filters.plan);
  return params;
}

export function hasActiveUserFilters(filters: UserListFilters): boolean {
  return (
    filters.status !== "all" || filters.role !== "all" || filters.plan !== "all"
  );
}
