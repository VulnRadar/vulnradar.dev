import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES } from "@/lib/constants"

export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  const userId = session.userId

  const userCheck = await pool.query("SELECT disabled_at FROM users WHERE id = $1", [userId])
  if (userCheck.rows[0]?.disabled_at) {
    return ApiResponse.forbidden("Account suspended.")
  }

  const [
    totalScansRes,
    recentScansRes,
    severityBreakdownRes,
    topVulnsRes,
    weeklyActivityRes,
    apiVsWebRes,
    uniqueSitesRes,
  ] = await Promise.all([
    pool.query(
      "SELECT COUNT(*)::int as count FROM scan_history WHERE user_id = $1",
      [userId],
    ),
    pool.query(
      `SELECT id, url, summary, findings_count, duration, scanned_at, source
       FROM scan_history WHERE user_id = $1
       ORDER BY scanned_at DESC LIMIT 5`,
      [userId],
    ),
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
    pool.query(
      `SELECT elem->>'title' as title, elem->>'severity' as severity, COUNT(*)::int as count
       FROM scan_history, jsonb_array_elements(findings) as elem
       WHERE user_id = $1
       GROUP BY elem->>'title', elem->>'severity'
       ORDER BY count DESC
       LIMIT 5`,
      [userId],
    ),
    pool.query(
      `WITH days AS (
        SELECT generate_series(
          (CURRENT_DATE - INTERVAL '13 days')::date,
          CURRENT_DATE::date,
          '1 day'::interval
        )::date AS day
      )
      SELECT days.day::text, COALESCE(COUNT(sh.id), 0)::int as scans
      FROM days
      LEFT JOIN scan_history sh ON DATE(sh.scanned_at) = days.day AND sh.user_id = $1
      GROUP BY days.day
      ORDER BY days.day`,
      [userId],
    ),
    pool.query(
      `SELECT source, COUNT(*)::int as count
       FROM scan_history WHERE user_id = $1
       GROUP BY source`,
      [userId],
    ),
    pool.query(
      `SELECT COUNT(DISTINCT url)::int as count
       FROM scan_history WHERE user_id = $1`,
      [userId],
    ),
  ])

  return ApiResponse.success({
    totalScans: totalScansRes.rows[0]?.count || 0,
    recentScans: recentScansRes.rows,
    severityBreakdown: severityBreakdownRes.rows[0],
    topVulnerabilities: topVulnsRes.rows,
    dailyActivity: weeklyActivityRes.rows.map((row: { day: string; scans: number }) => ({
      day: row.day,
      scans: Number(row.scans) || 0,
      issues: 0,
    })),
    sourceBreakdown: apiVsWebRes.rows,
    uniqueSites: uniqueSitesRes.rows[0]?.count || 0,
  })
})
