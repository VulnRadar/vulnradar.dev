import { describe, it, expect } from "vitest";
import { encryptApiKey } from "@/lib/auth/crypto";
import { generateSecret } from "@/lib/auth/totp";
import { runDiagnostics } from "../../../scripts/maintenance/db-diagnose.mjs";
import { flattenFindings } from "../../../scripts/_lib/_lib.corruption-orchestrator.mjs";
import { makeLenientPool } from "../_orchestration-pg-mock";

describe("db-diagnose.mjs runDiagnostics: wiring", () => {
  it("is entirely read-only: never issues a write statement", async () => {
    const pool = makeLenientPool();
    await runDiagnostics(pool);
    for (const call of pool.query.mock.calls) {
      const sql = String(call[0]).trim().toUpperCase();
      expect(
        sql.startsWith("INSERT") ||
          sql.startsWith("UPDATE") ||
          sql.startsWith("DELETE"),
      ).toBe(false);
    }
  });

  it("reports zero findings across every category on a minimal, clean schema", async () => {
    const pool = makeLenientPool();
    const { results, twoFactor } = await runDiagnostics(pool);
    expect(flattenFindings(results)).toEqual([]);
    expect(twoFactor.fatal).toBeUndefined();
    expect(twoFactor.totpEnabledUsers).toBe(0);
  });

  it("folds an fk_orphans finding from a widened schema into the results map", async () => {
    const pool = makeLenientPool({
      tableNames: ["users", "access_rules"],
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
          table_name: "access_rules",
          column_name: "id",
          data_type: "integer",
          is_nullable: "NO",
          column_default: null,
        },
        {
          table_name: "access_rules",
          column_name: "created_by",
          data_type: "integer",
          is_nullable: "YES",
          column_default: null,
        },
      ],
      primaryKeyRows: [
        { table_name: "users", column_name: "id" },
        { table_name: "access_rules", column_name: "id" },
      ],
      overrides: [
        {
          match: (sql) =>
            sql.includes("COUNT(*)") &&
            sql.includes("access_rules") &&
            sql.includes("created_by"),
          handler: () => ({ rows: [{ n: 1 }] }),
        },
        {
          match: (sql) =>
            sql.includes("SELECT c.") &&
            sql.includes("access_rules") &&
            sql.includes("created_by"),
          handler: () => ({ rows: [{ pk: 1, value: 999 }] }),
        },
      ],
    });

    const { results } = await runDiagnostics(pool);
    expect(results.fk_orphans.findings).toHaveLength(1);
    expect(results.fk_orphans.findings[0].confidence).toBe("implied");
  });

  it("folds the 2FA tool's own findings into the report instead of reimplementing them", async () => {
    const key = "a".repeat(64);
    const saved = process.env.API_KEY_ENCRYPTION_KEY;
    process.env.API_KEY_ENCRYPTION_KEY = key;
    try {
      const pool = makeLenientPool({
        overrides: [
          {
            match: (sql) =>
              sql.includes("FROM users WHERE totp_enabled = true"),
            handler: () => ({
              rows: [
                {
                  id: 1,
                  totp_enabled: true,
                  totp_secret: encryptApiKey(generateSecret()),
                  backup_codes: "{not valid json",
                  two_factor_method: "app",
                },
              ],
            }),
          },
        ],
      });
      const { twoFactor } = await runDiagnostics(pool);
      expect(twoFactor.totpEnabledUsers).toBe(1);
      expect(twoFactor.userResults[0].repairEligible).toBe(true);
    } finally {
      process.env.API_KEY_ENCRYPTION_KEY = saved;
    }
  });
});
