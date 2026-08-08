import { describe, it, expect } from "vitest";
import { diagnose } from "../../scripts/_lib/_lib.check-enums.mjs";
import { makeQueryRouterPool, containsAll } from "./_query-router-mock";

function ctxWith(
  tables: string[],
  columnsDetailed: Record<string, Array<{ name: string }>>,
  checkConstraintEnums: Array<{
    table: string;
    column: string;
    constraintName: string;
    values: string[];
  }> = [],
) {
  return {
    tables: new Set(tables),
    columnsDetailed,
    primaryKeys: {},
    foreignKeys: [],
    checkConstraintEnums,
  };
}

describe("enums: DB CHECK-constraint-derived (already Postgres-enforced)", () => {
  it("flags a row outside a discovered CHECK constraint's value set", async () => {
    const ctx = ctxWith(
      ["access_rules"],
      { access_rules: [{ name: "id" }, { name: "rule_type" }] },
      [
        {
          table: "access_rules",
          column: "rule_type",
          constraintName: "access_rules_rule_type_check",
          values: ["whitelist", "blacklist"],
        },
      ],
    );
    const pool = makeQueryRouterPool([
      {
        match: containsAll("COUNT(*)", "access_rules", "rule_type"),
        handler: () => ({ rows: [{ n: 1 }] }),
      },
      {
        match: containsAll("SELECT", "access_rules", "rule_type", "LIMIT"),
        handler: () => ({ rows: [{ pk: 1, value: "greylist" }] }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("needs-human");
    expect(findings[0].description).toContain("access_rules_rule_type_check");
    expect(findings[0].examples[0].detail).toBe("greylist");
  });

  it("skips when the constrained column doesn't exist on this schema", async () => {
    const ctx = ctxWith(["access_rules"], { access_rules: [{ name: "id" }] }, [
      {
        table: "access_rules",
        column: "rule_type",
        constraintName: "access_rules_rule_type_check",
        values: ["whitelist", "blacklist"],
      },
    ]);
    const pool = makeQueryRouterPool([]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("enums: application-level only (users.role, plan, subscription_status, two_factor_method, team_members.role)", () => {
  it("flags a users.role value outside STAFF_ROLES", async () => {
    const ctx = ctxWith(["users"], {
      users: [{ name: "id" }, { name: "role" }],
    });
    const pool = makeQueryRouterPool([
      {
        match: containsAll("COUNT(*)", '"users"', '"role"'),
        handler: () => ({ rows: [{ n: 1 }] }),
      },
      {
        match: containsAll("SELECT", '"users"', '"role"', "LIMIT"),
        handler: () => ({ rows: [{ pk: 7, value: "administrator" }] }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    const roleFinding = findings.find(
      (f) => f.column === "role" && f.table === "users",
    );
    expect(roleFinding).toBeDefined();
    expect(roleFinding!.severity).toBe("needs-human");
    expect(roleFinding!.examples[0]).toEqual({
      pk: 7,
      detail: "administrator",
    });
  });

  it("does not flag users.role when every value is recognized", async () => {
    const ctx = ctxWith(["users"], {
      users: [{ name: "id" }, { name: "role" }],
    });
    const pool = makeQueryRouterPool([
      { match: containsAll("COUNT(*)"), handler: () => ({ rows: [{ n: 0 }] }) },
    ]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings.find((f) => f.column === "role")).toBeUndefined();
  });

  it("skips an app-level enum column entirely when it doesn't exist on this schema", async () => {
    const ctx = ctxWith(["users"], { users: [{ name: "id" }] }); // no role/plan/etc at all
    const pool = makeQueryRouterPool([]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("skips entirely when the users table itself doesn't exist", async () => {
    const ctx = ctxWith([], {});
    const pool = makeQueryRouterPool([]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
