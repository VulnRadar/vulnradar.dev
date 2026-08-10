import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { getSettings } from "@/lib/config/runtime-config";
import type { SettingKey } from "@/lib/config/registry";

// billing: mirrors app/api/v3/history/route.ts's retention resolution --
// live admin-configured value, not the compiled BILLING_HISTORY_RETENTION
// table, so an admin edit is reflected here (not just in what
// lib/database/cleanup.ts deletes).
const RETENTION_SETTING_KEYS: Record<string, SettingKey> = {
  free: "BILLING_FREE_RETENTION",
  core_supporter: "BILLING_CORE_SUPPORTER_RETENTION",
  pro_supporter: "BILLING_PRO_SUPPORTER_RETENTION",
  elite_supporter: "BILLING_ELITE_SUPPORTER_RETENTION",
};

/**
 * GitHub repo scan history -- deliberately separate from GET /api/v3/history
 * (see that route's exclusion of scan_type = 'github'). This is the backing
 * data for app/repos: past scans of a repo you connected, not mixed into
 * the URL-scan history list.
 *
 * Two shapes depending on whether `repo` is given:
 *   - No `repo`: one row per repo (the latest scan + a total count), for
 *     the repo list view's "last scanned" glance.
 *   - `repo=<owner/name>`: every past scan of that one repo, newest first,
 *     for the per-repo timeline view.
 *
 * Session-only, same as POST /api/v3/scan/github -- no API-key path for
 * this feature yet.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repo = request.nextUrl.searchParams.get("repo")?.trim() || null;

  try {
    const userRes = await pool.query(
      "SELECT plan, role FROM users WHERE id = $1",
      [session.userId],
    );
    const userPlan = userRes.rows[0]?.plan || "free";
    const userRole = userRes.rows[0]?.role || "user";
    const isStaff = ["admin", "moderator", "support"].includes(userRole);
    const retentionSettingKey =
      RETENTION_SETTING_KEYS[userPlan] ?? RETENTION_SETTING_KEYS.free;
    const retentionSettings = await getSettings([retentionSettingKey] as const);
    const retentionDays = isStaff
      ? -1
      : Number(retentionSettings[retentionSettingKey]);
    const hasWindow = retentionDays > 0;

    if (repo) {
      const result = await pool.query(
        hasWindow
          ? `SELECT id, summary, findings_count, duration, scanned_at
             FROM scan_history
             WHERE user_id = $1 AND scan_type = 'github' AND url = $2
               AND scanned_at > NOW() - ($3 * INTERVAL '1 day')
             ORDER BY scanned_at DESC
             LIMIT 100`
          : `SELECT id, summary, findings_count, duration, scanned_at
             FROM scan_history
             WHERE user_id = $1 AND scan_type = 'github' AND url = $2
             ORDER BY scanned_at DESC
             LIMIT 100`,
        hasWindow
          ? [session.userId, repo, Math.floor(retentionDays)]
          : [session.userId, repo],
      );
      const scans = result.rows.map((row) => ({
        id: row.id,
        summary: row.summary,
        findingsCount: row.findings_count,
        duration: row.duration,
        scannedAt: row.scanned_at,
      }));
      return NextResponse.json({ scans });
    }

    // Grouped view: latest scan per repo plus how many scans it has on
    // record. ROW_NUMBER/COUNT window functions rather than N queries, one
    // per selected repo.
    const result = await pool.query(
      hasWindow
        ? `WITH ranked AS (
             SELECT id, url, summary, findings_count, duration, scanned_at,
                    COUNT(*) OVER (PARTITION BY url) AS scan_count,
                    ROW_NUMBER() OVER (PARTITION BY url ORDER BY scanned_at DESC) AS rn
             FROM scan_history
             WHERE user_id = $1 AND scan_type = 'github'
               AND scanned_at > NOW() - ($2 * INTERVAL '1 day')
           )
           SELECT id, url, summary, findings_count, duration, scanned_at, scan_count
           FROM ranked WHERE rn = 1
           ORDER BY scanned_at DESC`
        : `WITH ranked AS (
             SELECT id, url, summary, findings_count, duration, scanned_at,
                    COUNT(*) OVER (PARTITION BY url) AS scan_count,
                    ROW_NUMBER() OVER (PARTITION BY url ORDER BY scanned_at DESC) AS rn
             FROM scan_history
             WHERE user_id = $1 AND scan_type = 'github'
           )
           SELECT id, url, summary, findings_count, duration, scanned_at, scan_count
           FROM ranked WHERE rn = 1
           ORDER BY scanned_at DESC`,
      hasWindow
        ? [session.userId, Math.floor(retentionDays)]
        : [session.userId],
    );
    const summaries = result.rows.map((row) => ({
      repo: row.url,
      lastScan: {
        id: row.id,
        summary: row.summary,
        findingsCount: row.findings_count,
        duration: row.duration,
        scannedAt: row.scanned_at,
      },
      scanCount: Number(row.scan_count),
    }));
    return NextResponse.json({ summaries });
  } catch (error) {
    console.error("GitHub repo scan history error:", error);
    return NextResponse.json(
      { error: "Failed to load repo scan history." },
      { status: 500 },
    );
  }
}
