import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { RATING_FINDINGS_SQL } from "@/lib/scanner/rating-findings-sql";

/**
 * Well above what anyone keeps live, because the list is also where a share
 * gets revoked: the cap is there to bound one request, not to page the list.
 */
const SHARES_LIST_MAX = 500;

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all shared scans for the current user (where share_token is NOT NULL
  // and, if it has an expiry, that expiry hasn't passed -- an expired link
  // is excluded the same way GET /api/v3/shared/[token] excludes it from a
  // viewer's lookup, so this list only ever shows links that still work).
  // perf: this used to SELECT the whole findings JSONB -- every finding
  // object with its description, explanation, fixSteps and codeExamples --
  // for an UNBOUNDED number of the user's shares, purely so the page could
  // call getSafetyRating() and take an array length. That reads and
  // detoasts tens of MB for a list of one-line rows. getSafetyRating only
  // looks at title, severity, aiVerdict and aiConfidence, so project exactly
  // those four in SQL and leave the rest on disk, the same shape
  // app/api/v3/public-scans/route.ts already uses. The count comes from the
  // findings_count column rather than the array length, so it no longer
  // depends on having loaded the array at all.
  //
  // Ordered and filtered to match idx_scan_history_user_shared, so this reads
  // the account's shares and not every scan it has run. One past the cap, so
  // `truncated` can tell "exactly the cap" from "more than the cap".
  const result = await pool.query(
    `SELECT
       id,
       url,
       scanned_at,
       share_token,
       share_expires_at,
       share_publicly_listed,
       summary,
       findings_count,
       ${RATING_FINDINGS_SQL} AS findings
     FROM scan_history
     WHERE user_id = $1 AND share_token IS NOT NULL
       AND (share_expires_at IS NULL OR share_expires_at > NOW())
     ORDER BY scanned_at DESC
     LIMIT $2`,
    [session.userId, SHARES_LIST_MAX + 1],
  );

  const shares = result.rows.slice(0, SHARES_LIST_MAX).map((row) => {
    const findings =
      typeof row.findings === "string"
        ? JSON.parse(row.findings)
        : row.findings || [];
    const summary =
      typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary;
    return {
      id: row.id,
      url: row.url,
      scannedAt: row.scanned_at,
      token: row.share_token,
      expiresAt: row.share_expires_at,
      // Public Scans directory listing for this one share -- independent
      // of scan_history.is_public. See lib/scanner/share-privacy.ts.
      publiclyListed: row.share_publicly_listed !== false,
      summary,
      findings,
      findingsCount: Number(row.findings_count) || findings.length,
    };
  });

  return NextResponse.json({
    shares,
    limit: SHARES_LIST_MAX,
    truncated: result.rows.length > SHARES_LIST_MAX,
  });
}
