import { createHash } from "node:crypto";
import pool from "@/lib/database/db";

/**
 * The little bit of a shared report that the head and the social card need:
 * which host was scanned, when, and how the findings broke down by severity.
 *
 * Deliberately NOT a second copy of app/api/v3/shared/[token]/route.ts. That
 * route returns the whole report; this reads three columns for the two things
 * that render before the page does (generateMetadata in ./layout.tsx and
 * ./opengraph-image.tsx), because both of those run on the server before the
 * client component has fetched anything.
 *
 * The privacy math is the same as the route's: whoever is asking already holds
 * the token, and the token grants the full report, so putting the hostname and
 * the severity counts in the head leaks nothing the link does not already
 * grant. A token that misses, has expired, or has been revoked resolves to
 * null and both callers fall back to generic copy, so an invalid link still
 * says nothing about whether it ever existed.
 */
export interface ShareSummary {
  hostname: string;
  url: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
  scannedAt: Date | null;
}

function countOf(summary: unknown, key: string): number {
  if (!summary || typeof summary !== "object") return 0;
  const value = (summary as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function getShareSummary(
  token: string,
): Promise<ShareSummary | null> {
  if (!token || token.length !== 64) return null;

  // Same SHA-256 lookup the API route uses, against the same generated
  // share_token_hash column, with the same expiry and revocation gates. The
  // plaintext token is never compared directly (AUDIT-004#secrets-01).
  const tokenHash = createHash("sha256").update(token).digest("hex");

  try {
    let result = await pool.query(
      `SELECT sh.url, sh.summary, sh.scanned_at
         FROM scan_history sh
        WHERE sh.share_token_hash = $1
          AND (sh.share_expires_at IS NULL OR sh.share_expires_at > NOW())`,
      [tokenHash],
    );

    // Falls back to the auto-updating host_badges token for the same reason
    // the API route does: a badge link resolves to the latest scan of that
    // host, and the card has to describe the scan the page will show.
    if (result.rows.length === 0) {
      result = await pool.query(
        `SELECT sh.url, sh.summary, sh.scanned_at
           FROM host_badges hb
           JOIN scan_history sh ON sh.url = hb.url
             AND (sh.user_id = hb.user_id OR (hb.scope = 'global' AND sh.is_public = true))
          WHERE hb.badge_token_hash = $1
            AND hb.revoked_at IS NULL
            AND sh.status = 'completed'
          ORDER BY sh.scanned_at DESC
          LIMIT 1`,
        [tokenHash],
      );
    }

    const row = result.rows[0];
    if (!row) return null;

    const url = String(row.url ?? "");
    return {
      hostname: hostnameOf(url),
      url,
      critical: countOf(row.summary, "critical"),
      high: countOf(row.summary, "high"),
      medium: countOf(row.summary, "medium"),
      low: countOf(row.summary, "low"),
      info: countOf(row.summary, "info"),
      total: countOf(row.summary, "total"),
      scannedAt: row.scanned_at ? new Date(row.scanned_at) : null,
    };
  } catch {
    // A database problem must not turn a share link into a 500. Both callers
    // treat null as "use the generic card", which is what shipped before this
    // existed at all.
    return null;
  }
}
