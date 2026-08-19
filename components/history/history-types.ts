"use client";

import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

/**
 * One tag on a scan. `source` distinguishes a tag lib/tags/auto-tags.ts
 * derived from the scan's own findings ("auto") from one a user typed in
 * ("user") -- see app/api/v3/scan/tags/route.ts. Auto tags can't be
 * removed through that route, so the UI never shows a remove control on
 * one (see components/history/scan-tags.tsx).
 */
export interface ScanTag {
  tag: string;
  source: "auto" | "user";
}

export interface ScanRecord {
  // Opaque public_id (the list API aliases scan_history.public_id AS id), not
  // the sequential numeric primary key. Carried as-is into ?scan= links, the
  // detail fetch, and the tag body-param, all of which resolve it server-side.
  id: string;
  url: string;
  summary: {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
    info?: number;
    total?: number;
  };
  findings_count: number;
  duration: number;
  scanned_at: string;
  source?: string;
  tags?: ScanTag[];
}

export interface HistoryState {
  scans: ScanRecord[];
  loading: boolean;
  filter: string;
  tagFilter: string | null;
  allTags: string[];
  currentPage: number;
  pageSize: number;
}

export interface ScanDetailState {
  selectedScanId: string | null;
  scanDetail: ScanResult | null;
  detailLoading: boolean;
  selectedIssue: Vulnerability | null;
  scanOwnerId: number | null;
  scanNotes: string;
  editingNotes: boolean;
  savingNotes: boolean;
}

export function formatRelativeTime(dateStr: string) {
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

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function displayUrl(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname + u.search;
    return u.hostname + path;
  } catch {
    return url;
  }
}

export function getDomain(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
