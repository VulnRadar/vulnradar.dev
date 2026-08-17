/**
 * Aggregates scan_finding_feedback (collected app-wide via POST
 * /api/v3/scan/feedback) into a per-check false-positive rate: across
 * every user's feedback, what fraction of instances of this check got
 * marked false_positive vs confirmed vs not_applicable.
 *
 * Shared by two consumers with different freshness needs: the admin
 * Engine Feedback panel (app/api/v3/admin/engine-feedback/checks/route.ts)
 * reads it live, on demand; lib/scanner/adaptive-confidence.ts caches it
 * with a TTL and uses it to discount a finding's confidence for a check
 * with a real, statistically meaningful false-positive rate. Both need the
 * exact same extraction/aggregation logic, so it lives here once rather
 * than risking the two definitions drifting apart.
 */

import pool from "@/lib/database/db";

/**
 * Everything before the LAST "--" in a stable finding id
 * (`<checkId>--<hash>`, see lib/scanner/_helpers.ts's generateId). Using
 * the last occurrence, not the first, is defensive rather than load-
 * bearing today -- no check id in lib/scanner/checks-data/*.json currently
 * contains a literal "--" -- but it is what the id format actually
 * guarantees: the hash is everything after the final separator.
 */
export function extractCheckId(findingId: string): string {
  const idx = findingId.lastIndexOf("--");
  return idx === -1 ? findingId : findingId.slice(0, idx);
}

export interface CheckAccuracyCounts {
  confirmed: number;
  falsePositive: number;
  notApplicable: number;
  total: number;
  /** 0-100, one decimal place. */
  falsePositiveRate: number;
}

interface FeedbackVerdictRow {
  finding_id: string;
  verdict: "confirmed" | "false_positive" | "not_applicable";
  count: number;
}

/**
 * A live GROUP BY, not a materialized table: feedback row counts are
 * nowhere near the volume that would justify precomputation on write.
 * Callers that run this often (every scan, potentially) should cache the
 * result themselves rather than calling this per-finding or per-scan --
 * see adaptive-confidence.ts's own TTL cache.
 */
export async function aggregateCheckAccuracy(): Promise<
  Map<string, CheckAccuracyCounts>
> {
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
    else if (row.verdict === "false_positive") entry.falsePositive += row.count;
    else if (row.verdict === "not_applicable") entry.notApplicable += row.count;
    byCheck.set(checkId, entry);
  }

  const out = new Map<string, CheckAccuracyCounts>();
  for (const [checkId, counts] of byCheck) {
    const total =
      counts.confirmed + counts.falsePositive + counts.notApplicable;
    const falsePositiveRate =
      total > 0 ? Math.round((counts.falsePositive / total) * 1000) / 10 : 0;
    out.set(checkId, { ...counts, total, falsePositiveRate });
  }
  return out;
}
