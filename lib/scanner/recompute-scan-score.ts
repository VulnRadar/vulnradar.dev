/**
 * Recomputes a scan's displayed risk after a finding's feedback verdict
 * changes, so marking something false_positive actually lowers what the user
 * sees instead of only recording the verdict for the engine-learning loop.
 *
 * The finding itself is never deleted or hidden from `scan_history.findings`
 * -- it's still there, with its "False positive" badge, same as before.
 * Only what COUNTS changes: the severity tally, findings_count, and the
 * dangerScore, siteGrade, safetyRating and engineConfidence in result_meta,
 * all from scoreFindings (lib/scanner/score-findings.ts), the same function
 * execute-scan finalises a scan with. This used to rewrite the summary and the
 * danger score only, so the grade on the card and the badge stayed at F while
 * the score beside it improved.
 *
 * A verdict is the caller's private opinion, so by default it only rewrites
 * the caller's own scan_history row. host_reputation is different: one public
 * row per host with no user_id, read by the browser extension and
 * /host/<hostname> for every visitor. Letting any account's verdicts trim it
 * meant a free account could scan a phishing host publicly, mark every
 * finding false positive, and have the extension call the site safe. So the
 * cascade only runs when the caller has VERIFIED a domain covering the host,
 * on the same ownership rule lib/domains/owner-control.ts uses for acting on
 * a domain's public exposure: the domains row is the caller's own, not a
 * teammate's. Anyone else's verdicts wait for the next real scan, which
 * rewrites the row anyway.
 *
 * When it does cascade, the row's `findings` copy IS trimmed (not just its
 * danger_score/severity_counts), because app/api/v3/scan/reputation/route.ts
 * computes its `verdict` fresh from that array on every read, and auto_tags is
 * recomputed from the same trimmed array so /host does not keep showing a
 * "Critical Exposure" tag for findings the owner has ruled out. Its
 * result_meta gets the same grading keys, so /host's letter agrees with it.
 */
import pool from "@/lib/database/db";
import { HUMAN_FEEDBACK_SQL } from "./feedback-source";
import { coveringDomainCandidates } from "@/lib/domains/covering";
import { computeAutoTags } from "@/lib/tags/auto-tags";
import { normalizeHostForReputation } from "./host-reputation";
import { severityCounts } from "./severity-summary";
import {
  resultMetaIsIncomplete,
  scoreFindings,
  scoreMeta,
} from "./score-findings";
import type { Vulnerability } from "./types";

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
 * Whether `userId` has verified a domain covering the host `url` points at.
 *
 * The host is what `new URL()` parses, the same parse that keyed the
 * host_reputation row, so a domain the caller owns placed in the userinfo of
 * someone else's URL ("https://mine.example:pw@victim.test/") is matched as
 * victim.test, the row it would write. An IP literal has no host_reputation
 * row at all, so it never qualifies.
 */
async function callerOwnsHost(url: string, userId: number): Promise<boolean> {
  if (!normalizeHostForReputation(url)) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const candidates = coveringDomainCandidates(hostname);
  if (candidates.length === 0) return false;
  const res = await pool.query<{ id: number }>(
    `SELECT id FROM domains
      WHERE status = 'verified'
        AND domain = ANY($1::text[])
        AND user_id = $2
      LIMIT 1`,
    [candidates, userId],
  );
  return res.rows.length > 0;
}

/**
 * Best-effort: never throws. A failed recompute just means the score
 * stays as it was before this feedback call, not a broken feedback save --
 * the caller (app/api/v3/scan/feedback/route.ts) already returned 200 for
 * the part that matters (the verdict itself is recorded either way).
 *
 * `callerUserId` is the account whose verdicts are applied, and the scan must
 * be theirs: every statement here is scoped to it rather than trusting the
 * route's own ownership check to have run first.
 *
 * The verdict lookup is its own query rather than getFalsePositiveIds, which
 * answers a failed read with an empty set. That is the safe answer when a scan
 * is being finalised (everything counts), and the wrong one here: it would
 * overwrite a score that already excluded the owner's verdicts with one that
 * does not. A failure here throws into the catch and changes nothing.
 */
export async function recomputeScanScore(
  scanHistoryId: number,
  callerUserId: number,
): Promise<void> {
  try {
    const scanRes = await pool.query<{
      url: string;
      findings: unknown;
      result_meta: unknown;
    }>(
      `SELECT url, findings, result_meta FROM scan_history WHERE id = $1 AND user_id = $2`,
      [scanHistoryId, callerUserId],
    );
    if (scanRes.rows.length === 0) return;

    const { url, findings: rawFindings, result_meta } = scanRes.rows[0];
    const allFindings = parseFindings(rawFindings);
    if (allFindings.length === 0) return;

    const fpRes = await pool.query<{ finding_id: string }>(
      `SELECT finding_id FROM scan_finding_feedback
       WHERE user_id = $1 AND verdict = 'false_positive'
         AND ${HUMAN_FEEDBACK_SQL}`,
      [callerUserId],
    );
    const suppressed = new Set(fpRes.rows.map((r) => r.finding_id));

    const score = scoreFindings(allFindings, suppressed, {
      incomplete: resultMetaIsIncomplete(result_meta),
    });
    const meta = scoreMeta(score);

    await pool.query(
      `UPDATE scan_history
         SET summary = $1,
             findings_count = $4,
             result_meta = COALESCE(result_meta, '{}'::jsonb) || $2::jsonb
       WHERE id = $3
         AND user_id = $5`,
      // findings_count is set to the ACTIVE count too, so the list views (which
      // read findings_count) agree with the detail view (which reads
      // summary.total) after a false-positive verdict -- otherwise the same scan
      // shows "5 findings" over a breakdown summing to 4.
      [
        JSON.stringify(score.summary),
        JSON.stringify(meta),
        scanHistoryId,
        score.findingsCount,
        callerUserId,
      ],
    );

    if (!(await callerOwnsHost(url, callerUserId))) return;

    // Only affects a row if this scan is that host's CURRENT source scan
    // (WHERE source_scan_id = $5) -- a no-op UPDATE otherwise, which is
    // the correct outcome, not an error: host_reputation always reflects
    // whichever scan of that host ran most recently, by anyone.
    await pool.query(
      `UPDATE host_reputation
         SET danger_score = $1,
             severity_counts = $2,
             findings = $3,
             auto_tags = $4,
             result_meta = COALESCE(result_meta, '{}'::jsonb) || $6::jsonb
       WHERE source_scan_id = $5`,
      [
        score.dangerScore,
        // host_reputation.severity_counts holds the five bands without a total.
        JSON.stringify(severityCounts(score.activeFindings)),
        JSON.stringify(score.activeFindings),
        JSON.stringify(computeAutoTags(score.activeFindings)),
        scanHistoryId,
        JSON.stringify(meta),
      ],
    );
  } catch (err) {
    console.error(
      "[recompute-scan-score] Failed to recompute (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}
