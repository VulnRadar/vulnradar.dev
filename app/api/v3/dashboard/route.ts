import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";

export const GET = withErrorHandling(async () => {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  const userId = session.userId;

  const userCheck = await pool.query(
    "SELECT disabled_at FROM users WHERE id = $1",
    [userId],
  );
  if (userCheck.rows[0]?.disabled_at) {
    return ApiResponse.forbidden("Account suspended.");
  }

  const widgetLimit = await getSetting("DASHBOARD_WIDGET_LIMIT");

  // perf: this used to fan out seven parallel queries, taking 7 of the pool's
  // 10 connections for one page load, so two dashboards loading at once queued
  // and three blocked every other request in the process (login included). The
  // three whole-table aggregates over scan_history (total, unique sites, source
  // split) read the same rows, so they are now one query against one scan of
  // that user's rows instead of three.
  const [
    countsRes,
    recentScansRes,
    severityBreakdownRes,
    topVulnsRes,
    weeklyActivityRes,
  ] = await Promise.all([
    pool.query(
      `WITH base AS (
         SELECT url, source FROM scan_history WHERE user_id = $1
       )
       SELECT
         (SELECT COUNT(*)::int FROM base) AS total_scans,
         (SELECT COUNT(DISTINCT url)::int FROM base) AS unique_sites,
         (SELECT COALESCE(
                   json_agg(json_build_object('source', source, 'count', c)),
                   '[]'::json)
            FROM (SELECT source, COUNT(*)::int AS c FROM base GROUP BY source) s
         ) AS source_breakdown`,
      [userId],
    ),
    pool.query(
      // public_id, aliased to id, so the "Recent scans" widget links to the
      // opaque ?scan= handle the History tab resolves, never the numeric one.
      //
      // `status` is selected so the widget can tell a finished scan from one
      // that is still running or that failed. The row is INSERTed as
      // 'pending' before any work starts and the columns default to
      // summary '{}', findings_count 0, duration 0, so without this a scan
      // still in flight (or a cancelled/watchdog-killed one) rendered
      // identically to a genuinely clean result: "0 findings, 0.0s".
      `SELECT public_id AS id, url, summary, findings_count, duration, scanned_at, source, status
       FROM scan_history WHERE user_id = $1
       ORDER BY scanned_at DESC LIMIT $2`,
      [userId, widgetLimit],
    ),
    pool.query(
      // The dashboard presents this as "Critical and high", i.e. what is
      // wrong with my sites right now. It used to SUM every scan the account
      // had ever run, which made it a lifetime tally that could only ever
      // grow: fixing an issue and rescanning ADDED the rescan's findings on
      // top of the original scan's, so the headline number went UP as the
      // user's posture improved, and it could never return to zero.
      //
      // Current posture is the most recent scan per distinct target. Fixing
      // something and rescanning now replaces that target's contribution, so
      // the number falls the way a user expects.
      `WITH latest_per_target AS (
         SELECT DISTINCT ON (url) url, summary
         FROM scan_history
         WHERE user_id = $1 AND summary IS NOT NULL
         ORDER BY url, scanned_at DESC
       )
       SELECT
        COALESCE(SUM((summary->>'critical')::int), 0)::int as critical,
        COALESCE(SUM((summary->>'high')::int), 0)::int as high,
        COALESCE(SUM((summary->>'medium')::int), 0)::int as medium,
        COALESCE(SUM((summary->>'low')::int), 0)::int as low,
        COALESCE(SUM((summary->>'info')::int), 0)::int as info
      FROM latest_per_target`,
      [userId],
    ),
    pool.query(
      // "Most common findings" ranked across the user's sites. This used to
      // lateral-expand the findings JSONB of EVERY scan the account had ever
      // run: for 500 scans x 150 findings that is 75,000 elements detoasted
      // and expanded per page view, and the LIMIT applies after the GROUP BY
      // so it saved nothing. It was also the wrong number: rescanning one site
      // fifty times counted its unfixed finding fifty times, so the ranking
      // mostly reflected which site was scanned most, not which finding is
      // most common. Ranking the latest scan per distinct target fixes both,
      // and matches how the severity widget above already reads posture.
      `WITH latest_per_target AS (
         SELECT DISTINCT ON (url) findings
         FROM scan_history
         WHERE user_id = $1 AND findings IS NOT NULL
         ORDER BY url, scanned_at DESC
       )
       SELECT elem->>'title' as title, elem->>'severity' as severity, COUNT(*)::int as count
       FROM latest_per_target, jsonb_array_elements(findings) as elem
       GROUP BY elem->>'title', elem->>'severity'
       ORDER BY count DESC
       LIMIT $2`,
      [userId, widgetLimit],
    ),
    pool.query(
      // The join predicate is a range, not DATE(sh.scanned_at) = days.day:
      // wrapping the column in a function made the timestamp half
      // non-sargable, so idx_scan_history_user_scanned could not narrow to the
      // window and Postgres read all of the user's rows to draw two weeks.
      //
      // `issues` is summed here rather than hardcoded. The route used to
      // return issues: 0 for every day, so the tooltip confidently read
      // "N scans - 0 issues" on the main dashboard whatever the user found.
      `WITH days AS (
        SELECT generate_series(
          (CURRENT_DATE - INTERVAL '13 days')::date,
          CURRENT_DATE::date,
          '1 day'::interval
        )::date AS day
      )
      SELECT days.day::text,
             COALESCE(COUNT(sh.id), 0)::int as scans,
             COALESCE(SUM(sh.findings_count), 0)::int as issues
      FROM days
      LEFT JOIN scan_history sh
        ON sh.user_id = $1
       AND sh.scanned_at >= days.day
       AND sh.scanned_at < days.day + INTERVAL '1 day'
      GROUP BY days.day
      ORDER BY days.day`,
      [userId],
    ),
  ]);

  const counts = countsRes.rows[0];

  return ApiResponse.success({
    totalScans: counts?.total_scans || 0,
    recentScans: recentScansRes.rows,
    severityBreakdown: severityBreakdownRes.rows[0],
    topVulnerabilities: topVulnsRes.rows,
    dailyActivity: weeklyActivityRes.rows.map(
      (row: { day: string; scans: number; issues: number }) => ({
        day: row.day,
        scans: Number(row.scans) || 0,
        issues: Number(row.issues) || 0,
      }),
    ),
    sourceBreakdown: counts?.source_breakdown || [],
    uniqueSites: counts?.unique_sites || 0,
  });
});
