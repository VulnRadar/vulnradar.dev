/**
 * VulnRadar — Foreign-key orphan detection.
 *
 * Two tiers, clearly distinguished in the finding's `confidence` field:
 *
 *   "declared" -- a real FOREIGN KEY constraint currently exists on the
 *     live database (from getForeignKeys()). Postgres already enforces
 *     this, so an orphan here should be rare; still checked because it's
 *     cheap and a real signal if it ever fires (NOT VALID constraints,
 *     bulk-loaded data, etc.).
 *
 *   "implied" -- no FK constraint is declared on this column on THIS
 *     database, but the column's name plausibly references another
 *     table's primary key (e.g. `user_id` -> `users.id`). Production is
 *     an old v2 schema; instrumentation.ts adds several of these FKs via
 *     a self-healing ALTER TABLE on boot (fk_admin_audit_target_user,
 *     fk_access_rules_created_by) that a 2.3.2 deployment's OWN
 *     instrumentation.ts may not even contain yet, so the relationship
 *     can be real without Postgres enforcing it at all on production.
 *     Never auto-fixed (see checkFkOrphans below) -- a naming guess is
 *     not proof, so treat it as needing a human even when nullable.
 *
 * Auto-fix rule (declared FKs only): the child column is nullable ->
 * repair SETs it to NULL. This produces exactly the end state a real
 * `ON DELETE SET NULL` constraint would have produced automatically, had
 * one existed when the parent row was deleted -- see
 * app/api/v3/account/delete/route.ts, which already does this by hand
 * for the two FK columns in this schema that have no ON DELETE clause at
 * all (security_alerts.resolved_by, system_settings.updated_by). A
 * NOT NULL orphaned column can't be nulled and inventing a replacement
 * parent id would be a guess, so it is always needs-human.
 */

// Column-name -> parent-table hints for cases plain singularization gets
// wrong (irregular table names) or ambiguous (an actor/audit column that
// isn't named after its own concept, e.g. `resolved_by` -> users).
const IRREGULAR_PARENT_HINTS = {
  admin_id: "users",
  owner_id: "users",
  target_user_id: "users",
  created_by: "users",
  updated_by: "users",
  resolved_by: "users",
  invited_by: "users",
  gifted_by: "users",
  revoked_by: "users",
  awarded_by: "users",
  scan_id: "scan_history",
  api_key_id: "api_keys",
  message_id: "broadcast_messages",
  badge_id: "badges",
};

function guessParentTable(columnName, tableSet) {
  const hint = IRREGULAR_PARENT_HINTS[columnName];
  if (hint && tableSet.has(hint)) return hint;
  if (!columnName.endsWith("_id")) return null;
  const base = columnName.slice(0, -3);
  for (const candidate of [`${base}s`, base, `${base}es`]) {
    if (tableSet.has(candidate)) return candidate;
  }
  return null;
}

async function countAndSample(
  pool,
  childTable,
  childColumn,
  parentTable,
  parentColumn,
  pk,
) {
  const whereClause = `c."${childColumn}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${parentTable}" p WHERE p."${parentColumn}" = c."${childColumn}")`;
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM "${childTable}" c WHERE ${whereClause}`,
  );
  const count = countRes.rows[0]?.n ?? 0;
  if (count === 0) return null;
  const sampleRes = await pool.query(
    `SELECT c."${pk}" AS pk, c."${childColumn}" AS value FROM "${childTable}" c WHERE ${whereClause} LIMIT 5`,
  );
  return {
    count,
    examples: sampleRes.rows.map((r) => ({
      pk: r.pk,
      detail: `${childColumn}=${r.value}`,
    })),
    whereClause,
  };
}

/**
 * @param {{query: Function}} pool
 * @param {{tables: Set<string>, columnsDetailed: object, primaryKeys: object, foreignKeys: object[]}} ctx
 * @returns {Promise<{findings: import('./_lib.corruption-orchestrator.mjs').Finding[], meta: object}>}
 */
export async function diagnose(pool, ctx) {
  const { tables, columnsDetailed, primaryKeys, foreignKeys } = ctx;
  const findings = [];
  const declaredColumns = new Set(
    foreignKeys.map((fk) => `${fk.childTable}.${fk.childColumn}`),
  );

  // --- Tier 1: declared FK constraints ---
  for (const fk of foreignKeys) {
    if (!tables.has(fk.childTable) || !tables.has(fk.parentTable)) continue;
    const pk = (primaryKeys[fk.childTable] || ["id"])[0];
    const childCol = columnsDetailed[fk.childTable]?.find(
      (c) => c.name === fk.childColumn,
    );
    const hit = await countAndSample(
      pool,
      fk.childTable,
      fk.childColumn,
      fk.parentTable,
      fk.parentColumn,
      pk,
    );
    if (!hit) continue;
    const nullable = childCol ? childCol.isNullable : false;
    findings.push({
      category: "fk_orphan",
      severity: nullable ? "auto-fixable" : "needs-human",
      confidence: "declared",
      table: fk.childTable,
      column: fk.childColumn,
      description: `${fk.childTable}.${fk.childColumn} references ${fk.parentTable}.${fk.parentColumn} (declared FK constraint ${fk.constraintName}); ${hit.count} row(s) point at a parent that no longer exists.${nullable ? "" : " Column is NOT NULL, so the row can't be nulled or safely completed without inventing a value -- needs a human decision (fix the parent reference or delete the orphaned row)."}`,
      count: hit.count,
      examples: hit.examples,
      repair: nullable
        ? {
            sql: `UPDATE "${fk.childTable}" c SET "${fk.childColumn}" = NULL WHERE ${hit.whereClause}`,
            params: [],
            description: `SET ${fk.childTable}.${fk.childColumn} = NULL for ${hit.count} orphaned row(s) (parent ${fk.parentTable} row no longer exists).`,
          }
        : undefined,
    });
  }

  // --- Tier 2: implied FKs (naming convention, no declared constraint) ---
  for (const [table, cols] of Object.entries(columnsDetailed)) {
    if (!tables.has(table)) continue;
    for (const col of cols) {
      if (declaredColumns.has(`${table}.${col.name}`)) continue;
      if (col.name === "id") continue; // never guess a table's own PK
      const isCandidate = col.name.endsWith("_id") || col.name.endsWith("_by");
      if (!isCandidate) continue;
      const parentTable = guessParentTable(col.name, tables);
      if (!parentTable || parentTable === table) continue;
      const parentPk = (primaryKeys[parentTable] || ["id"])[0];
      if (!columnsDetailed[parentTable]?.some((c) => c.name === parentPk))
        continue;
      const pk = (primaryKeys[table] || ["id"])[0];
      const hit = await countAndSample(
        pool,
        table,
        col.name,
        parentTable,
        parentPk,
        pk,
      );
      if (!hit) continue;
      findings.push({
        category: "fk_orphan",
        severity: "needs-human",
        confidence: "implied",
        table,
        column: col.name,
        description: `${table}.${col.name} looks like it references ${parentTable}.${parentPk} by naming convention, but no FK constraint is declared on this database (plausible on the v2 production schema, which predates some of instrumentation.ts's self-healing FK additions). ${hit.count} row(s) point at a value with no matching ${parentTable} row. Not auto-fixed: a naming guess isn't proof this is really a foreign key.`,
        count: hit.count,
        examples: hit.examples,
        // No `repair` -- implied relationships are never auto-fixed, see file header.
      });
    }
  }

  return { findings, meta: { declaredFksChecked: foreignKeys.length } };
}
