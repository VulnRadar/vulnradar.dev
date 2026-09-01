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
  ActiveAdmin,
  Team,
  TeamDetail,
  UserDetail,
  BadgeDef,
} from "./types";

export interface AdminUsersResponse {
  stats: AdminStats;
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
  total: number;
  page: number;
  totalPages: number;
}

export interface AdminStaffResponse {
  admins: ActiveAdmin[];
}

export interface AdminTeamsResponse {
  teams: Team[];
  page: number;
  totalPages: number;
}

export interface AdminTeamDetailResponse extends TeamDetail {}

export interface AdminUserDetailResponse extends UserDetail {}

export interface AdminBadgesResponse {
  badges: BadgeDef[];
}

export interface AdminActionResponse {
  success?: boolean;
  error?: string;
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
