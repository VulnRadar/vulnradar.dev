// API response type definitions for admin endpoints

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
  users: AdminUser[];
  page: number;
  totalPages: number;
  callerRole?: string;
}

export interface AdminAuditResponse {
  logs: AuditEntry[];
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
  tempPassword?: string;
}

export interface TeamRenameResponse {
  success?: boolean;
  error?: string;
}

export interface TeamDeleteResponse {
  success?: boolean;
  error?: string;
}
