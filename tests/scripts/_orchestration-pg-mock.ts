import { vi, type Mock } from "vitest";

/**
 * Lenient mock pool for the scripts/maintenance/db-diagnose.mjs / scripts/maintenance/db-repair.mjs
 * orchestration suites, which exercise the WIRING across every check
 * module at once (already unit-tested individually in
 * tests/scripts/_lib.check-*.test.ts) rather than re-verifying each
 * category's internal logic. Naming every query text these two CLIs and
 * the six check modules combined can issue would be impractical and
 * wouldn't add coverage over the focused per-module suites, so unmatched
 * queries fall through to a safe, zero-findings default instead of
 * throwing.
 *
 * Introspection defaults to a minimal but coherent schema: just `users`
 * with the five columns scripts/maintenance/db-diagnose-2fa.mjs requires, no other
 * tables. That's enough for every check module to run and legitimately
 * find nothing. Pass `overrides` (checked before any default) to widen
 * the schema or inject specific COUNT/SELECT results for a test.
 */
const DEFAULT_COLUMNS = [
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
];

interface LenientPoolOptions {
  columnsRows?: typeof DEFAULT_COLUMNS;
  tableNames?: string[];
  primaryKeyRows?: Array<{ table_name: string; column_name: string }>;
  foreignKeyRows?: unknown[];
  checkConstraintRows?: unknown[];
  overrides?: Array<{
    match: (sql: string) => boolean;
    handler: (sql: string, params?: unknown[]) => unknown;
  }>;
}

export function makeLenientPool({
  columnsRows = DEFAULT_COLUMNS,
  tableNames = ["users"],
  primaryKeyRows = [{ table_name: "users", column_name: "id" }],
  foreignKeyRows = [],
  checkConstraintRows = [],
  overrides = [],
}: LenientPoolOptions = {}) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    for (const o of overrides) {
      if (o.match(sql)) return o.handler(sql, params);
    }
    if (sql.includes("information_schema.check_constraints")) {
      return { rows: checkConstraintRows };
    }
    if (
      sql.includes("information_schema.table_constraints") &&
      sql.includes("'PRIMARY KEY'")
    ) {
      return { rows: primaryKeyRows };
    }
    if (
      sql.includes("information_schema.table_constraints") &&
      sql.includes("'FOREIGN KEY'")
    ) {
      return { rows: foreignKeyRows };
    }
    if (sql.includes("information_schema.columns")) {
      return { rows: columnsRows };
    }
    if (sql.includes("information_schema.tables")) {
      return { rows: tableNames.map((t) => ({ table_name: t })) };
    }
    if (sql.includes("SELECT COUNT(*)::int AS n FROM users")) {
      return { rows: [{ n: 0 }] };
    }
    if (sql.includes("FROM users WHERE totp_enabled = true")) {
      return { rows: [] };
    }
    if (sql.includes("FROM email_2fa_codes")) {
      return { rows: [] };
    }
    if (sql.toUpperCase().includes("COUNT(*)")) {
      return { rows: [{ n: 0 }] };
    }
    return { rows: [] };
  });

  // Defaults to throwing, matching tests/scripts/_pg-mock.ts's
  // buildMockPool convention: a repair CLI's dry-run path must never call
  // pool.connect() at all, so an unmocked call fails the test immediately
  // instead of silently succeeding. Assign `pool.connect = vi.fn()...` to
  // override, same as with buildMockPool.
  const connect: Mock<(...args: unknown[]) => Promise<unknown>> = vi.fn(
    async () => {
      throw new Error(
        "pool.connect() was not expected to be called in this test -- pass connect: ... via overrides or assign pool.connect to override.",
      );
    },
  );

  return { query, connect };
}
