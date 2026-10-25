import { NextResponse } from "next/server";
import { logAction, requireAdmin } from "@/lib/auth/authorization";
import { getClientIp } from "@/lib/api/request-utils";
import { withErrorHandling } from "@/lib/api/api-utils";
import { logError } from "@/lib/logging/log";
import { recordScanFailure, requestCancel } from "@/lib/scanner/scan-jobs";
import { SCAN_ADMIN_CANCELLED_MESSAGE } from "@/lib/scanner/failure-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** scan_history.id is an int4; anything past it cannot be a real row. */
const MAX_SCAN_ID = 2_147_483_647;

function parseScanId(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{1,10}$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_SCAN_ID ? n : null;
}

/**
 * POST /api/v3/admin/queue-status/cancel   { scanId }
 *
 * Stops one pending or running scan from the admin queue. The queue could say
 * how many scans were running and only offer a sweep of the ones past the
 * grace period, so a single stuck scan (or one pointed at a target that
 * should not be hit any longer) meant waiting for the sweep or editing
 * scan_history by hand.
 *
 * Admin only, like the sweep beside it: it ends another person's scan. CSRF
 * middleware applies (same-origin POST). The caller confirms first
 * (components/admin/features/queue-status-manager.tsx), because the owner is
 * watching it fail and nothing undoes this.
 *
 * Order matters. The row is closed FIRST, as admin_cancelled, and the
 * in-process job is told to stop afterwards. The other way round, the job's
 * own catch races this write with a cancel of its own and the row ends up
 * recorded as the owner's cancel instead of staff's. The window the job keeps
 * running for in between is the length of one UPDATE.
 *
 * The row is the authority: if it was not pending or running there is nothing
 * to cancel, and no flag is left behind for a scan that already finished.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Send a JSON body with a scanId." },
      { status: 400 },
    );
  }
  const scanId = parseScanId((body as { scanId?: unknown } | null)?.scanId);
  if (scanId === null) {
    return NextResponse.json(
      { error: "scanId must be a whole number." },
      { status: 400 },
    );
  }

  const cancelled = await recordScanFailure(
    scanId,
    SCAN_ADMIN_CANCELLED_MESSAGE,
    "admin_cancelled",
  );
  if (!cancelled) {
    return NextResponse.json(
      {
        error:
          "That scan is not pending or running, so there is nothing to cancel. It may have just finished.",
      },
      { status: 409 },
    );
  }
  requestCancel(scanId);

  // Best-effort, like the sweep's: the scan is already stopped, and failing
  // the response over the audit row would tell the operator it was not.
  // No URL in the details: it is a customer's target and the audit log only
  // redacts email addresses.
  try {
    await logAction(
      admin.id,
      cancelled.userId,
      "admin_cancel_scan",
      `Scan #${scanId} (${cancelled.source ?? "unknown source"}) cancelled from the queue`,
      await getClientIp(),
    );
  } catch (auditErr) {
    logError(
      "admin",
      "failed to write the audit log for admin_cancel_scan (non-fatal)",
      auditErr,
      { scanId },
    );
  }

  return NextResponse.json({ cancelled: true, scanId });
});
