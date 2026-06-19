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
      "toggle_beta_access",
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
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Parse URL hash for admin panel routing
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
