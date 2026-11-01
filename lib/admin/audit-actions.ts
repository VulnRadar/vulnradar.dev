/**
 * Every action name admin_audit_log can hold, with how the audit log shows it.
 *
 * Action names used to be free strings. logAuditAction took any `string`, the
 * display labels lived in components/admin/config.ts and the filter categories
 * in components/admin/utils.ts, and both were hand-kept lists. By the time
 * anyone counted, 31 of the logged actions were in no filter category, so
 * choosing any category hid credit grants, email and plan changes, staff
 * invites, backups, log clears and updater runs: the rows an insider review
 * looks for first.
 *
 * Now this is the list. logAuditAction's `action` is typed as AuditAction, so
 * an unregistered name does not compile, and ACTION_META and
 * AUDIT_FILTER_CATEGORIES are derived from it rather than kept beside it.
 * tests/lib/admin/audit-actions.test.ts greps every logAction(/logAuditAction(
 * call in app/ and lib/ and fails on a name this file does not know.
 *
 * Client-safe on purpose (no imports): the admin panel renders from it. Colour
 * classes are NOT here, because lib/ is outside Tailwind's content globs; each
 * entry names a tone and components/admin/config.ts maps tones to classes.
 */

/** The audit log's filter chips, in display order. "All" is added by the UI. */
export const AUDIT_CATEGORIES = [
  { id: "roles", label: "Roles" },
  { id: "security", label: "Security" },
  { id: "staff", label: "Staff" },
  { id: "status", label: "Status" },
  { id: "badges", label: "Badges" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "notifications", label: "Notifications" },
  { id: "broadcasts", label: "Broadcasts" },
  { id: "system", label: "System" },
  { id: "data", label: "Account data" },
  { id: "logs_data", label: "Logs & data" },
] as const;

export type AuditCategoryId = (typeof AUDIT_CATEGORIES)[number]["id"];

/**
 * How loud a row is. `destructive` is also what the audit log reads to give a
 * row its blast-radius weight (components/admin/audit/audit-log.tsx), so it
 * belongs on anything that deletes, revokes or disables.
 */
export type AuditTone =
  | "primary"
  | "neutral"
  | "muted"
  | "success"
  | "warning"
  | "destructive"
  | "high";

export interface AuditActionDef {
  category: AuditCategoryId;
  tone: AuditTone;
  /** Badge text. */
  label: string;
  /**
   * Middle of the sentence "<admin> <verb> <target>". With no target, a
   * trailing for/to/from/of is dropped, so a verb that ends in one still
   * reads when the row is not about an account.
   */
  verb: string;
  icon: string;
}

/** Actions code may write. Add one here before the logAction call that uses it. */
export const AUDIT_ACTIONS = {
  // ── Roles
  set_role: {
    category: "roles",
    tone: "primary",
    label: "Changed Role",
    verb: "changed the role of",
    icon: "shield",
  },
  make_admin: {
    category: "roles",
    tone: "primary",
    label: "Promoted to Admin",
    verb: "promoted to admin",
    icon: "crown",
  },
  remove_admin: {
    category: "roles",
    tone: "muted",
    label: "Removed Admin Role",
    verb: "removed admin role from",
    icon: "shield-off",
  },

  // ── Security: credentials, sessions, and reads of private data
  reset_password: {
    category: "security",
    tone: "warning",
    label: "Reset Password",
    verb: "sent a password reset to",
    icon: "key",
  },
  update_password: {
    category: "security",
    tone: "warning",
    label: "Password Changed",
    verb: "set a new password for",
    icon: "key",
  },
  update_email: {
    category: "security",
    tone: "neutral",
    label: "Email Changed",
    verb: "updated the email of",
    icon: "mail",
  },
  revoke_sessions: {
    category: "security",
    tone: "warning",
    label: "Revoked Sessions",
    verb: "revoked all sessions for",
    icon: "log-out",
  },
  revoke_api_keys: {
    category: "security",
    tone: "warning",
    label: "Revoked API Keys",
    verb: "revoked API keys for",
    icon: "key",
  },
  revoke_api_key: {
    category: "security",
    tone: "warning",
    label: "Revoked API Key",
    verb: "revoked an API key for",
    icon: "key",
  },
  // Written by scripts/maintenance/db-repair-2fa.mjs, not by a route.
  reset_2fa: {
    category: "security",
    tone: "warning",
    label: "Reset 2FA",
    verb: "reset two-factor authentication for",
    icon: "smartphone",
  },
  issue_2fa_recovery_code: {
    category: "security",
    tone: "warning",
    label: "2FA Recovery Code Issued",
    verb: "emailed a one-time two-factor recovery code to",
    icon: "smartphone",
  },
  force_logout_all: {
    category: "security",
    tone: "warning",
    label: "Force Logout",
    verb: "force logged out",
    icon: "log-out",
  },
  verify_email: {
    category: "security",
    tone: "neutral",
    label: "Email Verified",
    verb: "manually verified the email of",
    icon: "mail-check",
  },
  unverify_email: {
    category: "security",
    tone: "warning",
    label: "Email Unverified",
    verb: "marked the email unverified for",
    icon: "mail-x",
  },
  resend_verification: {
    category: "security",
    tone: "neutral",
    label: "Verification Resent",
    verb: "resent the verification link to",
    icon: "mail",
  },
  // Reads, not mutations. Admin GETs used to leave no trail at all, so there
  // was nothing to reconstruct after a compromised or insider staff account
  // paged through private records.
  view_user_detail: {
    category: "security",
    tone: "muted",
    label: "Viewed Account",
    verb: "viewed the account record of",
    icon: "eye",
  },
  view_scan: {
    category: "security",
    tone: "muted",
    label: "Viewed Scan",
    verb: "inspected a scan of",
    icon: "eye",
  },
  view_ai_conversation: {
    category: "security",
    tone: "muted",
    label: "Viewed AI Chat",
    verb: "read an AI chat conversation of",
    icon: "eye",
  },
  // A user action, not a staff one: logged so an authenticated scan (which
  // carries someone's login) is accountable. admin_id and target are the same
  // account.
  "scan.authenticated": {
    category: "security",
    tone: "neutral",
    label: "Authenticated Scan",
    verb: "ran an authenticated scan as",
    icon: "lock",
  },

  // ── Staff: who joined, how staff signed in, acting as someone else, and
  // support work
  staff_invite_sent: {
    category: "staff",
    tone: "primary",
    label: "Staff Invite Sent",
    verb: "sent a staff invite to",
    icon: "user-plus",
  },
  staff_invite_revoked: {
    category: "staff",
    tone: "warning",
    label: "Staff Invite Revoked",
    verb: "revoked a pending staff invite",
    icon: "user-x",
  },
  staff_invite_accepted: {
    category: "staff",
    tone: "success",
    label: "Staff Invite Accepted",
    verb: "accepted a staff invite as",
    icon: "user-check",
  },
  staff_oidc_login: {
    category: "staff",
    tone: "muted",
    label: "Staff SSO Sign-in",
    verb: "signed in through staff SSO as",
    icon: "log-in",
  },
  impersonate: {
    category: "staff",
    tone: "high",
    label: "Impersonation",
    verb: "started impersonating",
    icon: "eye",
  },
  stop_impersonate: {
    category: "staff",
    tone: "muted",
    label: "Impersonation Ended",
    verb: "stopped impersonating",
    icon: "eye-off",
  },
  ticket_status_changed: {
    category: "staff",
    tone: "neutral",
    label: "Ticket Status Changed",
    verb: "changed a support ticket status for",
    icon: "life-buoy",
  },
  ticket_assigned: {
    category: "staff",
    tone: "neutral",
    label: "Ticket Assigned",
    verb: "assigned a support ticket from",
    icon: "life-buoy",
  },

  // ── Status: whether and how much an account can use the product
  disable_user: {
    category: "status",
    tone: "destructive",
    label: "Disabled",
    verb: "disabled the account of",
    icon: "ban",
  },
  enable_user: {
    category: "status",
    tone: "success",
    label: "Enabled",
    verb: "re-enabled the account of",
    icon: "check-circle",
  },
  // The name the delete handler actually logs. The account is gone by the
  // time the row is written, so it has no target and the verb stands alone.
  delete_account: {
    category: "status",
    tone: "destructive",
    label: "Account Deleted",
    verb: "permanently deleted an account",
    icon: "trash-2",
  },
  update_name: {
    category: "status",
    tone: "neutral",
    label: "Name Changed",
    verb: "updated the name of",
    icon: "user",
  },
  toggle_ai_ban: {
    category: "status",
    tone: "warning",
    label: "AI Chat Access Changed",
    verb: "changed AI chat access for",
    icon: "message-square-off",
  },
  clear_rate_limits: {
    category: "status",
    tone: "neutral",
    label: "Rate Limits Cleared",
    verb: "cleared rate limits for",
    icon: "gauge",
  },
  reset_daily_limit: {
    category: "status",
    tone: "neutral",
    label: "Daily Limit Reset",
    verb: "reset the daily scan count for",
    icon: "gauge",
  },
  reset_ai_usage: {
    category: "status",
    tone: "neutral",
    label: "AI Usage Reset",
    verb: "reset the AI usage window for",
    icon: "sparkles",
  },
  reset_github_review_usage: {
    category: "status",
    tone: "neutral",
    label: "GitHub Review Usage Reset",
    verb: "reset the GitHub review usage window for",
    icon: "gauge",
  },
  reset_free_github_trial: {
    category: "status",
    tone: "neutral",
    label: "Free GitHub Trial Reset",
    verb: "reset the free GitHub review trial for",
    icon: "gauge",
  },

  // ── Badges
  award_badge: {
    category: "badges",
    tone: "primary",
    label: "Badge Awarded",
    verb: "awarded a badge to",
    icon: "award",
  },
  revoke_badge: {
    category: "badges",
    tone: "warning",
    label: "Badge Revoked",
    verb: "revoked a badge from",
    icon: "award-off",
  },
  create_badge: {
    category: "badges",
    tone: "success",
    label: "Badge Created",
    verb: "created a new badge",
    icon: "plus-circle",
  },
  delete_badge: {
    category: "badges",
    tone: "destructive",
    label: "Badge Deleted",
    verb: "deleted a badge",
    icon: "trash-2",
  },

  // ── Subscriptions and money
  gift_subscription: {
    category: "subscriptions",
    tone: "warning",
    label: "Gifted Plan",
    verb: "gifted a subscription to",
    icon: "gift",
  },
  revoke_gift: {
    category: "subscriptions",
    tone: "destructive",
    label: "Revoked Gift",
    verb: "revoked gifted subscription from",
    icon: "gift-off",
  },
  update_plan: {
    category: "subscriptions",
    tone: "primary",
    label: "Plan Changed",
    verb: "changed the subscription plan for",
    icon: "credit-card",
  },
  grant_credits: {
    category: "subscriptions",
    tone: "warning",
    label: "Granted Credits",
    verb: "granted credits to",
    icon: "coins",
  },
  adjust_credits: {
    category: "subscriptions",
    tone: "warning",
    label: "Credits Adjusted",
    verb: "adjusted the credit balance of",
    icon: "coins",
  },

  // ── Notifications
  send_notification: {
    category: "notifications",
    tone: "primary",
    label: "Notification Sent",
    verb: "sent a notification to",
    icon: "bell",
  },
  notification_created: {
    category: "notifications",
    tone: "neutral",
    label: "Notification Created",
    verb: "created a site notification",
    icon: "bell-plus",
  },
  notification_updated: {
    category: "notifications",
    tone: "neutral",
    label: "Notification Updated",
    verb: "updated a site notification",
    icon: "bell",
  },
  notification_deleted: {
    category: "notifications",
    tone: "destructive",
    label: "Notification Deleted",
    verb: "deleted a site notification",
    icon: "bell-off",
  },

  // ── Broadcasts
  broadcast_created: {
    category: "broadcasts",
    tone: "neutral",
    label: "Broadcast Drafted",
    verb: "created a broadcast draft",
    icon: "mail",
  },
  broadcast_sent: {
    category: "broadcasts",
    tone: "primary",
    label: "Broadcast Sent",
    verb: "sent a broadcast",
    icon: "send",
  },
  broadcast_resent: {
    category: "broadcasts",
    tone: "primary",
    label: "Broadcast Resent",
    verb: "resent a broadcast",
    icon: "send",
  },
  broadcast_deleted: {
    category: "broadcasts",
    tone: "destructive",
    label: "Broadcast Deleted",
    verb: "deleted a broadcast draft",
    icon: "trash-2",
  },
  broadcast_tested: {
    category: "broadcasts",
    tone: "muted",
    label: "Broadcast Test Sent",
    verb: "sent themselves a test broadcast",
    icon: "mail",
  },
  broadcast_template_created: {
    category: "broadcasts",
    tone: "success",
    label: "Template Created",
    verb: "created a broadcast template",
    icon: "file-plus",
  },
  broadcast_template_updated: {
    category: "broadcasts",
    tone: "neutral",
    label: "Template Updated",
    verb: "updated a broadcast template",
    icon: "file-pen",
  },
  broadcast_template_deleted: {
    category: "broadcasts",
    tone: "destructive",
    label: "Template Deleted",
    verb: "deleted a broadcast template",
    icon: "file-x",
  },

  // ── System: site-wide settings and operations. None of these is about one
  // account, so they leave target_user_id null and the verb stands alone.
  system_setting_changed: {
    category: "system",
    tone: "neutral",
    label: "Setting Changed",
    verb: "changed a system setting",
    icon: "settings",
  },
  system_setting_reset: {
    category: "system",
    tone: "neutral",
    label: "Setting Reset",
    verb: "reset a system setting to its default",
    icon: "rotate-ccw",
  },
  // A change the caller's role may not make (APP_URL below super admin). The
  // attempt is the record, so it is logged even though nothing changed.
  system_setting_refused: {
    category: "system",
    tone: "warning",
    label: "Setting Change Refused",
    verb: "was refused a change to a system setting",
    icon: "shield-alert",
  },
  access_rule_created: {
    category: "system",
    tone: "warning",
    label: "Access Rule Created",
    verb: "created an access rule",
    icon: "shield-plus",
  },
  access_rule_updated: {
    category: "system",
    tone: "neutral",
    label: "Access Rule Updated",
    verb: "updated an access rule",
    icon: "shield",
  },
  access_rule_deleted: {
    category: "system",
    tone: "destructive",
    label: "Access Rule Deleted",
    verb: "deleted an access rule",
    icon: "shield-off",
  },
  security_alert_resolved: {
    category: "system",
    tone: "success",
    label: "Alert Resolved",
    verb: "resolved a security alert",
    icon: "shield-check",
  },
  promote_ai_tag: {
    category: "system",
    tone: "primary",
    label: "Auto-Tag Rule Promoted",
    verb: "promoted an AI tag to an auto-tag rule",
    icon: "tag",
  },
  demote_ai_tag: {
    category: "system",
    tone: "warning",
    label: "Auto-Tag Rule Removed",
    verb: "removed a promoted auto-tag rule",
    icon: "tag",
  },
  updater_apply_started: {
    category: "system",
    tone: "warning",
    label: "Self-Update Started",
    verb: "started a self-update",
    icon: "download",
  },
  sweep_stale_scans: {
    category: "system",
    tone: "warning",
    label: "Stale Scans Closed",
    verb: "closed stale scans",
    icon: "timer-off",
  },
  admin_cancel_scan: {
    category: "system",
    tone: "warning",
    label: "Scan Cancelled",
    verb: "cancelled a running scan of",
    icon: "circle-stop",
  },

  // ── Account data: what an account owns
  delete_scans: {
    category: "data",
    tone: "destructive",
    label: "Scans Deleted",
    verb: "deleted all scans for",
    icon: "trash-2",
  },
  delete_webhooks: {
    category: "data",
    tone: "destructive",
    label: "Webhooks Deleted",
    verb: "deleted webhooks for",
    icon: "webhook-off",
  },
  delete_schedules: {
    category: "data",
    tone: "destructive",
    label: "Schedules Deleted",
    verb: "deleted schedules for",
    icon: "calendar-off",
  },
  export_data: {
    category: "data",
    tone: "neutral",
    label: "Data Exported",
    verb: "exported data for",
    icon: "download",
  },
  clear_avatar: {
    category: "data",
    tone: "muted",
    label: "Avatar Cleared",
    verb: "cleared the avatar of",
    icon: "image-off",
  },
  add_note: {
    category: "data",
    tone: "neutral",
    label: "Note Added",
    verb: "added a note about",
    icon: "sticky-note",
  },
  edit_note: {
    category: "data",
    tone: "neutral",
    label: "Note Edited",
    verb: "edited a note about",
    icon: "sticky-note",
  },
  delete_note: {
    category: "data",
    tone: "destructive",
    label: "Note Deleted",
    verb: "deleted a note about",
    icon: "trash-2",
  },
  edit_team: {
    category: "data",
    tone: "neutral",
    label: "Team Renamed",
    verb: "renamed a team",
    icon: "users",
  },
  delete_team: {
    category: "data",
    tone: "destructive",
    label: "Team Deleted",
    verb: "deleted a team owned by",
    icon: "trash-2",
  },
  // A user action: the inviter is admin_id, the invitee (when they already
  // have an account) is the target.
  "team_invite.sent": {
    category: "data",
    tone: "neutral",
    label: "Team Invite Sent",
    verb: "sent a team invite to",
    icon: "user-plus",
  },

  // ── Logs & data: the records themselves. Clearing, exporting, backing up
  // or purging them is what an insider review asks about first.
  error_logs_cleared: {
    category: "logs_data",
    tone: "destructive",
    label: "Error Logs Cleared",
    verb: "cleared the error logs",
    icon: "trash-2",
  },
  email_logs_cleared: {
    category: "logs_data",
    tone: "destructive",
    label: "Email Logs Cleared",
    verb: "cleared the email logs",
    icon: "trash-2",
  },
  audit_log_exported: {
    category: "logs_data",
    tone: "warning",
    label: "Audit Log Exported",
    verb: "exported the audit log",
    icon: "download",
  },
  backup_started: {
    category: "logs_data",
    tone: "neutral",
    label: "Backup Started",
    verb: "started a database backup",
    icon: "database",
  },
  database_cleanup_run: {
    category: "logs_data",
    tone: "warning",
    label: "Cleanup Run",
    verb: "ran the database cleanup",
    icon: "trash-2",
  },
  // Written by scripts/maintenance/db-repair.mjs, not by a route.
  data_integrity_repair: {
    category: "logs_data",
    tone: "warning",
    label: "Data Repaired",
    verb: "ran a data integrity repair",
    icon: "wrench",
  },
  blocked_data_search: {
    category: "logs_data",
    tone: "muted",
    label: "Blocked Data Searched",
    verb: "searched scans for a blocked value",
    icon: "search",
  },
  blocked_data_delete: {
    category: "logs_data",
    tone: "destructive",
    label: "Blocked Data Deleted",
    verb: "deleted scans matching a blocked value",
    icon: "trash-2",
  },
  purge_host_reputation: {
    category: "logs_data",
    tone: "destructive",
    label: "Host Report Purged",
    verb: "purged a cached host report",
    icon: "trash-2",
  },
  revoke_public_share: {
    category: "logs_data",
    tone: "destructive",
    label: "Share Revoked",
    verb: "revoked a public share link",
    icon: "link-2-off",
  },
  unlist_public_share: {
    category: "logs_data",
    tone: "warning",
    label: "Share Unlisted",
    verb: "removed a scan from the public directory",
    icon: "eye-off",
  },
} satisfies Record<string, AuditActionDef>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

/**
 * Names older code wrote that nothing writes now. Rows carrying them are still
 * in the table, so they keep a label and a category, but they are not
 * AuditActions: new code cannot log them.
 */
export const LEGACY_AUDIT_ACTIONS = {
  disable: {
    category: "status",
    tone: "destructive",
    label: "Disabled",
    verb: "disabled the account of",
    icon: "ban",
  },
  enable: {
    category: "status",
    tone: "success",
    label: "Enabled",
    verb: "re-enabled the account of",
    icon: "check-circle",
  },
  delete_user: {
    category: "status",
    tone: "destructive",
    label: "Deleted",
    verb: "permanently deleted",
    icon: "trash-2",
  },
  delete: {
    category: "status",
    tone: "destructive",
    label: "Deleted",
    verb: "permanently deleted",
    icon: "trash-2",
  },
  set_scan_limit: {
    category: "status",
    tone: "neutral",
    label: "Scan Limit Set",
    verb: "set scan limit for",
    icon: "gauge",
  },
} satisfies Record<string, AuditActionDef>;

/** Every name a stored row can carry, live or legacy, for display. */
export const KNOWN_AUDIT_ACTIONS: Readonly<Record<string, AuditActionDef>> = {
  ...LEGACY_AUDIT_ACTIONS,
  ...AUDIT_ACTIONS,
};

/**
 * Narrow a computed string before logging it. A literal needs no guard (the
 * type checks it); this is for a name built at runtime.
 */
export function isAuditAction(value: string): value is AuditAction {
  return Object.prototype.hasOwnProperty.call(AUDIT_ACTIONS, value);
}

/** Every known action in one category, live and legacy. */
export function auditActionsIn(category: AuditCategoryId): string[] {
  return Object.entries(KNOWN_AUDIT_ACTIONS)
    .filter(([, def]) => def.category === category)
    .map(([id]) => id);
}
