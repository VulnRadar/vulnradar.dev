/**
 * VulnRadar — JSON/JSONB column checks.
 *
 * A genuine `json`/`jsonb`-typed column cannot hold syntactically invalid
 * JSON: Postgres validates it at write time and node-postgres parses it
 * into a real JS value on the way out, so a per-row "parse failure" for
 * these columns is not reachable the way it is for a TEXT column that
 * merely stores JSON by convention (like users.backup_codes, already
 * covered by scripts/db-diagnose-2fa.mjs). This module reports that fact
 * explicitly via `columnsInspected` rather than silently having nothing
 * to say, and instead checks the one thing Postgres does NOT enforce:
 * shape. `findings JSONB NOT NULL DEFAULT '[]'` and
 * `summary JSONB NOT NULL DEFAULT '{}'` (instrumentation.ts) declare
 * their intended shape via their default value; a row whose value
 * doesn't match (e.g. `findings` holding an object instead of an array)
 * is a real, checkable anomaly even though it will never be a raw parse
 * error.
 *
 * Never auto-fixable: there's no safe substitute value for a
 * wrong-shaped JSON blob without knowing what the row was supposed to
 * contain -- always needs-human.
 */

const SHAPE_HINTS = [
  {
    table: "scan_history",
    column: "findings",
    expected: "array",
    source: "instrumentation.ts: findings JSONB NOT NULL DEFAULT '[]'",
  },
  {
    table: "scan_history",
    column: "summary",
    expected: "object",
    source: "instrumentation.ts: summary JSONB NOT NULL DEFAULT '{}'",
  },
];

function matchesShape(value, expected) {
  if (expected === "array") return Array.isArray(value);
  // "object": a plain JSON object, not an array and not null.
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {{query: Function}} pool
 * @param {{tables: Set<string>, columnsDetailed: object, primaryKeys: object}} ctx
 * @returns {Promise<{findings: import('./_lib.corruption-orchestrator.mjs').Finding[], meta: {columnsInspected: number}}>}
 */
export async function diagnose(pool, ctx) {
  const { tables, columnsDetailed, primaryKeys } = ctx;
  const findings = [];

  let columnsInspected = 0;
  for (const cols of Object.values(columnsDetailed)) {
    for (const c of cols) {
      if (c.dataType === "json" || c.dataType === "jsonb") columnsInspected++;
    }
  }

  for (const hint of SHAPE_HINTS) {
    if (!tables.has(hint.table)) continue;
    if (!columnsDetailed[hint.table]?.some((c) => c.name === hint.column))
      continue;
    const pk = (primaryKeys[hint.table] || ["id"])[0];
    const res = await pool.query(
      `SELECT "${pk}" AS pk, "${hint.column}" AS value FROM "${hint.table}"`,
    );
    const bad = res.rows.filter((r) => !matchesShape(r.value, hint.expected));
    if (bad.length === 0) continue;
    findings.push({
      category: "json_shape",
      severity: "needs-human",
      table: hint.table,
      column: hint.column,
      description: `${bad.length} row(s) have a ${hint.table}.${hint.column} value that isn't the expected ${hint.expected} shape (${hint.source}). Valid JSON, wrong shape -- no safe substitute value without knowing the original content.`,
      count: bad.length,
      examples: bad
        .slice(0, 5)
        .map((r) => ({ pk: r.pk, detail: `got ${typeof r.value}` })),
    });
  }

  return { findings, meta: { columnsInspected } };
}
