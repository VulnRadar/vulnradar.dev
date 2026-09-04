/**
 * Regression-alert check: decides whether a just-completed scan should
 * trigger the critical/high findings email.
 *
 * Before this module existed, execute-scan.ts fired that email on every
 * single run where `summary.critical > 0 || summary.high > 0`, with no
 * comparison against the previous scan of the same URL. Since scheduled
 * scans can run hourly, a site with one persistent high finding emailed its
 * owner 24 identical alerts a day, forever -- despite the preference being
 * named `email_regression_alert`, i.e. it was always meant to be a diff, not
 * a level check.
 *
 * The diff itself reuses diffFindingsByKey (lib/scanner/finding-diff.ts),
 * the same primitive app/api/v3/compare/route.ts uses for its manual
 * "compare two scans" feature, keyed on `Vulnerability.id` -- a stable
 * `<checkId>--<urlHash>` (see lib/scanner/_helpers.ts's generateId) that the
 * same check produces again for the same URL on every later scan, which is
 * what makes "is this the same finding as last time" answerable at all.
 * Identity alone is not the whole answer, though: the id carries no severity,
 * so the severity of each matched finding is compared separately below.
 *
 * "New" is relative to the most recent prior *completed* scan of the exact
 * same (normalized) URL for the same user -- the same row a hand-triggered
 * compare would land on if you asked it to diff against "whatever came
 * before this one." A finding whose most recent feedback
 * (scan_finding_feedback, see app/api/v3/scan/feedback/route.ts) is
 * `false_positive` is treated as already-known/suppressed: it never counts
 * as newly regressed, and it is dropped from the "still outstanding" list
 * too, since a finding the user has already told us isn't real shouldn't be
 * presented as something that needs action. A finding whose remediation
 * status (finding_remediation, see lib/scanner/remediation.ts) is
 * `accepted_risk` or `wont_fix` is treated the same way, for the same reason:
 * the user has made a decision about it, and mailing them about it hourly is
 * the repeat-notification problem this module exists to end.
 */

import pool from "@/lib/database/db";
import type { Vulnerability } from "./types";
import { diffFindingsByKey } from "./finding-diff";

function isCriticalOrHigh(f: Vulnerability): boolean {
  return f.severity === "critical" || f.severity === "high";
}

/** Findings the user has already marked false_positive for this exact
 *  scanned URL -- keyed by finding id, matching how scan_finding_feedback
 *  itself is keyed (user_id, finding_id, finding_url). */
async function getSuppressedFindingIds(
  userId: number,
  findingUrl: string,
): Promise<Set<string>> {
  const result = await pool.query<{ finding_id: string }>(
    `SELECT finding_id FROM scan_finding_feedback
     WHERE user_id = $1 AND finding_url = $2 AND verdict = 'false_positive'`,
    [userId, findingUrl],
  );
  return new Set(result.rows.map((r) => r.finding_id));
}

/**
 * Findings the user has closed out in triage: accepted risk, or won't fix
 * (lib/scanner/remediation.ts). Both mean "I have decided about this", so
 * re-alerting on them every scheduled run is exactly the repeat-notification
 * problem this module was written to end, one level up.
 *
 * `fixed` is deliberately NOT here. A finding still being detected after the
 * user marked it fixed is the one case where the scanner disagrees with the
 * user, and that is worth an email rather than silence.
 *
 * Best-effort: the table postdates this module, so a deployment that has not
 * migrated yet keeps the previous behaviour instead of losing its alerts.
 */
async function getTriagedFindingIds(
  userId: number,
  findingUrl: string,
): Promise<Set<string>> {
  try {
    const result = await pool.query<{ finding_id: string }>(
      `SELECT finding_id FROM finding_remediation
       WHERE user_id = $1 AND finding_url = $2
         AND status IN ('accepted_risk', 'wont_fix')`,
      [userId, findingUrl],
    );
    return new Set(result.rows.map((r) => r.finding_id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("finding_remediation")) {
      console.error("[regression-alert] triage lookup failed:", msg);
    }
    return new Set();
  }
}

/** The most recent *other*, completed scan of this exact URL for this user
 *  -- "previous scan" for diffing purposes. Excludes the scan currently
 *  being finalized (`excludeScanId`) so a scan never diffs against itself. */
async function getPreviousScanFindings(
  userId: number,
  url: string,
  excludeScanId: number,
): Promise<Vulnerability[]> {
  const result = await pool.query<{ findings: unknown }>(
    `SELECT findings FROM scan_history
     WHERE user_id = $1 AND url = $2 AND id != $3 AND status = 'completed'
     ORDER BY scanned_at DESC
     LIMIT 1`,
    [userId, url, excludeScanId],
  );
  const raw = result.rows[0]?.findings;
  if (!raw) return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? (parsed as Vulnerability[]) : [];
}

export interface RegressionCheckParams {
  userId: number;
  /** The scanned URL, used both as the scan_history lookup key and the
   *  scan_finding_feedback lookup key -- must match what execute-scan.ts /
   *  execute-crawl-scan.ts actually persist as scan_history.url. */
  url: string;
  /** The scan_history row id of the scan currently completing, excluded
   *  from the "previous scan" lookup. */
  scanId: number;
  currentFindings: Vulnerability[];
}

export interface RegressionCheckResult {
  /** True when there is at least one genuinely new, non-suppressed
   *  critical/high finding -- the single gate for sending the alert email. */
  hasNewCriticalOrHigh: boolean;
  /** New since the previous scan, critical/high only, suppressed excluded. */
  newFindings: Vulnerability[];
  /** Present in both scans, critical/high only, suppressed excluded --
   *  "still outstanding" for the email body. */
  outstandingFindings: Vulnerability[];
}

/**
 * Diff the current scan's findings against the previous completed scan of
 * the same URL, and decide whether a critical/high regression alert should
 * fire. First scan ever for a URL has no previous findings to diff against,
 * so every current critical/high finding counts as "new" -- there is no
 * baseline for it to be a repeat of.
 */
export async function checkForNewCriticalOrHighFindings(
  params: RegressionCheckParams,
): Promise<RegressionCheckResult> {
  const { userId, url, scanId, currentFindings } = params;

  const [previousFindings, falsePositiveIds, triagedIds] = await Promise.all([
    getPreviousScanFindings(userId, url, scanId),
    getSuppressedFindingIds(userId, url),
    getTriagedFindingIds(userId, url),
  ]);
  // One set from here down: "the user has already dealt with this", whether
  // they dealt with it by calling it wrong or by accepting it.
  const suppressedIds = new Set([...falsePositiveIds, ...triagedIds]);

  const { added, unchanged } = diffFindingsByKey(
    previousFindings,
    currentFindings,
    (f) => f.id,
  );

  // Severity is not part of the finding id, and several checks decide severity
  // per run rather than declaring one: page-cookie-missing-secure, for
  // instance, is high when the cookie looks session-like and medium
  // otherwise. So a site that adds a session cookie without Secure produces a
  // finding whose id is byte-identical to the previous scan's medium one, the
  // id-only diff files it under "unchanged", and the alert that exists
  // precisely to report a new high never fires. Compare the severity too: a
  // finding that climbed into critical/high since the last scan is new
  // information about this site, which is the whole point of the feature.
  // ref: AUDIT-009#regression-01
  const previousSeverityById = new Map(
    previousFindings.map((f) => [f.id, f.severity] as const),
  );
  const escalated = unchanged.filter((f) => {
    if (!isCriticalOrHigh(f)) return false;
    const before = previousSeverityById.get(f.id);
    return before !== undefined && before !== "critical" && before !== "high";
  });
  const escalatedIds = new Set(escalated.map((f) => f.id));

  const newFindings = [
    ...added.filter((f) => isCriticalOrHigh(f) && !suppressedIds.has(f.id)),
    ...escalated.filter((f) => !suppressedIds.has(f.id)),
  ];
  // An escalated finding is reported as new, so it must not also be listed as
  // "still outstanding" in the same email.
  const outstandingFindings = unchanged.filter(
    (f) =>
      isCriticalOrHigh(f) &&
      !suppressedIds.has(f.id) &&
      !escalatedIds.has(f.id),
  );

  return {
    hasNewCriticalOrHigh: newFindings.length > 0,
    newFindings,
    outstandingFindings,
  };
}
