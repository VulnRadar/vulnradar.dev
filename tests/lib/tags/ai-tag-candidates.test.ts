/**
 * Tests for lib/tags/ai-tag-candidates.ts: the read side of "promote an AI
 * tag". The pool is faked, so this file proves the SHAPE of the work (how many
 * queries, what they are bounded by, where the counting happens) and the
 * mapping from rows to candidates. What the SQL returns against real Postgres
 * is tests/integration/ai-tag-candidates.test.ts.
 *
 * The shape is the point. The route this came from started two queries per
 * candidate, all at once, each pulling up to 50 whole findings arrays into
 * Node, against a pool of ten connections.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ALL_CATEGORIES } from "@/lib/scanner/types";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const {
  loadAiTagCandidates,
  MAX_CANDIDATES,
  MAX_EXAMPLES,
  MAX_FINDINGS_SAMPLE,
  MIN_CANDIDATE_SCANS,
  RULE_SEVERITIES,
} = await import("@/lib/tags/ai-tag-candidates");

beforeEach(() => {
  mockQuery.mockReset();
});

function candidateRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    tag: `Tag ${i}`,
    scan_count: 100 - i,
    user_count: 2,
  }));
}

describe("loadAiTagCandidates: bounded work", () => {
  it("stops after the first query when no tag has recurred enough", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(loadAiTagCandidates()).resolves.toEqual([]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("asks for the busiest candidates, capped, and never the ones already promoted", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await loadAiTagCandidates();

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("st.source = 'ai'");
    expect(sql).toContain("HAVING COUNT(DISTINCT st.scan_id) >= $1");
    expect(sql).toMatch(
      /ORDER BY COUNT\(DISTINCT st\.scan_id\) DESC, st\.tag ASC\s+LIMIT \$2/,
    );
    // Promoted tags are excluded by tag and by the AI tag they came from.
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("promoted_auto_tag_rules");
    expect(sql).toContain("p.tag = st.tag");
    expect(sql).toContain("p.source_ai_tag = st.tag");
    expect(params).toEqual([MIN_CANDIDATE_SCANS, MAX_CANDIDATES]);
    expect(MAX_CANDIDATES).toBe(25);
  });

  it("runs three queries whether there are 2 candidates or 25", async () => {
    for (const n of [2, MAX_CANDIDATES]) {
      mockQuery.mockReset();
      mockQuery
        .mockResolvedValueOnce({ rows: candidateRows(n) })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const out = await loadAiTagCandidates();

      expect(out).toHaveLength(n);
      expect(mockQuery).toHaveBeenCalledTimes(3);
    }
  });

  it("hands every candidate tag to the examples and counts queries in one array", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: candidateRows(3) })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await loadAiTagCandidates();

    const [, examplesParams] = mockQuery.mock.calls[1];
    expect(examplesParams).toEqual([["Tag 0", "Tag 1", "Tag 2"], MAX_EXAMPLES]);

    const [, facetParams] = mockQuery.mock.calls[2];
    expect(facetParams[0]).toEqual(["Tag 0", "Tag 1", "Tag 2"]);
    expect(facetParams[1]).toBe(MAX_FINDINGS_SAMPLE);
  });

  it("counts findings inside Postgres and never selects the findings column", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: candidateRows(1) })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await loadAiTagCandidates();

    const [facetSql] = mockQuery.mock.calls[2];
    expect(facetSql).toContain("jsonb_array_elements");
    expect(facetSql).toContain("GROUP BY tag, facet, val");
    // No `SELECT sh.findings` shipping the blobs to Node to be counted there.
    expect(facetSql).not.toMatch(/SELECT\s+(?:\w+\.)?findings\b/i);
    // A findings value that is not an array must not abort the whole query.
    expect(facetSql).toContain("jsonb_typeof(sh.findings) = 'array'");
  });

  it("limits suggestions to values the promote form would accept", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: candidateRows(1) })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await loadAiTagCandidates();

    const [facetSql, facetParams] = mockQuery.mock.calls[2];
    expect(facetSql).toContain("'^CWE-[0-9]+$'");
    expect(facetParams[2]).toEqual(ALL_CATEGORIES);
    expect(facetParams[3]).toEqual(RULE_SEVERITIES);
  });
});

describe("loadAiTagCandidates: rows to candidates", () => {
  it("joins counts, examples and suggestions by tag", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { tag: "DNS Email Hygiene Gaps", scan_count: 5, user_count: 3 },
          { tag: "Legacy TLS", scan_count: 4, user_count: 1 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            tag: "DNS Email Hygiene Gaps",
            scan_id: 102,
            url: "https://b.example.com",
            scanned_at: "2026-01-02",
          },
          {
            tag: "DNS Email Hygiene Gaps",
            scan_id: 101,
            url: "https://a.example.com",
            scanned_at: "2026-01-01",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { tag: "DNS Email Hygiene Gaps", facet: "category", val: "dns" },
          { tag: "DNS Email Hygiene Gaps", facet: "category", val: "email" },
          { tag: "DNS Email Hygiene Gaps", facet: "cwe", val: "CWE-350" },
          { tag: "DNS Email Hygiene Gaps", facet: "severity", val: "high" },
          { tag: "DNS Email Hygiene Gaps", facet: "severity", val: "medium" },
        ],
      });

    const out = await loadAiTagCandidates();

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      tag: "DNS Email Hygiene Gaps",
      scanCount: 5,
      userCount: 3,
      examples: [
        { scanId: 102, url: "https://b.example.com", scannedAt: "2026-01-02" },
        { scanId: 101, url: "https://a.example.com", scannedAt: "2026-01-01" },
      ],
      suggested: {
        cwes: ["CWE-350"],
        categories: ["dns", "email"],
        // The most common severity is the one offered, the first row for it.
        minSeverity: "high",
      },
    });
  });

  it("gives a candidate with nothing to suggest empty lists and a medium floor", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: candidateRows(1) })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const [candidate] = await loadAiTagCandidates();

    expect(candidate.examples).toEqual([]);
    expect(candidate.suggested).toEqual({
      cwes: [],
      categories: [],
      minSeverity: "medium",
    });
  });

  it("serialises a timestamp the driver parsed into a Date, and keeps a missing one null", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: candidateRows(1) })
      .mockResolvedValueOnce({
        rows: [
          {
            tag: "Tag 0",
            scan_id: 1,
            url: "https://a.example.com",
            scanned_at: new Date("2026-03-04T05:06:07.000Z"),
          },
          {
            tag: "Tag 0",
            scan_id: 2,
            url: "https://b.example.com",
            scanned_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const [candidate] = await loadAiTagCandidates();

    expect(candidate.examples.map((e) => e.scannedAt)).toEqual([
      "2026-03-04T05:06:07.000Z",
      null,
    ]);
  });

  it("lets a database failure reach the caller", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));

    await expect(loadAiTagCandidates()).rejects.toThrow("db exploded");
  });
});
