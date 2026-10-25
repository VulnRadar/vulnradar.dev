import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));

const { parseUserFilters, userOrderBy, USER_SORT_COLUMNS } =
  await import("@/lib/admin/users-query");
const { staffRolesByRank } = await import("@/lib/admin/staff-roles");

function parse(query: string) {
  const result = parseUserFilters(new URLSearchParams(query));
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

describe("parseUserFilters, status", () => {
  it("applies no filter by default, or for 'all'", () => {
    expect(parse("")).toEqual({ ok: true, where: "", params: [] });
    expect(parse("status=all").where).toBe("");
  });

  it.each([
    ["disabled", "u.disabled_at IS NOT NULL"],
    ["unverified", "u.email_verified_at IS NULL"],
    ["no2fa", "u.totp_enabled IS NOT TRUE"],
  ])("maps %s to a fixed predicate and binds nothing", (status, predicate) => {
    const ok = parse(`status=${status}`);
    expect(ok.where).toBe(`WHERE ${predicate}`);
    expect(ok.params).toEqual([]);
  });

  it("rejects a status that is not on the whitelist, SQL-shaped or not", () => {
    for (const bad of ["banned", "1=1", "disabled OR 1=1", "constructor"]) {
      expect(
        parseUserFilters(new URLSearchParams({ status: bad })),
        bad,
      ).toEqual({ ok: false, error: "Unknown status filter." });
    }
  });
});

describe("parseUserFilters, plan and role", () => {
  it("binds a plan the catalog knows and rejects the rest", () => {
    const ok = parse("plan=pro_supporter");
    expect(ok.where).toBe("WHERE u.plan = $1");
    expect(ok.params).toEqual(["pro_supporter"]);
    expect(parseUserFilters(new URLSearchParams("plan=platinum"))).toEqual({
      ok: false,
      error: "Unknown plan.",
    });
  });

  it("filters one role, or every staff role at once", () => {
    const one = parse("role=billing");
    expect(one.where).toBe("WHERE u.role = $1");
    expect(one.params).toEqual(["billing"]);

    const staff = parse("role=staff");
    expect(staff.where).toBe("WHERE u.role = ANY($1::text[])");
    // The same list the staff directory uses, so 'staff' means one thing.
    expect(staff.params).toEqual([staffRolesByRank()]);
    expect(staff.params[0]).toContain("ops");
    expect(staff.params[0]).not.toContain("user");

    expect(parse("role=user").params).toEqual(["user"]);
  });

  it("rejects an unknown role, including names inherited from Object.prototype", () => {
    for (const bad of ["root", "constructor", "__proto__", "admin;--"]) {
      expect(parseUserFilters(new URLSearchParams({ role: bad })), bad).toEqual(
        { ok: false, error: "Unknown role." },
      );
    }
  });
});

describe("parseUserFilters, search", () => {
  it("matches name and email as an escaped substring", () => {
    const ok = parse(`search=${encodeURIComponent("50%_off")}`);
    expect(ok.where).toBe(
      "WHERE (u.email ILIKE $1 ESCAPE '\\' OR u.name ILIKE $1 ESCAPE '\\')",
    );
    expect(ok.params).toEqual(["%50\\%\\_off%"]);
  });

  it("lets a number also be a user id, without losing the text match", () => {
    const ok = parse("search=1042");
    expect(ok.where).toBe(
      "WHERE (u.id = $2 OR u.email ILIKE $1 ESCAPE '\\' OR u.name ILIKE $1 ESCAPE '\\')",
    );
    expect(ok.params).toEqual(["%1042%", 1042]);
  });

  it("does not treat a number too big for int4, or a mixed token, as an id", () => {
    expect(parse("search=99999999999").params).toEqual(["%99999999999%"]);
    expect(parse("search=1e3").params).toEqual(["%1e3%"]);
    expect(parse("search=user42").params).toEqual(["%user42%"]);
  });

  it("combines with the filters in one AND, numbering placeholders in order", () => {
    const ok = parse("status=no2fa&role=staff&plan=free&search=7");
    expect(ok.where).toBe(
      "WHERE u.totp_enabled IS NOT TRUE AND u.plan = $1 AND u.role = ANY($2::text[]) AND (u.id = $4 OR u.email ILIKE $3 ESCAPE '\\' OR u.name ILIKE $3 ESCAPE '\\')",
    );
    expect(ok.params).toHaveLength(4);
  });

  it("ignores a blank search and caps a huge one", () => {
    expect(parse("search=%20").where).toBe("");
    expect(
      (parse(`search=${"a".repeat(900)}`).params[0] as string).length,
    ).toBe(202);
  });
});

describe("userOrderBy", () => {
  it("defaults to newest first", () => {
    expect(userOrderBy(null, null)).toBe("u.created_at DESC");
    expect(userOrderBy("password_hash", "asc")).toBe("u.created_at DESC");
  });

  it("sorts only by a whitelisted column, with a stable tie-break", () => {
    expect(userOrderBy("joined", "asc")).toBe("u.created_at ASC, u.id DESC");
    expect(userOrderBy("name", "desc")).toBe(
      `${USER_SORT_COLUMNS.name} DESC, u.id DESC`,
    );
    // Any direction but "asc" is DESC; it is never interpolated.
    expect(userOrderBy("joined", "asc; DROP TABLE users")).toBe(
      "u.created_at DESC, u.id DESC",
    );
  });
});
