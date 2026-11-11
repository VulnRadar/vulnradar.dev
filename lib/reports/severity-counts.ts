/**
 * compliance-report.ts and markdown-report.ts each carried a byte-identical
 * private copy of this tally. It now lives beside the scan summary it shares a
 * definition with (lib/scanner/severity-summary.ts), so a report and the scan
 * it summarises cannot disagree about how a band is counted.
 */
export { severityCounts } from "@/lib/scanner/severity-summary";
