/**
 * Recomputes a scan's displayed risk (severity breakdown + danger score)
 * after a finding's feedback verdict changes, so marking something
 * false_positive actually lowers what the user sees instead of only
 * recording the verdict for the engine-learning loop.
 *
 * The finding itself is never deleted or hidden from `scan_history.findings`
 * -- it's still there, with its "False positive" badge, same as before.
 * Only what COUNTS toward the severity tally and the numeric danger score
 * changes: a false_positive-verdict finding is excluded from both.
 *
 * Also cascades to host_reputation when this scan is that host's current
 * source scan. That table's `findings` copy IS trimmed (not just its
 * danger_score/severity_counts), because unlike scan_history it has no
 * per-user "still there, just marked" semantics -- it's a single public
 * cache row with no user_id (see host-reputation.ts's own doc comment),
 * and app/api/v3/scan/reputation/route.ts computes its `verdict` fresh
 * from that findings array on every read via getSafetyRating(). Leaving
 * the false_positive finding in there would keep dragging that live
 * verdict back down even after danger_score was corrected.
 */
import pool from "@/lib/database/db";
import { getDangerScore } from "./safety-rating";
import { SEVERITY_LEVELS } from "@/lib/config/constants";
import type { Vulnerability } from "./types";

function tallySeverities(findings: Vulnerability[]) {
  return {
    critical: findings.filter((f) => f.severity === SEVERITY_LEVELS.CRITICAL)
      .length,
    high: findings.filter((f) => f.severity === SEVERITY_LEVELS.HIGH).length,
    medium: findings.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM)
      .length,
    low: findings.filter((f) => f.severity === SEVERITY_LEVELS.LOW).length,
    info: findings.filter((f) => f.severity === SEVERITY_LEVELS.INFO).length,
  };
}

function parseFindings(raw: unknown): Vulnerability[] {
  if (Array.isArray(raw)) return raw as Vulnerability[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Best-effort: never throws. A failed recompute just means the score
 * stays as it was before this feedback call, not a broken feedback save --
 * the caller (app/api/v3/scan/feedback/route.ts) already returned 200 for
 * the part that matters (the verdict itself is recorded either way).
 */
export async function recomputeScanScore(scanHistoryId: number): Promise<void> {
  try {
    const scanRes = await pool.query<{
      user_id: number;
      findings: unknown;
    }>(`SELECT user_id, findings FROM scan_history WHERE id = $1`, [
      scanHistoryId,
    ]);
    if (scanRes.rows.length === 0) return;

    const { user_id, findings: rawFindings } = scanRes.rows[0];
    const allFindings = parseFindings(rawFindings);
    if (allFindings.length === 0) return;

    const fpRes = await pool.query<{ finding_id: string }>(
      `SELECT finding_id FROM scan_finding_feedback
       WHERE user_id = $1 AND verdict = 'false_positive'`,
      [user_id],
    );
    const suppressed = new Set(fpRes.rows.map((r) => r.finding_id));

    const activeFindings = allFindings.filter((f) => !suppressed.has(f.id));
    const counts = tallySeverities(activeFindings);
    const summary = { ...counts, total: activeFindings.length };
    const dangerScore = getDangerScore(activeFindings);

    await pool.query(
      `UPDATE scan_history
         SET summary = $1,
             result_meta = jsonb_set(
               COALESCE(result_meta, '{}'::jsonb),
               '{dangerScore}',
               $2::jsonb
             )
       WHERE id = $3`,
      [JSON.stringify(summary), JSON.stringify(dangerScore), scanHistoryId],
    );

    // Only affects a row if this scan is that host's CURRENT source scan
    // (WHERE source_scan_id = $4) -- a no-op UPDATE otherwise, which is
    // the correct outcome, not an error: host_reputation always reflects
    // whichever scan of that host ran most recently, by anyone.
    await pool.query(
      `UPDATE host_reputation
         SET danger_score = $1,
             severity_counts = $2,
             findings = $3
       WHERE source_scan_id = $4`,
      [
        dangerScore,
        JSON.stringify(counts),
        JSON.stringify(activeFindings),
        scanHistoryId,
      ],
    );
  } catch (err) {
    console.error(
      "[recompute-scan-score] Failed to recompute (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}
