import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { fetchCheckFeedbackVerdicts } from "@/lib/scanner/check-accuracy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enough ids for an export of the whole filtered table, not unbounded. */
const MAX_CHECK_IDS = 100;
const DEFAULT_PER_CHECK = 25;
const MAX_PER_CHECK = 100;

/**
 * GET /api/v3/admin/engine-feedback/checks/verdicts?checkId=a&checkId=b&perCheck=25
 *
 * The individual verdicts behind a Check Accuracy row: which URL the
 * finding was on, what the submitter called it, and any note they left.
 * scan_finding_feedback has always stored all three; the panel only ever
 * showed the counts, which is the difference between "this check is bad"
 * and "this check misfires on order numbers".
 *
 * Loaded on demand (one check when a row is expanded, the filtered set
 * when exporting) rather than alongside the table, and capped per check,
 * so a check with hundreds of verdicts cannot bloat the response.
 *
 * finding_url and notes are written by whoever submitted the feedback.
 * They are returned as plain strings and the UI renders them as text
 * only: no linkification, so a staff member cannot be walked into
 * visiting a URL somebody planted here.
 */
export async function GET(request: NextRequest) {
  const admin = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_ENGINE_FEEDBACK,
  );
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const checkIds = Array.from(
    new Set(
      searchParams
        .getAll("checkId")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_CHECK_IDS);

  if (checkIds.length === 0) {
    return NextResponse.json(
      { error: "At least one checkId is required." },
      { status: 400 },
    );
  }

  const requestedPerCheck = Number(searchParams.get("perCheck"));
  const perCheck =
    Number.isFinite(requestedPerCheck) && requestedPerCheck > 0
      ? Math.min(Math.floor(requestedPerCheck), MAX_PER_CHECK)
      : DEFAULT_PER_CHECK;

  try {
    const byCheck = await fetchCheckFeedbackVerdicts(checkIds, perCheck);
    return NextResponse.json({
      perCheck,
      verdicts: Object.fromEntries(byCheck),
    });
  } catch (error) {
    console.error(
      "[admin/engine-feedback/checks/verdicts] Failed to load verdicts:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to load check verdicts." },
      { status: 500 },
    );
  }
}
