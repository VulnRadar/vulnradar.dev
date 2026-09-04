/**
 * Tests for lib/reports/csv-report.ts.
 *
 * CSV is the export most likely to be forwarded to a colleague and was the
 * thinnest: ten prose columns, no finding id, no CVE/CVSS/KEV/EPSS, no
 * affected target, no triage status, and no server-side route at all
 * (?format=csv 400'd). This proves the columns are there, that the identity
 * column is populated, and that a scanned site's own text cannot turn a row
 * into a formula on the recipient's machine.
 */
import { describe, it, expect } from "vitest";
import { generateCsvReport, CSV_HEADERS } from "@/lib/reports/csv-report";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

function finding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "hsts-missing--a1b2",
    title: "HSTS header missing",
    severity: "medium",
    category: "headers",
    description: "No Strict-Transport-Security header.",
    evidence: "Header absent",
    riskImpact: "Downgrade attacks stay possible.",
    explanation: "x",
    fixSteps: ["Add the header", "Preload"],
    codeExamples: [],
    ...overrides,
  };
}

function scan(findings: Vulnerability[]): ScanResult {
  return {
    url: "https://example.com",
    scannedAt: "2026-01-01T00:00:00.000Z",
    duration: 1200,
    findings,
    summary: {
      critical: 0,
      high: 0,
      medium: findings.length,
      low: 0,
      info: 0,
      total: findings.length,
    },
  };
}

function rows(csv: string): string[] {
  return csv.split("\n");
}

describe("generateCsvReport", () => {
  it("leads with the stable finding id", () => {
    // The deterministic <checkId>--<urlHash> is what makes this week's export
    // diffable against last week's, and it was the one column missing.
    const csv = generateCsvReport(scan([finding()]));
    expect(rows(csv)[0]).toBe(CSV_HEADERS.join(","));
    expect(rows(csv)[0].startsWith("Finding ID,")).toBe(true);
    expect(rows(csv)[1].startsWith("hsts-missing--a1b2,")).toBe(true);
  });

  it("carries the enrichment a triager actually sorts on", () => {
    const csv = generateCsvReport(
      scan([
        finding({
          cwe: "CWE-319",
          owasp: "A02:2021",
          cveIds: ["CVE-2021-44228", "CVE-2021-45046"],
          cvssScore: 7.5,
          inKev: true,
          epssScore: 0.97412,
          confidence: 96,
        }),
      ]),
    );
    const row = rows(csv)[1];
    expect(row).toContain("CWE-319");
    expect(row).toContain("A02:2021");
    expect(row).toContain("CVE-2021-44228 CVE-2021-45046");
    expect(row).toContain("7.5");
    expect(row).toContain("yes");
    expect(row).toContain("0.97412");
  });

  it("leaves KEV blank when the catalog could not be checked", () => {
    // Absent is not false. "Not exploited in the wild" and "we could not
    // reach CISA" must not collapse into the same cell.
    const csv = generateCsvReport(scan([finding({ inKev: undefined })]));
    const cells = rows(csv)[1].split(",");
    expect(cells[CSV_HEADERS.indexOf("KEV")]).toBe("");
  });

  it("names the scanned URL as the affected target, or the file for a repo scan", () => {
    const web = rows(generateCsvReport(scan([finding()])))[1];
    expect(web).toContain("https://example.com");

    const repo = rows(
      generateCsvReport(
        scan([finding({ location: { file: "src/index.ts", line: 42 } })]),
      ),
    )[1];
    expect(repo).toContain("src/index.ts:42");
  });

  it("exports the owner's triage status, which no export carried before", () => {
    const csv = generateCsvReport(
      scan([
        finding({
          remediation: {
            status: "accepted_risk",
            note: "Legacy host, retiring in Q3",
            assignee: "sam",
            dueAt: "2026-09-30",
          },
        }),
      ]),
    );
    const row = rows(csv)[1];
    expect(row).toContain("Accepted risk");
    expect(row).toContain("sam");
    expect(row).toContain("2026-09-30");
    expect(row).toContain("Legacy host");
  });

  it("says Open for a finding with no status, and False positive for a suppressed one", () => {
    const open = rows(generateCsvReport(scan([finding()])))[1].split(",");
    expect(open[CSV_HEADERS.indexOf("Status")]).toBe("Open");

    const fp = rows(
      generateCsvReport(scan([finding({ suppressed: true })])),
    )[1];
    expect(fp).toContain("False positive");
  });

  it("neutralizes a formula smuggled in through a scanned site's own text", () => {
    // The title and evidence columns are echoed from the target. A cell
    // starting with = is executed by Excel/Sheets on open, and RFC 4180
    // quoting does not stop it.
    const csv = generateCsvReport(
      scan([finding({ title: '=HYPERLINK("http://evil","click")' })]),
    );
    expect(csv).toContain("\"'=HYPERLINK");
  });

  it("quotes a value containing a comma so the column count survives", () => {
    const csv = generateCsvReport(
      scan([finding({ evidence: "a, b, c" })]),
    ).split("\n");
    expect(csv[1]).toContain('"a, b, c"');
  });

  it("emits only the header row for a clean scan", () => {
    expect(generateCsvReport(scan([]))).toBe(CSV_HEADERS.join(","));
  });

  it("exports a finding stored by an older engine without required fields", () => {
    // Rows come out of scan_history.findings, i.e. JSON written by whatever
    // version ran that scan. An export of a two-year-old scan must not throw
    // because a field the current type calls required did not exist yet.
    const partial = {
      id: "old--x",
      title: "Old",
      severity: "low",
      category: "headers",
    } as unknown as Vulnerability;
    expect(() => generateCsvReport(scan([partial]))).not.toThrow();
  });
});
