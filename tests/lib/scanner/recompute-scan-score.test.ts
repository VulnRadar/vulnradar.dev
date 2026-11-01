/**
 * Tests for lib/scanner/recompute-scan-score.ts: recomputing a scan's
 * severity tally + danger score after a finding is marked false_positive,
 * without deleting the finding itself, plus the host_reputation cascade that
 * only a verified owner of the host may trigger.
 *
 * Mocks only the database pool (the boundary this module actually crosses).
 * getDangerScore and computeAutoTags are real (pure functions) so the expected
 * values in each test are derived the same way the module under test derives
 * them. What the SQL itself does against Postgres is proved in
 * tests/integration/scan-feedback-reputation.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getDangerScore } from "@/lib/scanner/safety-rating";
import { computeAutoTags } from "@/lib/tags/auto-tags";
import type { Vulnerability } from "@/lib/scanner/types";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { recomputeScanScore } =
  await import("@/lib/scanner/recompute-scan-score");

interface TestFinding {
  id: string;
  severity: string;
  title: string;
}

function finding(id: string, severity: string): TestFinding {
  return { id, severity, title: `Test finding ${id}` };
}

const URL_OF_SCAN = "https://app.example.com/login";

function scanRow(findings: unknown, url = URL_OF_SCAN) {
  return { rows: [{ url, findings }] };
}

function sqlOf(call: unknown[]): string {
  return String(call[0]);
}

function callsMatching(fragment: string): unknown[][] {
  return mockQuery.mock.calls.filter((c) => sqlOf(c).includes(fragment));
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe("recomputeScanScore", () => {
  it("does nothing when the scan_history row does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await recomputeScanScore(999, 1);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("reads the scan only if it belongs to the caller", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await recomputeScanScore(123, 42);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM scan_history");
    expect(sql).toMatch(/user_id = \$2/);
    expect(params).toEqual([123, 42]);
  });

  it("does nothing when the scan has zero findings", async () => {
    mockQuery.mockResolvedValueOnce(scanRow([]));

    await recomputeScanScore(1, 1);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("excludes false_positive-verdict findings from the severity tally and danger score", async () => {
    const findings = [
      finding("crit-1", "critical"),
      finding("high-1", "high"),
      finding("med-1", "medium"),
    ];
    mockQuery.mockResolvedValueOnce(scanRow(findings));
    mockQuery.mockResolvedValueOnce({ rows: [{ finding_id: "crit-1" }] });
    mockQuery.mockResolvedValue({ rows: [] });

    await recomputeScanScore(123, 42);

    const activeFindings = findings.filter((f) => f.id !== "crit-1");
    const expectedDangerScore = getDangerScore(
      activeFindings as unknown as Vulnerability[],
    );

    const [update] = callsMatching("UPDATE scan_history");
    const [, updateParams] = update as [string, unknown[]];
    const summary = JSON.parse(updateParams[0] as string);
    expect(summary).toEqual({
      critical: 0,
      high: 1,
      medium: 1,
      low: 0,
      info: 0,
      total: 2,
    });
    expect(JSON.parse(updateParams[1] as string)).toBe(expectedDangerScore);
    expect(updateParams[2]).toBe(123);
  });

  it("scopes the false-positive lookup to the caller", async () => {
    mockQuery.mockResolvedValueOnce(scanRow([finding("a", "high")]));
    mockQuery.mockResolvedValue({ rows: [] });

    await recomputeScanScore(123, 42);

    const [fpSql, fpParams] = mockQuery.mock.calls[1];
    expect(fpSql).toContain("verdict = 'false_positive'");
    expect(fpParams).toEqual([42]);
  });

  it("updates only the caller's own scan_history row", async () => {
    mockQuery.mockResolvedValueOnce(scanRow([finding("a", "high")]));
    mockQuery.mockResolvedValue({ rows: [] });

    await recomputeScanScore(123, 42);

    const [update] = callsMatching("UPDATE scan_history");
    const [sql, params] = update as [string, unknown[]];
    expect(sql).toMatch(/WHERE id = \$3\s+AND user_id = \$5/);
    expect(params[2]).toBe(123);
    expect(params[4]).toBe(42);
  });

  // gap-ai-trust-boundary-2 / code-health-1: host_reputation is a public row
  // with no user_id. A free account could scan a phishing host publicly, mark
  // every finding false positive, and the extension and /host would then call
  // the site safe. Private feedback stays private unless the caller has
  // proven they control the host.
  it("never writes host_reputation when the caller has no verified domain for the host", async () => {
    mockQuery.mockResolvedValueOnce(
      scanRow([finding("a", "critical"), finding("b", "high")]),
    );
    mockQuery.mockResolvedValueOnce({
      rows: [{ finding_id: "a" }, { finding_id: "b" }],
    });
    mockQuery.mockResolvedValue({ rows: [] });

    await recomputeScanScore(456, 7);

    expect(callsMatching("UPDATE scan_history")).toHaveLength(1);
    expect(callsMatching("host_reputation")).toHaveLength(0);
  });

  it("asks for a verified domain owned by the caller that covers the scan's host", async () => {
    mockQuery.mockResolvedValueOnce(scanRow([finding("a", "high")]));
    mockQuery.mockResolvedValue({ rows: [] });

    await recomputeScanScore(456, 7);

    const [lookup] = callsMatching("FROM domains");
    const [sql, params] = lookup as [string, unknown[]];
    expect(sql).toContain("status = 'verified'");
    expect(sql).toMatch(/user_id = \$2/);
    // The covering candidates of app.example.com: an apex covers its
    // subdomains, a different registrable domain never does.
    expect(params).toEqual([["app.example.com", "example.com", "com"], 7]);
  });

  it("matches the host, not a lookalike in the userinfo", async () => {
    mockQuery.mockResolvedValueOnce(
      scanRow(
        [finding("a", "high")],
        "https://victim.example.com:pw@attacker.test/",
      ),
    );
    mockQuery.mockResolvedValue({ rows: [] });

    await recomputeScanScore(456, 7);

    const [lookup] = callsMatching("FROM domains");
    expect((lookup as [string, unknown[]])[1][0]).toEqual([
      "attacker.test",
      "test",
    ]);
  });

  it("cascades to host_reputation, auto_tags included, for a verified owner", async () => {
    const findings = [finding("a", "high"), finding("b", "low")];
    mockQuery.mockResolvedValueOnce(scanRow(findings));
    mockQuery.mockResolvedValueOnce({ rows: [{ finding_id: "a" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE scan_history
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9 }] }); // verified domain
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE host_reputation

    await recomputeScanScore(456, 7);

    const [rep] = callsMatching("UPDATE host_reputation");
    const [repSql, repParams] = rep as [string, unknown[]];
    expect(repSql).toContain("WHERE source_scan_id = $5");
    expect(repSql).toContain("auto_tags = $4");
    expect(repParams[4]).toBe(456);

    const active = [findings[1]] as unknown as Vulnerability[];
    expect(repParams[0]).toBe(getDangerScore(active));
    expect(JSON.parse(repParams[1] as string)).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 1,
      info: 0,
    });
    expect(JSON.parse(repParams[2] as string)).toEqual(active);
    expect(JSON.parse(repParams[3] as string)).toEqual(computeAutoTags(active));
  });

  it("skips the ownership lookup for an IP-literal scan, which has no reputation row", async () => {
    mockQuery.mockResolvedValueOnce(
      scanRow([finding("a", "high")], "http://203.0.113.5/"),
    );
    mockQuery.mockResolvedValue({ rows: [] });

    await recomputeScanScore(456, 7);

    expect(callsMatching("FROM domains")).toHaveLength(0);
    expect(callsMatching("host_reputation")).toHaveLength(0);
  });

  it("parses findings stored as a JSON string", async () => {
    mockQuery.mockResolvedValueOnce(
      scanRow(JSON.stringify([finding("a", "low")])),
    );
    mockQuery.mockResolvedValue({ rows: [] });

    await recomputeScanScore(1, 1);

    const [update] = callsMatching("UPDATE scan_history");
    expect(
      JSON.parse((update as [string, unknown[]])[1][0] as string).total,
    ).toBe(1);
  });

  it("treats unparsable findings as empty and stops after the lookup", async () => {
    mockQuery.mockResolvedValueOnce(scanRow("{not json"));

    await recomputeScanScore(1, 1);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("never throws when a query rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    await expect(recomputeScanScore(1, 1)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
