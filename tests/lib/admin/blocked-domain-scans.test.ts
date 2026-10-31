import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockPurge = vi.fn();
vi.mock("@/lib/admin/purge-user-scans", () => ({
  purgeScansWhere: (...args: unknown[]) => mockPurge(...args),
}));

const {
  normalizeBlockedDomain,
  findScansForBlockedDomain,
  deleteScansForBlockedDomain,
} = await import("@/lib/admin/blocked-domain-scans");
const { hostOfUrlSql } = await import("@/lib/database/sql-fragments");

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockPurge.mockReset();
  mockPurge.mockResolvedValue({ scans: 0, hostReports: 0 });
});

/**
 * What the match does to real rows is tests/integration/blocked-domain-scans.test.ts.
 * These pin the parts the unit tier can see: that the value is reduced to the
 * same thing the SQL compares it with, and that both statements extract the host
 * with the one shared expression.
 */
describe("normalizeBlockedDomain", () => {
  it.each([
    ["evil.com", "evil.com"],
    ["  HTTPS://Evil.com/some/path?q=1  ", "evil.com"],
    ["https://evil.com:8443/x", "evil.com"],
    ["evil.com:8443", "evil.com"],
    ["https://evil.com?x=1", "evil.com"],
    ["https://evil.com#frag", "evil.com"],
    ["https://user:pw@Evil.com:8443/x?y#z", "evil.com"],
    ["user@evil.com", "evil.com"],
    ["a@b@evil.com", "evil.com"],
    ["sub.evil.com", "sub.evil.com"],
    ["", ""],
  ])("reduces %j to %j", (input, expected) => {
    expect(normalizeBlockedDomain(input)).toBe(expected);
  });
});

describe("the host match", () => {
  it("searches by the shared host expression, on both arms", async () => {
    await findScansForBlockedDomain("evil.com");
    const sql = String(mockQuery.mock.calls[0][0]);
    const host = hostOfUrlSql("sh.url");
    expect(sql).toContain(`${host} = $1 OR ${host} LIKE $2`);
    expect(mockQuery.mock.calls[0][1]).toEqual(["evil.com", "%.evil.com"]);
  });

  it("deletes by the same expression, on the bare url column", async () => {
    await deleteScansForBlockedDomain("evil.com");
    const [condition, params] = mockPurge.mock.calls[0];
    const host = hostOfUrlSql("url");
    expect(condition).toBe(`${host} = $1 OR ${host} LIKE $2`);
    expect(params).toEqual(["evil.com", "%.evil.com"]);
  });

  it("escapes LIKE metacharacters in the subdomain arm", async () => {
    await deleteScansForBlockedDomain("a_b%c.com");
    expect(mockPurge.mock.calls[0][1]).toEqual([
      "a_b%c.com",
      "%.a\\_b\\%c.com",
    ]);
  });
});
