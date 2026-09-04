import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { escapeCsv } from "@/lib/ui/download";
import { REMEDIATION_LABELS } from "@/lib/scanner/remediation";

/**
 * CSV export.
 *
 * The spreadsheet format is the one most likely to be handed to a colleague,
 * and for a long time it was the thinnest: ten columns of prose with no
 * finding id, no CVE, no CVSS, no KEV/EPSS, no affected target and no triage
 * status. The stable finding id in particular is the thing that makes two
 * scans of the same site comparable at all (lib/scanner/remediation.ts), so
 * leaving it out of the export meant the receiving spreadsheet could not be
 * diffed against next week's.
 *
 * It also lived only in the browser export menu, so `?format=csv` on the
 * report API 400'd while every other format worked. One pure generator, used
 * by both, the same way SARIF/Markdown/PDF already are.
 *
 * Cell escaping is lib/ui/download.ts's escapeCsv, which quotes per RFC 4180
 * AND neutralizes spreadsheet formula injection -- finding text is echoed
 * from a scanned third party, so `=HYPERLINK(...)` in a page title is a real
 * input, not a hypothetical one.
 */

/** Byte-order mark, so Excel opens the file as UTF-8 rather than as CP-1252. */
export const CSV_BOM = "﻿";

export const CSV_HEADERS = [
  "Finding ID",
  "Title",
  "Severity",
  "Category",
  "Affected",
  "Status",
  "Assignee",
  "Due",
  "Triage Note",
  "CWE",
  "OWASP",
  "CVE",
  "CVSS",
  "KEV",
  "EPSS",
  "Confidence",
  "Description",
  "Evidence",
  "Risk Impact",
  "Fix Steps",
  "AI Verdict",
  "AI Confidence",
  "AI Notes",
] as const;

/**
 * What this finding is about: the file:line for a repo scan, the scanned URL
 * for everything else. A row with no target at all is not actionable by
 * whoever the spreadsheet gets forwarded to.
 */
function affected(finding: Vulnerability, scanUrl: string): string {
  if (!finding.location) return scanUrl;
  const { file, line } = finding.location;
  return line === undefined ? file : `${file}:${line}`;
}

/** The owner's triage state in one column. "Open" is the implicit default. */
function statusCell(finding: Vulnerability): string {
  if (finding.suppressed) return "False positive";
  const status = finding.remediation?.status;
  return status ? REMEDIATION_LABELS[status] : "Open";
}

/**
 * Every field is read defensively. A row here comes from scan_history.findings,
 * i.e. JSON written by whatever engine version ran that scan, and an export of
 * a two-year-old scan must not 500 because a field the current type calls
 * required did not exist yet.
 */
function row(finding: Vulnerability, scanUrl: string): string[] {
  return [
    finding.id,
    finding.title,
    (finding.severity ?? "").toUpperCase(),
    finding.category,
    affected(finding, scanUrl),
    statusCell(finding),
    finding.remediation?.assignee ?? "",
    finding.remediation?.dueAt ?? "",
    finding.remediation?.note ?? "",
    finding.cwe ?? "",
    finding.owasp ?? "",
    Array.isArray(finding.cveIds) ? finding.cveIds.join(" ") : "",
    finding.cvssScore != null ? finding.cvssScore.toFixed(1) : "",
    // Absent, not false, when the KEV catalog itself could not be fetched --
    // "not exploited" and "not checked" must stay distinguishable here too.
    finding.inKev === undefined ? "" : finding.inKev ? "yes" : "no",
    finding.epssScore != null ? finding.epssScore.toFixed(5) : "",
    finding.confidence != null ? String(finding.confidence) : "",
    finding.description,
    finding.evidence,
    finding.riskImpact,
    Array.isArray(finding.fixSteps) ? finding.fixSteps.join(" | ") : "",
    finding.aiVerdict ?? "",
    finding.aiConfidence != null ? String(finding.aiConfidence) : "",
    finding.aiReason ?? "",
  ].map((cell) => escapeCsv(String(cell ?? "")));
}

/** One CSV document for a completed scan. No BOM: callers prepend CSV_BOM. */
export function generateCsvReport(result: ScanResult): string {
  const findings = result.findings ?? [];
  return [
    CSV_HEADERS.join(","),
    ...findings.map((finding) => row(finding, result.url).join(",")),
  ].join("\n");
}
