// Admin panel configuration - tabs, action metadata, filters

// The five-entry ADMIN_TABS table that used to live here is gone. It was not
// the live tab table and never had an importer: the panel builds its tabs at
// runtime from NAV_GROUPS in app/admin/page.tsx (flattened into
// ALL_ADMIN_TABS), which carries all twenty destinations plus the per-tab
// permission gate. Keeping a stale five-entry copy in the file literally
// named "Admin panel configuration" is how a tab gets added in the wrong
// place. Add a tab in NAV_GROUPS.

// Action metadata for audit log display
export interface ActionMeta {
  label: string;
  verb: string;
  icon: string;
  cls: string;
}

export const ACTION_META: Record<string, ActionMeta> = {
  // Role changes
  set_role: {
    label: "Changed Role",
    verb: "changed the role of",
    icon: "shield",
    cls: "bg-primary/10 text-primary border-primary/20",
  },
  make_admin: {
    label: "Promoted to Admin",
    verb: "promoted to admin",
    icon: "crown",
    cls: "bg-primary/10 text-primary border-primary/20",
  },
  remove_admin: {
    label: "Removed Admin Role",
    verb: "removed admin role from",
    icon: "shield-off",
    cls: "bg-muted text-muted-foreground border-border",
  },
  // Security actions
  reset_password: {
    label: "Reset Password",
    verb: "sent a password reset to",
    icon: "key",
    cls: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  },
  revoke_sessions: {
    label: "Revoked Sessions",
    verb: "revoked all sessions for",
    icon: "log-out",
    cls: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  },
  revoke_api_keys: {
    label: "Revoked API Keys",
    verb: "revoked API keys for",
    icon: "key",
    cls: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  },
  reset_2fa: {
    label: "Reset 2FA",
    verb: "reset two-factor authentication for",
    icon: "smartphone",
    cls: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  },
  force_logout_all: {
    label: "Force Logout",
    verb: "force logged out",
    icon: "log-out",
    cls: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  },
  // Account status
  disable_user: {
    label: "Disabled",
    verb: "disabled the account of",
    icon: "ban",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
  },
  disable: {
    label: "Disabled",
    verb: "disabled the account of",
    icon: "ban",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
  },
  enable_user: {
    label: "Enabled",
    verb: "re-enabled the account of",
    icon: "check-circle",
    cls: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
  },
  enable: {
    label: "Enabled",
    verb: "re-enabled the account of",
    icon: "check-circle",
    cls: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
  },
  delete_user: {
    label: "Deleted",
    verb: "permanently deleted",
    icon: "trash-2",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
  },
  delete: {
    label: "Deleted",
    verb: "permanently deleted",
    icon: "trash-2",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
  },
  // Profile updates
  update_name: {
    label: "Name Changed",
    verb: "updated the name of",
    icon: "user",
    cls: "bg-muted text-foreground border-border",
  },
  update_email: {
    label: "Email Changed",
    verb: "updated the email of",
    icon: "mail",
    cls: "bg-muted text-foreground border-border",
  },
  update_plan: {
    label: "Plan Changed",
    verb: "changed the subscription plan for",
    icon: "credit-card",
    cls: "bg-primary/10 text-primary border-primary/20",
  },
  clear_avatar: {
    label: "Avatar Cleared",
    verb: "cleared the avatar of",
    icon: "image-off",
    cls: "bg-muted text-muted-foreground border-border",
  },
  // Gift subscriptions
  gift_subscription: {
    label: "Gifted Plan",
    verb: "gifted a subscription to",
    icon: "gift",
    cls: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  },
  revoke_gift: {
    label: "Revoked Gift",
    verb: "revoked gifted subscription from",
    icon: "gift-off",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
  },
  // Data management
  delete_scans: {
    label: "Scans Deleted",
    verb: "deleted all scans for",
    icon: "trash-2",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
  },
  delete_webhooks: {
    label: "Webhooks Deleted",
    verb: "deleted webhooks for",
    icon: "webhook-off",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
  },
  delete_schedules: {
    label: "Schedules Deleted",
    verb: "deleted schedules for",
    icon: "calendar-off",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
  },
  export_data: {
    label: "Data Exported",
    verb: "exported data for",
    icon: "download",
    cls: "bg-muted text-foreground border-border",
  },
  clear_rate_limits: {
    label: "Rate Limits Cleared",
    verb: "cleared rate limits for",
    icon: "gauge",
    cls: "bg-muted text-foreground border-border",
  },
  // Badges
  award_badge: {
    label: "Badge Awarded",
    verb: "awarded a badge to",
    icon: "award",
    cls: "bg-primary/10 text-primary border-primary/20",
  },
  revoke_badge: {
    label: "Badge Revoked",
    verb: "revoked a badge from",
    icon: "award-off",
    cls: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  },
  create_badge: {
    label: "Badge Created",
    verb: "created a new badge",
    icon: "plus-circle",
    cls: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
  },
  delete_badge: {
    label: "Badge Deleted",
    verb: "deleted a badge",
    icon: "trash-2",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
  },
  // Admin
  impersonate: {
    label: "Impersonation",
    verb: "started impersonating",
    icon: "eye",
    cls: "bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))] border-[hsl(var(--severity-high))]/20",
  },
  // Read, not a mutation. Admin GETs used to leave no trail at all, so
  // there was nothing to reconstruct after a compromised or insider staff
  // account paged through accounts; opening one user's full record (PII,
  // sessions, billing identifiers) now writes a row.
  view_user_detail: {
    label: "Viewed Account",
    verb: "viewed the account record of",
    icon: "eye",
    cls: "bg-muted text-muted-foreground border-border",
  },
  set_scan_limit: {
    label: "Scan Limit Set",
    verb: "set scan limit for",
    icon: "gauge",
    cls: "bg-muted text-foreground border-border",
  },
  add_note: {
    label: "Note Added",
    verb: "added a note about",
    icon: "sticky-note",
    cls: "bg-muted text-foreground border-border",
  },
  send_notification: {
    label: "Notification Sent",
    verb: "sent a notification to",
    icon: "bell",
    cls: "bg-primary/10 text-primary border-primary/20",
  },
  // Usage/limit resets
  reset_daily_limit: {
    label: "Daily Limit Reset",
    verb: "reset the daily scan count for",
    icon: "gauge",
    cls: "bg-muted text-foreground border-border",
  },
  reset_ai_usage: {
    label: "AI Usage Reset",
    verb: "reset the AI usage window for",
    icon: "sparkles",
    cls: "bg-muted text-foreground border-border",
  },
  reset_github_review_usage: {
    label: "GitHub Review Usage Reset",
    verb: "reset the GitHub review usage window for",
    icon: "gauge",
    cls: "bg-muted text-foreground border-border",
  },
  reset_free_github_trial: {
    label: "Free GitHub Trial Reset",
    verb: "reset the free GitHub review trial for",
    icon: "gauge",
    cls: "bg-muted text-foreground border-border",
  },
};

// Success-toast text for every admin PATCH action, keyed by its `action`
// value. THIS IS THE LIVE COPY: app/admin/page.tsx imports it and does
// `showToast(ACTION_LABELS[action] || "Action completed.")`. It used to keep
// its own inlined duplicate that had drifted six entries ahead of this one,
// so adding a label here (the obvious place, in the file named "Admin panel
// configuration") silently produced the generic fallback instead. Add new
// actions here and nowhere else.
export const ACTION_LABELS: Record<string, string> = {
  set_role: "User role updated.",
  make_admin: "User promoted to admin.",
  remove_admin: "Admin privileges removed.",
  reset_password: "Password reset email sent to the user.",
  revoke_sessions: "All sessions revoked.",
  revoke_api_keys: "All API keys revoked.",
  disable: "Account disabled.",
  enable: "Account re-enabled.",
  delete: "User deleted.",
  award_badge: "Badge awarded.",
  revoke_badge: "Badge removed from user.",
  create_badge: "Badge created.",
  delete_badge: "Badge deleted permanently.",
  update_name: "Name updated.",
  update_email: "Email updated.",
  update_plan: "Plan updated.",
  notify_account_changes: "Account change email sent to user.",
  reset_2fa: "Two-factor authentication reset.",
  delete_scans: "All scans deleted.",
  clear_rate_limits: "Rate limits cleared.",
  gift_subscription: "Subscription gifted successfully.",
  revoke_gift: "Gifted subscription revoked.",
  toggle_ai_ban: "AI chat access updated.",
  verify_email: "Email verified.",
  unverify_email: "Email unverified.",
  send_notification: "Notification sent.",
  // No UI dispatches send_email and PATCH /api/v3/admin has no case for it,
  // so this label is unreachable: the action would 400. Kept because the
  // permission and its role grant still exist in lib/auth/permissions-client.ts
  // (tests/lib/auth/permissions-client.test.ts flags it as a known stale id),
  // and removing one half without the other just moves the inconsistency.
  send_email: "Email sent.",
  reset_daily_limit: "Daily scan count reset.",
  reset_ai_usage: "AI usage window reset.",
  reset_github_review_usage: "GitHub review usage window reset.",
  reset_free_github_trial: "Free GitHub review trial reset.",
};

// Audit log filter categories: defined in components/admin/utils.ts
// (re-exported from the barrel to avoid duplicate declarations)

// Actions the admin API requires re-entering the calling admin's own
// password for. Any PATCH to /api/v3/admin with one of these `action`
// values is rejected with 403 unless `currentAdminPassword` is included in
// the request body -- app/api/v3/admin/route.ts imports this exact Set for
// that check, rather than keeping its own copy, so this is the single
// place both the client re-auth prompt and the server enforcement read
// from. Every "Danger Zone" action in user-detail-panel.tsx (irreversible
// data loss, or revoking access/security material) plus the pre-existing
// account-mutation set.
//
// "revoke_all_sessions" was a bug: no action anywhere is ever queued
// under that name (the real one is "revoke_sessions" -- see
// user-detail-panel.tsx's queueSupportAction call), so "Revoke All
// Sessions" was never actually password-gated despite looking like it
// was in this list.
export const PASSWORD_GATED_ACTIONS = new Set([
  "update_email",
  "update_password",
  "disable",
  "reset_password",
  "delete",
  "revoke_sessions",
  "revoke_api_keys",
  "reset_2fa",
  "force_logout_all",
  "toggle_ai_ban",
  "delete_scans",
  "delete_webhooks",
  "delete_schedules",
  "remove_admin",
  "make_admin",
  "set_role",
  "impersonate",
  // Not a PATCH /api/v3/admin action: it names the POST to
  // /api/v3/admin/staff-invites, which grants the same privilege set_role
  // does (admin is selectable) and used to take one unconfirmed click.
  // Enforced in that route's own handler.
  "send_staff_invite",
]);

// Default pagination sizes
export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_AUDIT_PAGE_SIZE = 10;
export const DEFAULT_STAFF_PAGE_SIZE = 10;
