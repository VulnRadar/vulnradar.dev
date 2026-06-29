import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { performDatabaseCleanup } from "@/lib/database/cleanup";
import { checkRateLimit } from "@/lib/rate-limiting/rate-limit";
import { getClientIp } from "@/lib/api/request-utils";
import pool from "@/lib/database/db";
import { STAFF_ROLE_HIERARCHY } from "@/lib/config/constants";

/**
 * POST /api/v3/admin/cleanup
 *
 * Triggers performDatabaseCleanup() which expires and deletes:
 *   - password_reset_tokens (TTL 1h)
 *   - email_verification_tokens (TTL 24h)
 *   - email_2fa_codes (TTL 10min)
 *   - email-2fa pending cookie (5min)
 *   - device_trust entries (TTL 30d)
 *   - sessions (past expires_at)
 *   - rate_limit rows (older than 1 day)
 *   - revoked api_keys (older than 30 days)
 *   - subdomain_cache (older than 4h)
 *   - access_rules stale hit_count
 *   - security_alerts (180d)
 *   - scan_history per-plan retention
 *   - data_requests, admin_audit_log, admin_user_notes, staff_activity (365d)
 *   - gifted_subscriptions (90d past expiry)
 *
 * Authentication: either (a) a logged-in staff session, or (b) a
 * static header `X-Cron-Key: $CLEANUP_API_KEY`. The header path
 * exists so an external cron (GitHub Actions) can drive cleanup
 * without holding a session cookie — important for serverless
 * deployments where the in-process setInterval cleanup never fires.
 *
 * Rate-limited to 1 request per minute per IP for the header path
 * (cron callers should pass a deterministic key; we treat unknown
 * callers conservatively).
 */
export async function POST(request: NextRequest) {
  const cronKey = request.headers.get("x-cron-key");
  const configuredKey = process.env.CLEANUP_API_KEY;

  // Two auth paths:
  //   1. Header-based: for external cron (GH Actions, k8s CronJob, ...)
  //   2. Session-based: for in-app admin "Run cleanup now" button
  let authorized = false;
  let authMethod: "header" | "session" | null = null;

  if (configuredKey && cronKey && cronKey === configuredKey) {
    authorized = true;
    authMethod = "header";
  } else if (!configuredKey && !cronKey) {
    // No CLEANUP_API_KEY configured — fall through to session check
    // (development convenience).
  } else if (configuredKey && !cronKey) {
    // CLEANUP_API_KEY is set but caller didn't provide one — fall
    // through to session check (admin still works in the UI).
  } else if (!configuredKey && cronKey) {
    // Caller sent a key but none is configured — reject.
    return NextResponse.json(
      { error: "X-Cron-Key provided but CLEANUP_API_KEY is not set." },
      { status: 401 },
    );
  } else {
    // Both provided, but mismatch.
    return NextResponse.json({ error: "Invalid X-Cron-Key." }, { status: 401 });
  }

  if (!authorized) {
    // Try session auth.
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userResult = await pool.query<{ role: string }>(
      "SELECT role FROM users WHERE id = $1",
      [session.userId],
    );
    const role = userResult.rows[0]?.role || "user";
    if (
      (STAFF_ROLE_HIERARCHY[role] || 0) < (STAFF_ROLE_HIERARCHY.support || 1)
    ) {
      return NextResponse.json(
        { error: "Staff role required." },
        { status: 403 },
      );
    }
    authorized = true;
    authMethod = "session";
  }

  // Rate limit the header path conservatively (1/min/IP). The session
  // path is throttled by the per-user admin rate limit.
  if (authMethod === "header") {
    const ip = (await getClientIp()) || "unknown";
    const rl = await checkRateLimit({
      key: `cleanup-cron:${ip}`,
      // 1 request per minute per IP. The cron should be hitting from
      // GitHub's outbound IP range, which is a small pool — collisions
      // are unlikely.
      maxAttempts: 1,
      windowSeconds: 60,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: "Rate limited; cleanup cron can retry in 60s.",
        },
        { status: 429 },
      );
    }
  }

  try {
    const stats = await performDatabaseCleanup();
    return NextResponse.json({
      success: true,
      authMethod,
      stats,
    });
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
