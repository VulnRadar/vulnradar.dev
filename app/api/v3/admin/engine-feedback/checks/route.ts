import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { requireAdmin } from "@/lib/auth/authorization";
import { getCheckDef } from "@/lib/scanner/registry";
import { getSetting } from "@/lib/config/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FeedbackVerdictRow {
  finding_id: string;
  verdict: "confirmed" | "false_positive" | "not_applicable";
  count: number;
}

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
 * Everything before the LAST "--" in a stable finding id
 * (`<checkId>--<hash>`, see lib/scanner/_helpers.ts's generateId). Using
 * the last occurrence, not the first, is defensive rather than load-
 * bearing today -- no check id in lib/scanner/checks-data/*.json currently
 * contains a literal "--" -- but it is what the id format actually
 * guarantees: the hash is everything after the final separator.
 */
function extractCheckId(findingId: string): string {
  const idx = findingId.lastIndexOf("--");
  return idx === -1 ? findingId : findingId.slice(0, idx);
}

/**
 * GET /api/v3/admin/engine-feedback/checks
 *
 * Aggregates scan_finding_feedback (already collected app-wide via
 * POST /api/v3/scan/feedback, but never rolled up before this) into a
 * per-check false-positive rate: across every user's feedback, what
 * fraction of instances of this check got marked false_positive vs
 * confirmed vs not_applicable. Powers the "Check Accuracy" table on the
 * admin Engine Feedback panel -- a human-in-the-loop signal for retuning
 * lib/scanner/checks-data/*.json, never applied automatically.
 *
 * A live GROUP BY on read, not a materialized table: feedback row counts
 * here are nowhere near the volume that would justify precomputation.
 */
export async function GET() {
  const admin = await requireAdmin();
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
    const result = await pool.query<FeedbackVerdictRow>(
      `SELECT finding_id, verdict, COUNT(*)::int AS count
       FROM scan_finding_feedback
       GROUP BY finding_id, verdict`,
    );

    const byCheck = new Map<
      string,
      { confirmed: number; falsePositive: number; notApplicable: number }
    >();
    for (const row of result.rows) {
      const checkId = extractCheckId(row.finding_id);
      const entry = byCheck.get(checkId) ?? {
        confirmed: 0,
        falsePositive: 0,
        notApplicable: 0,
      };
      if (row.verdict === "confirmed") entry.confirmed += row.count;
      else if (row.verdict === "false_positive")
        entry.falsePositive += row.count;
      else if (row.verdict === "not_applicable")
        entry.notApplicable += row.count;
      byCheck.set(checkId, entry);
    }

    const checks: CheckAccuracyEntry[] = Array.from(byCheck.entries()).map(
      ([checkId, counts]) => {
        const total =
          counts.confirmed + counts.falsePositive + counts.notApplicable;
        const falsePositiveRate =
          total > 0
            ? Math.round((counts.falsePositive / total) * 1000) / 10
            : 0;
        const def = getCheckDef(checkId);
        return {
          checkId,
          title: def?.title ?? checkId,
          category: def?.category ?? null,
          severity: def?.severity ?? null,
          confirmed: counts.confirmed,
          falsePositive: counts.falsePositive,
          notApplicable: counts.notApplicable,
          total,
          falsePositiveRate,
          flagged:
            total >= minSampleSize && falsePositiveRate >= thresholdPercent,
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
