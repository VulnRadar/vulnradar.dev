import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { getCheckDef } from "@/lib/scanner/registry";
import { getSetting } from "@/lib/config/runtime-config";
import { aggregateCheckAccuracy } from "@/lib/scanner/check-accuracy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface CheckAccuracyEntry {
  checkId: string;
  title: string;
  category: string | null;
  severity: string | null;
  confirmed: number;
  falsePositive: number;
  notApplicable: number;
  total: number;
  /** 0-100, one decimal place. */
  falsePositiveRate: number;
  flagged: boolean;
}

/**
 * GET /api/v3/admin/engine-feedback/checks
 *
 * Powers the "Check Accuracy" table on the admin Engine Feedback panel.
 * The underlying aggregation (lib/scanner/check-accuracy.ts) is shared
 * with lib/scanner/adaptive-confidence.ts, which -- unlike this read-only
 * admin view -- DOES apply it automatically, discounting a finding's
 * confidence for a check flagged here as having a real false-positive
 * rate. This route stays a live read, not a cache: the admin panel wants
 * up-to-the-second numbers, not the confidence pass's TTL-cached snapshot.
 */
export async function GET() {
  const admin = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_ENGINE_FEEDBACK,
  );
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const [thresholdPercent, minSampleSize] = await Promise.all([
    getSetting("ENGINE_FEEDBACK_NOISE_THRESHOLD_PERCENT"),
    getSetting("ENGINE_FEEDBACK_MIN_SAMPLE_SIZE"),
  ]);

  try {
    const byCheck = await aggregateCheckAccuracy();

    const checks: CheckAccuracyEntry[] = Array.from(byCheck.entries()).map(
      ([checkId, counts]) => {
        const def = getCheckDef(checkId);
        return {
          checkId,
          title: def?.title ?? checkId,
          category: def?.category ?? null,
          severity: def?.severity ?? null,
          confirmed: counts.confirmed,
          falsePositive: counts.falsePositive,
          notApplicable: counts.notApplicable,
          total: counts.total,
          falsePositiveRate: counts.falsePositiveRate,
          flagged:
            counts.total >= minSampleSize &&
            counts.falsePositiveRate >= thresholdPercent,
        };
      },
    );

    checks.sort(
      (a, b) => b.falsePositiveRate - a.falsePositiveRate || b.total - a.total,
    );

    return NextResponse.json({ checks, thresholdPercent, minSampleSize });
  } catch (error) {
    console.error(
      "[admin/engine-feedback/checks] Failed to aggregate check feedback:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to load check feedback." },
      { status: 500 },
    );
  }
}
