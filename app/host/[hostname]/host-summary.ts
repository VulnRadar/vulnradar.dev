import pool from "@/lib/database/db";
import { normalizeHostForReputation } from "@/lib/scanner/host-reputation";

/**
 * The head-and-social-card slice of a host report: the hostname, its current
 * danger score, and the severity breakdown. Read here rather than through
 * GET /api/v3/host/[hostname] because generateMetadata and opengraph-image.tsx
 * both run on the server before the page's client component has fetched
 * anything.
 *
 * host_reputation only ever reflects public scans (see the table's own
 * comment in lib/scanner/host-reputation.ts), so nothing this returns is
 * private to the account that ran the scan.
 */
export interface HostSummary {
  host: string;
  dangerScore: number | null;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  lastScannedAt: Date | null;
}

function countOf(counts: unknown, key: string): number {
  if (!counts || typeof counts !== "object") return 0;
  const value = (counts as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function decodeHostParam(rawHostname: string): string {
  try {
    return decodeURIComponent(rawHostname);
  } catch {
    return rawHostname;
  }
}

export async function getHostSummary(
  rawHostname: string,
): Promise<HostSummary | null> {
  const host = normalizeHostForReputation(decodeHostParam(rawHostname));
  if (!host) return null;

  try {
    const result = await pool.query(
      `SELECT danger_score, severity_counts, last_scanned_at
         FROM host_reputation
        WHERE host = $1`,
      [host],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      host,
      dangerScore:
        typeof row.danger_score === "number" ? row.danger_score : null,
      critical: countOf(row.severity_counts, "critical"),
      high: countOf(row.severity_counts, "high"),
      medium: countOf(row.severity_counts, "medium"),
      low: countOf(row.severity_counts, "low"),
      info: countOf(row.severity_counts, "info"),
      lastScannedAt: row.last_scanned_at ? new Date(row.last_scanned_at) : null,
    };
  } catch {
    // A database problem must not turn the host page into a 500; both callers
    // fall back to the generic card.
    return null;
  }
}
