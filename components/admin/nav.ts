// THE admin panel's destination table. One list, in one file.
//
// AUDIT-014 qols-01. This lived inside the AdminContent component in
// app/admin/page.tsx, where the same twenty-one destinations were written out
// three times: once as the `VALID_TABS` string tuple that the URL parser
// checks, once again as the `ActiveTab` union, and a third time as the
// NAV_GROUPS_RAW table that actually renders the sidebar. Nothing tied the
// three together, so a destination could exist in two of them and not the
// third, which is exactly how a tab ends up unreachable by URL or invisible in
// the nav. Now `VALID_TABS` is the source, `AdminTabKey` is derived from it,
// and `AdminNavItem["key"]` is typed as `AdminTabKey`, so a nav entry naming a
// tab that does not exist is a compile error and a tab missing from the nav is
// a test failure (tests/components/admin/nav.test.ts).
//
// This is a separate module from components/admin/config.ts on purpose:
// config.ts exports PASSWORD_GATED_ACTIONS, which app/api/v3/admin/route.ts
// imports on the server. Putting a table of lucide icons in there would pull
// the icon library into a server bundle that has no use for it.

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Ban,
  Bell,
  Bug,
  DatabaseBackup,
  DownloadCloud,
  Gauge,
  Globe,
  History,
  LifeBuoy,
  ListOrdered,
  Mail,
  MessageCircle,
  Send,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import {
  STAFF_PERMISSIONS,
  type StaffPermission,
} from "@/lib/auth/permissions-client";
import { STAFF_ROLE_HIERARCHY } from "@/lib/config/client-constants";

export const VALID_TABS = [
  "overview",
  "users",
  "audit",
  "admins",
  "notifications",
  "teams",
  "access-rules",
  "blocked-data",
  "content",
  "security-alerts",
  "settings",
  "broadcast",
  "ai-chats",
  "support-tickets",
  "updater",
  "backup",
  "queue-status",
  "error-logs",
  "email-logs",
  "engine-feedback",
  "billing-overview",
] as const;

export type AdminTabKey = (typeof VALID_TABS)[number];

export interface AdminNavItem {
  key: AdminTabKey;
  label: string;
  icon: LucideIcon;
  /** The exact STAFF_PERMISSIONS grant this destination's own route enforces
   *  server-side, so a specialist role never sees a tab whose first request
   *  then 403s. */
  permission?: StaffPermission;
  /** For the handful of routes still gated on a raw role-hierarchy floor
   *  (requireModerator and friends) rather than a named permission. */
  minHierarchy?: number;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

/**
 * Grouped by the question an operator is trying to answer, not by what kind of
 * row the data is.
 *
 * The old grouping was six data-model nouns: "User Management",
 * "Communications", a one-item "Content", a one-item "Billing", and a "System"
 * bucket holding seven destinations whose only shared property was not fitting
 * anywhere else (an update installer, a backup runner, a queue gauge, two log
 * viewers, a settings editor and a detection-tuning tool). Nobody arrives at
 * this panel thinking "I need a system thing".
 *
 *   Operations      Is the machine healthy, and if not, where. The five
 *                   ex-System runtime destinations all answer this one
 *                   question, and they are exactly the tabs the Overview
 *                   health rows link into, so a red row lands inside its own
 *                   group.
 *   People          Who is this account, and who on staff touched it. Audit
 *                   Log moves here from "Security": it is the record of what
 *                   staff did to accounts, so it is read next to the accounts
 *                   and the staff list, not next to firewall rules.
 *   Support         Someone is asking us for help. AI Chats moves out of
 *                   "Communications": reading a user's conversation is support
 *                   and moderation work, not messaging.
 *   Trust & Safety  What is a user or an IP allowed to do here. Absorbs the
 *                   former one-item "Content" group, which was the same job
 *                   under a different noun.
 *   Messaging       Tell users something, unprompted. Only these two do.
 *   Billing         Money. Still one destination, but it is genuinely its own
 *                   job and nothing else belongs beside it.
 *   Configuration   Change how the system behaves. Both entries are
 *                   write-once-and-watch, not read-often.
 *
 * Group order is how often an operator opens the group: the morning health
 * check, then account work, then the two inboxes.
 */
export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: "Operations",
    items: [
      {
        // No permission gate: every role that reaches this page can see the
        // overview, and the API decides which health rows that role may read.
        key: "overview",
        label: "Overview",
        icon: Activity,
      },
      {
        key: "queue-status",
        label: "Scanner Queue",
        icon: ListOrdered,
        permission: STAFF_PERMISSIONS.VIEW_SYSTEM_STATS,
      },
      {
        key: "error-logs",
        label: "Error Logs",
        icon: Bug,
        permission: STAFF_PERMISSIONS.VIEW_ERROR_LOGS,
      },
      {
        key: "email-logs",
        label: "Email Logs",
        icon: Mail,
        permission: STAFF_PERMISSIONS.TRIGGER_MAINTENANCE,
      },
      {
        key: "backup",
        label: "Backups",
        icon: DatabaseBackup,
        permission: STAFF_PERMISSIONS.TRIGGER_MAINTENANCE,
      },
      {
        key: "updater",
        label: "Updater",
        icon: DownloadCloud,
        permission: STAFF_PERMISSIONS.TRIGGER_MAINTENANCE,
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        key: "users",
        label: "Users",
        icon: Users,
        permission: STAFF_PERMISSIONS.VIEW_USERS,
      },
      {
        key: "teams",
        label: "Teams",
        icon: UsersRound,
        minHierarchy: STAFF_ROLE_HIERARCHY.moderator,
      },
      {
        key: "admins",
        label: "Staff",
        icon: Shield,
        // section=active-admins is gated on VIEW_AUDIT_LOG server-side
        // (app/api/v3/admin/route.ts). This tab carried no gate at all, so
        // billing/content_manager/ops saw it and got a guaranteed 403.
        permission: STAFF_PERMISSIONS.VIEW_AUDIT_LOG,
      },
      {
        key: "audit",
        label: "Audit Log",
        icon: History,
        permission: STAFF_PERMISSIONS.VIEW_AUDIT_LOG,
      },
    ],
  },
  {
    label: "Support",
    items: [
      {
        key: "support-tickets",
        label: "Tickets",
        icon: LifeBuoy,
        permission: STAFF_PERMISSIONS.MANAGE_SUPPORT_TICKETS,
      },
      {
        key: "ai-chats",
        label: "AI Chats",
        icon: MessageCircle,
        permission: STAFF_PERMISSIONS.MODERATE_CONTENT,
      },
    ],
  },
  {
    label: "Trust & Safety",
    items: [
      {
        key: "security-alerts",
        label: "Security Alerts",
        icon: ShieldCheck,
        permission: STAFF_PERMISSIONS.TRIGGER_MAINTENANCE,
      },
      {
        key: "access-rules",
        label: "Access Rules",
        icon: Globe,
        permission: STAFF_PERMISSIONS.TRIGGER_MAINTENANCE,
      },
      {
        key: "blocked-data",
        label: "Blocked Data",
        icon: Ban,
        permission: STAFF_PERMISSIONS.TRIGGER_MAINTENANCE,
      },
      {
        key: "content",
        label: "Hosts & Shares",
        icon: Share2,
        permission: STAFF_PERMISSIONS.MODERATE_CONTENT,
      },
    ],
  },
  {
    label: "Messaging",
    items: [
      {
        key: "broadcast",
        label: "Broadcast",
        icon: Send,
        permission: STAFF_PERMISSIONS.TRIGGER_MAINTENANCE,
      },
      {
        key: "notifications",
        label: "Notifications",
        icon: Bell,
        permission: STAFF_PERMISSIONS.SEND_ANNOUNCEMENTS,
      },
    ],
  },
  {
    label: "Billing",
    items: [
      {
        key: "billing-overview",
        label: "Revenue",
        icon: Wallet,
        permission: STAFF_PERMISSIONS.VIEW_BILLING_OVERVIEW,
      },
    ],
  },
  {
    label: "Configuration",
    items: [
      {
        key: "settings",
        label: "Settings",
        icon: Settings,
        permission: STAFF_PERMISSIONS.TRIGGER_MAINTENANCE,
      },
      {
        key: "engine-feedback",
        label: "Engine Feedback",
        icon: Gauge,
        permission: STAFF_PERMISSIONS.MANAGE_ENGINE_FEEDBACK,
      },
    ],
  },
];

/** Every destination, in sidebar order, ignoring permissions. */
export const ALL_ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV_GROUPS.flatMap(
  (group) => group.items,
);

/**
 * Can this role see this destination at all? A tab whose gate fails is not
 * rendered, rather than rendered and then 403ing on its first request.
 */
export function canSeeAdminNavItem(
  item: AdminNavItem,
  callerRole: string,
  hasPermission: (role: string, permission: StaffPermission) => boolean,
): boolean {
  if (
    item.permission !== undefined &&
    !hasPermission(callerRole, item.permission)
  ) {
    return false;
  }
  if (
    item.minHierarchy !== undefined &&
    (STAFF_ROLE_HIERARCHY[callerRole] ?? 0) < item.minHierarchy
  ) {
    return false;
  }
  return true;
}
