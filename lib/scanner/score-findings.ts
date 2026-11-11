/**
 * Everything a scan reports about its findings as a whole: the severity
 * breakdown, the count, the danger score, the letter grade, the safety rating
 * and the engine confidence, computed from the findings the owner has not
 * ruled out.
 *
 * Each of these used to be computed in two places that disagreed. The scan
 * executor counted every finding, so a critical the owner had marked a false
 * positive on Monday was back in the headline, the grade and the scheduled
 * email after Tuesday's rescan, and triage looked like it had done nothing.
 * The recompute after a verdict excluded it, but only rewrote the summary and
 * the danger score, so the grade on the card and the badge stayed at F while
 * the score next to it improved. One function now produces the whole set, and
 * both paths call it with the same suppressed ids.
 *
 * What is excluded: findings whose id the owner marked false positive
 * (a person's verdict only, see lib/scanner/feedback-source.ts). What is not:
 * remediation statuses, including accepted_risk and wont_fix. Those say "this
 * is real and I have decided to live with it", and the grade is a description
 * of the site that a share link and an embedded badge show to other people,
 * so a risk the owner accepted still counts against it. The regression alert
 * leaves them out of its email for a different reason: it is about not mailing
 * someone hourly about a decision they already made, which is a question of
 * notification, not of what the site looks like.
 *
 * The findings themselves are never removed from the scan row. A suppressed
 * finding keeps its place in the list with its "False positive" mark; only
 * what it counts towards changes.
 */
import {
  getDangerScore,
  getEngineConfidence,
  getSafetyRating,
  type SafetyRating,
} from "./safety-rating";
import { getSiteGrade, type SiteGrade } from "./site-grade";
import { summarizeFindings, type FindingsSummary } from "./severity-summary";
import type { Vulnerability } from "./types";

export interface FindingsScore {
  /** The findings that count: everything not in the suppressed set. */
  activeFindings: Vulnerability[];
  summary: FindingsSummary;
  /** The value of scan_history.findings_count, which the list views read. */
  findingsCount: number;
  dangerScore: number;
  siteGrade: SiteGrade;
  safetyRating: SafetyRating;
  engineConfidence: number;
}

export interface ScoreFindingsOptions {
  /**
   * Some part of the scan did not finish (a branch timed out, a page check
   * threw, the page was refused). It lowers the engine confidence the same way
   * it always has.
   */
  incomplete?: boolean;
}

export function scoreFindings(
  findings: Vulnerability[],
  suppressedIds: ReadonlySet<string>,
  options: ScoreFindingsOptions = {},
): FindingsScore {
  const activeFindings =
    suppressedIds.size === 0
      ? findings
      : findings.filter((f) => !suppressedIds.has(f.id));
  return {
    activeFindings,
    summary: summarizeFindings(activeFindings),
    findingsCount: activeFindings.length,
    dangerScore: getDangerScore(activeFindings),
    siteGrade: getSiteGrade(activeFindings),
    safetyRating: getSafetyRating(activeFindings),
    engineConfidence: getEngineConfidence(
      activeFindings,
      options.incomplete === true,
    ),
  };
}

/**
 * The result_meta keys a score owns. Spread into a scan's result_meta at
 * finalise, and merged over it by the recompute, so the two write the same
 * keys under the same names.
 */
export function scoreMeta(score: FindingsScore): {
  dangerScore: number;
  siteGrade: SiteGrade;
  safetyRating: SafetyRating;
  engineConfidence: number;
} {
  return {
    dangerScore: score.dangerScore,
    siteGrade: score.siteGrade,
    safetyRating: score.safetyRating,
    engineConfidence: score.engineConfidence,
  };
}

/**
 * Whether a stored result_meta says the scan did not finish everything, for a
 * recompute that has only the row to go on. execute-scan lists every planned
 * branch in `incomplete` when the async phase times out, so the list alone is
 * the same signal it used.
 */
export function resultMetaIsIncomplete(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const incomplete = (meta as { incomplete?: unknown }).incomplete;
  return Array.isArray(incomplete) && incomplete.length > 0;
}
