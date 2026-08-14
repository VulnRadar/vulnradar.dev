"use client";

import type { SafetyRating } from "@/lib/scanner/safety-rating";

/** One row of GET /api/v3/assets -- see that route for the exact shape. */
export interface AssetRow {
  host: string;
  scanCount: number;
  latestScanId: number;
  latestUrl: string;
  latestScannedAt: string;
  findingsCount: number;
  summary: {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
    info?: number;
  };
  safetyRating: SafetyRating;
}

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

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
