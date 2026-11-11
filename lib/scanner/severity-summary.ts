import type { Severity, Vulnerability } from "./types";

/**
 * How a scan's findings break down by severity.
 *
 * The scan executors (single page, crawl page, authenticated, demo) each built
 * this with five `findings.filter(...).length` passes written out by hand, and
 * the score recompute after a false-positive verdict built it a sixth way. The
 * stored `summary` of a scan has to mean the same thing whichever path wrote
 * it, so they all call this.
 */

/**
 * Tally a finding list by severity, with every band present at zero.
 *
 * Every band is initialised to 0 deliberately: a report that omits "critical:
 * 0" reads as "not measured" rather than "none found". A finding whose
 * severity is none of the five is not counted in any band.
 */
export function severityCounts(
  findings: Vulnerability[],
): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const finding of findings) {
    if (Object.hasOwn(counts, finding.severity)) counts[finding.severity] += 1;
  }
  return counts;
}

export type FindingsSummary = Record<Severity, number> & { total: number };

/**
 * The `summary` object stored on a scan: the five bands plus `total`, which is
 * the length of the list rather than the sum of the bands, as it always was.
 */
export function summarizeFindings(findings: Vulnerability[]): FindingsSummary {
  return { ...severityCounts(findings), total: findings.length };
}
