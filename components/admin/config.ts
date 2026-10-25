// Admin panel configuration - tabs, action metadata, filters

import { KNOWN_AUDIT_ACTIONS, type AuditTone } from "@/lib/admin/audit-actions";

// The five-entry ADMIN_TABS table that used to live here is gone. It was not
// the live tab table and never had an importer: the panel builds its tabs at
// runtime from NAV_GROUPS in app/admin/page.tsx (flattened into
// ALL_ADMIN_TABS), which carries all twenty destinations plus the per-tab
// permission gate. Keeping a stale five-entry copy in the file literally
// named "Admin panel configuration" is how a tab gets added in the wrong
// place. Add a tab in NAV_GROUPS.

// Action metadata for audit log display, derived from the registry in
// lib/admin/audit-actions.ts. This used to be a hand-kept 41-entry table that
// had fallen 25 actions behind what the routes actually log (staff invites,
// log clears, audit exports, account deletion among them), so those rows
// rendered as `performed "error logs cleared"`. Add an action there, not here.
export interface ActionMeta {
  label: string;
  verb: string;
  icon: string;
  cls: string;
}

/**
 * The registry names a tone; the classes live here because lib/ is outside
 * Tailwind's content globs and a class string written there would be purged.
 */
const TONE_CLASSES: Record<AuditTone, string> = {
  primary: "bg-primary/10 text-primary border-primary/20",
  neutral: "bg-muted text-foreground border-border",
  muted: "bg-muted text-muted-foreground border-border",
  success:
    "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
  warning:
    "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  high: "bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))] border-[hsl(var(--severity-high))]/20",
};

export const ACTION_META: Record<string, ActionMeta> = Object.fromEntries(
  Object.entries(KNOWN_AUDIT_ACTIONS).map(([action, def]) => [
    action,
    {
      label: def.label,
      verb: def.verb,
      icon: def.icon,
      cls: TONE_CLASSES[def.tone],
    },
  ]),
);

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
  revoke_api_key: "API key revoked.",
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
  issue_2fa_recovery_code:
    "Recovery code emailed to the user. It replaces any backup codes they had.",
  delete_scans: "All scans deleted.",
  clear_rate_limits: "Rate limits cleared.",
  gift_subscription: "Subscription gifted successfully.",
  revoke_gift: "Gifted subscription revoked.",
  grant_credits: "Credits granted.",
  toggle_ai_ban: "AI chat access updated.",
  verify_email: "Email verified.",
  unverify_email: "Email unverified.",
  resend_verification: "Verification link sent to the user.",
  send_notification: "Notification sent.",
  // No UI dispatches send_email and PATCH /api/v3/admin has no case for it,
  // so this label is unreachable: the action would 400. Kept because the
  // permission and its role grant still exist in lib/auth/permissions-client.ts
  // (tests/lib/auth/permissions-client.test.ts flags it as a known stale id),
  // and removing one half without the other just moves the inconsistency.
  send_email: "Email sent.",
  // Five cards in the user detail panel had no entry here and fell back to
  // the generic "Action completed.", including the two that delete a user's
  // integrations outright, where the toast is the only confirmation of what
  // was removed.
  force_logout_all: "Every session ended and every API key revoked.",
  impersonate: "Impersonation session started.",
  clear_avatar: "Profile picture removed.",
  delete_webhooks: "All webhooks deleted.",
  delete_schedules: "All scheduled scans deleted.",
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
  // All three names for the same destructive handler. The route only
  // answers to "delete" now, and these are here so that reintroducing a
  // synonym cannot reintroduce an ungated path to it.
  "delete",
  "delete_user",
  "delete_account",
  "revoke_sessions",
  "revoke_api_keys",
  "revoke_api_key",
  "reset_2fa",
  // Hands whoever reads the target's mailbox a working second factor, so it
  // sits with the account-mutation set rather than with the harmless resets.
  "issue_2fa_recovery_code",
  "force_logout_all",
  "toggle_ai_ban",
  "delete_scans",
  "delete_webhooks",
  "delete_schedules",
  "remove_admin",
  "make_admin",
  "set_role",
  "impersonate",
  // Adds real, non-expiring spendable balance, up to 20M AI tokens or 500
  // browser minutes a call, so a hijacked staff session should not be able
  // to repeat it without the password.
  "grant_credits",
  // Not a PATCH /api/v3/admin action: it names the POST to
  // /api/v3/admin/staff-invites, which grants the same privilege set_role
  // does (admin is selectable) and used to take one unconfirmed click.
  // Enforced in that route's own handler.
  "send_staff_invite",
]);

/**
 * Every action id the user detail panel's two action cards render:
 * components/admin/users/user-detail-panel.tsx's "Support Actions" card and
 * its "Danger zone" card.
 *
 * A card shows when the caller can run at least one of the actions inside it.
 * Both used to be gated on DISABLE_USER instead, a permission none of the
 * cards in either one requires, so a role holding a grant the server would
 * have accepted was still shown "You have view-only access": billing could not
 * reach gift_subscription or revoke_gift, the two actions that role exists
 * for; security_analyst could not reach revoke_sessions or force_logout_all;
 * content_manager could not reach send_notification or toggle_ai_ban. The
 * server never refused any of them, so the capability was reachable by
 * hand-writing the PATCH and no other way.
 *
 * Here rather than beside the JSX so tests/components/admin/config.test.ts can
 * hold every id to one that ADMIN_ACTIONS actually defines. An id that drifts
 * out of that registry is not a visible break: canPerformAction returns false
 * for an unknown action, so the card simply renders permanently disabled with
 * "Your role cannot perform this action", which reads like a permission
 * problem rather than a typo.
 */
export const SUPPORT_CARD_ACTIONS = [
  "revoke_sessions",
  "revoke_api_keys",
  "reset_password",
  "issue_2fa_recovery_code",
  "clear_rate_limits",
  "force_logout_all",
  "impersonate",
  "reset_daily_limit",
  "reset_ai_usage",
  "reset_github_review_usage",
  "reset_free_github_trial",
  "verify_email",
  "unverify_email",
  "resend_verification",
  "clear_avatar",
  "send_notification",
  "gift_subscription",
  "revoke_gift",
] as const;

export const DANGER_ZONE_ACTIONS = [
  "toggle_ai_ban",
  "delete_scans",
  "delete_webhooks",
  "delete_schedules",
  "delete",
] as const;

// Default pagination sizes
export const DEFAULT_PAGE_SIZE = 10;
