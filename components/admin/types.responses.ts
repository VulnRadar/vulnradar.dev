// API response type definitions for admin endpoints.
//
// These are load-bearing: app/admin/page.tsx's fetchers annotate their
// res.json() with them, so a route that changes an envelope key (or drops
// one) is a compile error rather than a runtime undefined. The file used to
// have zero importers, which meant it documented the admin API's response
// shapes and was guaranteed to drift from them with nothing to catch it.
//
// Every interface here has a call site. Add one only alongside the fetcher
// that will annotate it, or the file starts drifting again.

import type {
  AdminStats,
  AdminUser,
  AuditEntry,
  AuditStats,
  ActiveAdmin,
  Team,
  TeamDetail,
  UserDetail,
  BadgeDef,
} from "./types";

/** GET /api/v3/admin?section=stats: the aggregate counters, on their own. */
export interface AdminStatsResponse {
  stats: AdminStats;
}

export interface AdminUsersResponse {
  /**
   * Empty for a staff role without VIEW_USERS (ops). The route still returns
   * the aggregate stats to that caller rather than a 403, because the panel
   * fetches this section on mount and reads a 403 as "no admin access".
   */
  users: AdminUser[];
  total: number;
  page: number;
  totalPages: number;
  callerRole?: string;
}

export interface AdminAuditResponse {
  logs: AuditEntry[];
  /** Rows the request's filters leave, across every page. */
  total: number;
  page: number;
  totalPages: number;
  /** Counted over the whole log by the server, whatever the filters. */
  stats: AuditStats;
}

export interface AdminStaffResponse {
  admins: ActiveAdmin[];
}

export interface AdminTeamsResponse {
  teams: Team[];
  page: number;
  totalPages: number;
  /** Teams matching the search, across every page. */
  total: number;
}

/** The body every admin route answers a refusal or a miss with. */
export interface AdminErrorResponse {
  error: string;
}

/**
 * GET /api/v3/admin/teams/[id]: the team and its members, or a 403 or 404
 * body. A response is one or the other, never both.
 */
export type AdminTeamDetailResponse = TeamDetail | AdminErrorResponse;

/**
 * GET /api/v3/admin?section=user-detail: the account record, or an error body
 * (403 "Your role cannot view accounts", 404 "User not found"). It used to
 * claim to always be a UserDetail, so a refusal was stored as the selected
 * user and the panel read `.user.id` off an error body during render.
 */
export type AdminUserDetailResponse = UserDetail | AdminErrorResponse;

export function isUserDetailResponse(
  body: AdminUserDetailResponse | null | undefined,
): body is UserDetail {
  return (
    !!body &&
    "user" in body &&
    typeof body.user === "object" &&
    body.user !== null
  );
}

export function isTeamDetailResponse(
  body: AdminTeamDetailResponse | null | undefined,
): body is TeamDetail {
  return (
    !!body &&
    "team" in body &&
    typeof body.team === "object" &&
    body.team !== null &&
    "members" in body &&
    Array.isArray(body.members)
  );
}

export interface AdminBadgesResponse {
  badges: BadgeDef[];
}

export interface AdminActionResponse {
  success?: boolean;
  error?: string;
  /** A sentence about what the action did, for the toast. Set where the
   *  outcome can differ from the request, e.g. adjust_credits. */
  message?: string;
  /**
   * force_logout_all only: whether the keys were revoked along with the
   * sessions. False for a role that may end sessions but not revoke keys.
   */
  apiKeysRevoked?: boolean;
  /**
   * Set by the sub-actions that mutate an account field (update_name,
   * update_email, update_plan, set_role). The panel collects these and
   * sends one "here is what changed" email at the end of a save rather
   * than one per field, so the shape has to survive a route change.
   */
  change?: { field: string; oldValue: string; newValue: string };
}

export interface TeamRenameResponse {
  success?: boolean;
  error?: string;
}

export interface TeamDeleteResponse {
  success?: boolean;
  error?: string;
}
