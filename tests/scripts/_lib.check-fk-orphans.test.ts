import { describe, it, expect } from "vitest";
import { diagnose } from "../../scripts/_lib/_lib.check-fk-orphans.mjs";
import {
  makeQueryRouterPool,
  contains,
  containsAll,
} from "./_query-router-mock";

/**
 * Every fixture below is scoped to EXACTLY the tables/columns a given
 * test needs. The implied-FK tier scans every _id/_by column across the
 * whole ctx regardless of which specific declared FK a test is about, so
 * an unrelated extra column left in a shared fixture would trigger its
 * own unmocked query and fail the test with "Unrouted query" -- keeping
 * fixtures minimal avoids that instead of papering over it with catch-all
 * mock routes that could hide a real bug.
 */
function ctxWith({
  tables,
  columnsDetailed,
  primaryKeys,
  foreignKeys = [],
}: {
  tables: string[];
  columnsDetailed: Record<
    string,
    Array<{ name: string; dataType: string; isNullable: boolean }>
  >;
  primaryKeys: Record<string, string[]>;
  foreignKeys?: Array<{
    constraintName: string;
    childTable: string;
    childColumn: string;
    parentTable: string;
    parentColumn: string;
    deleteRule: string;
  }>;
}) {
  return {
    tables: new Set(tables),
    columnsDetailed,
    primaryKeys,
    foreignKeys,
    checkConstraintEnums: [],
  };
}

const usersOnly = {
  users: [{ name: "id", dataType: "integer", isNullable: false }],
};

describe("fk-orphans: declared FK constraints", () => {
  it("nullable orphaned column is auto-fixable with a SET NULL repair", async () => {
    const ctx = ctxWith({
      tables: ["users", "admin_audit_log"],
      columnsDetailed: {
        ...usersOnly,
        admin_audit_log: [
          { name: "id", dataType: "integer", isNullable: false },
          { name: "target_user_id", dataType: "integer", isNullable: true },
        ],
      },
      primaryKeys: { users: ["id"], admin_audit_log: ["id"] },
      foreignKeys: [
        {
          constraintName: "fk_target_user",
          childTable: "admin_audit_log",
          childColumn: "target_user_id",
          parentTable: "users",
          parentColumn: "id",
          deleteRule: "NO ACTION",
        },
      ],
    });
    const pool = makeQueryRouterPool([
      {
        match: containsAll("COUNT(*)", "admin_audit_log", "target_user_id"),
        handler: () => ({ rows: [{ n: 3 }] }),
      },
      {
        match: containsAll("SELECT c.", "admin_audit_log", "target_user_id"),
        handler: () => ({ rows: [{ pk: 1, value: 999 }] }),
      },
    ]);

    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.severity).toBe("auto-fixable");
    expect(f.confidence).toBe("declared");
    expect(f.count).toBe(3);
    expect(f.repair?.sql).toContain('SET "target_user_id" = NULL');
    expect(f.repair?.sql).toContain("admin_audit_log");
  });

  it("NOT NULL orphaned column is needs-human with no repair", async () => {
    const ctx = ctxWith({
      tables: ["users", "admin_audit_log"],
      columnsDetailed: {
        ...usersOnly,
        admin_audit_log: [
          { name: "id", dataType: "integer", isNullable: false },
          { name: "admin_id", dataType: "integer", isNullable: false },
        ],
      },
      primaryKeys: { users: ["id"], admin_audit_log: ["id"] },
      foreignKeys: [
        {
          constraintName: "admin_audit_log_admin_id_fkey",
          childTable: "admin_audit_log",
          childColumn: "admin_id",
          parentTable: "users",
          parentColumn: "id",
          deleteRule: "CASCADE",
        },
      ],
    });
    const pool = makeQueryRouterPool([
      {
        match: containsAll("COUNT(*)", "admin_audit_log", "admin_id"),
        handler: () => ({ rows: [{ n: 1 }] }),
      },
      {
        match: containsAll("SELECT c.", "admin_audit_log", "admin_id"),
        handler: () => ({ rows: [{ pk: 5, value: 42 }] }),
      },
    ]);

    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("needs-human");
    expect(findings[0].repair).toBeUndefined();
  });

  it("reports nothing when the count is zero", async () => {
    const ctx = ctxWith({
      tables: ["users", "admin_audit_log"],
      columnsDetailed: {
        ...usersOnly,
        admin_audit_log: [
          { name: "id", dataType: "integer", isNullable: false },
          { name: "target_user_id", dataType: "integer", isNullable: true },
        ],
      },
      primaryKeys: { users: ["id"], admin_audit_log: ["id"] },
      foreignKeys: [
        {
          constraintName: "fk_target_user",
          childTable: "admin_audit_log",
          childColumn: "target_user_id",
          parentTable: "users",
          parentColumn: "id",
          deleteRule: "NO ACTION",
        },
      ],
    });
    const pool = makeQueryRouterPool([
      { match: contains("COUNT(*)"), handler: () => ({ rows: [{ n: 0 }] }) },
    ]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
  });
});

describe("fk-orphans: implied FKs (naming convention, no declared constraint)", () => {
  it("flags access_rules.created_by as implied and always needs-human", async () => {
    const ctx = ctxWith({
      tables: ["users", "access_rules"],
      columnsDetailed: {
        ...usersOnly,
        access_rules: [
          { name: "id", dataType: "integer", isNullable: false },
          { name: "created_by", dataType: "integer", isNullable: true },
        ],
      },
      primaryKeys: { users: ["id"], access_rules: ["id"] },
    });
    const pool = makeQueryRouterPool([
      {
        match: containsAll("COUNT(*)", "access_rules", "created_by"),
        handler: () => ({ rows: [{ n: 2 }] }),
      },
      {
        match: containsAll("SELECT c.", "access_rules", "created_by"),
        handler: () => ({ rows: [{ pk: 1, value: 77 }] }),
      },
    ]);

    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(1);
    const created = findings[0];
    expect(created.confidence).toBe("implied");
    expect(created.severity).toBe("needs-human");
    expect(created.repair).toBeUndefined();
  });

  it("does not re-check a column that already has a declared FK", async () => {
    const ctx = ctxWith({
      tables: ["users", "access_rules"],
      columnsDetailed: {
        ...usersOnly,
        access_rules: [
          { name: "id", dataType: "integer", isNullable: false },
          { name: "created_by", dataType: "integer", isNullable: true },
        ],
      },
      primaryKeys: { users: ["id"], access_rules: ["id"] },
      foreignKeys: [
        {
          constraintName: "fk_access_rules_created_by",
          childTable: "access_rules",
          childColumn: "created_by",
          parentTable: "users",
          parentColumn: "id",
          deleteRule: "SET NULL",
        },
      ],
    });
    const pool = makeQueryRouterPool([
      { match: contains("COUNT(*)"), handler: () => ({ rows: [{ n: 0 }] }) },
    ]);
    const { findings } = await diagnose(pool, ctx);
    // Exactly one query pair issued (the declared-tier check), not two.
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(findings).toHaveLength(0);
  });

  it("never guesses a parent table that doesn't exist (no false positive, no query issued)", async () => {
    const ctx = ctxWith({
      tables: ["widgets"],
      columnsDetailed: {
        widgets: [
          { name: "id", dataType: "integer", isNullable: false },
          { name: "gadget_id", dataType: "integer", isNullable: true }, // no "gadgets"/"gadget" table exists
        ],
      },
      primaryKeys: { widgets: ["id"] },
    });
    const pool = makeQueryRouterPool([]); // any query call is a bug -- throws
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("never treats a table's own id column as a candidate", async () => {
    const ctx = ctxWith({
      tables: ["users"],
      columnsDetailed: usersOnly,
      primaryKeys: { users: ["id"] },
    });
    const pool = makeQueryRouterPool([]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
