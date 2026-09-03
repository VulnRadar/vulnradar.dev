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

/** The two forms the shares list needs for one expiry: `label` for the
 *  "Expires" column, which already names the fact, and `spoken` for the
 *  accessible name of the control in that cell, which is read on its own
 *  with no column header for context. Callers only ever see a live share
 *  (an expired one is filtered out server-side), so this never needs to
 *  describe an already-expired state. */
export function formatExpiry(expiresAt: string | null | undefined): {
  label: string;
  spoken: string;
} {
  if (!expiresAt) return { label: "Never", spoken: "This link never expires" };
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / 86400000);
  if (diffDays <= 1)
    return { label: "Today", spoken: "This link expires today" };
  return {
    label: `in ${diffDays}d`,
    spoken: `This link expires in ${diffDays} days`,
  };
}

// Canonical relative-time formatter (see lib/ui/relative-time.ts).
export { formatRelativeTime } from "@/lib/ui/relative-time";

/** `rail` is the full-strength fill for the 3px severity strip down the left
 *  edge of a row, and `bg` the 10% tint used behind larger surfaces. The row
 *  used to derive the rail from the tint with `bg.replace("/10", "")`, which
 *  only worked for as long as every tint here happened to end in exactly
 *  "/10": changing one to "/12" would have silently painted a transparent
 *  rail with no type error. Both are stated. */
export function getSeverityInfo(share: Share) {
  const rating = getSafetyRating(share.findings);
  if (rating === "unsafe")
    return {
      label: "Exploitable",
      color: "text-[hsl(var(--severity-critical))]",
      bg: "bg-[hsl(var(--severity-critical))]/10",
      rail: "bg-[hsl(var(--severity-critical))]",
      icon: ShieldAlert,
    };
  if (rating === "caution")
    return {
      label: "Caution",
      color: "text-[hsl(var(--severity-medium))]",
      bg: "bg-[hsl(var(--severity-medium))]/10",
      rail: "bg-[hsl(var(--severity-medium))]",
      icon: AlertTriangle,
    };
  return {
    label: "Clean",
    color: "text-[hsl(var(--success))]",
    bg: "bg-[hsl(var(--success))]/10",
    rail: "bg-[hsl(var(--success))]",
    icon: CheckCircle2,
  };
}

export function getShareUrl(token: string): string {
  if (typeof window === "undefined") return `/shared/${token}`;
  return `${window.location.origin}/shared/${token}`;
}
