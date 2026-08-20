import type { ScanResult, Severity, Vulnerability } from "@/lib/scanner/types";
import { APP_NAME, APP_URL, APP_VERSION } from "@/lib/config/constants";

/**
 * SARIF (Static Analysis Results Interchange Format) 2.1.0 export.
 *
 * SARIF is the JSON schema GitHub Code Scanning (and most CI security
 * tooling) consumes natively: upload a `.sarif` file via the
 * `github/codeql-action/upload-sarif` action, or a security tab that
 * accepts SARIF directly, and findings show up as annotated Code Scanning
 * alerts instead of a report nobody opens.
 *
 * Mirrors pdf-report.ts's shape: a single pure `generateSarifReport(result)`
 * function with no I/O, called client-side from the export menu exactly
 * like the existing JSON/CSV/PDF exports (see scan-actions-menu.tsx) --
 * there is no dedicated API route for any of those, so SARIF doesn't get
 * one either.
 *
 * Spec references used below:
 *   - https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 *   - runs[].tool.driver.rules[] declares every rule (check) referenced
 *   - runs[].results[] is one entry per finding, referencing a rule by id
 */

// ── Minimal SARIF 2.1.0 type subset (no @types/sarif dependency) ───────────

interface SarifMessage {
  text: string;
}

interface SarifArtifactLocation {
  uri: string;
}

interface SarifRegion {
  startLine: number;
}

interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region?: SarifRegion;
}

interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

type SarifLevel = "error" | "warning" | "note";

interface SarifReportingDescriptor {
  id: string;
  name: string;
  shortDescription: SarifMessage;
  fullDescription: SarifMessage;
  helpUri?: string;
  defaultConfiguration: { level: SarifLevel };
  properties: {
    tags: string[];
    "security-severity": string;
    category: string;
    [key: string]: unknown;
  };
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: SarifMessage;
  locations: SarifLocation[];
  partialFingerprints: { vulnradarFindingId: string };
  properties: {
    severity: Severity;
    category: string;
    confidence?: number;
    [key: string]: unknown;
  };
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifReportingDescriptor[];
    };
  };
  results: SarifResult[];
}

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: SarifRun[];
}

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";

// SARIF has three real severity levels (plus "none", unused here). Critical
// and high both need to surface as blocking in tools that gate on "error",
// which is the whole point of exporting to CI in the first place.
const LEVEL_BY_SEVERITY: Record<Severity, SarifLevel> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
  info: "note",
};

// GitHub Code Scanning reads `properties["security-severity"]` (a
// CVSS-like 0.0-10.0 string) to color-code and sort alerts independently
// of `level`. Fallback per severity band when a finding has no computed
// CVSS; values chosen to land in GitHub's own critical/high/medium/low bands.
const SECURITY_SEVERITY_BY_SEVERITY: Record<Severity, string> = {
  critical: "9.5",
  high: "7.5",
  medium: "5.0",
  low: "3.0",
  info: "1.0",
};

/**
 * The security-severity to export. Prefers the finding's real computed CVSS 3.1
 * base score (cvssScore) so CI sees the actual number, not a value invented from
 * the severity label -- a finding whose real CVSS is 6.1 must not export as
 * "7.5"/"9.5" just because it's labelled high/critical. Falls back to the
 * per-band default only when no CVSS was computed.
 */
function securitySeverityFor(finding: Vulnerability): string {
  if (typeof finding.cvssScore === "number" && finding.cvssScore >= 0) {
    return finding.cvssScore.toFixed(1);
  }
  return SECURITY_SEVERITY_BY_SEVERITY[finding.severity];
}

/** `"CWE-79"` -> `"external/cwe/cwe-79"`, the tag convention CodeQL/GitHub use to drive the CWE filter in the Code Scanning UI. */
function cweTag(cwe: string): string | null {
  const match = /^CWE-(\d+)$/i.exec(cwe.trim());
  if (!match) return null;
  return `external/cwe/cwe-${match[1]}`;
}

function ruleTags(finding: Vulnerability): string[] {
  const tags = ["security", `category:${finding.category}`];
  if (finding.cwe) {
    tags.push(finding.cwe);
    const tag = cweTag(finding.cwe);
    if (tag) tags.push(tag);
  }
  if (finding.owasp) tags.push(`owasp:${finding.owasp}`);
  return tags;
}

function toRule(finding: Vulnerability): SarifReportingDescriptor {
  return {
    id: finding.id,
    name: finding.title,
    shortDescription: { text: finding.title },
    fullDescription: { text: finding.description },
    ...(finding.references && finding.references.length > 0
      ? { helpUri: finding.references[0] }
      : {}),
    defaultConfiguration: { level: LEVEL_BY_SEVERITY[finding.severity] },
    properties: {
      tags: ruleTags(finding),
      "security-severity": securitySeverityFor(finding),
      category: finding.category,
    },
  };
}

/** One evidence-bearing message combining the finding's description and its proof, so a SARIF viewer shows enough to act without opening VulnRadar. */
function toMessage(finding: Vulnerability): string {
  const parts = [finding.description];
  if (finding.evidence) parts.push(`Evidence: ${finding.evidence}`);
  if (finding.riskImpact) parts.push(`Risk: ${finding.riskImpact}`);
  return parts.join(" ");
}

function toLocation(finding: Vulnerability, scanUrl: string): SarifLocation {
  if (finding.location) {
    return {
      physicalLocation: {
        artifactLocation: { uri: finding.location.file },
        ...(finding.location.line !== undefined
          ? { region: { startLine: finding.location.line } }
          : {}),
      },
    };
  }
  return {
    physicalLocation: {
      artifactLocation: { uri: scanUrl },
    },
  };
}

/**
 * Convert a completed scan's findings into a SARIF 2.1.0 log.
 *
 * Pure and synchronous, like generatePdfReport. `runs` is always a single
 * entry -- one VulnRadar scan is one tool run over one target.
 */
export function generateSarifReport(result: ScanResult): SarifLog {
  const rules: SarifReportingDescriptor[] = [];
  const ruleIndexById = new Map<string, number>();
  const results: SarifResult[] = [];

  for (const finding of result.findings) {
    let ruleIndex = ruleIndexById.get(finding.id);
    if (ruleIndex === undefined) {
      ruleIndex = rules.length;
      rules.push(toRule(finding));
      ruleIndexById.set(finding.id, ruleIndex);
    }

    results.push({
      ruleId: finding.id,
      ruleIndex,
      level: LEVEL_BY_SEVERITY[finding.severity],
      message: { text: toMessage(finding) },
      locations: [toLocation(finding, result.url)],
      partialFingerprints: { vulnradarFindingId: finding.id },
      properties: {
        severity: finding.severity,
        category: finding.category,
        ...(finding.confidence !== undefined
          ? { confidence: finding.confidence }
          : {}),
      },
    });
  }

  return {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: APP_NAME,
            version: APP_VERSION,
            informationUri: APP_URL,
            rules,
          },
        },
        results,
      },
    ],
  };
}
