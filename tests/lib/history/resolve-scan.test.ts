/**
 * Unit tests for the shared scan-history id resolver (lib/history/
 * resolve-scan.ts). The pool is mocked at its module boundary, the same
 * pattern the history route tests use.
 *
 * Covers the two properties the opaque-id scheme relies on: a public_id is
 * non-numeric (so it can never be confused with, or collide against, the
 * sequential primary key during a lookup), and an all-digits legacy id still
 * resolves via the numeric fallback so old ?scan=55 / /history/55 links keep
 * opening. Uniqueness itself is enforced by the idx_scan_history_public_id
 * UNIQUE index in the migration; the resolver only ever reads one row (LIMIT 1).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { scanNumericId, resolveScanRow } =
  await import("@/lib/history/resolve-scan");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("scanNumericId", () => {
  it("classifies an opaque 32-hex public_id as non-numeric (null)", () => {
    expect(scanNumericId("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4")).toBeNull();
  });

  it("classifies any value carrying a non-digit as non-numeric", () => {
    expect(scanNumericId("55x")).toBeNull();
    expect(scanNumericId("")).toBeNull();
    expect(scanNumericId("1.5")).toBeNull();
    expect(scanNumericId("-5")).toBeNull();
  });

  it("returns the number for an in-range all-digits legacy id", () => {
    expect(scanNumericId("55")).toBe(55);
    expect(scanNumericId("2147483647")).toBe(2147483647);
  });

  it("rejects a numeric string above the int4 primary-key range", () => {
    expect(scanNumericId("2147483648")).toBeNull();
    expect(scanNumericId("99999999999999999999999999999999")).toBeNull();
  });

  it("rejects 0, which is never a real serial id", () => {
    expect(scanNumericId("0")).toBeNull();
  });
});

describe("resolveScanRow", () => {
  it("matches by public_id only for an opaque id, with the numeric fallback disabled", async () => {
    const row = { id: 7, user_id: 3 };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await resolveScanRow("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");

    expect(result).toEqual(row);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("public_id = $1");
    expect(sql).toContain("LIMIT 1");
    // Non-numeric id -> the numeric fallback param is null, so a public_id
    // lookup can never accidentally match a row by its sequential id.
    expect(params).toEqual(["a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", null]);
  });

  it("also offers the legacy numeric primary key for an all-digits id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55, user_id: 3 }] });

    await resolveScanRow("55");

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["55", 55]);
  });

  it("returns null when nothing matches", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    expect(await resolveScanRow("does-not-exist")).toBeNull();
  });
});
