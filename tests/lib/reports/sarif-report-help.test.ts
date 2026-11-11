import { describe, it, expect } from "vitest";
import { generateSarifReport } from "@/lib/reports/sarif-report";
import { APP_URL } from "@/lib/config/constants";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

/**
 * What GitHub Code Scanning shows under "Rule help". Without it an alert says
 * what is wrong and leaves the reader to look up how to fix it.
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

function firstRule(finding: Vulnerability) {
  const result: ScanResult = {
    url: "https://example.com",
    scannedAt: new Date("2026-01-15T10:30:00Z").toISOString(),
    duration: 1000,
    findings: [finding],
    summary: { critical: 0, high: 0, medium: 1, low: 0, info: 0, total: 1 },
  };
  return generateSarifReport(result).runs[0].tool.driver.rules[0];
}

describe("generateSarifReport: rule help", () => {
  it("puts the fix steps and the check's fix guide in the rule help", () => {
    const rule = firstRule(
      makeFinding({ fixSteps: ["Add the header.", "Redeploy."] }),
    );

    expect(rule.help?.text).toBe(
      [
        "How to fix it:",
        "1. Add the header.",
        "2. Redeploy.",
        "",
        `Fix guide: ${APP_URL}/checks/hsts-missing`,
      ].join("\n"),
    );
    expect(rule.help?.markdown).toBe(
      [
        "**How to fix it**",
        "",
        "1. Add the header.",
        "2. Redeploy.",
        "",
        `[Read the fix guide](${APP_URL}/checks/hsts-missing)`,
      ].join("\n"),
    );
  });

  it("resolves an async finding to the page that documents its check", () => {
    const rule = firstRule(
      makeFinding({
        id: "async-missing-spf-record--k3j9x1",
        title: "Missing SPF Record",
      }),
    );

    expect(rule.help?.text).toContain(
      `Fix guide: ${APP_URL}/checks/spf-record`,
    );
  });

  it("still carries the fix steps when the check has no page of its own", () => {
    const rule = firstRule(
      makeFinding({ id: "page-no-such-check--k3j9x1", fixSteps: ["Do it."] }),
    );

    expect(rule.help?.text).toBe("How to fix it:\n1. Do it.");
    expect(rule.help?.markdown).not.toContain("fix guide");
  });

  it("leaves help off when there is nothing to say", () => {
    const rule = firstRule(
      makeFinding({ id: "page-no-such-check--k3j9x1", fixSteps: [] }),
    );

    expect(rule.help).toBeUndefined();
  });

  it("keeps helpUri on the finding's own first reference", () => {
    const rule = firstRule(
      makeFinding({ references: ["https://example.org/ref"] }),
    );

    expect(rule.helpUri).toBe("https://example.org/ref");
  });
});
