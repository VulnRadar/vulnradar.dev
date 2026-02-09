import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.userId

  // Check if account is disabled
  const userCheck = await pool.query("SELECT disabled_at FROM users WHERE id = $1", [userId])
  if (userCheck.rows[0]?.disabled_at) {
    return NextResponse.json({ error: "Account suspended." }, { status: 403 })
  }

  // Run all queries in parallel
  const [totalScansRes, recentScansRes, severityBreakdownRes, topVulnsRes, weeklyActivityRes, apiVsWebRes, uniqueSitesRes] =
    await Promise.all([
      // Total scans
      pool.query("SELECT COUNT(*)::int as count FROM scan_history WHERE user_id = $1", [userId]),
      // Recent 5 scans
      pool.query(
        `SELECT id, url, summary, findings_count, duration, scanned_at, source
         FROM scan_history WHERE user_id = $1
         ORDER BY scanned_at DESC LIMIT 5`,
        [userId],
      ),
      // Severity breakdown across all scans
      pool.query(
        `SELECT
          COALESCE(SUM((summary->>'critical')::int), 0)::int as critical,
          COALESCE(SUM((summary->>'high')::int), 0)::int as high,
          COALESCE(SUM((summary->>'medium')::int), 0)::int as medium,
          COALESCE(SUM((summary->>'low')::int), 0)::int as low,
          COALESCE(SUM((summary->>'info')::int), 0)::int as info
        FROM scan_history WHERE user_id = $1`,
        [userId],
      ),
      // Top vulnerability titles from findings
      pool.query(
        `SELECT elem->>'title' as title, elem->>'severity' as severity, COUNT(*)::int as count
         FROM scan_history, jsonb_array_elements(findings) as elem
         WHERE user_id = $1
         GROUP BY elem->>'title', elem->>'severity'
         ORDER BY count DESC
         LIMIT 5`,
        [userId],
      ),
      // Daily scan activity (last 14 days)
      pool.query(
        `WITH days AS (
          SELECT generate_series(
            (CURRENT_DATE - INTERVAL '13 days')::date,
            CURRENT_DATE::date,
            '1 day'::interval
          )::date AS day
        )
        SELECT
          days.day::text as day,
          COALESCE(COUNT(sh.id), 0)::int as scans,
          COALESCE(SUM(sh.findings_count), 0)::int as issues
        FROM days
        LEFT JOIN scan_history sh
          ON date_trunc('day', sh.scanned_at)::date = days.day
          AND sh.user_id = $1
        GROUP BY days.day
        ORDER BY days.day ASC`,
        [userId],
      ),
      // API vs Web breakdown
      pool.query(
        `SELECT
          COALESCE(source, 'web') as source,
          COUNT(*)::int as count
        FROM scan_history WHERE user_id = $1
        GROUP BY source`,
        [userId],
      ),
      // Unique sites scanned
      pool.query(
        `SELECT COUNT(DISTINCT
          CASE
            WHEN url ~ '^https?://' THEN substring(url from '://([^/]+)')
            ELSE url
          END
        )::int as count FROM scan_history WHERE user_id = $1`,
        [userId],
      ),
    ])

  return NextResponse.json({
    totalScans: totalScansRes.rows[0].count,
    uniqueSites: uniqueSitesRes.rows[0].count,
    recentScans: recentScansRes.rows,
    severityBreakdown: severityBreakdownRes.rows[0],
    topVulnerabilities: topVulnsRes.rows,
    dailyActivity: weeklyActivityRes.rows,
    sourceBreakdown: apiVsWebRes.rows,
  })
}
