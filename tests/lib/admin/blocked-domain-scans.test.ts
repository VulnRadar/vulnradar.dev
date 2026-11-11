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
  searchScansForBlockedDomain,
  BLOCKED_DOMAIN_SCAN_LIST_LIMIT,
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

  // The first "://" is only a scheme when it comes before the path, the query
  // and the fragment. Otherwise the value names the host in front of it and the
  // URL after it is data.
  it.each([
    ["evil.com/r?u=http://victim.com", "evil.com"],
    ["evil.com?u=https://victim.com/x", "evil.com"],
    ["evil.com#http://victim.com", "evil.com"],
    ["https://evil.com/r?u=http://victim.com", "evil.com"],
    ["ftp://files.evil.com/pub", "files.evil.com"],
  ])(
    "reads the host in front of a URL carried as data: %j",
    (input, expected) => {
      expect(normalizeBlockedDomain(input)).toBe(expected);
    },
  );
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

// bug-ui-admin-4: the list stops at 100 and the delete does not, and the
// confirm quoted the list's length. The count has to run the delete's
// predicate, so the number an admin confirms is the number that goes.
describe("the search total", () => {
  function answer(listRows: number, total: number) {
    mockQuery.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes("COUNT(*)")
          ? { rows: [{ n: total }] }
          : {
              rows: Array.from({ length: listRows }, (_, i) => ({ id: i + 1 })),
            },
      ),
    );
  }

  it("counts with the same predicate the delete uses, uncapped", async () => {
    answer(100, 150);
    await searchScansForBlockedDomain("evil.com");
    const count = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("COUNT(*)"),
    );
    const host = hostOfUrlSql("url");
    expect(String(count?.[0])).toContain(`${host} = $1 OR ${host} LIKE $2`);
    expect(String(count?.[0])).not.toContain("LIMIT");
    expect(count?.[1]).toEqual(["evil.com", "%.evil.com"]);
  });

  it("reports the exact total and that the list is truncated", async () => {
    answer(100, 150);
    const found = await searchScansForBlockedDomain("evil.com");
    expect(found.scans).toHaveLength(100);
    expect(found.total).toBe(150);
    expect(found.truncated).toBe(true);
  });

  it("is not truncated when the list is everything", async () => {
    answer(3, 3);
    const found = await searchScansForBlockedDomain("evil.com");
    expect(found).toMatchObject({ total: 3, truncated: false });
  });

  it("never reports fewer than it lists", async () => {
    // A scan written between the two statements.
    answer(4, 3);
    const found = await searchScansForBlockedDomain("evil.com");
    expect(found).toMatchObject({ total: 4, truncated: false });
  });

  it("lists the same cap it documents", async () => {
    answer(0, 0);
    await findScansForBlockedDomain("evil.com");
    expect(String(mockQuery.mock.calls[0][0])).toContain(
      `LIMIT ${BLOCKED_DOMAIN_SCAN_LIST_LIMIT}`,
    );
  });
});

describe("a value that normalizes to nothing", () => {
  // A pasted ":8080", "?x=1", "#top", "@" or "user@" is only a port, a query, a
  // fragment or userinfo, and reduces to the empty string. The subdomain arm of
  // an empty name is "%.", which any host ending in a dot satisfies, so it must
  // never reach the database.
  it.each([":8080", "?x=1", "#top", "@", "user@", "https://", "/"])(
    "reduces %j to an empty domain",
    (value) => {
      expect(normalizeBlockedDomain(value)).toBe("");
    },
  );

  it("searches for nothing", async () => {
    expect(await findScansForBlockedDomain("")).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("deletes nothing", async () => {
    expect(await deleteScansForBlockedDomain("")).toBe(0);
    expect(mockPurge).not.toHaveBeenCalled();
  });

  it("counts nothing", async () => {
    expect(await searchScansForBlockedDomain("")).toEqual({
      scans: [],
      total: 0,
      truncated: false,
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
