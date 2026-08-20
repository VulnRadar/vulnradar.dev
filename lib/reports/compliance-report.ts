import type { ScanResult, Severity, Vulnerability } from "@/lib/scanner/types";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import {
  FRAMEWORKS,
  getControlsForFinding,
  type ControlRef,
  type FrameworkKey,
} from "./compliance-mappings";

/**
 * Compliance mapping report (Markdown).
 *
 * Takes a completed scan and expresses each finding as the framework controls
 * it touches (PCI DSS 4.0, SOC 2, ISO/IEC 27001:2022, OWASP ASVS), so an
 * engineer or a GRC reviewer can see "these findings are relevant to PCI
 * requirement X" without hand-mapping every result.
 *
 * This is GUIDANCE, not a compliance statement. The disclaimer at the very top
 * of the output says so in plain terms, and that framing is deliberate: a scan
 * observes a target from the outside and cannot evaluate policies, processes,
 * evidence, or scope, which is what an actual assessment is about.
 *
 * Mirrors markdown-report.ts: a single pure `generateComplianceReport(result)`
 * function with no I/O, called client-side from the export menu exactly like
 * the other text exports. The mapping tables live in compliance-mappings.ts.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity] ?? 0;
}

function severityCounts(findings: Vulnerability[]): Record<Severity, number> {
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

function formatScannedAt(scannedAt: string | undefined): string {
  const date = scannedAt ? new Date(scannedAt) : null;
  if (!date || Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The short tag line (CWE / OWASP) for a finding, or null when it has neither. */
function findingTags(finding: Vulnerability): string | null {
  const tags: string[] = [];
  if (finding.cwe) tags.push(finding.cwe);
  if (finding.owasp) tags.push(`OWASP ${finding.owasp}`);
  return tags.length > 0 ? tags.join(", ") : null;
}

/** The remediation text for a finding, guarded so it never throws on a minimal shape. */
function findingFix(finding: Vulnerability): string {
  if (finding.fixSteps && finding.fixSteps.length > 0) {
    return finding.fixSteps.join(" ");
  }
  return "See the finding detail in " + APP_NAME + " for remediation steps.";
}

/** One finding rendered under a control: title, severity, tags, and the fix. */
function findingLines(finding: Vulnerability): string[] {
  const lines: string[] = [
    `- ${finding.title} (${SEVERITY_LABEL[finding.severity] ?? finding.severity})`,
  ];
  const tags = findingTags(finding);
  if (tags) lines.push(`  - Tags: ${tags}`);
  lines.push(`  - Fix: ${findingFix(finding)}`);
  return lines;
}

interface ControlBucket {
  id: string;
  title: string;
  findings: Vulnerability[];
  topSeverity: number;
}

/**
 * Group a scan's findings by the controls they touch, for one framework.
 * A finding can appear under several controls; that is intended, since a single
 * weakness is often relevant to more than one requirement.
 */
function bucketByControl(
  findings: Vulnerability[],
  framework: FrameworkKey,
): ControlBucket[] {
  const buckets = new Map<string, ControlBucket>();

  for (const finding of findings) {
    const controls: ControlRef[] = getControlsForFinding(finding);
    for (const control of controls) {
      if (control.framework !== framework) continue;
      let bucket = buckets.get(control.id);
      if (!bucket) {
        bucket = {
          id: control.id,
          title: control.title,
          findings: [],
          topSeverity: 0,
        };
        buckets.set(control.id, bucket);
      }
      bucket.findings.push(finding);
      bucket.topSeverity = Math.max(
        bucket.topSeverity,
        severityRank(finding.severity),
      );
    }
  }

  // Most-severe control first; ties fall back to the control id for stability.
  return [...buckets.values()].sort(
    (a, b) => b.topSeverity - a.topSeverity || a.id.localeCompare(b.id),
  );
}

function sortBySeverity(findings: Vulnerability[]): Vulnerability[] {
  return [...findings].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  );
}

function frameworkSection(
  findings: Vulnerability[],
  framework: FrameworkKey,
  name: string,
  blurb: string,
): string[] {
  const buckets = bucketByControl(findings, framework);
  const lines: string[] = [`## ${name}`, "", blurb, ""];

  if (buckets.length === 0) {
    lines.push(
      `No findings from this scan mapped to ${name} controls.`,
      "",
      "---",
      "",
    );
    return lines;
  }

  lines.push(
    `${buckets.length} control${buckets.length === 1 ? "" : "s"} touched by this scan's findings.`,
    "",
  );

  for (const bucket of buckets) {
    lines.push(`### ${bucket.id}: ${bucket.title}`, "");
    for (const finding of sortBySeverity(bucket.findings)) {
      lines.push(...findingLines(finding));
    }
    lines.push("");
  }

  lines.push("---", "");
  return lines;
}

export function generateComplianceReport(result: ScanResult): string {
  const findings = result.findings ?? [];
  const frameworkNames = FRAMEWORKS.map((f) => f.name).join(", ");

  const lines: string[] = [`# Compliance mapping report for ${result.url}`, ""];

  // Disclaimer, at the very top, in its own section. This framing is mandatory:
  // the report is guidance, never a certification or a statement of compliance.
  lines.push(
    "## Read this first",
    "",
    `This is automated security guidance generated from ${APP_NAME}'s scan findings. It is NOT an official audit, certification, attestation, or statement of compliance, and it does not make this site or its operator PCI DSS, SOC 2, ISO 27001, or ASVS compliant.`,
    "",
    `${APP_NAME} is a scanner: it observes a target from the outside and maps what it finds to control themes. It cannot see your policies, processes, evidence, or audit scope, and those are what a real assessment evaluates. Treat this report as a way to prioritize remediation and brief engineers, not as proof of anything.`,
    "",
    "Any certification or attestation must come from a qualified assessor: a PCI QSA, a licensed CPA firm for SOC 2, or an accredited ISO 27001 certification body. The control references below are indicative of where a finding is relevant, not a pass or fail judgement against any requirement.",
    "",
    "---",
    "",
  );

  // Overview.
  const counts = severityCounts(findings);
  const mapped = findings.filter(
    (f) => getControlsForFinding(f).length > 0,
  ).length;
  const unmapped = findings.length - mapped;

  lines.push(
    "## Overview",
    "",
    `- Target: ${result.url}`,
    `- Scanned: ${formatScannedAt(result.scannedAt)}`,
    `- Findings: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low, ${counts.info} info (${findings.length} total)`,
    `- Mapped to at least one control: ${mapped}; not mapped: ${unmapped}`,
    `- Frameworks covered: ${frameworkNames}`,
    "",
    "---",
    "",
  );

  if (findings.length === 0) {
    lines.push(
      "## No findings",
      "",
      "This scan reported no findings, so there are no control gaps to map. That is a clean scan result, not an assessment of compliance.",
      "",
      "---",
      "",
      `Generated by ${APP_NAME} (${APP_URL}).`,
      "",
    );
    return lines.join("\n");
  }

  for (const framework of FRAMEWORKS) {
    lines.push(
      ...frameworkSection(
        findings,
        framework.key,
        framework.name,
        framework.blurb,
      ),
    );
  }

  // Unmapped findings, so nothing is silently dropped and the report never
  // implies full coverage.
  const unmappedFindings = sortBySeverity(
    findings.filter((f) => getControlsForFinding(f).length === 0),
  );

  lines.push("## Unmapped findings", "");
  if (unmappedFindings.length === 0) {
    lines.push(
      "Every finding in this scan mapped to at least one framework control.",
      "",
    );
  } else {
    lines.push(
      `${unmappedFindings.length} finding${unmappedFindings.length === 1 ? "" : "s"} did not map to any of the frameworks above. That does not mean they are low risk: it means the mapping tables do not have a defensible control for them (for example DNS, email, or reputation findings that these web-application frameworks do not directly govern). Review them on their own merits.`,
      "",
    );
    for (const finding of unmappedFindings) {
      lines.push(...findingLines(finding));
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "## How this mapping works",
    "",
    "Each finding is routed through its OWASP Top 10 (2021) category, either from the tag the check assigned it or from a CWE-to-category crosswalk, then to the controls each framework uses to govern that class of weakness. Findings with no defensible mapping are listed under Unmapped findings above rather than force-fit. The mappings are indicative and are not a substitute for a qualified assessor's judgement.",
    "",
    "---",
    "",
    `Generated by ${APP_NAME} (${APP_URL}).`,
    "",
  );

  return lines.join("\n");
}
