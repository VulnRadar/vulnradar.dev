/**
 * VulnRadar — Schema version fingerprint detector.
 *
 * Used when the meta table is missing or unreadable. Compares the live
 * schema against each known version's fingerprint and returns the highest
 * version that is a strict superset of what's in the database.
 *
 * Returns:
 *   { version: "2.3.0", confidence: "high"|"medium"|"low", reason: "..." }
 *
 * Confidence is "high" if every table + column in the target fingerprint
 * is present in the live schema, and "low" if nothing matches at all.
 *
 * AUDIT-013 migrate-08: a version used to be rejected only when a
 * fingerprint TABLE was missing. Missing COLUMNS were counted and used for
 * exactly one thing, downgrading confidence from "high" to "medium", and
 * the version was still returned as the detected one. So a database with
 * all 34 v2 tables but missing v2 columns on `users` (the exact state a
 * partial or interrupted 1.0.0 -> 2.0.0 run leaves) reported as
 * "2.0.0 (confidence: medium)", migrate.mjs accepted it, buildPlan
 * composed 2.0.0 -> 3.0.0, and the v1 -> v2 addColumns that would have
 * supplied users.plan, stripe_customer_id, subscription_status,
 * beta_access and daily_scan_limit never ran. writeMeta then stamped
 * 3.0.0, and the next boot died on `CREATE INDEX idx_users_plan ON
 * users(plan)` with "column does not exist", permanently: the meta row now
 * said 3.0.0, so the detector never revisited those columns and recovery
 * meant hand-editing vulnradar_schema_meta.
 *
 * A fingerprint is a claim about what a version's schema contains. A
 * database missing part of it is not at that version, so a missing column
 * now disqualifies exactly like a missing table and detection falls back
 * to the highest version that is genuinely complete.
 */

import { VERSIONS } from "./_registry.mjs";

/**
 * @param {object} actual  live schema from getActualSchema(pool)
 *                         shape: { [tableName]: [colName, ...] }
 */
export function fingerprintDetect(actual) {
  const liveTables = new Set(Object.keys(actual));

  const matches = [];
  for (const v of VERSIONS) {
    const fp = v.fingerprint;
    const fpTables = fp.tables;
    const requiredTables = [...fpTables].filter((t) => liveTables.has(t));
    const missingTables = [...fpTables].filter((t) => !liveTables.has(t));

    if (missingTables.length > 0) continue; // v isn't a superset of live

    // Check column fingerprints
    const missingColumnNames = [];
    let totalColumnChecks = 0;
    for (const [table, cols] of Object.entries(fp.columns || {})) {
      if (!actual[table]) continue;
      const liveCols = new Set(actual[table]);
      for (const col of cols) {
        totalColumnChecks++;
        if (!liveCols.has(col.toLowerCase())) {
          missingColumnNames.push(`${table}.${col}`);
        }
      }
    }

    // Disqualifying, same as a missing table. See this file's header.
    if (missingColumnNames.length > 0) continue;

    matches.push({
      version: v.name,
      missingTables,
      missingColumns: 0,
      totalColumnChecks,
    });
  }

  if (matches.length === 0) {
    return {
      version: null,
      confidence: "low",
      reason: "No known schema version matches the live database.",
    };
  }

  // The highest version with no missing required items wins. Since we
  // already filtered out versions with missing tables, the highest-indexed
  // match in VERSIONS is the most recent.
  matches.sort((a, b) => {
    const ai = VERSIONS.findIndex((v) => v.name === a.version);
    const bi = VERSIONS.findIndex((v) => v.name === b.version);
    return bi - ai;
  });
  const best = matches[0];

  return {
    version: best.version,
    confidence: "high",
    reason: `Every ${best.version} fingerprint table and column is present.`,
  };
}
