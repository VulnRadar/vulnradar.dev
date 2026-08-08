/**
 * VulnRadar — General schema introspection for scripts/db-diagnose.mjs and
 * scripts/db-repair.mjs.
 *
 * Everything here is derived from information_schema / pg_catalog at
 * runtime against whatever database DATABASE_URL points at -- nothing
 * hardcodes a table or column name. scripts/_lib/_lib.schema.mjs already
 * provides a lighter-weight `getActualSchema` (table -> column names only)
 * for the migration tooling; this module adds the richer detail (types,
 * nullability, foreign keys, check-constraint enums, primary keys) the
 * general corruption checks need, without changing that existing file.
 *
 * IMPORTANT CAVEAT (stated plainly, not assumed away): these queries were
 * written against the standard, long-stable information_schema/pg_catalog
 * views and follow the same join patterns Postgres documents, but they
 * have not been run against a live Postgres instance in this environment
 * (no local Postgres/Docker was available while building this). Run
 * `npm run db:diagnose` (always read-only) against a staging copy first
 * to confirm the introspection queries behave as expected before relying
 * on this against production.
 */

/**
 * @param {{query: Function}} pool
 * @returns {Promise<Record<string, {name: string, dataType: string, isNullable: boolean, columnDefault: unknown}[]>>}
 */
export async function getColumnsDetailed(pool) {
  const res = await pool.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const tables = {};
  for (const row of res.rows) {
    const t = row.table_name;
    if (!tables[t]) tables[t] = [];
    tables[t].push({
      name: row.column_name.toLowerCase(),
      dataType: row.data_type,
      isNullable: row.is_nullable === "YES",
      columnDefault: row.column_default,
    });
  }
  return tables;
}

/**
 * table -> [primaryKeyColumnName, ...] (almost always a single "id" column
 * in this schema, but derived, not assumed).
 * @param {{query: Function}} pool
 * @returns {Promise<Record<string, string[]>>}
 */
export async function getPrimaryKeys(pool) {
  const res = await pool.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.constraint_schema = kcu.constraint_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.ordinal_position
  `);
  const tables = {};
  for (const row of res.rows) {
    const t = row.table_name;
    if (!tables[t]) tables[t] = [];
    tables[t].push(row.column_name.toLowerCase());
  }
  return tables;
}

/**
 * Every FOREIGN KEY constraint currently declared on the live database.
 * Returns [{ constraintName, childTable, childColumn, parentTable, parentColumn, deleteRule }].
 *
 * These are constraints Postgres is ALREADY enforcing, so an orphan here
 * should be structurally rare (only reachable via NOT VALID constraints,
 * bulk-loaded data that bypassed constraints, or a constraint added after
 * bad rows already existed). Still worth checking -- cheap, and a real
 * signal if it ever fires.
 */
export async function getForeignKeys(pool) {
  const res = await pool.query(`
    SELECT
      tc.constraint_name,
      tc.table_name AS child_table,
      kcu.column_name AS child_column,
      ccu.table_name AS parent_table,
      ccu.column_name AS parent_column,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.constraint_schema = kcu.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.constraint_schema = ccu.constraint_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
     AND tc.constraint_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name
  `);
  return res.rows.map((row) => ({
    constraintName: row.constraint_name,
    childTable: row.child_table,
    childColumn: row.child_column.toLowerCase(),
    parentTable: row.parent_table,
    parentColumn: row.parent_column.toLowerCase(),
    deleteRule: row.delete_rule,
  }));
}

/**
 * Best-effort extraction of enum-shaped CHECK constraints, e.g.
 * `CHECK (status IN ('pending','running','completed','failed'))`.
 *
 * information_schema.check_constraints.check_clause is Postgres's
 * normalized rendering of the expression (typically
 * `(status)::text = ANY (ARRAY['pending'::character varying, ...])`).
 * We don't try to fully parse SQL expressions -- we pull every quoted
 * string literal out of the clause. For a genuine `IN (...)` / `= ANY`
 * enum check every literal is a valid value; for any other kind of CHECK
 * (range checks, `id = 1`, etc.) there are usually 0-1 quoted literals,
 * so we only treat a constraint as enum-shaped when it yields at least
 * two distinct literals -- a single-value coincidence is far more likely
 * to be an unrelated constraint than a genuine enum of size 1.
 *
 * Returns [{ table, column, constraintName, values: string[] }].
 */
export async function getCheckConstraintEnums(pool) {
  const res = await pool.query(`
    SELECT ccu.table_name, ccu.column_name, cc.constraint_name, cc.check_clause
    FROM information_schema.check_constraints cc
    JOIN information_schema.constraint_column_usage ccu
      ON cc.constraint_name = ccu.constraint_name
     AND cc.constraint_schema = ccu.constraint_schema
    WHERE cc.constraint_schema = 'public'
  `);

  const results = [];
  for (const row of res.rows) {
    const literals = [...row.check_clause.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(
      (m) => m[1],
    );
    const distinct = [...new Set(literals)];
    if (distinct.length < 2) continue; // not enum-shaped
    results.push({
      table: row.table_name,
      column: row.column_name.toLowerCase(),
      constraintName: row.constraint_name,
      values: distinct,
    });
  }
  return results;
}

/** Plain list of table names in the public schema. */
export async function getTableNames(pool) {
  const res = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return res.rows.map((r) => r.table_name);
}
