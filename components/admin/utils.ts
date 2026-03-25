// Admin panel shared utilities

// Action metadata for audit log display
export const ACTION_META: Record<string, { label: string; verb: string; icon: string; cls: string }> = {
  // Role changes
  set_role: { label: "Changed Role", verb: "changed the role of", icon: "shield", cls: "bg-primary/10 text-primary border-primary/20" },
  make_admin: { label: "Promoted to Admin", verb: "promoted to admin", icon: "crown", cls: "bg-primary/10 text-primary border-primary/20" },
  remove_admin: { label: "Removed Admin Role", verb: "removed admin role from", icon: "shield-off", cls: "bg-muted text-muted-foreground border-border" },
  // Security actions
  reset_password: { label: "Reset Password", verb: "sent a password reset to", icon: "key", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  revoke_sessions: { label: "Revoked Sessions", verb: "revoked all sessions for", icon: "log-out", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  revoke_api_keys: { label: "Revoked API Keys", verb: "revoked API keys for", icon: "key", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  reset_2fa: { label: "Reset 2FA", verb: "reset two-factor authentication for", icon: "smartphone", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  force_logout_all: { label: "Force Logout", verb: "force logged out", icon: "log-out", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  // Account status
  disable_user: { label: "Disabled", verb: "disabled the account of", icon: "ban", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  disable: { label: "Disabled", verb: "disabled the account of", icon: "ban", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  enable_user: { label: "Enabled", verb: "re-enabled the account of", icon: "check-circle", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  enable: { label: "Enabled", verb: "re-enabled the account of", icon: "check-circle", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  delete_user: { label: "Deleted", verb: "permanently deleted", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  delete: { label: "Deleted", verb: "permanently deleted", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  // Profile updates
  update_name: { label: "Name Changed", verb: "updated the name of", icon: "user", cls: "bg-muted text-foreground border-border" },
  update_email: { label: "Email Changed", verb: "updated the email of", icon: "mail", cls: "bg-muted text-foreground border-border" },
  update_plan: { label: "Plan Changed", verb: "changed the subscription plan for", icon: "credit-card", cls: "bg-primary/10 text-primary border-primary/20" },
  clear_avatar: { label: "Avatar Cleared", verb: "cleared the avatar of", icon: "image-off", cls: "bg-muted text-muted-foreground border-border" },
  // Email verification
  verify_email: { label: "Email Verified", verb: "verified the email of", icon: "mail-check", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  unverify_email: { label: "Email Unverified", verb: "unverified the email of", icon: "mail-x", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  // Beta & Premium
  toggle_beta_access: { label: "Beta Access", verb: "toggled beta access for", icon: "flask", cls: "bg-primary/10 text-primary border-primary/20" },
  // Gift subscriptions
  gift_subscription: { label: "Gifted Plan", verb: "gifted a subscription to", icon: "gift", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  revoke_gift: { label: "Revoked Gift", verb: "revoked gifted subscription from", icon: "gift-off", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  // Data management
  delete_scans: { label: "Scans Deleted", verb: "deleted all scans for", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  delete_webhooks: { label: "Webhooks Deleted", verb: "deleted webhooks for", icon: "webhook-off", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  delete_schedules: { label: "Schedules Deleted", verb: "deleted schedules for", icon: "calendar-off", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  export_data: { label: "Data Exported", verb: "exported data for", icon: "download", cls: "bg-muted text-foreground border-border" },
  clear_rate_limits: { label: "Rate Limits Cleared", verb: "cleared rate limits for", icon: "gauge", cls: "bg-muted text-foreground border-border" },
  // Badges
  award_badge: { label: "Badge Awarded", verb: "awarded a badge to", icon: "award", cls: "bg-primary/10 text-primary border-primary/20" },
  revoke_badge: { label: "Badge Revoked", verb: "revoked a badge from", icon: "award-off", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  create_badge: { label: "Badge Created", verb: "created a new badge", icon: "plus-circle", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  delete_badge: { label: "Badge Deleted", verb: "deleted a badge", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  // Admin
  impersonate: { label: "Impersonation", verb: "started impersonating", icon: "eye", cls: "bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))] border-[hsl(var(--severity-high))]/20" },
  set_scan_limit: { label: "Scan Limit Set", verb: "set scan limit for", icon: "gauge", cls: "bg-muted text-foreground border-border" },
  add_note: { label: "Note Added", verb: "added a note about", icon: "sticky-note", cls: "bg-muted text-foreground border-border" },
  send_notification: { label: "Notification Sent", verb: "sent a notification to", icon: "bell", cls: "bg-primary/10 text-primary border-primary/20" },
}

import type { AuditEntry } from "./types"

export function getActionSentence(log: AuditEntry): string {
  const meta = ACTION_META[log.action]
  const adminName = log.admin_name || log.admin_email.split("@")[0]
  const targetName = log.target_name || (log.target_email ? log.target_email.split("@")[0] : null)
  
  if (meta?.verb) {
    if (targetName) {
      return `${adminName} ${meta.verb} ${targetName}`
    }
    return `${adminName} ${meta.verb.replace(/ (for|to|from|of)$/, "")}`
  }
  
  // Fallback
  const actionLabel = log.action.split("_").join(" ")
  return targetName ? `${adminName} performed "${actionLabel}" on ${targetName}` : `${adminName} performed "${actionLabel}"`
}

export function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  
  if (diffSecs < 60) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
