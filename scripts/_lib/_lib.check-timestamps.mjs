/**
 * VulnRadar — Timestamp sanity checks.
 *
 * Fully generic: for every table that HAS both created_at and
 * updated_at columns (discovered from the live schema, no hardcoded
 * table list), and every table that has created_at, run two cheap
 * checks. Always needs-human -- there is no way to infer what a
 * corrupted timestamp should actually have been.
 *
 * "Future" allows a small slack window (1 day) rather than flagging
 * anything after `NOW()` literally, so ordinary clock skew between an
 * app server and the DB server doesn't produce false positives.
 */
const FUTURE_SLACK = "1 day";

/**
 * @param {{query: Function}} pool
 * @param {{tables: Set<string>, columnsDetailed: object, primaryKeys: object}} ctx
 * @returns {Promise<{findings: import('./_lib.corruption-orchestrator.mjs').Finding[], meta: {tablesChecked: number}}>}
 */
export async function diagnose(pool, ctx) {
  const { tables, columnsDetailed, primaryKeys } = ctx;
  const findings = [];
  let tablesChecked = 0;

  for (const table of tables) {
    const cols = new Set((columnsDetailed[table] || []).map((c) => c.name));
    const pk = (primaryKeys[table] || [])[0];
    if (!pk) continue;
    const hasCreated = cols.has("created_at");
    const hasUpdated = cols.has("updated_at");
    if (!hasCreated && !hasUpdated) continue;
    tablesChecked++;

    if (hasCreated && hasUpdated) {
      const where = `updated_at < created_at`;
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${where}`,
      );
      const count = countRes.rows[0]?.n ?? 0;
      if (count > 0) {
        const sampleRes = await pool.query(
          `SELECT "${pk}" AS pk FROM "${table}" WHERE ${where} LIMIT 5`,
        );
        findings.push({
          category: "timestamp",
          severity: "needs-human",
          table,
          column: "updated_at",
          description: `${count} row(s) in ${table} have updated_at before created_at.`,
          count,
          examples: sampleRes.rows.map((r) => ({ pk: r.pk })),
        });
      }
    }

    if (hasCreated) {
      const where = `created_at > NOW() + INTERVAL '${FUTURE_SLACK}'`;
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${where}`,
      );
      const count = countRes.rows[0]?.n ?? 0;
      if (count > 0) {
        const sampleRes = await pool.query(
          `SELECT "${pk}" AS pk FROM "${table}" WHERE ${where} LIMIT 5`,
        );
        findings.push({
          category: "timestamp",
          severity: "needs-human",
          table,
          column: "created_at",
          description: `${count} row(s) in ${table} have a created_at more than ${FUTURE_SLACK} in the future.`,
          count,
          examples: sampleRes.rows.map((r) => ({ pk: r.pk })),
        });
      }
    }
  }

  return { findings, meta: { tablesChecked } };
}
