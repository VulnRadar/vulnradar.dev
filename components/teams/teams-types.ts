import { Crown, Shield, Eye, User, Settings, Wrench } from "lucide-react";
import { TEAM_ROLES } from "@/lib/config/constants";

export interface Team {
  id: number;
  name: string;
  slug: string;
  owner_id: number;
  owner_email: string;
  owner_name: string | null;
  owner_avatar_url: string | null;
  member_count: number;
  created_at: string;
  role: string;
}

export interface Member {
  user_id: number;
  role: string;
  joined_at: string;
  name: string;
  email: string;
  avatar_url?: string;
  staff_role?: string;
}

export interface Invite {
  id: number;
  email: string;
  role: string;
  invited_at: string;
  expires_at: string;
}

export interface MemberScan {
  id: number;
  url: string;
  scanned_at: string;
  findings_count: number;
}

export const ROLE_ICONS: Record<string, typeof Crown> = {
  owner: Crown,
  admin: Shield,
  manager: Settings,
  operator: Wrench,
  member: User,
  viewer: Eye,
};

export const ROLE_COLORS: Record<string, string> = {
  owner:
    "bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]",
  admin: "bg-primary/10 text-primary border-primary/20",
  manager: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  operator: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  member: "bg-muted text-foreground border-border",
  viewer: "bg-muted text-muted-foreground border-border",
};

/**
 * What each role can actually do, in the words of the person doing it.
 * Mirrors TEAM_ROLE_PERMISSIONS in lib/config/constants.ts.
 */
export const ROLE_ABILITIES: Record<string, string> = {
  owner: "Everything, plus renaming and deleting the team.",
  admin:
    "Invite and remove people, run scans, rename the team, read every report.",
  manager:
    "Invite and remove people, rename the team, read every report. Doesn't run scans.",
  operator:
    "Run scans, rename the team, read every report. Doesn't manage people.",
  member: "Run scans and read every report.",
  viewer: "Read reports. Cannot start a scan.",
};

// Most to least privileged is TEAM_ROLES' own declared key order (owner
// first), so this just walks it directly -- a future role addition to
// TEAM_ROLES shows up here with no edit needed here.
export const ROLE_ORDER: readonly string[] = Object.values(TEAM_ROLES);

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
