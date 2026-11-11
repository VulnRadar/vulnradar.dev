import { describe, expect, it } from "vitest";
import {
  buildHistoryCountsQuery,
  buildHistoryFilter,
} from "@/lib/history/list-filter";

describe("buildHistoryFilter", () => {
  it("has no filter fragment when neither q nor tag is given", () => {
    const filter = buildHistoryFilter({
      userId: 7,
      retentionDays: -1,
      q: null,
      tag: null,
    });

    expect(filter.filtering).toBe(false);
    expect(filter.filterWhere).toBe("TRUE");
    expect(filter.where).toBe(filter.baseWhere);
    expect(filter.params).toEqual([7]);
  });

  it("keeps the q/tag fragment out of baseWhere and numbers it after the base params", () => {
    const filter = buildHistoryFilter({
      userId: 7,
      retentionDays: 30,
      q: "shop",
      tag: "prod",
    });

    expect(filter.baseParams).toEqual([7, 30]);
    expect(filter.params).toEqual([7, 30, "%shop%", "prod"]);
    expect(filter.baseWhere).not.toContain("ILIKE");
    expect(filter.filterWhere).toContain("sh.url ILIKE $3 ESCAPE");
    expect(filter.filterWhere).toContain("st_f.tag = $4");
    expect(filter.filterWhere).not.toContain("sh.user_id");
    expect(filter.where).toContain(filter.baseWhere);
    expect(filter.where).toContain(filter.filterWhere.split(" AND ")[0]);
  });
});

describe("buildHistoryCountsQuery", () => {
  it("counts the account and the filtered set in one statement", () => {
    const filter = buildHistoryFilter({
      userId: 7,
      retentionDays: -1,
      q: "shop",
      tag: null,
    });

    const { sql, params } = buildHistoryCountsQuery(filter);

    expect(sql).toContain("COUNT(*)::int AS total");
    expect(sql).toContain("COUNT(*) FILTER (WHERE sh.url ILIKE $2");
    expect(sql).toContain("FROM scan_history sh");
    expect(sql).toContain(filter.baseWhere);
    expect(params).toEqual([7, "%shop%"]);
  });

  it("makes matched equal total when there is no filter", () => {
    const filter = buildHistoryFilter({
      userId: 7,
      retentionDays: -1,
      q: null,
      tag: null,
    });

    const { sql, params } = buildHistoryCountsQuery(filter);

    expect(sql).toContain("FILTER (WHERE TRUE)");
    expect(params).toEqual([7]);
  });
});
