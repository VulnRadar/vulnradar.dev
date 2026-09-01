// Admin panel utility functions

import {
  Activity,
  Shield,
  Key,
  Award,
  Users,
  Bell,
  Settings,
  Mail,
  Gift,
  ShieldAlert,
} from "lucide-react";
import { ACTION_META } from "./config";
import type { AuditEntry } from "./types";

/**
 * Audit log filter categories with comprehensive action mappings
 */
export const AUDIT_FILTER_CATEGORIES = [
  { id: "all", label: "All", icon: Activity },
  {
    id: "roles",
    label: "Roles",
    icon: Shield,
    actions: ["set_role", "make_admin", "remove_admin"],
  },
  {
    id: "security",
    label: "Security",
    icon: Key,
    actions: [
      "reset_password",
      "revoke_sessions",
      "revoke_api_keys",
      "reset_2fa",
      "force_logout_all",
      "impersonate",
      "verify_email",
      "unverify_email",
      "view_user_detail",
    ],
  },
  {
    id: "status",
    label: "Status",
    icon: Users,
    actions: [
      "disable_user",
      "enable_user",
      "delete_account",
      "set_scan_limit",
      "clear_rate_limits",
    ],
  },
  {
    id: "badges",
    label: "Badges",
    icon: Award,
    actions: ["award_badge", "revoke_badge", "create_badge", "delete_badge"],
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    icon: Gift,
    actions: ["gift_subscription", "revoke_gift"],
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    actions: [
      "send_notification",
      "notification_created",
      "notification_updated",
      "notification_deleted",
    ],
  },
  {
    id: "broadcasts",
    label: "Broadcasts",
    icon: Mail,
    actions: [
      "broadcast_created",
      "broadcast_sent",
      "broadcast_deleted",
      "broadcast_resent",
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Settings,
    actions: [
      "system_setting_changed",
      "access_rule_created",
      "access_rule_deleted",
      "access_rule_updated",
      "security_alert_resolved",
    ],
  },
  {
    id: "data",
    label: "Data",
    icon: ShieldAlert,
    actions: [
      "delete_scans",
      "export_data",
      "delete_webhooks",
      "delete_schedules",
      "clear_avatar",
      "add_note",
      "edit_note",
      "delete_note",
    ],
  },
];

/**
 * Format a date as relative time (e.g., "2h ago", "3d ago")
 */
// Canonical relative-time formatter (see lib/ui/relative-time.ts).
export { formatRelativeTime } from "@/lib/ui/relative-time";

export interface ChangeDiff {
  field: string;
  from: string;
  to: string;
}

const CHANGED_FROM_TO =
  /^(.*?)\s+from\s+"([^"]*)"\s+to\s+"([^"]*)"(?:\s+for\s+.+)?$/i;
const RESET_TO_DEFAULT =
  /^Reset\s+"([^"]+)"\s+to its default\s+\(was\s+"([^"]*)"\)$/i;

/**
 * Best-effort parse of an audit log's free-text `details` string into a
 * structured before/after diff, for the handful of admin actions that log a
 * plain-English "Changed X from Y to Z" or "Reset X (was Y)" sentence
 * (system_setting_changed, system_setting_reset, update_name, update_email,
 * update_plan). Returns null for every other action's details, which keep
 * rendering as the plain sentence they already are.
 */
export function parseChangeDiff(details: string | null): ChangeDiff | null {
  if (!details) return null;

  const reset = RESET_TO_DEFAULT.exec(details);
  if (reset) {
    return { field: reset[1], from: reset[2], to: "default" };
  }

  const changed = CHANGED_FROM_TO.exec(details);
  if (changed) {
    let field = changed[1].trim();
    field = field.replace(/^changed\s+/i, "").trim();
    field = field.replace(/^"(.*)"$/, "$1");
    return { field, from: changed[2], to: changed[3] };
  }

  return null;
}

/**
 * Generate a human-readable sentence for an audit log entry
 */
export function getActionSentence(log: AuditEntry): string {
  const meta = ACTION_META[log.action];
  const adminName = log.admin_name || log.admin_email.split("@")[0];
  const targetName =
    log.target_name ||
    (log.target_email ? log.target_email.split("@")[0] : null);

  if (meta?.verb) {
    if (targetName) {
      return `${adminName} ${meta.verb} ${targetName}`;
    }
    return `${adminName} ${meta.verb.replace(/ (for|to|from|of)$/, "")}`;
  }

  // Fallback
  const actionLabel = log.action.split("_").join(" ");
  return targetName
    ? `${adminName} performed "${actionLabel}" on ${targetName}`
    : `${adminName} performed "${actionLabel}"`;
}

/**
 * Get the fallback label for an action (converts snake_case to Title Case)
 */
export function getActionFallbackLabel(action: string): string {
  return action
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Generate consistent avatar colors based on email
 */
export function getAvatarColorIndex(email: string): number {
  return email.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 5;
}

/**
 * Avatar color classes array
 */
export const AVATAR_COLORS = [
  "bg-primary/15 text-primary",
  "bg-emerald-500/15 text-emerald-500",
  "bg-[hsl(var(--severity-medium))]/15 text-[hsl(var(--severity-medium))]",
  "bg-[hsl(var(--severity-high))]/15 text-[hsl(var(--severity-high))]",
  "bg-[hsl(var(--severity-low))]/15 text-[hsl(var(--severity-low))]",
];

/**
 * Format bytes to human-readable size.
 *
 * This used to be a second, wrong implementation with no callers: its unit
 * table stopped at "GB", so anything at or above 1 TB indexed past the end
 * and rendered "1 undefined". The body below is the one backup-manager.tsx
 * had defined privately and was the only one actually rendering bytes; it
 * handles TB and drops to 0 decimals at or above 10 of a unit. One export,
 * one behaviour.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Absolute timestamp formatter for admin tables.
 *
 * Four private copies of this lived in components/admin/features (backup and
 * billing-overview without seconds, email-logs and error-logs with), so the
 * same panel showed two different precisions depending on which tab you were
 * on. One function with an explicit flag instead: log views pass
 * `withSeconds` because ordering within a minute is the point there.
 */
export function formatTimestamp(iso: string, withSeconds = false): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
  });
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Parse URL hash for admin panel routing.
 *
 * SUPERSEDED, and not wired to anything. The panel abandoned '#users/user-12'
 * hash routing for query params: state goes through updateUrlWithUser in
 * app/admin/page.tsx, which calls setQueryParam/setQueryParams. Neither this
 * nor buildAdminHash below has a caller anywhere, tests included, and the tab
 * whitelist below lists five destinations against the panel's twenty (the
 * live set is NAV_GROUPS in app/admin/page.tsx, flattened into
 * ALL_ADMIN_TABS). Extend the query-param path, not these. Kept because
 * removing an export is the owner's call.
 */
export function parseAdminHash(hash: string): {
  tab: string | null;
  userId: number | null;
} {
  const cleanHash = hash.replace("#", "");
  if (!cleanHash) return { tab: null, userId: null };

  const parts = cleanHash.split("/");
  let tab: string | null = null;
  let userId: number | null = null;

  for (const part of parts) {
    if (["users", "audit", "admins", "notifications", "teams"].includes(part)) {
      tab = part;
    }
    if (part.startsWith("user-")) {
      const id = parseInt(part.replace("user-", ""), 10);
      if (!isNaN(id)) userId = id;
    }
  }

  return { tab, userId };
}

/**
 * Build admin URL hash
 */
export function buildAdminHash(tab?: string, userId?: number | null): string {
  const parts: string[] = [];
  if (tab) parts.push(tab);
  if (userId) parts.push(`user-${userId}`);
  return parts.length > 0 ? `#${parts.join("/")}` : "";
}
