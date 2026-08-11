import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all shared scans for the current user (where share_token is NOT NULL
  // and, if it has an expiry, that expiry hasn't passed -- an expired link
  // is excluded the same way GET /api/v3/shared/[token] excludes it from a
  // viewer's lookup, so this list only ever shows links that still work).
  const result = await pool.query(
    `SELECT
       id,
       url,
       scanned_at,
       share_token,
       share_expires_at,
       share_publicly_listed,
       summary,
       findings
     FROM scan_history
     WHERE user_id = $1 AND share_token IS NOT NULL
       AND (share_expires_at IS NULL OR share_expires_at > NOW())
     ORDER BY scanned_at DESC`,
    [session.userId],
  );

  const shares = result.rows.map((row) => {
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
      findingsCount: findings.length,
    };
  });

  return NextResponse.json({ shares });
}
