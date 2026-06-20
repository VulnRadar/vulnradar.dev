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
 * is present in the live schema, "medium" if all required tables are
 * present but some columns differ, and "low" if multiple versions match
 * equally.
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
    let missingColumns = 0;
    let totalColumnChecks = 0;
    for (const [table, cols] of Object.entries(fp.columns || {})) {
      if (!actual[table]) continue;
      const liveCols = new Set(actual[table]);
      for (const col of cols) {
        totalColumnChecks++;
        if (!liveCols.has(col.toLowerCase())) missingColumns++;
      }
    }

    matches.push({
      version: v.name,
      missingTables,
      missingColumns,
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

  const confidence = best.missingColumns === 0 ? "high" : "medium";

  return {
    version: best.version,
    confidence,
    reason: `All ${best.missingTables.length === 0 ? best.version + " tables" : "some tables"} present${
      best.missingColumns > 0
        ? `, but ${best.missingColumns} column(s) differ from fingerprint`
        : ""
    }.`,
  };
}
