"use client";

import type { SafetyRating } from "@/lib/scanner/safety-rating";
import type { ScanTag } from "@/components/history/history-types";

/** One row of GET /api/v3/public-scans -- see that route for the exact
 *  shape. Deliberately does not include the full findings array: the
 *  verdict is computed server-side so the directory payload stays light. */
export interface PublicScan {
  token: string;
  url: string;
  scannedAt: string;
  verdict: SafetyRating;
  summary: {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
    info?: number;
  };
  findingsCount: number;
  scannedBy: string;
  scannedByAvatar: string | null;
  scannedByRole: string;
  tags: ScanTag[];
}

export const VERDICT: Record<
  SafetyRating,
  { label: string; rail: string; text: string }
> = {
  safe: {
    label: "No exploitable issues found",
    rail: "bg-[hsl(var(--success))]",
    text: "text-[hsl(var(--success))]",
  },
  caution: {
    label: "Review before trusting this host",
    rail: "bg-[hsl(var(--severity-medium))]",
    text: "text-[hsl(var(--severity-medium))]",
  },
  unsafe: {
    label: "Actively exploitable issues found",
    rail: "bg-[hsl(var(--severity-critical))]",
    text: "text-[hsl(var(--severity-critical))]",
  },
};

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname + u.search;
    return u.hostname + path;
  } catch {
    return url;
  }
}
