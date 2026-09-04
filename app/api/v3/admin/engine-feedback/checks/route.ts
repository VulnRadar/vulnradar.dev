import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { getCheckDef } from "@/lib/scanner/registry";
import { getAsyncCheckDef } from "@/lib/scanner/async-check-catalog";
import { getSetting } from "@/lib/config/runtime-config";
import {
  aggregateCheckAccuracy,
  assessCheckAccuracy,
} from "@/lib/scanner/check-accuracy";

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
  /** Never confirmed, and reported false often enough for its severity. */
  neverConfirmed: boolean;
  /** Severity-weighted Wilson lower bound. The default row order. */
  priority: number;
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
 *
 * Check definitions come from two registries, not one. Most ids resolve
 * through getCheckDef (lib/scanner/checks-data/*.json), but the async
 * layer builds its findings in code with ids derived from the finding
 * title (`async-<slug>`), which are in no JSON file. Those used to fall
 * through to null and render as "Category: Unknown, Severity: Unknown"
 * for around 25 rows; getAsyncCheckDef resolves them against the catalog
 * those findings are actually built from.
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
        const def = getCheckDef(checkId) ?? getAsyncCheckDef(checkId);
        const severity = def?.severity ?? null;
        return {
          checkId,
          title: def?.title ?? checkId,
          category: def?.category ?? null,
          severity,
          confirmed: counts.confirmed,
          falsePositive: counts.falsePositive,
          notApplicable: counts.notApplicable,
          total: counts.total,
          falsePositiveRate: counts.falsePositiveRate,
          ...assessCheckAccuracy(counts, severity, {
            thresholdPercent,
            minSampleSize,
          }),
        };
      },
    );

    // Priority first, not raw false-positive rate: sorting by rate put
    // every n=1 report at 100% above every check with real evidence
    // behind it. Rate is still a sortable column in the table.
    checks.sort(
      (a, b) =>
        b.priority - a.priority ||
        b.falsePositiveRate - a.falsePositiveRate ||
        b.total - a.total,
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
