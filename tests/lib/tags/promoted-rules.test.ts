/**
 * Tests for lib/tags/promoted-rules.ts: listing the auto-tag rules an admin
 * has promoted and removing one. The pool is faked, so these prove what the
 * code does with the rows and which statements it sends; that the DELETE
 * really removes exactly one row and the LEFT JOIN survives a deleted
 * promoter is tests/integration/promoted-auto-tag-rules.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));

const mockInvalidate = vi.fn();
vi.mock("@/lib/tags/auto-tags", () => ({
  invalidatePromotedRulesCache: () => mockInvalidate(),
}));

const { listPromotedRules, deletePromotedRule } =
  await import("@/lib/tags/promoted-rules");

beforeEach(() => {
  mockQuery.mockReset();
  mockInvalidate.mockReset();
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    tag: "DNS Email Hygiene Gaps",
    cwes: ["CWE-350"],
    categories: ["dns"],
    require_both: false,
    min_severity: "high",
    min_count: 2,
    created_at: new Date("2026-05-06T07:08:09.000Z"),
    created_by_name: "Sam Admin",
    created_by_email: "sam@example.test",
    ...overrides,
  };
}

describe("listPromotedRules", () => {
  it("lists newest first, so the rule just promoted is the first row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await listPromotedRules();

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM promoted_auto_tag_rules");
    expect(sql).toContain("ORDER BY r.created_at DESC, r.id DESC");
    // A rule outlives the account that promoted it (ON DELETE SET NULL).
    expect(sql).toContain("LEFT JOIN users");
  });

  it("maps a row to the shape the panel renders", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] });

    await expect(listPromotedRules()).resolves.toEqual([
      {
        id: 4,
        tag: "DNS Email Hygiene Gaps",
        cwes: ["CWE-350"],
        categories: ["dns"],
        requireBoth: false,
        minSeverity: "high",
        minCount: 2,
        createdBy: "Sam Admin",
        createdAt: "2026-05-06T07:08:09.000Z",
      },
    ]);
  });

  it("turns a null cwes or categories column into an empty list", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [row({ cwes: null, categories: ["dns"] })],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [row({ cwes: ["CWE-79"], categories: null })],
    });

    const [first] = await listPromotedRules();
    const [second] = await listPromotedRules();

    expect(first.cwes).toEqual([]);
    expect(second.categories).toEqual([]);
  });

  it("falls back to a masked address for a promoter with no name, never the raw one", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        row({ created_by_name: "  ", created_by_email: "samuel@example.test" }),
      ],
    });

    const [rule] = await listPromotedRules();

    expect(rule.createdBy).toBe("s****l@example.test");
    expect(JSON.stringify(rule)).not.toContain("samuel@");
  });

  it("leaves createdBy null once the promoting account is gone", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [row({ created_by_name: null, created_by_email: null })],
    });

    const [rule] = await listPromotedRules();

    expect(rule.createdBy).toBeNull();
  });
});

describe("deletePromotedRule", () => {
  it("deletes by id and returns what the rule was", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tag: "DNS Email Hygiene Gaps",
          cwes: ["CWE-350"],
          categories: null,
          min_severity: "high",
          min_count: 2,
        },
      ],
    });

    const removed = await deletePromotedRule(4);

    const [sql, params] = mockQuery.mock.calls[0];
    // One statement does the delete and the read-back, so two admins racing
    // on the same rule cannot both be told they removed it.
    expect(sql).toMatch(/DELETE FROM promoted_auto_tag_rules\s+WHERE id = \$1/);
    expect(sql).toContain("RETURNING");
    expect(params).toEqual([4]);
    expect(removed).toEqual({
      tag: "DNS Email Hygiene Gaps",
      cwes: ["CWE-350"],
      categories: [],
      minSeverity: "high",
      minCount: 2,
    });
  });

  it("drops the rule cache when a rule was removed, so it stops tagging at once", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tag: "X",
          cwes: ["CWE-79"],
          categories: null,
          min_severity: "low",
          min_count: 1,
        },
      ],
    });

    await deletePromotedRule(1);

    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it("returns null and leaves the cache alone when there was no such rule", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(deletePromotedRule(999)).resolves.toBeNull();

    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it("lets a database failure reach the caller, and does not touch the cache", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));

    await expect(deletePromotedRule(1)).rejects.toThrow("db exploded");

    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
