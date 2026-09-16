import { describe, it, expect } from "vitest";
import { parsePagination, positiveIntParam } from "@/lib/api/pagination";

/**
 * Regression suite for the pagination helper.
 *
 * This existed as six separate implementations across six routes, and three
 * of them got an edge wrong in a way a query string could reach. The cases
 * marked below are those exact bugs; they are here so the consolidation
 * cannot quietly regress back into any of them.
 */
describe("positiveIntParam", () => {
  it("takes a positive integer", () => {
    expect(positiveIntParam("7", 1)).toBe(7);
  });

  it("falls back for every shape that is not a positive integer", () => {
    for (const raw of [null, "", "   ", "abc", "0", "-5", "NaN", "Infinity"]) {
      expect(positiveIntParam(raw, 42)).toBe(42);
    }
  });

  it("takes the integer part of a fractional value", () => {
    expect(positiveIntParam("3.9", 1)).toBe(3);
  });
});

describe("parsePagination", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("defaults to the first page", () => {
    const { page, offset } = parsePagination(q(""));
    expect(page).toBe(1);
    expect(offset).toBe(0);
  });

  it("computes the offset from page and limit", () => {
    expect(parsePagination(q("page=3&limit=10")).offset).toBe(20);
  });

  // BUG 1: admin/teams had no floor on page, so this produced OFFSET -10.
  // Postgres rejects a negative OFFSET, which made it a 500 from a query
  // string.
  it("never produces a negative offset", () => {
    for (const raw of ["page=0", "page=-1", "page=-9999"]) {
      const { page, offset } = parsePagination(q(raw), { defaultLimit: 10 });
      expect(page).toBe(1);
      expect(offset).toBe(0);
    }
  });

  // BUG 2: ai/conversations used Math.max(1, parseInt(x)) with no fallback.
  // Math.max(1, NaN) is NaN, not 1, so a non-numeric page reached SQL as NaN.
  it("never produces NaN from a non-numeric page or limit", () => {
    const { page, limit, offset } = parsePagination(q("page=abc&limit=xyz"));
    expect(Number.isNaN(page)).toBe(false);
    expect(Number.isNaN(limit)).toBe(false);
    expect(Number.isNaN(offset)).toBe(false);
    expect(page).toBe(1);
    expect(offset).toBe(0);
  });

  // BUG 3: an unbounded page multiplied into an offset past what Postgres
  // accepts for a bigint, failing the same way the negative offset did.
  it("caps the page so the offset stays in range", () => {
    const { page, offset } = parsePagination(q("page=1e21&limit=100"));
    expect(Number.isSafeInteger(offset)).toBe(true);
    expect(page).toBeLessThanOrEqual(1_000_000);
  });

  it("clamps the limit to maxLimit and honours defaultLimit", () => {
    expect(parsePagination(q("limit=9999"), { maxLimit: 100 }).limit).toBe(100);
    expect(parsePagination(q(""), { defaultLimit: 50 }).limit).toBe(50);
  });

  it("keeps the per-call-site limits the routes actually use", () => {
    // ai/conversations pages at 50 and admits 200; the admin lists page at 10.
    expect(
      parsePagination(q(""), { defaultLimit: 50, maxLimit: 200 }).limit,
    ).toBe(50);
    expect(
      parsePagination(q("limit=500"), { defaultLimit: 50, maxLimit: 200 })
        .limit,
    ).toBe(200);
    expect(
      parsePagination(q(""), { defaultLimit: 10, maxLimit: 100 }).limit,
    ).toBe(10);
  });
});
