/**
 * Tests for lib/scanner/recompute-scan-score.ts: recomputing a scan's
 * severity tally + danger score after a finding is marked false_positive,
 * without deleting the finding itself, plus the host_reputation cascade.
 *
 * Mocks only the database pool (the boundary this module actually crosses).
 * getDangerScore is real (a pure function) so the expected score in each
 * test is derived the same way the module under test derives it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getDangerScore } from "@/lib/scanner/safety-rating";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { recomputeScanScore } = await import(
  "@/lib/scanner/recompute-scan-score"
);

interface TestFinding {
  id: string;
  severity: string;
  title: string;
}

function finding(id: string, severity: string): TestFinding {
  return { id, severity, title: `Test finding ${id}` };
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe("recomputeScanScore", () => {
  it("does nothing when the scan_history row does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await recomputeScanScore(999);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the scan has zero findings", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 1, findings: [] }],
    });

    await recomputeScanScore(1);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("excludes false_positive-verdict findings from the severity tally and danger score", async () => {
    const findings = [
      finding("crit-1", "critical"),
      finding("high-1", "high"),
      finding("med-1", "medium"),
    ];
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 42, findings }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ finding_id: "crit-1" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE scan_history
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE host_reputation

    await recomputeScanScore(123);

    expect(mockQuery).toHaveBeenCalledTimes(4);

    const activeFindings = findings.filter((f) => f.id !== "crit-1");
    const expectedDangerScore = getDangerScore(activeFindings);

    const [updateSql, updateParams] = mockQuery.mock.calls[2];
    expect(updateSql).toContain("UPDATE scan_history");
    const summary = JSON.parse(updateParams[0]);
    expect(summary).toEqual({
      critical: 0,
      high: 1,
      medium: 1,
      low: 0,
      info: 0,
      total: 2,
    });
    expect(JSON.parse(updateParams[1])).toBe(expectedDangerScore);
    expect(updateParams[2]).toBe(123);
  });

  it("scopes the false-positive lookup to the scan's own user", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 42, findings: [finding("a", "high")] }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await recomputeScanScore(123);

    const [fpSql, fpParams] = mockQuery.mock.calls[1];
    expect(fpSql).toContain("verdict = 'false_positive'");
    expect(fpParams).toEqual([42]);
  });

  it("cascades to host_reputation scoped by source_scan_id", async () => {
    const findings = [finding("a", "high"), finding("b", "low")];
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 7, findings }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no feedback
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await recomputeScanScore(456);

    const [repSql, repParams] = mockQuery.mock.calls[3];
    expect(repSql).toContain("UPDATE host_reputation");
    expect(repSql).toContain("WHERE source_scan_id = $4");
    expect(repParams[3]).toBe(456);
    // host_reputation's findings copy is trimmed too, unlike scan_history's.
    expect(JSON.parse(repParams[2])).toEqual(findings);
  });

  it("parses findings stored as a JSON string", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 1, findings: JSON.stringify([finding("a", "low")]) }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await recomputeScanScore(1);

    const [, updateParams] = mockQuery.mock.calls[2];
    expect(JSON.parse(updateParams[0]).total).toBe(1);
  });

  it("treats unparsable findings as empty and stops after the lookup", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 1, findings: "{not json" }],
    });

    await recomputeScanScore(1);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("never throws when a query rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    await expect(recomputeScanScore(1)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
