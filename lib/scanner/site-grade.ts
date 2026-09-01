/**
 * Whole-site letter grade, A+ through F.
 *
 * VulnRadar had the scoring machinery but not the vocabulary. The whole-scan
 * verdict was a three-state safety rating ("safe" | "caution" | "unsafe") and
 * a 0-10 danger score, while every free peer a prospect compares this against
 * grades a whole site on one A+ to F scale: MDN HTTP Observatory,
 * SecurityHeaders.com (whose API Snyk shut down in April 2026),
 * Qualys SSL Labs, ImmuniWeb. lib/scanner/ssl-grade.ts already computes a real
 * SSL-Labs-style letter, but only for the TLS handshake.
 *
 * A README badge that says "caution" is a liability the owner removes; one
 * that says "A" is a trophy they keep, and it links back.
 * ref: AUDIT-014#comp-03
 *
 * DERIVATION. Deliberately a pure function of `getDangerScore`, not a second
 * scoring system: a grade that could disagree with the danger score and the
 * safety rating shown next to it would be worse than no grade. The danger
 * score is already anchored to the safety tier (see its tierBase/tierCap in
 * lib/scanner/safety-rating.ts), so the mapping below inherits that anchoring
 * exactly:
 *
 *   score  grade   what produces it
 *   ─────  ─────   ────────────────────────────────────────────────────────
 *     0     A+     No findings at all.
 *    1-2    A      Informational or low findings only.
 *    3-4    B      Hardening gaps: missing best-practice headers and the like.
 *    5-6    C      Significant hardening gaps, or one exploitable medium.
 *    7-8    D      Exploitable high-severity issues.
 *    9-10   F      Critical exploitable vulnerabilities.
 *
 * Because the danger score caps a "safe" site at 4 and floors an "unsafe" one
 * at 8, a safe site can only ever grade A+, A or B; a caution site C or D; an
 * unsafe site D or F. No separate rule enforces that, and none should: it
 * falls out of the one score both surfaces already use.
 */

import { getDangerScore } from "./safety-rating";
import type { Vulnerability } from "@/lib/scanner/types";

export type SiteGrade = "A+" | "A" | "B" | "C" | "D" | "F";

type GradeableFinding = Pick<Vulnerability, "aiVerdict" | "aiConfidence"> & {
  severity: string;
  title: string;
  confidence?: number;
};

/** Highest danger score each grade covers, in order. */
const GRADE_THRESHOLDS: { maxScore: number; grade: SiteGrade }[] = [
  { maxScore: 0, grade: "A+" },
  { maxScore: 2, grade: "A" },
  { maxScore: 4, grade: "B" },
  { maxScore: 6, grade: "C" },
  { maxScore: 8, grade: "D" },
  { maxScore: 10, grade: "F" },
];

export function getSiteGrade(findings: GradeableFinding[]): SiteGrade {
  const score = getDangerScore(findings);
  for (const { maxScore, grade } of GRADE_THRESHOLDS) {
    if (score <= maxScore) return grade;
  }
  return "F";
}

/**
 * One line explaining what a grade means, for a badge tooltip or the public
 * host report. Kept beside the table above so the two cannot drift.
 */
export const SITE_GRADE_SUMMARY: Record<SiteGrade, string> = {
  "A+": "No issues found.",
  A: "Informational findings only.",
  B: "Hardening gaps: best-practice headers or settings are missing.",
  C: "Significant hardening gaps, or one exploitable medium-severity issue.",
  D: "Exploitable high-severity issues found.",
  F: "Critical exploitable vulnerabilities found.",
};
