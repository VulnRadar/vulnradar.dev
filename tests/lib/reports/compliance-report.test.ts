import { describe, it, expect } from "vitest";
import { generateComplianceReport } from "@/lib/reports/compliance-report";
import { getControlsForFinding } from "@/lib/reports/compliance-mappings";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

/**
 * lib/reports/compliance-report.ts turns a completed ScanResult into a Markdown
 * compliance-mapping report, the same pure/synchronous shape as the other
 * exporters (see tests/lib/reports/sarif-report.test.ts) so it can be unit
 * tested without a browser or file system.
 */

function makeFinding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "hsts-missing--abc123",
    title: "Missing HSTS Header",
    severity: "medium",
    category: "headers",
    description:
      "The response is missing the Strict-Transport-Security header.",
    evidence: "No Strict-Transport-Security header present.",
    riskImpact: "Users may be exposed to protocol downgrade attacks.",
    explanation: "HSTS instructs browsers to only ever use HTTPS.",
    fixSteps: ["Add the Strict-Transport-Security header."],
    codeExamples: [],
    ...overrides,
  };
}

function makeSummary(findings: Vulnerability[]): ScanResult["summary"] {
  const summary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    total: findings.length,
  };
  for (const f of findings) summary[f.severity]++;
  return summary;
}

function makeResult(
  findings: Vulnerability[],
  overrides: Partial<ScanResult> = {},
): ScanResult {
  return {
    url: "https://example.com",
    scannedAt: new Date("2026-01-15T10:30:00Z").toISOString(),
    duration: 2450,
    findings,
    summary: makeSummary(findings),
    ...overrides,
  };
}

describe("generateComplianceReport", () => {
  it("puts the mandatory guidance-not-certification disclaimer at the top", () => {
    const report = generateComplianceReport(makeResult([makeFinding()]));

    // The disclaimer section comes before any framework section.
    const disclaimerIndex = report.indexOf("## Read this first");
    expect(disclaimerIndex).toBeGreaterThanOrEqual(0);
    expect(disclaimerIndex).toBeLessThan(report.indexOf("## PCI DSS 4.0"));

    // The load-bearing "this is not a certification" phrasing must survive.
    expect(report).toContain(
      "NOT an official audit, certification, attestation, or statement of compliance",
    );
    expect(report).toContain("does not make this site or its operator");
    expect(report).toContain("qualified assessor");
    // It must never imply certification.
    expect(report.toLowerCase()).not.toContain("certifies that");
  });

  it("maps a CWE-79 (XSS) finding to at least one control in each framework", () => {
    const finding = makeFinding({
      id: "reflected-xss--1",
      title: "Reflected Cross-Site Scripting",
      severity: "high",
      category: "content",
      cwe: "CWE-79",
      owasp: "A03:2021",
    });

    // Sanity-check the mapping layer directly first.
    const controls = getControlsForFinding(finding);
    const frameworks = new Set(controls.map((c) => c.framework));
    expect(frameworks.has("pci")).toBe(true);
    expect(frameworks.has("soc2")).toBe(true);
    expect(frameworks.has("iso27001")).toBe(true);
    expect(frameworks.has("asvs")).toBe(true);

    const report = generateComplianceReport(makeResult([finding]));
    // A03 Injection -> PCI 6.2.4 and ASVS V5, with the finding listed under them.
    expect(report).toContain("6.2.4:");
    expect(report).toContain("V5:");
    expect(report).toContain("Reflected Cross-Site Scripting");
  });

  it("maps a missing-security-header finding (CWE-693 / A05) to configuration controls", () => {
    const finding = makeFinding({
      id: "csp-missing--1",
      title: "Missing Content Security Policy",
      severity: "medium",
      category: "headers",
      cwe: "CWE-693",
      owasp: "A05:2021",
    });
    const report = generateComplianceReport(makeResult([finding]));

    // A05 Security Misconfiguration -> ASVS V14 (Configuration) and PCI 2.2.
    expect(report).toContain("V14:");
    expect(report).toContain("2.2:");
    expect(report).toContain("Missing Content Security Policy");
  });

  it("lists findings with no defensible mapping under Unmapped findings", () => {
    // A DNS finding with no OWASP tag and no mappable CWE: these web-app
    // frameworks do not govern it, so it must surface, not vanish.
    const dns = makeFinding({
      id: "spf-missing--1",
      title: "No SPF Record",
      severity: "low",
      category: "dns",
      cwe: undefined,
      owasp: undefined,
    });
    const mapped = makeFinding({
      id: "xss--1",
      title: "Reflected XSS",
      category: "content",
      cwe: "CWE-79",
      owasp: "A03:2021",
    });

    expect(getControlsForFinding(dns)).toHaveLength(0);

    const report = generateComplianceReport(makeResult([dns, mapped]));
    const unmappedIndex = report.indexOf("## Unmapped findings");
    expect(unmappedIndex).toBeGreaterThanOrEqual(0);
    // The DNS finding appears in the unmapped section, after that heading.
    expect(report.indexOf("No SPF Record")).toBeGreaterThan(unmappedIndex);
    // The overview counts it as not mapped.
    expect(report).toContain("Mapped to at least one control: 1; not mapped: 1");
  });

  it("does not throw and stays honest for a result with zero findings", () => {
    const report = generateComplianceReport(makeResult([]));
    expect(report).toContain("## Read this first");
    expect(report).toContain("no control gaps to map");
    // A clean scan is stated as a clean result, never as compliance.
    expect(report).toContain("not an assessment of compliance");
    // Still names every framework in the overview.
    expect(report).toContain("OWASP ASVS 4.0");
  });

  it("never throws on a minimal finding missing optional fields", () => {
    const bare = {
      id: "bare--1",
      title: "Bare Finding",
      severity: "info",
      category: "reputation",
      description: "",
      evidence: "",
      riskImpact: "",
      explanation: "",
      fixSteps: [],
      codeExamples: [],
    } as Vulnerability;

    expect(() =>
      generateComplianceReport(makeResult([bare])),
    ).not.toThrow();
    const report = generateComplianceReport(makeResult([bare]));
    expect(report).toContain("Bare Finding");
  });

  it("contains no em dashes anywhere in the output copy", () => {
    const findings = [
      makeFinding({ cwe: "CWE-79", owasp: "A03:2021" }),
      makeFinding({
        id: "dns--1",
        title: "No SPF Record",
        category: "dns",
        cwe: undefined,
        owasp: undefined,
      }),
    ];
    const report = generateComplianceReport(makeResult(findings));
    expect(report).not.toContain("—");
  });
});
