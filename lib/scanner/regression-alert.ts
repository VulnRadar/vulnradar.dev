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
 *
 * "New" is relative to the most recent prior *completed* scan of the exact
 * same (normalized) URL for the same user -- the same row a hand-triggered
 * compare would land on if you asked it to diff against "whatever came
 * before this one." A finding whose most recent feedback
 * (scan_finding_feedback, see app/api/v3/scan/feedback/route.ts) is
 * `false_positive` is treated as already-known/suppressed: it never counts
 * as newly regressed, and it is dropped from the "still outstanding" list
 * too, since a finding the user has already told us isn't real shouldn't be
 * presented as something that needs action.
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

  const [previousFindings, suppressedIds] = await Promise.all([
    getPreviousScanFindings(userId, url, scanId),
    getSuppressedFindingIds(userId, url),
  ]);

  const { added, unchanged } = diffFindingsByKey(
    previousFindings,
    currentFindings,
    (f) => f.id,
  );

  const newFindings = added.filter(
    (f) => isCriticalOrHigh(f) && !suppressedIds.has(f.id),
  );
  const outstandingFindings = unchanged.filter(
    (f) => isCriticalOrHigh(f) && !suppressedIds.has(f.id),
  );

  return {
    hasNewCriticalOrHigh: newFindings.length > 0,
    newFindings,
    outstandingFindings,
  };
}
