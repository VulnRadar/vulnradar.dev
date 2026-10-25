import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { purgeScansWhere, purgeUserScans } =
  await import("@/lib/admin/purge-user-scans");

beforeEach(() => {
  mockQuery.mockReset();
});

/**
 * What the SQL does to real rows is tests/integration/purge-user-scans.test.ts.
 * These pin the shape that makes it safe: one statement, reports before scans,
 * and a count for each.
 */
describe("purgeScansWhere", () => {
  it("deletes the host reports and the scans in one statement and returns both counts", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ scans: 4, host_reports: 2 }] });
    const result = await purgeScansWhere("user_id = $1", [7]);
    expect(result).toEqual({ scans: 4, hostReports: 2 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    // One snapshot of the doomed set feeds both deletes.
    expect(sql).toContain("WITH doomed AS");
    expect(sql).toContain("DELETE FROM host_reputation");
    expect(sql).toContain("source_scan_id IN (SELECT id FROM doomed)");
    expect(sql).toContain("DELETE FROM scan_history");
    expect(params).toEqual([7]);
  });

  it("parenthesises the condition so an OR cannot widen the set", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ scans: 0, host_reports: 0 }] });
    await purgeScansWhere("url = $1 OR url LIKE $2", ["a", "%b"]);
    expect(mockQuery.mock.calls[0][0]).toContain(
      "WHERE (url = $1 OR url LIKE $2)",
    );
  });

  it("reads zero when the statement returns no row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await purgeScansWhere("user_id = $1", [1])).toEqual({
      scans: 0,
      hostReports: 0,
    });
  });
});

describe("purgeUserScans", () => {
  it("purges by owner", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ scans: 1, host_reports: 1 }] });
    await purgeUserScans(42);
    expect(mockQuery.mock.calls[0][0]).toContain("WHERE (user_id = $1)");
    expect(mockQuery.mock.calls[0][1]).toEqual([42]);
  });
});
