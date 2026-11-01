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
 * "Critical Exposure" tag for findings the owner has ruled out.
 */
import pool from "@/lib/database/db";
import { getDangerScore } from "./safety-rating";
import { coveringDomainCandidates } from "@/lib/domains/covering";
import { computeAutoTags } from "@/lib/tags/auto-tags";
import { countSeverities, normalizeHostForReputation } from "./host-reputation";
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
 */
export async function recomputeScanScore(
  scanHistoryId: number,
  callerUserId: number,
): Promise<void> {
  try {
    const scanRes = await pool.query<{
      url: string;
      findings: unknown;
    }>(
      `SELECT url, findings FROM scan_history WHERE id = $1 AND user_id = $2`,
      [scanHistoryId, callerUserId],
    );
    if (scanRes.rows.length === 0) return;

    const { url, findings: rawFindings } = scanRes.rows[0];
    const allFindings = parseFindings(rawFindings);
    if (allFindings.length === 0) return;

    const fpRes = await pool.query<{ finding_id: string }>(
      `SELECT finding_id FROM scan_finding_feedback
       WHERE user_id = $1 AND verdict = 'false_positive'`,
      [callerUserId],
    );
    const suppressed = new Set(fpRes.rows.map((r) => r.finding_id));

    const activeFindings = allFindings.filter((f) => !suppressed.has(f.id));
    const counts = countSeverities(activeFindings);
    const summary = { ...counts, total: activeFindings.length };
    const dangerScore = getDangerScore(activeFindings);

    await pool.query(
      `UPDATE scan_history
         SET summary = $1,
             findings_count = $4,
             result_meta = jsonb_set(
               COALESCE(result_meta, '{}'::jsonb),
               '{dangerScore}',
               $2::jsonb
             )
       WHERE id = $3
         AND user_id = $5`,
      // findings_count is set to the ACTIVE count too, so the list views (which
      // read findings_count) agree with the detail view (which reads
      // summary.total) after a false-positive verdict -- otherwise the same scan
      // shows "5 findings" over a breakdown summing to 4.
      [
        JSON.stringify(summary),
        JSON.stringify(dangerScore),
        scanHistoryId,
        activeFindings.length,
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
             auto_tags = $4
       WHERE source_scan_id = $5`,
      [
        dangerScore,
        JSON.stringify(counts),
        JSON.stringify(activeFindings),
        JSON.stringify(computeAutoTags(activeFindings)),
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
