import type { Severity, Vulnerability } from "@/lib/scanner/types";

/**
 * Tally a finding list by severity, with every band present at zero.
 *
 * compliance-report.ts and markdown-report.ts each carried a byte-identical
 * private copy of this. Both exports summarise the same scan, so a change to
 * how a band is counted had to land twice or the two reports would disagree
 * about the same result. One function, imported by both.
 *
 * Every band is initialised to 0 deliberately: a report that omits "critical:
 * 0" reads as "not measured" rather than "none found".
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
    if (counts[finding.severity] !== undefined) counts[finding.severity] += 1;
  }
  return counts;
}
