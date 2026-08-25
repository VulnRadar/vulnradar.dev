import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/authorization";
import { performDatabaseCleanup } from "@/lib/database/cleanup";

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
