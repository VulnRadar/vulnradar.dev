import { NextResponse } from "next/server";
import {
  logAction,
  requireAdmin,
  requirePermission,
} from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { getClientIp } from "@/lib/api/request-utils";
import { withErrorHandling } from "@/lib/api/api-utils";
import { logError } from "@/lib/logging/log";
import {
  staleScanGraceSeconds,
  sweepStaleScans,
} from "@/lib/scanner/scan-jobs";
import {
  FAILED_SAMPLE_LIMIT,
  INFLIGHT_LIMIT,
  readFailureSample,
  readInflight,
  readQueueSnapshot,
} from "@/lib/scanner/queue-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many swept scan ids the audit row names; a flood is a count. */
const AUDIT_NAMED_SCANS = 20;

/**
 * GET /api/v3/admin/queue-status
 *
 * AUDIT-010 admin-feature-gap: there was no way for an operator to tell
 * "is the scanner backed up right now" without direct DB access. One
 * grouped COUNT(*) over scan_history, plus the oldest pending/running row's
 * age, answers that. Powers
 * components/admin/features/queue-status-manager.tsx. The queries themselves
 * are in lib/scanner/queue-status.ts, where the integration tier can run them.
 *
 * "Failed" is the scanner's own failures only. A cancel, a limit that turned a
 * URL away, a URL a batch never reached and a target that was down each have
 * their own count: the product working is not an incident, and an incident
 * must not hide among the cancels.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const admin = await requirePermission(STAFF_PERMISSIONS.VIEW_SYSTEM_STATS);
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  // Opt-in, and deliberately not part of the polled payload.
  //
  // The card behind this polls every 45 seconds, and the counts above are
  // aggregate: they name no user and no target. The failure rows are the
  // opposite - a URL somebody scanned, tied to their user id - so shipping
  // them on every poll would put customer targets on the wire continuously
  // to render a section that is collapsed most of the time. The operator
  // asks for them when they open the list, and not before. The in-flight
  // list is the same: a URL and a user id per row.
  const params = new URL(request.url).searchParams;
  const wantFailures = params.get("failures") === "1";
  const wantInflight = params.get("inflight") === "1";

  try {
    const { counts, oldestPendingAt, oldestRunningAt } =
      await readQueueSnapshot();

    const now = Date.now();
    const ageMs = (at: string | null) =>
      at ? Math.max(0, now - new Date(at).getTime()) : null;

    // error_message is returned RAW, which is the deliberate part. The
    // sanitizer in lib/api/scan-error-message.ts exists because the scan
    // pipeline persists `error.message` verbatim and that string can name an
    // internal host, port or table; it is applied where the row is shown to
    // the person who RAN the scan. Its docblock says the raw string stays in
    // the row "which is where an operator debugging the failure should be
    // looking anyway", and this is that surface. Collapsing a pg driver error
    // to "an internal error occurred" here would hide exactly the detail the
    // reader is here for, from a reader who already holds
    // VIEW_SYSTEM_STATS. Do not route this through publicScanErrorMessage.
    //
    // Same reason the response carries user_id and not an email: an operator
    // triaging a spike needs to know whether it is one account or fifty, and
    // an id answers that. Putting a name to the id is VIEW_USERS' job, in the
    // Users tab, and joining users here would quietly widen what this
    // endpoint's own permission grants.
    const failures = wantFailures ? await readFailureSample() : undefined;
    const inflight = wantInflight ? await readInflight() : undefined;

    return NextResponse.json({
      counts,
      oldestPendingAgeMs: ageMs(oldestPendingAt),
      oldestRunningAgeMs: ageMs(oldestRunningAt),
      recentWindowHours: 24,
      generatedAt: new Date(now).toISOString(),
      ...(failures
        ? {
            failures: failures.map((row) => ({
              id: row.id,
              userId: row.user_id,
              url: row.url,
              error: row.error_message,
              kind: row.failure_kind ?? null,
              source: row.source,
              durationMs: row.duration,
              failedAt: row.scanned_at,
            })),
            failuresTruncated: failures.length === FAILED_SAMPLE_LIMIT,
          }
        : {}),
      ...(inflight
        ? {
            inflight: inflight.map((row) => ({
              id: row.id,
              userId: row.user_id,
              url: row.url,
              source: row.source,
              status: row.status,
              startedAt: row.started_at,
              currentCategory: row.current_category,
            })),
            inflightTruncated: inflight.length === INFLIGHT_LIMIT,
          }
        : {}),
    });
  } catch (error) {
    logError("admin", "failed to fetch the scanner queue status", error);
    return NextResponse.json(
      { error: "Failed to fetch scanner queue status." },
      { status: 500 },
    );
  }
});

/**
 * POST /api/v3/admin/queue-status
 *
 * Fails the pending and running scans that are past the stale-scan grace
 * period, on demand. The card above flags a stuck scan, and clearing one used
 * to mean waiting for the sweep timer or a restart, or editing scan_history by
 * hand. This runs that same sweep, so it can never fail a scan the timer
 * would have left alone: only rows older than staleScanGraceSeconds, which is
 * twice the longest configured scan budget.
 *
 * Admin only, like the database cleanup beside it: it ends other users'
 * scans. CSRF middleware applies (same-origin POST). Audit-logged
 * best-effort, since the sweep has already run.
 */
export const POST = withErrorHandling(async () => {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  try {
    const [sweptRows, graceSeconds] = await Promise.all([
      sweepStaleScans("admin"),
      staleScanGraceSeconds(),
    ]);
    const swept = sweptRows.length;
    // The ids, so the audit row says which scans were closed and not only how
    // many (the timer's sweep names them in the error log for the same reason).
    // Ids only: a URL is a customer's target.
    const named = sweptRows
      .slice(0, AUDIT_NAMED_SCANS)
      .map((row) => `#${row.id}`)
      .join(", ");
    try {
      await logAction(
        admin.id,
        null,
        "sweep_stale_scans",
        `Failed ${swept} stale scan(s) older than ${graceSeconds}s on demand` +
          (swept > 0
            ? `: ${named}${swept > AUDIT_NAMED_SCANS ? `, and ${swept - AUDIT_NAMED_SCANS} more` : ""}`
            : ""),
        await getClientIp(),
      );
    } catch (auditErr) {
      logError(
        "admin",
        "failed to write the audit log for sweep_stale_scans (non-fatal)",
        auditErr,
      );
    }
    return NextResponse.json({ swept, graceSeconds });
  } catch (error) {
    logError("admin", "stale scan sweep failed", error);
    return NextResponse.json(
      { error: "Failed to clear stale scans." },
      { status: 500 },
    );
  }
});
