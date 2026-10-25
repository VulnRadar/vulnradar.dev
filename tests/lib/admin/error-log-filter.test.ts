import { describe, it, expect } from "vitest";
import {
  buildErrorLogWhere,
  parseErrorLogFilter,
} from "@/lib/admin/error-log-filter";

/**
 * The WHERE clause behind Admin > System > Error Logs. What the SQL does with
 * it is proven against Postgres in tests/integration/error-logs.test.ts; this
 * pins the shape: which conditions appear, how the parameters are numbered,
 * and what the request-id parser refuses.
 */
const RID = "3f9a1c2e-1111-4222-8333-444455556666";

describe("buildErrorLogWhere", () => {
  it("is empty with no filters, so the list is unfiltered", () => {
    expect(buildErrorLogWhere({})).toEqual({ clause: "", params: [] });
    expect(
      buildErrorLogWhere({ search: "   ", requestId: null, scanId: null }),
    ).toEqual({ clause: "", params: [] });
  });

  it("groups the two search columns so they cannot swallow the other filters", () => {
    // Without the parentheses `a OR b AND c` reads as `a OR (b AND c)`, and a
    // request filter would stop narrowing anything the search matched.
    const { clause } = buildErrorLogWhere({ search: "x", scanId: 1 });
    expect(clause).toBe(
      "WHERE (message ILIKE $1 ESCAPE '\\' OR detail ILIKE $1 ESCAPE '\\') AND scan_id = $2",
    );
  });

  it("escapes LIKE metacharacters so the search is a substring, not a pattern", () => {
    const { params } = buildErrorLogWhere({ search: "50%_done\\" });
    expect(params).toEqual(["%50\\%\\_done\\\\%"]);
  });

  it("numbers parameters in the order the conditions appear", () => {
    const { clause, params } = buildErrorLogWhere({
      search: "boom",
      requestId: RID,
      scanId: 9,
    });
    expect(clause).toContain("request_id = $2");
    expect(clause).toContain("scan_id = $3");
    expect(params).toEqual(["%boom%", RID, 9]);
  });

  it("numbers from $1 when the search is absent", () => {
    const { clause, params } = buildErrorLogWhere({
      requestId: RID,
      scanId: 9,
    });
    expect(clause).toBe("WHERE request_id = $1 AND scan_id = $2");
    expect(params).toEqual([RID, 9]);
  });

  it("treats scan 0 as a value rather than as no filter", () => {
    // The parser refuses 0, but the builder must not be the thing that
    // silently drops a filter that is present.
    expect(buildErrorLogWhere({ scanId: 0 }).clause).toBe("WHERE scan_id = $1");
  });
});

describe("parseErrorLogFilter", () => {
  const parse = (qs: string) => parseErrorLogFilter(new URLSearchParams(qs));

  it("reads all three filters", () => {
    expect(parse(`search=%20boom%20&requestId=${RID}&scanId=42`)).toEqual({
      ok: true,
      filter: { search: "boom", requestId: RID, scanId: 42 },
    });
  });

  it("accepts nothing at all", () => {
    expect(parse("")).toEqual({
      ok: true,
      filter: { search: "", requestId: null, scanId: null },
    });
  });

  it.each(["short", "has space in it", "semi;colon-injection", "x".repeat(65)])(
    "refuses %j as a request id",
    (bad) => {
      expect(parse(`requestId=${encodeURIComponent(bad)}`)).toEqual({
        ok: false,
        error: "That is not a request id.",
      });
    },
  );

  it.each(["abc", "-1", "0", "1.5", "1e3", "1234567890"])(
    "refuses %j as a scan id",
    (bad) => {
      expect(parse(`scanId=${encodeURIComponent(bad)}`)).toEqual({
        ok: false,
        error: "That is not a scan id.",
      });
    },
  );
});
