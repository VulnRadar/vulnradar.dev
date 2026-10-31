import { NextResponse } from "next/server";
import { logAction, requireAdmin } from "@/lib/auth/authorization";
import { getClientIp } from "@/lib/api/request-utils";
import {
  performDatabaseCleanup,
  CleanupPassError,
  type CleanupStats,
} from "@/lib/database/cleanup";

/** The per-table counts of a run, as the audit details string carries them. */
function removedSummary(stats: CleanupStats, none: string): string {
  const removed = Object.entries(stats)
    .filter(([, count]) => Number(count) > 0)
    .map(([table, count]) => `${table}: ${count}`);
  return removed.length > 0 ? removed.join(", ") : none;
}

/**
 * The one staff action that deletes rows from admin_audit_log itself, and it
 * was the only state-changing admin endpoint that wrote nothing to it. A forced
 * run past the retention windows destroys scan history, sessions and audit rows
 * across roughly fifteen tables, so who asked for it and what it removed has to
 * survive the run. The per-table counts go in the details string because the
 * interval job that normally does this work reports the same numbers only to
 * the server log, which rotates.
 *
 * Best-effort: the prune has already run by the time this executes, so a failed
 * audit write must not be reported back as a failed cleanup.
 */
async function recordRun(adminId: number, details: string): Promise<void> {
  try {
    await logAction(
      adminId,
      null,
      "database_cleanup_run",
      details,
      await getClientIp(),
    );
  } catch (auditErr) {
    console.error(
      "[admin/cleanup] Failed to write audit log for database_cleanup_run (non-fatal):",
      auditErr,
    );
  }
}

/**
 * POST /api/v3/admin/cleanup
 *
 * On-demand trigger for the database cleanup job. The in-process
 * `setInterval` in instrumentation.ts runs cleanup every 5 minutes
 * (see lib/database/cleanup.ts); this endpoint exists so a staff
 * member can force a run from the admin UI without waiting.
 *
 * Cleanup deletes:
 *   - password_reset_tokens (TTL 1h)
 *   - email_verification_tokens (TTL 24h)
 *   - email_2fa_codes (TTL 10min)
 *   - sessions (past expires_at)
 *   - device_trust entries (TTL 30d)
 *   - rate_limit rows (older than 1 day)
 *   - revoked api_keys (older than 30 days)
 *   - subdomain_cache (older than 4h)
 *   - access_rules stale hit_count
 *   - security_alerts (180d)
 *   - scan_history per-plan retention
 *   - data_requests, admin_audit_log, admin_user_notes,
 *     staff_activity (365d)
 *   - gifted_subscriptions (90d past expiry)
 *   - system_error_logs (30d)
 *
 * Auth: full admin. Cleanup permanently deletes scan history past
 * retention, audit logs, sessions, and tokens, so it is admin-only (not the
 * support-tier floor it used to allow) and, via requireAdmin, also honors
 * ENFORCE_STAFF_2FA. CSRF middleware applies (same-origin POST).
 */
export async function POST() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  try {
    const stats = await performDatabaseCleanup();
    await recordRun(
      admin.id,
      `Ran database cleanup on demand (${removedSummary(stats, "nothing to remove")})`,
    );
    return NextResponse.json({ success: true, stats });
  } catch (err) {
    console.error("[admin/cleanup] Cleanup failed:", err);
    // A pass that ran to the end with some prunes failing has still deleted
    // everything the others reached. It is answered as a failure, but it is
    // recorded like any other run, with how many prunes failed.
    if (err instanceof CleanupPassError) {
      await recordRun(
        admin.id,
        `Ran database cleanup on demand, ${err.errors.length} prune(s) failed (${removedSummary(err.stats, "nothing removed")})`,
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: "Cleanup failed; see server logs.",
      },
      { status: 500 },
    );
  }
}
