import { describe, it, expect, vi } from "vitest";
import {
  getColumnsDetailed,
  getPrimaryKeys,
  getForeignKeys,
  getCheckConstraintEnums,
  getTableNames,
} from "../../scripts/_lib/_lib.schema-introspect.mjs";

function poolReturning(rows: unknown[]) {
  return { query: vi.fn(async () => ({ rows })) };
}

describe("getColumnsDetailed", () => {
  it("groups columns by table with type/nullability/default", async () => {
    const pool = poolReturning([
      {
        table_name: "users",
        column_name: "ID",
        data_type: "integer",
        is_nullable: "NO",
        column_default: null,
      },
      {
        table_name: "users",
        column_name: "email",
        data_type: "character varying",
        is_nullable: "NO",
        column_default: null,
      },
      {
        table_name: "sessions",
        column_name: "user_id",
        data_type: "integer",
        is_nullable: "YES",
        column_default: null,
      },
    ]);
    const result = await getColumnsDetailed(pool);
    expect(result.users).toEqual([
      {
        name: "id",
        dataType: "integer",
        isNullable: false,
        columnDefault: null,
      },
      {
        name: "email",
        dataType: "character varying",
        isNullable: false,
        columnDefault: null,
      },
    ]);
    expect(result.sessions[0].isNullable).toBe(true);
  });
});

describe("getPrimaryKeys", () => {
  it("returns table -> [pk columns], lowercased", async () => {
    const pool = poolReturning([
      { table_name: "users", column_name: "ID" },
      { table_name: "team_members", column_name: "id" },
    ]);
    const result = await getPrimaryKeys(pool);
    expect(result).toEqual({ users: ["id"], team_members: ["id"] });
  });
});

describe("getForeignKeys", () => {
  it("maps the join result into a flat, lowercased FK list", async () => {
    const pool = poolReturning([
      {
        constraint_name: "fk_admin_audit_target_user",
        child_table: "admin_audit_log",
        child_column: "TARGET_USER_ID",
        parent_table: "users",
        parent_column: "ID",
        delete_rule: "SET NULL",
      },
    ]);
    const result = await getForeignKeys(pool);
    expect(result).toEqual([
      {
        constraintName: "fk_admin_audit_target_user",
        childTable: "admin_audit_log",
        childColumn: "target_user_id",
        parentTable: "users",
        parentColumn: "id",
        deleteRule: "SET NULL",
      },
    ]);
  });
});

describe("getCheckConstraintEnums", () => {
  it("extracts the value list from Postgres's normalized ANY(ARRAY[...]) rendering", async () => {
    const pool = poolReturning([
      {
        table_name: "scan_history",
        column_name: "STATUS",
        constraint_name: "scan_history_status_check",
        check_clause:
          "((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]))",
      },
    ]);
    const result = await getCheckConstraintEnums(pool);
    expect(result).toEqual([
      {
        table: "scan_history",
        column: "status",
        constraintName: "scan_history_status_check",
        values: ["pending", "running", "completed", "failed"],
      },
    ]);
  });

  it("ignores a non-enum CHECK constraint with fewer than two quoted literals", async () => {
    const pool = poolReturning([
      {
        table_name: "vulnradar_schema_meta",
        column_name: "id",
        constraint_name: "vulnradar_schema_meta_id_check",
        check_clause: "(id = 1)",
      },
    ]);
    const result = await getCheckConstraintEnums(pool);
    expect(result).toEqual([]);
  });

  it("de-duplicates repeated literals", async () => {
    const pool = poolReturning([
      {
        table_name: "t",
        column_name: "c",
        constraint_name: "t_c_check",
        check_clause:
          "((c)::text = ANY (ARRAY['a'::text, 'a'::text, 'b'::text]))",
      },
    ]);
    const result = await getCheckConstraintEnums(pool);
    expect(result[0].values).toEqual(["a", "b"]);
  });

  it("handles the simpler IN (...) rendering some Postgres versions may use", async () => {
    const pool = poolReturning([
      {
        table_name: "access_rules",
        column_name: "value_type",
        constraint_name: "access_rules_value_type_check",
        check_clause: "value_type IN ('ip', 'url')",
      },
    ]);
    const result = await getCheckConstraintEnums(pool);
    expect(result[0].values).toEqual(["ip", "url"]);
  });
});

describe("getTableNames", () => {
  it("returns the plain table name list", async () => {
    const pool = poolReturning([
      { table_name: "users" },
      { table_name: "sessions" },
    ]);
    expect(await getTableNames(pool)).toEqual(["users", "sessions"]);
  });
});
