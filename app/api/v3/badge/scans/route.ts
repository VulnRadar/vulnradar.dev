import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One row per unique URL, not one row per scan: a badge is keyed to a
  // URL (see app/api/v3/badge/site/route.ts), so re-scanning a URL that
  // already has an entry here should move it to the top with the new
  // scanned_at, not add a second, separate row for what's still the same
  // badge/token. DISTINCT ON (sh.url) picks the single newest scan per URL
  // (its own ORDER BY requires sh.url first, then scanned_at DESC to pick
  // "newest"); the outer query re-sorts that deduped set by recency for
  // display. Includes share_token if it exists, plus site_badge_token: the
  // stable, auto-updating badge token already issued for this URL (if any),
  // so the badge page can show "you already have a badge for this" instead
  // of offering to create a second, redundant one.
  const result = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (sh.url)
              sh.id, sh.url, sh.share_token, sh.findings_count, sh.scanned_at, sh.summary, sh.findings,
              hb.badge_token AS site_badge_token
       FROM scan_history sh
       LEFT JOIN host_badges hb
         ON hb.user_id = sh.user_id AND hb.url = sh.url AND hb.revoked_at IS NULL
       WHERE sh.user_id = $1
       ORDER BY sh.url, sh.scanned_at DESC
     ) latest_per_url
     ORDER BY scanned_at DESC
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
