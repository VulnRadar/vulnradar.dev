import type { Vulnerability } from "@/lib/scanner/types";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { AlertTriangle, ShieldAlert, CheckCircle2 } from "lucide-react";

export interface Share {
  id: number;
  url: string;
  scannedAt: string;
  token: string;
  /** ISO timestamp the link stops working at, or null/undefined if it
   *  never expires. An already-expired share never reaches the client --
   *  GET /api/v3/shares excludes it from the list entirely -- so this is
   *  always either null or a moment still in the future. */
  expiresAt?: string | null;
  /** Whether this share is listed in the public /public-scans directory --
   *  independent of the account's default (see lib/scanner/share-privacy.ts)
   *  and independent of scan_history.is_public / /host/[hostname]. */
  publiclyListed: boolean;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  findings: Vulnerability[];
  findingsCount: number;
}

/** "Never expires" / "Expires in 12d" / "Expires today", for the shares
 *  list. Callers only ever see a live share (an expired one is filtered
 *  out server-side), so this never needs to describe an already-expired
 *  state. */
export function formatExpiry(expiresAt: string | null | undefined): string {
  if (!expiresAt) return "Never expires";
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / 86400000);
  if (diffDays <= 1) return "Expires today";
  return `Expires in ${diffDays}d`;
}

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

export function getSeverityInfo(share: Share) {
  const rating = getSafetyRating(share.findings);
  if (rating === "unsafe")
    return {
      label: "Exploitable",
      color: "text-[hsl(var(--severity-critical))]",
      bg: "bg-[hsl(var(--severity-critical))]/10",
      icon: ShieldAlert,
    };
  if (rating === "caution")
    return {
      label: "Caution",
      color: "text-[hsl(var(--severity-medium))]",
      bg: "bg-[hsl(var(--severity-medium))]/10",
      icon: AlertTriangle,
    };
  return {
    label: "Clean",
    color: "text-[hsl(var(--success))]",
    bg: "bg-[hsl(var(--success))]/10",
    icon: CheckCircle2,
  };
}

export function getShareUrl(token: string): string {
  if (typeof window === "undefined") return `/shared/${token}`;
  return `${window.location.origin}/shared/${token}`;
}
