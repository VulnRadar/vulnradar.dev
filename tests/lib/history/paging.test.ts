import { describe, expect, it } from "vitest";
import { MAX_OFFSET, parsePaging } from "@/lib/history/paging";

function paging(query: string, maxRows = 100) {
  return parsePaging(new URLSearchParams(query), maxRows);
}

describe("parsePaging", () => {
  it("is the first full page when nothing is asked for", () => {
    expect(paging("")).toEqual({ limit: 100, offset: 0 });
  });

  it("takes a limit and offset as given, within the cap", () => {
    expect(paging("limit=25&offset=50")).toEqual({ limit: 25, offset: 50 });
  });

  it("rounds fractions down", () => {
    expect(paging("limit=2.9&offset=7.9")).toEqual({ limit: 2, offset: 7 });
  });

  it("clamps a limit above the cap and replaces one below 1", () => {
    expect(paging("limit=100000").limit).toBe(100);
    for (const bad of ["0", "-5", "abc", ""]) {
      expect(paging(`limit=${bad}`).limit, `limit=${bad}`).toBe(100);
    }
  });

  it("clamps an offset past what a database column holds", () => {
    for (const huge of [
      "1e21",
      "9223372036854775808",
      "99999999999999999999",
      String(MAX_OFFSET + 1),
    ]) {
      expect(paging(`offset=${huge}`).offset, `offset=${huge}`).toBe(
        MAX_OFFSET,
      );
    }
    expect(paging(`offset=${MAX_OFFSET}`).offset).toBe(MAX_OFFSET);
  });

  it("treats a negative or unparseable offset as the start", () => {
    for (const bad of ["-1", "abc", "", "NaN"]) {
      expect(paging(`offset=${bad}`).offset, `offset=${bad}`).toBe(0);
    }
  });
});
