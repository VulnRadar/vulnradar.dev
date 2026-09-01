// Pure formatting helpers. Zero side effects, zero imports beyond
// the local types module. Safe to use in popup, options, content, and
// background contexts.

import { SEVERITY_HEX, SEVERITY_RANK } from "./types";
import type { NotificationThreshold, Severity } from "./types";

/** Hex color for a severity (matches the live app's --severity-* vars). */
export function severityHex(s: Severity): string {
  return SEVERITY_HEX[s];
}

/** Comparable rank (critical > high > medium > low > info). */
export function severityRank(s: Severity): number {
  return SEVERITY_RANK[s];
}

/**
 * The notification threshold rule, in one place. The background worker's
 * shouldNotify() used to hand-roll this with its own severity rank map, so
 * the same rule existed twice and a change to one copy would never reach the
 * other. Typed against NotificationThreshold rather than a repeated inline
 * union, so adding a threshold level to the settings type breaks here too.
 */
export function meetsThreshold(
  findingSeverity: Severity,
  threshold: NotificationThreshold,
): boolean {
  if (threshold === "off") return false;
  if (threshold === "all") return true;
  return severityRank(findingSeverity) >= severityRank(threshold);
}

const DURATION_UNITS: readonly {
  readonly ms: number;
  readonly suffix: string;
}[] = [
  { ms: 60_000, suffix: "m" },
  { ms: 1_000, suffix: "s" },
];

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  for (const u of DURATION_UNITS) {
    if (ms >= u.ms) {
      const n = ms / u.ms;
      return `${n.toFixed(n >= 10 ? 0 : 1)}${u.suffix}`;
    }
  }
  return `${ms}ms`;
}

const COMPACT_NUMBER = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCount(n: number): string {
  return COMPACT_NUMBER.format(n);
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Math.round((now - t) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.round(diff / 86_400)}d ago`;
  return new Date(t).toLocaleDateString();
}

export function truncateUrl(s: string, max: number = 48): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "\u2026";
}
