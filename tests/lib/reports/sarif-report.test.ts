import { describe, it, expect } from "vitest";
import { generateSarifReport } from "@/lib/reports/sarif-report";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

/**
 * lib/reports/sarif-report.ts converts a completed ScanResult into a SARIF
 * 2.1.0 log, the same pure/synchronous shape as pdf-report.ts (see
 * tests/lib/reports/pdf-report.test.ts) so it can be unit-tested without a
 * browser or file system.
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

describe("generateSarifReport", () => {
  it("produces a well-formed SARIF 2.1.0 log for a normal result", () => {
    const findings = [
      makeFinding({
        id: "sql-injection-patterns--url1",
        severity: "critical",
        title: "SQL Injection in login form",
        category: "code",
        cwe: "CWE-89",
        owasp: "A03:2021",
      }),
      makeFinding({
        id: "csp-missing--url1",
        severity: "high",
        title: "Missing Content Security Policy",
        cwe: "CWE-693",
        owasp: "A05:2021",
      }),
      makeFinding({ id: "hsts-missing--url1", severity: "medium" }),
      makeFinding({
        id: "referrer-policy-missing--url1",
        severity: "low",
        title: "Missing Referrer Policy",
      }),
      makeFinding({
        id: "server-header-disclosure--url1",
        severity: "info",
        title: "Server Header Discloses Technology",
      }),
    ];
    const result = makeResult(findings);

    const sarif = generateSarifReport(result);

    // Required top-level shape (SARIF 2.1.0 spec section 3.13).
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.$schema).toContain("sarif-schema-2.1.0.json");
    expect(sarif.runs).toHaveLength(1);

    const run = sarif.runs[0];
    // Required fields for a runs[0] object per the spec.
    expect(run.tool.driver.name).toBeTruthy();
    expect(Array.isArray(run.tool.driver.rules)).toBe(true);
    expect(Array.isArray(run.results)).toBe(true);

    expect(run.tool.driver.rules).toHaveLength(5);
    expect(run.results).toHaveLength(5);

    // Every result references a declared rule.
    const ruleIds = new Set(run.tool.driver.rules.map((r) => r.id));
    for (const result of run.results) {
      expect(ruleIds.has(result.ruleId)).toBe(true);
      expect(run.tool.driver.rules[result.ruleIndex].id).toBe(result.ruleId);
    }
  });

  it("maps VulnRadar severities to SARIF levels correctly", () => {
    const findings = [
      makeFinding({ id: "a--1", severity: "critical" }),
      makeFinding({ id: "b--1", severity: "high" }),
      makeFinding({ id: "c--1", severity: "medium" }),
      makeFinding({ id: "d--1", severity: "low" }),
      makeFinding({ id: "e--1", severity: "info" }),
    ];
    const sarif = generateSarifReport(makeResult(findings));
    const levelsById = Object.fromEntries(
      sarif.runs[0].results.map((r) => [r.ruleId, r.level]),
    );

    expect(levelsById["a--1"]).toBe("error"); // critical
    expect(levelsById["b--1"]).toBe("error"); // high
    expect(levelsById["c--1"]).toBe("warning"); // medium
    expect(levelsById["d--1"]).toBe("note"); // low
    expect(levelsById["e--1"]).toBe("note"); // info

    // Rule-level defaultConfiguration.level mirrors the result level.
    const rulesById = Object.fromEntries(
      sarif.runs[0].tool.driver.rules.map((r) => [r.id, r]),
    );
    expect(rulesById["a--1"].defaultConfiguration.level).toBe("error");
    expect(rulesById["c--1"].defaultConfiguration.level).toBe("warning");
  });

  it("includes the CWE and OWASP tags on the rule when present, and omits them when absent", () => {
    const findings = [
      makeFinding({
        id: "xss-sink--1",
        cwe: "CWE-79",
        owasp: "A03:2021",
      }),
      makeFinding({ id: "no-mapping--1" }),
    ];
    const sarif = generateSarifReport(makeResult(findings));
    const rulesById = Object.fromEntries(
      sarif.runs[0].tool.driver.rules.map((r) => [r.id, r]),
    );

    const withCwe = rulesById["xss-sink--1"];
    expect(withCwe.properties.tags).toContain("CWE-79");
    expect(withCwe.properties.tags).toContain("external/cwe/cwe-79");
    expect(withCwe.properties.tags).toContain("owasp:A03:2021");

    const withoutCwe = rulesById["no-mapping--1"];
    expect(withoutCwe.properties.tags.some((t) => t.startsWith("CWE-"))).toBe(
      false,
    );
    expect(withoutCwe.properties.tags.some((t) => t.startsWith("owasp:"))).toBe(
      false,
    );
  });

  it("sets a GitHub-compatible security-severity score per severity", () => {
    const findings = [
      makeFinding({ id: "a--1", severity: "critical" }),
      makeFinding({ id: "b--1", severity: "info" }),
    ];
    const sarif = generateSarifReport(makeResult(findings));
    const rulesById = Object.fromEntries(
      sarif.runs[0].tool.driver.rules.map((r) => [r.id, r]),
    );
    expect(Number(rulesById["a--1"].properties["security-severity"])).toBe(9.5);
    expect(Number(rulesById["b--1"].properties["security-severity"])).toBe(1.0);
  });

  it("uses the scanned URL as the artifact location for URL-based findings", () => {
    const sarif = generateSarifReport(
      makeResult([makeFinding()], { url: "https://target.example/path" }),
    );
    const location = sarif.runs[0].results[0].locations[0];
    expect(location.physicalLocation.artifactLocation.uri).toBe(
      "https://target.example/path",
    );
    expect(location.physicalLocation.region).toBeUndefined();
  });

  it("uses the finding's file/line as the artifact location for source-based (GitHub repo scan) findings", () => {
    const sarif = generateSarifReport(
      makeResult([
        makeFinding({
          location: { file: "src/api/login.ts", line: 42 },
        }),
      ]),
    );
    const location = sarif.runs[0].results[0].locations[0];
    expect(location.physicalLocation.artifactLocation.uri).toBe(
      "src/api/login.ts",
    );
    expect(location.physicalLocation.region?.startLine).toBe(42);
  });

  it("omits the region when a source-based finding has no line number", () => {
    const sarif = generateSarifReport(
      makeResult([makeFinding({ location: { file: "src/config.ts" } })]),
    );
    const location = sarif.runs[0].results[0].locations[0];
    expect(location.physicalLocation.artifactLocation.uri).toBe(
      "src/config.ts",
    );
    expect(location.physicalLocation.region).toBeUndefined();
  });

  it("produces valid output for a result with no findings, without throwing", () => {
    const sarif = generateSarifReport(makeResult([]));
    expect(sarif.runs[0].tool.driver.rules).toEqual([]);
    expect(sarif.runs[0].results).toEqual([]);
    expect(sarif.runs[0].tool.driver.name).toBeTruthy();
  });

  it("deduplicates rules when the same finding id appears more than once", () => {
    const findings = [
      makeFinding({ id: "dup--1" }),
      makeFinding({ id: "dup--1" }),
    ];
    const sarif = generateSarifReport(makeResult(findings));
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(1);
    expect(sarif.runs[0].results).toHaveLength(2);
    for (const result of sarif.runs[0].results) {
      expect(result.ruleIndex).toBe(0);
    }
  });

  it("round-trips a realistic multi-finding scan result through JSON without losing structure", () => {
    const findings = [
      makeFinding({
        id: "hsts-missing--h1",
        severity: "high",
        title: "Missing HSTS",
        cwe: "CWE-319",
        owasp: "A02:2021",
      }),
      makeFinding({
        id: "cookie-httponly-missing--h1",
        severity: "medium",
        title: "Cookie Missing HttpOnly",
        category: "cookies",
        cwe: "CWE-1004",
        owasp: "A05:2021",
      }),
      makeFinding({
        id: "hardcoded-secrets--h1",
        severity: "critical",
        title: "Hard-coded secret in source",
        category: "code",
        cwe: "CWE-798",
        owasp: "A07:2021",
        location: { file: "src/config/keys.ts", line: 12 },
      }),
    ];
    const result = makeResult(findings, {
      url: "https://target.example",
      summary: makeSummary(findings),
    });

    const sarif = generateSarifReport(result);
    const json = JSON.stringify(sarif);
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs[0].results).toHaveLength(3);
    expect(parsed.runs[0].tool.driver.rules).toHaveLength(3);

    const secretResult = parsed.runs[0].results.find(
      (r: { ruleId: string }) => r.ruleId === "hardcoded-secrets--h1",
    );
    expect(secretResult.level).toBe("error");
    expect(
      secretResult.locations[0].physicalLocation.artifactLocation.uri,
    ).toBe("src/config/keys.ts");
    expect(secretResult.locations[0].physicalLocation.region.startLine).toBe(
      12,
    );

    const hstsRule = parsed.runs[0].tool.driver.rules.find(
      (r: { id: string }) => r.id === "hsts-missing--h1",
    );
    expect(hstsRule.properties.tags).toContain("external/cwe/cwe-319");
  });
});
