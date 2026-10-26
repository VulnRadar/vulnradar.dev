import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));

const { parseAuditFilters, shapeAuditStats, AUDIT_STATS_SQL } =
  await import("@/lib/admin/audit-query");
const { AUDIT_CATEGORIES, auditActionsIn } =
  await import("@/lib/admin/audit-actions");

function parse(query: string) {
  const result = parseAuditFilters(new URLSearchParams(query));
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

describe("parseAuditFilters, the whitelist", () => {
  it("applies no filter and no joins by default", () => {
    expect(parse("")).toEqual({
      ok: true,
      where: "",
      params: [],
      joinsUsers: false,
    });
  });

  it("filters one action, and only one the registry knows", () => {
    const ok = parse("action=grant_credits");
    expect(ok.where).toBe("WHERE al.action = $1");
    expect(ok.params).toEqual(["grant_credits"]);

    expect(
      parseAuditFilters(new URLSearchParams("action=drop table users")),
    ).toEqual({ ok: false, error: "Unknown audit action." });
    // A name inherited from Object.prototype is not an action.
    expect(
      parseAuditFilters(new URLSearchParams("action=constructor")),
    ).toEqual({ ok: false, error: "Unknown audit action." });
  });

  it("maps a category to the registry's actions for it, legacy names included", () => {
    const ok = parse("category=status");
    expect(ok.where).toBe("WHERE al.action = ANY($1::text[])");
    expect(ok.params).toEqual([auditActionsIn("status")]);
    expect(ok.params[0]).toContain("disable");

    expect(parseAuditFilters(new URLSearchParams("category=nope"))).toEqual({
      ok: false,
      error: "Unknown audit category.",
    });
  });

  it("treats category=all as no filter, and every real category as valid", () => {
    expect(parse("category=all").where).toBe("");
    for (const { id } of AUDIT_CATEGORIES) {
      expect(parseAuditFilters(new URLSearchParams(`category=${id}`)).ok).toBe(
        true,
      );
    }
  });

  it("lets an explicit action win over a category", () => {
    const ok = parse("action=set_role&category=status");
    expect(ok.params).toEqual(["set_role"]);
  });

  it("takes ids as positive integers only", () => {
    expect(parse("adminId=7").params).toEqual([7]);
    expect(parse("targetUserId=12").where).toBe("WHERE al.target_user_id = $1");
    for (const bad of ["0", "-3", "1.5", "abc", "1e3", "99999999999"]) {
      expect(
        parseAuditFilters(new URLSearchParams(`adminId=${bad}`)).ok,
        bad,
      ).toBe(false);
      expect(
        parseAuditFilters(new URLSearchParams(`targetUserId=${bad}`)).ok,
        bad,
      ).toBe(false);
    }
  });

  it("takes dates as ISO instants and rejects the rest", () => {
    const ok = parse("from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z");
    expect(ok.where).toBe(
      "WHERE al.created_at >= $1::timestamptz AND al.created_at <= $2::timestamptz",
    );
    expect(ok.params).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
    ]);
    expect(parseAuditFilters(new URLSearchParams("from=yesterday")).ok).toBe(
      false,
    );
    expect(parseAuditFilters(new URLSearchParams("to=garbage")).ok).toBe(false);
  });

  it("numbers placeholders in the order clauses are added", () => {
    const ok = parse("category=roles&adminId=2&targetUserId=3");
    expect(ok.where).toBe(
      "WHERE al.action = ANY($1::text[]) AND al.admin_id = $2 AND al.target_user_id = $3",
    );
    expect(ok.params).toHaveLength(3);
  });
});

describe("parseAuditFilters, the search term", () => {
  it("escapes LIKE metacharacters so a search is a substring, not a pattern", () => {
    const ok = parse(`q=${encodeURIComponent("100%_done\\")}`);
    expect(ok.params).toEqual(["%100\\%\\_done\\\\%"]);
  });

  it("reaches SQL only as a bound parameter", () => {
    const evil = "'; DROP TABLE admin_audit_log; --";
    const ok = parse(`q=${encodeURIComponent(evil)}`);
    expect(ok.where).not.toContain("DROP");
    expect(ok.where).not.toContain(evil);
    // Only LIKE-escaped, never altered or split. The expected value applies
    // the same three escapes the parser does (backslash, %, _), so it stays
    // right if the probe string ever gains one of the others.
    expect(ok.params[0]).toBe(`%${evil.replace(/[\\%_]/g, "\\$&")}%`);
  });

  it("searches details, action, ip and both people, and needs the users join", () => {
    const ok = parse("q=ops");
    expect(ok.joinsUsers).toBe(true);
    for (const column of [
      "al.details",
      "al.action",
      "al.ip_address",
      "au.email",
      "au.name",
      "tu.email",
      "tu.name",
    ]) {
      expect(ok.where).toContain(`${column} ILIKE $1 ESCAPE '\\'`);
    }
  });

  it("ignores a blank search and caps an enormous one", () => {
    expect(parse("q=%20%20").where).toBe("");
    const long = parse(`q=${"a".repeat(5000)}`);
    expect((long.params[0] as string).length).toBe(200 + 2);
  });
});

describe("the stat tiles", () => {
  it("counts the last week in one pass with COUNT ... FILTER", () => {
    expect(AUDIT_STATS_SQL).toContain("FILTER");
    expect(AUDIT_STATS_SQL.match(/FROM admin_audit_log/g)).toHaveLength(1);
  });

  it("reads zero from a missing row and coerces COUNT strings", () => {
    expect(shapeAuditStats(undefined)).toEqual({
      last24h: 0,
      last7d: 0,
      activeAdmins7d: 0,
      userActions7d: 0,
    });
    expect(
      shapeAuditStats({
        last_24h: "4",
        last_7d: "30",
        active_admins_7d: 2,
        user_actions_7d: "11",
      }),
    ).toEqual({ last24h: 4, last7d: 30, activeAdmins7d: 2, userActions7d: 11 });
  });
});
