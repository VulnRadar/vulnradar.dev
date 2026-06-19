// Admin panel type definitions

export interface AdminStats {
  total_users: string;
  total_scans: string;
  active_api_keys: string;
  active_schedules: string;
  active_webhooks: string;
  users_with_2fa: string;
  scans_24h: string;
  new_users_7d: string;
  disabled_users: string;
  shared_scans: string;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  role: string | null;
  avatar_url: string | null;
  totp_enabled: boolean;
  tos_accepted_at: string | null;
  created_at: string;
  disabled_at: string | null;
  scan_count: number;
  api_key_count: number;
  plan: string;
  subscription_status: string | null;
  gifted_plan?: string | null;
  gift_end_date?: string | null;
}

export interface BadgeDef {
  id: number;
  name: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  priority: number;
  is_limited: boolean;
}

export interface UserBadge extends BadgeDef {
  awarded_at: string;
}

export interface AdminNote {
  id: number;
  note: string;
  created_at: string;
  admin_id: number;
  admin_email: string;
  admin_name: string | null;
  admin_avatar_url: string | null;
}

export interface UserDetail {
  user: AdminUser & {
    session_count: number;
    has_backup_codes: boolean;
  };
  recentScans: {
    id: number;
    url: string;
    findings_count: number;
    source: string;
    scanned_at: string;
  }[];
  apiKeys: {
    id: number;
    key_prefix: string;
    name: string;
    daily_limit: number;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }[];
  webhooks: {
    id: number;
    name: string;
    url: string;
    type: string;
    active: boolean;
  }[];
  schedules: {
    id: number;
    url: string;
    frequency: string;
    active: boolean;
    last_run_at: string | null;
    next_run_at: string | null;
  }[];
  activeSessions: {
    id: string;
    created_at: string;
    expires_at: string;
    ip_address: string | null;
    user_agent: string | null;
  }[];
  badges: UserBadge[];
  notes: AdminNote[];
}

export interface AuditEntry {
  id: number;
  action: string;
  details: string | null;
  created_at: string;
  ip_address: string | null;
  admin_id: number;
  admin_email: string;
  admin_name: string | null;
  admin_avatar_url: string | null;
  target_email: string | null;
  target_name: string | null;
  target_avatar_url: string | null;
}

export interface ActiveAdmin {
  id: number;
  email: string;
  name: string | null;
  role: string;
  avatar_url: string | null;
  created_at: string;
  totp_enabled: boolean;
  last_session_created: string | null;
  active_sessions: number;
  last_admin_action: string | null;
  last_action_type: string | null;
  last_ip: string | null;
  total_actions: number;
  actions_24h: number;
  // Activity tracking fields
  last_heartbeat?: string | null;
  is_active?: boolean;
  current_section?: string;
  seconds_since_heartbeat?: number;
  recent_actions?: number;
}

export interface Team {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  owner_id: number;
  owner_email: string;
  owner_name: string | null;
  owner_avatar_url: string | null;
  member_count: number;
}

export interface TeamMember {
  user_id: number;
  role: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

export interface TeamDetail {
  team: {
    id: number;
    name: string;
    owner_email: string;
    owner_name: string | null;
  };
  members: TeamMember[];
}

export interface ConfirmDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<void>;
  children?: React.ReactNode;
}

export interface ToastState {
  message: string;
  type: "success" | "error";
}

export type AdminTab = "users" | "audit" | "admins" | "notifications" | "teams";
