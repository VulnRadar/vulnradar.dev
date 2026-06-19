import { Crown, Shield, Eye } from "lucide-react";

export interface Team {
  id: number;
  name: string;
  created_at: string;
  role: string;
  member_count: number;
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
  viewer: Eye,
};

export const ROLE_COLORS: Record<string, string> = {
  owner: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  admin: "bg-primary/10 text-primary border-primary/20",
  viewer: "bg-muted text-muted-foreground border-border",
};

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
