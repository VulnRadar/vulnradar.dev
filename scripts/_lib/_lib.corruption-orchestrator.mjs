/**
 * VulnRadar — Shared orchestration for scripts/maintenance/db-diagnose.mjs and
 * scripts/maintenance/db-repair.mjs.
 *
 * Builds the introspection context ONCE (columns, primary keys, FK
 * constraints, CHECK-constraint enums) and runs every check module
 * against it. Both CLIs use this so "what counts as a finding" is
 * defined in exactly one place, same principle as
 * scripts/_lib/_lib.2fa-diagnostics.mjs for the 2FA-specific tool.
 *
 * @typedef {{
 *   category: string,
 *   severity: "auto-fixable" | "needs-human",
 *   confidence?: "declared" | "implied",
 *   table: string,
 *   column: string,
 *   description: string,
 *   count: number,
 *   examples: Array<{pk: unknown, detail?: string}>,
 *   repair?: {sql: string, params: unknown[], description: string},
 * }} Finding
 */
import {
  getColumnsDetailed,
  getPrimaryKeys,
  getForeignKeys,
  getCheckConstraintEnums,
  getTableNames,
} from "./_lib.schema-introspect.mjs";
import * as fkOrphans from "./_lib.check-fk-orphans.mjs";
import * as encryptedColumns from "./_lib.check-encrypted-columns.mjs";
import * as jsonShape from "./_lib.check-json-shape.mjs";
import * as enums from "./_lib.check-enums.mjs";
import * as crossColumn from "./_lib.check-cross-column.mjs";
import * as timestamps from "./_lib.check-timestamps.mjs";

export const CHECK_MODULES = [
  { key: "fk_orphans", label: "Foreign-key orphans", module: fkOrphans },
  {
    key: "encrypted_columns",
    label: "Encrypted-column decrypt failures",
    module: encryptedColumns,
  },
  { key: "json_shape", label: "JSON/JSONB shape", module: jsonShape },
  { key: "enums", label: "Enum/status consistency", module: enums },
  {
    key: "cross_column",
    label: "Cross-column state consistency",
    module: crossColumn,
  },
  { key: "timestamps", label: "Timestamp sanity", module: timestamps },
];

/**
 * @param {{query: Function}} pool
 */
export async function buildContext(pool) {
  const [
    tableNames,
    columnsDetailed,
    primaryKeys,
    foreignKeys,
    checkConstraintEnums,
  ] = await Promise.all([
    getTableNames(pool),
    getColumnsDetailed(pool),
    getPrimaryKeys(pool),
    getForeignKeys(pool),
    getCheckConstraintEnums(pool),
  ]);
  return {
    tables: new Set(tableNames),
    columnsDetailed,
    primaryKeys,
    foreignKeys,
    checkConstraintEnums,
  };
}

/**
 * Runs every check module and returns { [key]: { findings, meta } }.
 * Findings vary in shape by category (e.g. only fk_orphan findings carry
 * a `confidence` field), so they're typed loosely here rather than
 * forcing a lowest-common-denominator interface across six categories.
 * @param {{query: Function}} pool
 * @param {object} ctx  from buildContext()
 * @returns {Promise<Record<string, {findings: Finding[], meta: object}>>}
 */
export async function runAllChecks(pool, ctx) {
  const results = {};
  for (const { key, module } of CHECK_MODULES) {
    results[key] = await module.diagnose(pool, ctx);
  }
  return results;
}

/**
 * Flattens the per-module results map into one array of findings.
 * @param {Record<string, {findings: Finding[], meta: object}>} results
 * @returns {Finding[]}
 */
export function flattenFindings(results) {
  return Object.values(results).flatMap((r) => r.findings);
}
