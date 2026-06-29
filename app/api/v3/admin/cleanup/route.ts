import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { performDatabaseCleanup } from "@/lib/database/cleanup";
import pool from "@/lib/database/db";
import { STAFF_ROLE_HIERARCHY } from "@/lib/config/constants";

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
 *
 * Auth: staff session (support role or above). CSRF middleware
 * applies (same-origin POST from the admin UI).
 */
export async function POST(_request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userResult = await pool.query<{ role: string }>(
    "SELECT role FROM users WHERE id = $1",
    [session.userId],
  );
  const role = userResult.rows[0]?.role || "user";
  if ((STAFF_ROLE_HIERARCHY[role] || 0) < (STAFF_ROLE_HIERARCHY.support || 1)) {
    return NextResponse.json(
      { error: "Staff role required." },
      { status: 403 },
    );
  }

  try {
    const stats = await performDatabaseCleanup();
    return NextResponse.json({ success: true, stats });
  } catch (err) {
    console.error("[admin/cleanup] Cleanup failed:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Cleanup failed; see server logs.",
      },
      { status: 500 },
    );
  }
}
