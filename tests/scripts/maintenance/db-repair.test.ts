import { describe, it, expect, vi } from "vitest";
import {
  runRepairPlan,
  runRepair,
} from "../../../scripts/maintenance/db-repair.mjs";
import { makeLenientPool } from "../_orchestration-pg-mock";
import { buildMockClient } from "../_pg-mock";

/**
 * Uses the same "disabled user with a surviving session" cross-column
 * rule (already unit-tested in tests/scripts/_lib.check-cross-column.test.ts)
 * as a simple, real auto-fixable finding to drive the repair CLI's own
 * generic apply/dry-run/transaction-isolation behavior -- this suite is
 * about the CLI's wiring and safety guarantees, not re-verifying which
 * findings are auto-fixable (that's the check modules' job).
 */
const SCHEMA_WITH_SESSIONS = {
  tableNames: ["users", "sessions"],
  columnsRows: [
    {
      table_name: "users",
      column_name: "id",
      data_type: "integer",
      is_nullable: "NO",
      column_default: null,
    },
    {
      table_name: "users",
      column_name: "totp_enabled",
      data_type: "boolean",
      is_nullable: "NO",
      column_default: "false",
    },
    {
      table_name: "users",
      column_name: "totp_secret",
      data_type: "character varying",
      is_nullable: "YES",
      column_default: null,
    },
    {
      table_name: "users",
      column_name: "backup_codes",
      data_type: "text",
      is_nullable: "YES",
      column_default: null,
    },
    {
      table_name: "users",
      column_name: "two_factor_method",
      data_type: "character varying",
      is_nullable: "YES",
      column_default: null,
    },
    {
      table_name: "users",
      column_name: "disabled_at",
      data_type: "timestamp with time zone",
      is_nullable: "YES",
      column_default: null,
    },
    {
      table_name: "sessions",
      column_name: "id",
      data_type: "integer",
      is_nullable: "NO",
      column_default: null,
    },
    {
      table_name: "sessions",
      column_name: "user_id",
      data_type: "integer",
      is_nullable: "NO",
      column_default: null,
    },
  ],
  primaryKeyRows: [
    { table_name: "users", column_name: "id" },
    { table_name: "sessions", column_name: "id" },
  ],
};

function poolWithOneOrphanedSession(
  adminRows: Array<{ id: number; email: string; role: string }> = [],
) {
  return makeLenientPool({
    ...SCHEMA_WITH_SESSIONS,
    overrides: [
      {
        match: (sql) => sql.includes("COUNT(*)") && sql.includes("sessions"),
        handler: () => ({ rows: [{ n: 2 }] }),
      },
      {
        match: (sql) => sql.includes("s.user_id AS pk"),
        handler: () => ({ rows: [{ pk: 5 }] }),
      },
      {
        match: (sql) =>
          sql.includes("SELECT id, email, role FROM users WHERE id = $1"),
        handler: (_sql, params) => ({
          rows: adminRows.filter((r) => r.id === params?.[0]),
        }),
      },
    ],
  });
}

describe("runRepairPlan", () => {
  it("classifies findings without ever writing", async () => {
    const pool = poolWithOneOrphanedSession();
    const { autoFixable, needsHuman } = await runRepairPlan(pool);
    expect(autoFixable.some((f) => f.table === "sessions")).toBe(true);
    expect(Array.isArray(needsHuman)).toBe(true);
    for (const call of pool.query.mock.calls) {
      const sql = String(call[0]).trim().toUpperCase();
      expect(
        sql.startsWith("INSERT") ||
          sql.startsWith("UPDATE") ||
          sql.startsWith("DELETE"),
      ).toBe(false);
    }
  });
});

describe("runRepair: dry run (default) makes zero writes", () => {
  it("never calls pool.connect", async () => {
    const pool = poolWithOneOrphanedSession();
    const result = await runRepair(pool, { apply: false });
    expect(result.dryRun).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.backupFile).toBeNull();
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe("runRepair: apply mode", () => {
  it("requires a valid admin id that exists in users", async () => {
    const pool = poolWithOneOrphanedSession([]);
    await expect(
      runRepair(pool, { apply: true, adminId: 999 }),
    ).rejects.toThrow(/does not match any row/);
  });

  it("applies only the auto-fixable finding, writes a backup, and audit-logs it", async () => {
    const pool = poolWithOneOrphanedSession([
      { id: 10, email: "admin@example.com", role: "admin" },
    ]);
    const client = buildMockClient(async () => ({ rows: [] }));
    pool.connect = vi.fn().mockResolvedValueOnce(client);

    interface RepairBackupEntry {
      category: string;
      table: string;
      column: string;
      description: string;
      count: number;
      examples: unknown[];
    }
    const writeBackupFile = vi.fn(
      (_args: {
        timestamp: Date;
        adminId: number;
        entries: RepairBackupEntry[];
      }) => "/fake/path.json",
    );
    const result = await runRepair(pool, {
      apply: true,
      adminId: 10,
      writeBackupFile,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(result.backupFile).toBe("/fake/path.json");
    expect(writeBackupFile).toHaveBeenCalledTimes(1);
    const backupArg = writeBackupFile.mock.calls[0]?.[0];
    expect(backupArg?.adminId).toBe(10);
    expect(backupArg?.entries.some((e) => e.table === "sessions")).toBe(true);

    const sqlCalls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls).toContain("BEGIN");
    expect(sqlCalls.some((s) => s.includes("DELETE FROM sessions"))).toBe(true);
    expect(sqlCalls.some((s) => s.includes("admin_audit_log"))).toBe(true);
    expect(sqlCalls).toContain("COMMIT");

    const auditCall = client.query.mock.calls.find((c) =>
      String(c[0]).includes("admin_audit_log"),
    );
    expect(auditCall?.[1]).toEqual([
      10,
      null,
      "data_integrity_repair",
      expect.any(String),
      null,
    ]);

    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "sessions", ok: true }),
      ]),
    );
  });

  it("one finding's transaction failure does not roll back or block another finding's fix", async () => {
    // Widen the schema so TWO independent auto-fixable findings exist:
    // the sessions cross-column rule plus a nullable declared-FK orphan.
    const pool = makeLenientPool({
      tableNames: ["users", "sessions", "admin_audit_log"],
      columnsRows: [
        ...SCHEMA_WITH_SESSIONS.columnsRows,
        {
          table_name: "admin_audit_log",
          column_name: "id",
          data_type: "integer",
          is_nullable: "NO",
          column_default: null,
        },
        {
          table_name: "admin_audit_log",
          column_name: "target_user_id",
          data_type: "integer",
          is_nullable: "YES",
          column_default: null,
        },
      ],
      primaryKeyRows: [
        ...SCHEMA_WITH_SESSIONS.primaryKeyRows,
        { table_name: "admin_audit_log", column_name: "id" },
      ],
      foreignKeyRows: [
        {
          constraint_name: "fk_target_user",
          child_table: "admin_audit_log",
          child_column: "target_user_id",
          parent_table: "users",
          parent_column: "id",
          delete_rule: "NO ACTION",
        },
      ],
      overrides: [
        {
          match: (sql) => sql.includes("COUNT(*)") && sql.includes("sessions"),
          handler: () => ({ rows: [{ n: 1 }] }),
        },
        {
          match: (sql) => sql.includes("s.user_id AS pk"),
          handler: () => ({ rows: [{ pk: 5 }] }),
        },
        {
          match: (sql) =>
            sql.includes("COUNT(*)") &&
            sql.includes("admin_audit_log") &&
            sql.includes("target_user_id"),
          handler: () => ({ rows: [{ n: 1 }] }),
        },
        {
          match: (sql) =>
            sql.includes("SELECT c.") &&
            sql.includes("admin_audit_log") &&
            sql.includes("target_user_id"),
          handler: () => ({ rows: [{ pk: 1, value: 999 }] }),
        },
        {
          match: (sql) =>
            sql.includes("SELECT id, email, role FROM users WHERE id = $1"),
          handler: () => ({
            rows: [{ id: 10, email: "admin@example.com", role: "admin" }],
          }),
        },
      ],
    });

    const { autoFixable } = await runRepairPlan(pool);
    expect(autoFixable.length).toBeGreaterThanOrEqual(2);

    // First finding's client fails on its repair UPDATE/DELETE (never on
    // BEGIN or the admin_audit_log INSERT); second client succeeds
    // throughout. Matched by statement type, not by "admin_audit_log",
    // since the FK-orphan repair's own UPDATE also targets that table.
    const failingClient = buildMockClient((sql: string) => {
      if (sql === "BEGIN" || sql.startsWith("INSERT INTO admin_audit_log")) {
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE") || sql.startsWith("DELETE")) {
        throw new Error("simulated failure");
      }
      return { rows: [] };
    });
    const okClient = buildMockClient(async () => ({ rows: [] }));
    pool.connect = vi
      .fn()
      .mockResolvedValueOnce(failingClient)
      .mockResolvedValueOnce(okClient);

    const result = await runRepair(pool, {
      apply: true,
      adminId: 10,
      writeBackupFile: () => "/x.json",
    });

    expect(result.results).toHaveLength(2);
    expect(result.results.some((r) => r.ok === false)).toBe(true);
    expect(result.results.some((r) => r.ok === true)).toBe(true);
    expect(failingClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(okClient.query).toHaveBeenCalledWith("COMMIT");
    expect(failingClient.release).toHaveBeenCalled();
    expect(okClient.release).toHaveBeenCalled();
  });
});
