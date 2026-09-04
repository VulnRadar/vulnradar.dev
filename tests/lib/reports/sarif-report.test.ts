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

  // ── Evidence excerpts ────────────────────────────────────────────────
  //
  // The verbatim proof every page check produces was attached to the finding,
  // shipped in the API response, fed to the AI verifier, and exported by
  // nothing at all.

  it("carries the verbatim excerpts as a structured result property", () => {
    const log = generateSarifReport(
      makeResult([
        makeFinding({
          evidenceExcerpts: [
            { label: "Set-Cookie", value: "sid=abc; Path=/", line: 4 },
          ],
        }),
      ]),
    );
    expect(log.runs[0].results[0].properties.evidenceExcerpts).toEqual([
      { label: "Set-Cookie", value: "sid=abc; Path=/", line: 4 },
    ]);
  });

  it("sanitizes an excerpt before exporting it", () => {
    const log = generateSarifReport(
      makeResult([
        makeFinding({
          evidenceExcerpts: [
            { label: "body", value: "safe\u202eevil\nsecond line" },
          ],
        }),
      ]),
    );
    const excerpts = log.runs[0].results[0].properties.evidenceExcerpts as {
      value: string;
    }[];
    expect(excerpts[0].value).toBe("safe�evil second line");
  });

  it("omits the property entirely when a finding has no excerpts", () => {
    const log = generateSarifReport(makeResult([makeFinding()]));
    expect(log.runs[0].results[0].properties.evidenceExcerpts).toBeUndefined();
  });

  // ── Triage suppressions ──────────────────────────────────────────────
  //
  // A SARIF result carrying `suppressions` is one GitHub Code Scanning files
  // as a dismissed alert, so this is the switch that can stop somebody's
  // build failing. It is opt-in for exactly that reason.

  it("emits no suppressions by default, even for an accepted-risk finding", () => {
    const log = generateSarifReport(
      makeResult([
        makeFinding({
          severity: "critical",
          remediation: { status: "accepted_risk" },
        }),
      ]),
    );
    expect(log.runs[0].results[0].suppressions).toBeUndefined();
    // The status still travels, so a consumer can read the owner's triage
    // without it silently changing what the gate counts.
    expect(log.runs[0].results[0].properties.remediationStatus).toBe(
      "accepted_risk",
    );
  });

  it("suppresses accepted-risk and won't-fix findings when asked", () => {
    const log = generateSarifReport(
      makeResult([
        makeFinding({ id: "a--1", remediation: { status: "accepted_risk" } }),
        makeFinding({ id: "b--1", remediation: { status: "wont_fix" } }),
      ]),
      { applySuppressions: true },
    );
    for (const result of log.runs[0].results) {
      expect(result.suppressions).toHaveLength(1);
      expect(result.suppressions![0].kind).toBe("external");
      expect(result.suppressions![0].status).toBe("accepted");
    }
  });

  it("quotes the user's own triage note as the justification", () => {
    const log = generateSarifReport(
      makeResult([
        makeFinding({
          remediation: { status: "accepted_risk", note: "Retiring in Q3" },
        }),
      ]),
      { applySuppressions: true },
    );
    expect(log.runs[0].results[0].suppressions![0].justification).toContain(
      "Retiring in Q3",
    );
  });

  it("suppresses a false positive when asked", () => {
    const log = generateSarifReport(
      makeResult([makeFinding({ suppressed: true })]),
      { applySuppressions: true },
    );
    expect(log.runs[0].results[0].suppressions).toHaveLength(1);
    expect(log.runs[0].results[0].properties.falsePositive).toBe(true);
  });

  it("never suppresses a finding the user marked fixed", () => {
    // The scanner is still detecting it, so the tool and the user disagree.
    // That is a regression worth reporting, not something to file as handled.
    const log = generateSarifReport(
      makeResult([makeFinding({ remediation: { status: "fixed" } })]),
      { applySuppressions: true },
    );
    expect(log.runs[0].results[0].suppressions).toBeUndefined();
  });

  it("never suppresses an untriaged finding", () => {
    const log = generateSarifReport(makeResult([makeFinding()]), {
      applySuppressions: true,
    });
    expect(log.runs[0].results[0].suppressions).toBeUndefined();
  });
});
