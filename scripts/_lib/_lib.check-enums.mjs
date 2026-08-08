/**
 * VulnRadar — Enum/status column consistency.
 *
 * Two sources, both schema-driven or code-cited (never guessed):
 *   1. DB-level CHECK constraints, discovered generically from the live
 *      database via getCheckConstraintEnums() -- these are already
 *      Postgres-enforced, so a violation here is a strong signal
 *      something bypassed normal writes.
 *   2. Application-level-only enums (APP_ENUM_COLUMNS) for columns that
 *      have NO DB constraint at all -- role, plan, subscription_status,
 *      two_factor_method, team_members.role. See _lib.app-enums.mjs for
 *      exactly where each value list was read from.
 *
 * Always needs-human: picking a "correct" replacement value for a
 * corrupted enum is a product/business decision (which real value did
 * this used to be?), not something this tool can infer.
 */
import { APP_ENUM_COLUMNS } from "./_lib.app-enums.mjs";

/**
 * @param {{query: Function}} pool
 * @param {{tables: Set<string>, columnsDetailed: object, primaryKeys: object, checkConstraintEnums: object[]}} ctx
 * @returns {Promise<{findings: import('./_lib.corruption-orchestrator.mjs').Finding[], meta: object}>}
 */
export async function diagnose(pool, ctx) {
  const { tables, columnsDetailed, primaryKeys, checkConstraintEnums } = ctx;
  const findings = [];

  const specs = [
    ...checkConstraintEnums.map((c) => ({
      table: c.table,
      column: c.column,
      values: c.values,
      nullable: true, // unknown from this view; treat conservatively (skip NULLs either way)
      source: `DB CHECK constraint ${c.constraintName} (already Postgres-enforced)`,
    })),
    ...APP_ENUM_COLUMNS,
  ];

  for (const spec of specs) {
    if (!tables.has(spec.table)) continue;
    if (!columnsDetailed[spec.table]?.some((c) => c.name === spec.column))
      continue;

    const placeholders = spec.values.map((_, i) => `$${i + 1}`).join(", ");
    const nullGuard = spec.nullable ? `"${spec.column}" IS NOT NULL AND ` : "";
    const whereClause = `${nullGuard}"${spec.column}" NOT IN (${placeholders})`;
    const pk = (primaryKeys[spec.table] || ["id"])[0];

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "${spec.table}" WHERE ${whereClause}`,
      spec.values,
    );
    const count = countRes.rows[0]?.n ?? 0;
    if (count === 0) continue;

    const sampleRes = await pool.query(
      `SELECT "${pk}" AS pk, "${spec.column}" AS value FROM "${spec.table}" WHERE ${whereClause} LIMIT 5`,
      spec.values,
    );

    findings.push({
      category: "enum_violation",
      severity: "needs-human",
      table: spec.table,
      column: spec.column,
      description: `${count} row(s) have a ${spec.table}.${spec.column} value outside the recognized set {${spec.values.join(", ")}} (source: ${spec.source}). No safe automatic replacement -- which real value this used to be is a judgment call.`,
      count,
      examples: sampleRes.rows.map((r) => ({
        pk: r.pk,
        detail: String(r.value),
      })),
    });
  }

  return { findings, meta: { specsChecked: specs.length } };
}
