import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { findOwnedScan, parseScanRef } = await import("@/lib/history/scan-ref");

const PUBLIC_ID = "0123456789abcdef0123456789abcdef";

describe("parseScanRef", () => {
  it("reads a public id as itself, with no numeric reading", () => {
    expect(parseScanRef(PUBLIC_ID)).toEqual({
      raw: PUBLIC_ID,
      numericId: null,
    });
  });

  it("reads a plain integer, as a string or a number, as the primary key", () => {
    expect(parseScanRef("123")).toEqual({ raw: "123", numericId: 123 });
    expect(parseScanRef(123)).toEqual({ raw: "123", numericId: 123 });
    expect(parseScanRef("2147483647")).toEqual({
      raw: "2147483647",
      numericId: 2147483647,
    });
  });

  it.each([
    undefined,
    null,
    true,
    {},
    [],
    [1],
    "",
    " 1",
    "1 ",
    "0",
    "-1",
    "+1",
    "1.5",
    "1e3",
    "12abc",
    "007",
    "2147483648",
    "99999999999999999999",
    1.5,
    -1,
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1e21,
    PUBLIC_ID.toUpperCase(),
    PUBLIC_ID.slice(1),
    `${PUBLIC_ID}0`,
    "g".repeat(32),
  ])("refuses %j", (value) => {
    expect(parseScanRef(value)).toBeNull();
  });
});

describe("findOwnedScan", () => {
  beforeEach(() => mockQuery.mockReset());

  it("puts the owner in the predicate and reads two columns, not the row", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 9, url: "https://example.com/" }],
    });
    const ref = parseScanRef(PUBLIC_ID);
    if (!ref) throw new Error("fixture is a public id");

    const scan = await findOwnedScan(ref, 42);

    expect(scan).toEqual({ id: 9, url: "https://example.com/" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("SELECT id, url FROM scan_history");
    expect(sql).not.toContain("*");
    expect(sql).toContain("AND user_id = $3");
    expect(params).toEqual([PUBLIC_ID, null, 42]);
  });

  it("matches a numeric id against the primary key", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const ref = parseScanRef("7");
    if (!ref) throw new Error("fixture is a numeric id");

    expect(await findOwnedScan(ref, 42)).toBeNull();
    expect(mockQuery.mock.calls[0][1]).toEqual(["7", 7, 42]);
  });
});
