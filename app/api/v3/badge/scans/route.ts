import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Return ALL scans, not just shared ones. Include share_token if it
  // exists, plus site_badge_token: the stable, auto-updating badge token
  // already issued for this URL (if any -- see
  // app/api/v3/badge/site/route.ts), so the badge page can show "you
  // already have a badge for this" instead of offering to create a
  // second, redundant one.
  const result = await pool.query(
    `SELECT sh.id, sh.url, sh.share_token, sh.findings_count, sh.scanned_at, sh.summary, sh.findings,
            hb.badge_token AS site_badge_token
     FROM scan_history sh
     LEFT JOIN host_badges hb
       ON hb.user_id = sh.user_id AND hb.url = sh.url AND hb.revoked_at IS NULL
     WHERE sh.user_id = $1
     ORDER BY sh.scanned_at DESC
     LIMIT 50`,
    [session.userId],
  );

  const scans = result.rows.map((row) => ({
    id: row.id,
    url: row.url,
    share_token: row.share_token,
    site_badge_token: row.site_badge_token,
    findings_count: row.findings_count,
    scanned_at: row.scanned_at,
    summary:
      typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary,
    findings:
      typeof row.findings === "string"
        ? JSON.parse(row.findings)
        : row.findings || [],
  }));

  return NextResponse.json(scans);
}
