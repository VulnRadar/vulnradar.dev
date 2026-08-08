import { describe, it, expect } from "vitest";
import { generatePdfReport } from "@/lib/reports/pdf-report";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

/**
 * lib/reports/pdf-report.ts builds raw PDF syntax by hand (its own top
 * comment: "no external deps") - there is no Puppeteer/Playwright/jsPDF
 * browser-rendering dependency here despite jspdf being in package.json for
 * other features, so this is pure, synchronous, fully-testable logic. We
 * assert on the generated PDF bytes as text (PDF's text-drawing operators
 * are themselves ASCII), not on visual rendering.
 */

function makeFinding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "test-check",
    title: "Missing HSTS Header",
    severity: "medium",
    category: "headers",
    description:
      "The response is missing the Strict-Transport-Security header.",
    evidence: "No Strict-Transport-Security header present.",
    riskImpact: "Users may be exposed to protocol downgrade attacks.",
    explanation: "HSTS instructs browsers to only ever use HTTPS.",
    fixSteps: [
      "Add the Strict-Transport-Security header.",
      "Set max-age to at least 31536000 seconds.",
    ],
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

function decode(bytes: Uint8Array): string {
  // Every byte the generator writes comes from ASCII template strings
  // (escPdf only ever inserts `\`, `(`, `)`), so latin1 round-trips the
  // exact source string for assertions.
  return Buffer.from(bytes).toString("latin1");
}

describe("generatePdfReport", () => {
  it("produces a well-formed multi-section PDF for a normal result", () => {
    const findings = [
      makeFinding({
        severity: "critical",
        title: "SQL Injection in login form",
        category: "content",
      }),
      makeFinding({
        severity: "high",
        title: "Missing Content Security Policy",
      }),
      makeFinding({ severity: "medium" }),
      makeFinding({ severity: "low", title: "Missing Referrer Policy" }),
      makeFinding({
        severity: "info",
        title: "Server Header Discloses Technology",
      }),
    ];
    const result = makeResult(findings);

    const bytes = generatePdfReport(result);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    const pdf = decode(bytes);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trim().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("example.com");
    expect(pdf).toContain("DETAILED FINDINGS");
    expect(pdf).toContain("SQL Injection in login form");
    // A critical exploitable finding (SQL Injection) forces the unsafe tier.
    expect(pdf).toContain("NOT SAFE TO VIEW");
  });

  it("produces valid output for a result with no findings, without throwing", () => {
    const result = makeResult([]);

    const bytes = generatePdfReport(result);
    const pdf = decode(bytes);

    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trim().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("No vulnerabilities were detected.");
    expect(pdf).toContain("SAFE TO VIEW");
    expect(pdf).not.toContain("NOT SAFE TO VIEW");
    // "finding(s)" goes through the same escPdf() as everything else, so
    // the parens are backslash-escaped in the raw PDF text stream.
    expect(pdf).toContain("This report contains 0 finding\\(s\\)");
  });

  it("handles the maximum realistic number of findings across many pages without throwing", () => {
    const severities: Vulnerability["severity"][] = [
      "critical",
      "high",
      "medium",
      "low",
      "info",
    ];
    const findings: Vulnerability[] = Array.from({ length: 200 }, (_, i) =>
      makeFinding({
        id: `check-${i}`,
        title: `Finding number ${i}`,
        severity: severities[i % severities.length],
        description: "A moderately long description of the issue. ".repeat(4),
        fixSteps: ["Step one.", "Step two.", "Step three."],
        codeExamples: [
          {
            label: "Example",
            language: "http",
            code: "Strict-Transport-Security: max-age=31536000\nX-Frame-Options: DENY",
          },
        ],
      }),
    );
    const result = makeResult(findings);

    let bytes: Uint8Array = new Uint8Array();
    expect(() => {
      bytes = generatePdfReport(result);
    }).not.toThrow();

    const pdf = decode(bytes);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trim().endsWith("%%EOF")).toBe(true);

    // Multiple distinct page objects, not "/Type /Pages" (the container).
    const pageMatches = pdf.match(/\/Type \/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBeGreaterThan(1);

    // /Count on the Pages object matches the number of page objects built.
    const countMatch = /\/Count (\d+)/.exec(pdf);
    expect(countMatch).not.toBeNull();
    expect(Number(countMatch![1])).toBe(pageMatches.length);

    expect(pdf).toContain("1. [");
    expect(pdf).toContain("200. [");
    expect(pdf).toContain("This report contains 200 finding\\(s\\)");
  });

  it("escapes parentheses and backslashes so they can't corrupt PDF string syntax", () => {
    const result = makeResult([
      makeFinding({
        title: "Path Traversal via ../../../etc/passwd (CVE-2021-1234)",
        description:
          "Payload used: C:\\Windows\\System32 and (parenthetical) notes.",
      }),
    ]);

    const pdf = decode(generatePdfReport(result));

    expect(pdf).toContain("\\(CVE-2021-1234\\)");
    expect(pdf).toContain("C:\\\\Windows\\\\System32");
    expect(pdf).toContain("\\(parenthetical\\)");
  });

  it("renders remediation steps and code examples when present", () => {
    const result = makeResult([
      makeFinding({
        title: "Missing Content Security Policy",
        fixSteps: ["Add a Content-Security-Policy header."],
        codeExamples: [
          {
            label: "Nginx",
            language: "nginx",
            code: "add_header Content-Security-Policy \"default-src 'self'\";",
          },
        ],
      }),
    ]);

    const pdf = decode(generatePdfReport(result));

    expect(pdf).toContain("Remediation Steps:");
    expect(pdf).toContain("1. Add a Content-Security-Policy header.");
    expect(pdf).toContain("Code Examples:");
    expect(pdf).toContain("Nginx:");
  });

  it("skips the remediation and code-example blocks when absent", () => {
    const result = makeResult([
      makeFinding({ fixSteps: [], codeExamples: [] }),
    ]);

    const pdf = decode(generatePdfReport(result));

    expect(pdf).not.toContain("Remediation Steps:");
    expect(pdf).not.toContain("Code Examples:");
  });
});
