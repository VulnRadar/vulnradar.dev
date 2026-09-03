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
  /** The team's own picture: a same-origin /api/v3/teams/avatar/<id>?v=<stamp>
   *  path, or null when nobody has set one. Built server-side from the
   *  team_avatars row so it always matches what is actually stored. */
  avatar_url: string | null;
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

/** An invitation addressed to the current user (from GET /teams/invitations),
 *  shown on the teams list so they can accept or decline it in-app. */
export interface TeamInvitation {
  id: number;
  team_name: string;
  invited_by_name: string | null;
  role: string;
  created_at: string;
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

// One table, one vocabulary. manager and operator used raw indigo-500 and
// orange-500 while every other row used theme tokens, so those two badges did
// not follow the theme at all and sat in the low-contrast band in light mode.
// The two privileged roles keep the accent because privilege is what the colour
// is for; the rest are told apart by ROLE_ICONS on a neutral badge.
export const ROLE_COLORS: Record<string, string> = {
  owner:
    "bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]",
  admin: "bg-primary/10 text-primary border-primary/20",
  manager: "bg-muted text-foreground border-border",
  operator: "bg-muted text-foreground border-border",
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

export type InvitableRole =
  "admin" | "manager" | "operator" | "member" | "viewer";

// Least to most privileged, matching the invite UI's reading order. Derived
// from TEAM_ROLES (excluding the non-invitable owner) so a future role shows
// up automatically, the same way the invite API's INVITABLE_TEAM_ROLES does.
export const INVITABLE_ROLES = Object.values(TEAM_ROLES)
  .filter((r) => r !== TEAM_ROLES.OWNER)
  .reverse() as InvitableRole[];

// Canonical relative-time formatter (see lib/ui/relative-time.ts).
export { formatRelativeTime } from "@/lib/ui/relative-time";
