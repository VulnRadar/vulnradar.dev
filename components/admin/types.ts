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
  email_verified_at: string | null;
  scan_count: number;
  api_key_count: number;
  plan: string;
  subscription_status: string | null;
  gifted_plan?: string | null;
  gift_end_date?: string | null;
  ai_chat_banned?: boolean;
  google_id: string | null;
  google_email: string | null;
  google_name: string | null;
  github_id: string | null;
  github_email: string | null;
  github_name: string | null;
  // The GitHub @handle (login) for a GitHub SIGN-IN. Null for rows created
  // before this column existed (they get it on next sign-in) and for accounts
  // with no GitHub sign-in. Distinct from a repo connection's github_username.
  github_login: string | null;
  // Discord SIGN-IN identity (users.discord_id), set when an account is
  // created or linked via "Sign in with Discord". Distinct from the richer
  // discord_connections row (server join + bot tokens) surfaced separately as
  // detail.discordConnection: signing up with Discord populates these columns
  // but does NOT create a discord_connections row, so the admin panel must
  // read these to reflect the sign-in link the same way it does google_id /
  // github_id, or a Discord-signup account looks unlinked.
  discord_id: string | null;
  discord_username: string | null;
  discord_email: string | null;
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
  /** Discord is the only OAuth-style connection stored server-side
   *  (discord_connections table); null when the user never linked one. */
  discordConnection: {
    discord_id: string;
    discord_username: string;
    discord_discriminator: string | null;
    discord_avatar: string | null;
    guild_joined: boolean;
    connected_at: string;
  } | null;
  /** Separate from user.google_id/github_id (sign-in linking): this is the
   *  distinct repo-read-access connection (code scanning), stored in
   *  github_connections with its own OAuth scopes/token. */
  githubRepoConnection: {
    github_username: string;
    scopes: string;
    connected_at: string;
  } | null;
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
  target_user_id: number | null;
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
  /**
   * The whole team row, not a subset. GET /api/v3/admin/teams/[id] selects
   * id, name, slug, created_at, owner_id, owner_email, owner_name and
   * owner_avatar_url, which is exactly `Team`. This used to declare a
   * four-field shape (id, name, owner_email, owner_name) that no caller and
   * no route ever agreed with, which is the drift AdminTeamDetailResponse
   * exists to catch.
   */
  team: Team;
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
