import type { ScanResult, Severity, Vulnerability } from "@/lib/scanner/types";
import { severityCounts } from "./severity-counts";
import { mdText, mdInlineCode, mdFenced } from "./md-escape";
import { APP_NAME, APP_URL, SEVERITY_ORDER } from "@/lib/config/constants";
import {
  getSafetyRating,
  type SafetyRating,
} from "@/lib/scanner/safety-rating";
import {
  toDisplayExcerpts,
  formatExcerptLine,
} from "@/lib/scanner/evidence-excerpts";
import { REMEDIATION_LABELS } from "@/lib/scanner/remediation";

/**
 * Markdown export.
 *
 * A human-readable report for pasting into a PR description, an issue, a
 * wiki, or a chat message: anywhere a rendered .md reads better than the
 * JSON/SARIF machine formats.
 *
 * Mirrors pdf-report.ts's shape: a single pure `generateMarkdownReport(result)`
 * function with no I/O, called client-side from the export menu exactly like
 * the existing JSON/CSV/PDF/SARIF exports (see scan-actions-menu.tsx). There
 * is no dedicated API route for any of those, so Markdown doesn't get one
 * either.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

const SAFETY_LABEL: Record<SafetyRating, string> = {
  safe: "Safe to view",
  caution: "View with caution",
  unsafe: "Not safe to view",
};

function findingSection(finding: Vulnerability): string[] {
  // Finding fields can echo attacker-controlled response snippets from a
  // scanned target; neutralize HTML/Markdown-active chars so the exported .md
  // can't inject HTML in a third-party viewer (defense-in-depth, see
  // lib/reports/md-escape.ts).
  const lines: string[] = [
    `### ${mdText(finding.title)} [${finding.severity.toUpperCase()}]`,
    "",
  ];

  if (finding.category) {
    lines.push(`Category: ${mdText(finding.category)}`, "");
  }

  if (finding.description) {
    lines.push(mdText(finding.description), "");
  }

  if (finding.evidence) {
    if (finding.evidence.includes("\n")) {
      lines.push("Evidence:", "", "```", mdFenced(finding.evidence), "```", "");
    } else {
      lines.push(`Evidence: \`${mdInlineCode(finding.evidence)}\``, "");
    }
  }

  // Verbatim proof: the exact header/script/markup the check matched, which
  // is what makes the finding checkable without re-running the scan by hand.
  // Inside a fence rather than as prose: these are third-party response
  // fragments, and a fenced block is inert in a viewer that renders HTML.
  const excerpts = toDisplayExcerpts(finding.evidenceExcerpts);
  if (excerpts.length > 0) {
    lines.push("Verbatim proof:", "", "```");
    for (const ex of excerpts) lines.push(mdFenced(formatExcerptLine(ex)));
    lines.push("```", "");
  }

  if (finding.riskImpact) {
    lines.push(`Risk and impact: ${mdText(finding.riskImpact)}`, "");
  }

  // The owner's own triage. attachRemediation has always run on the export
  // route and no generator read it, so a finding the user closed as
  // "accepted risk" exported looking identical to an untouched one.
  if (finding.suppressed) {
    lines.push("Status: Marked a false positive", "");
  } else if (finding.remediation) {
    const { status, assignee, dueAt, note } = finding.remediation;
    const detail = [
      assignee ? `assigned to ${mdText(assignee)}` : null,
      dueAt ? `due ${mdText(dueAt)}` : null,
    ].filter(Boolean);
    lines.push(
      `Status: ${REMEDIATION_LABELS[status]}${
        detail.length > 0 ? ` (${detail.join(", ")})` : ""
      }`,
      "",
    );
    if (note) lines.push(`Triage note: ${mdText(note)}`, "");
  }

  if (finding.aiVerdict) {
    const confidence =
      finding.aiConfidence !== undefined
        ? ` (confidence ${finding.aiConfidence}%)`
        : "";
    lines.push(`AI verdict: ${mdText(finding.aiVerdict)}${confidence}`, "");
    if (finding.aiReason) lines.push(mdText(finding.aiReason), "");
  }

  if (finding.fixSteps && finding.fixSteps.length > 0) {
    lines.push("Fix:", "");
    finding.fixSteps.forEach((step, i) =>
      lines.push(`${i + 1}. ${mdText(step)}`),
    );
    lines.push("");
  }

  return lines;
}

export function generateMarkdownReport(result: ScanResult): string {
  const findings = result.findings ?? [];
  const lines: string[] = [`# Security report for ${mdText(result.url)}`, ""];

  const scannedAt = result.scannedAt ? new Date(result.scannedAt) : null;
  const scannedLabel =
    scannedAt && !Number.isNaN(scannedAt.getTime())
      ? scannedAt.toLocaleString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Unknown";
  lines.push(`Scanned: ${scannedLabel}`);

  if (result.dangerScore !== undefined) {
    lines.push(`Risk score: ${result.dangerScore}/10`);
  }

  const rating = getSafetyRating(findings);
  lines.push(`Safety rating: ${SAFETY_LABEL[rating]}`);

  const counts = severityCounts(findings);
  lines.push(
    `Findings: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low, ${counts.info} info`,
    "",
    "---",
    "",
  );

  if (findings.length === 0) {
    lines.push("No findings. Every check passed.", "");
  } else {
    for (const severity of SEVERITY_ORDER) {
      const group = findings.filter((f) => f.severity === severity);
      if (group.length === 0) continue;
      lines.push(`## ${SEVERITY_LABEL[severity]} (${group.length})`, "");
      for (const finding of group) {
        lines.push(...findingSection(finding));
      }
    }
  }

  lines.push("---", "", `Generated by ${APP_NAME} (${APP_URL}).`, "");

  return lines.join("\n");
}
