/**
 * VulnRadar: is the live schema what the target version is supposed to be?
 *
 * Separate from migrate.mjs because that file runs main() on import, so
 * nothing in it can be called from a test.
 */

import { getActualSchema } from "../_lib/_lib.schema.mjs";
import { VERSIONS, getVersion } from "./_registry.mjs";

/**
 * What a version's schema contains, as Map<table, Set<column>>.
 *
 * The expectation comes from the version files themselves, via
 * buildMigrationSchema(): the v1 baseline with every registered upgrade
 * applied. That is exactly what the plan promised to produce, so a mismatch
 * means a step silently no-opped (an IF NOT EXISTS matching a pre-existing
 * object of a different shape, for instance) rather than that the expectation
 * is wrong. tests/scripts/migrate/schema-parity.test.ts separately guarantees
 * that same derived set equals the boot schema's.
 *
 * Falls back to the registry if the version files cannot be parsed for any
 * reason: a verification that cannot run must not be the thing that fails a
 * migration.
 */
export async function expectedSchemaFor(target) {
  try {
    if (target !== VERSIONS[VERSIONS.length - 1].name) {
      // Only the newest version has a derived expectation; an older
      // target is a downgrade and its shape is the fingerprint.
      throw new Error("not the newest version");
    }
    const { buildMigrationSchema } =
      await import("../_lib/_lib.schema-parity.mjs");
    return (await buildMigrationSchema()).tables;
  } catch {
    return expectedSchemaFromRegistry(getVersion(target));
  }
}

export function expectedSchemaFromRegistry({ fingerprint }) {
  return new Map(
    [...fingerprint.tables].map((t) => [
      t,
      new Set(fingerprint.columns?.[t] || []),
    ]),
  );
}

/**
 * @param {Map<string, Set<string>>} expected
 * @param {Record<string, string[]>} actual shape from getActualSchema(pool)
 */
export function missingFromSchema(expected, actual) {
  const live = new Map(
    Object.entries(actual).map(([t, cols]) => [t, new Set(cols)]),
  );
  const missingTables = [];
  const missingColumns = [];
  for (const [table, cols] of expected) {
    const liveCols = live.get(table);
    if (!liveCols) {
      missingTables.push(table);
      continue;
    }
    for (const col of cols) {
      if (!liveCols.has(col.toLowerCase())) {
        missingColumns.push(`${table}.${col}`);
      }
    }
  }
  missingTables.sort();
  missingColumns.sort();
  return { missingTables, missingColumns };
}

/**
 * AUDIT-013 migrate-09: re-read the live schema and compare it against what
 * the target version is supposed to contain.
 */
export async function verifyTargetSchema(pool, target) {
  const expected = await expectedSchemaFor(target);
  const missing = missingFromSchema(expected, await getActualSchema(pool));
  return {
    ok:
      missing.missingTables.length === 0 && missing.missingColumns.length === 0,
    ...missing,
    checkedTables: expected.size,
  };
}

/**
 * What a gap means when the database is already at the target schema version.
 *
 * A schema version covers more than one release, and each release's boot adds
 * to it. The in-app updater runs the migrator after replacing the files and
 * before the restart, so on every update the database is short of whatever the
 * new release's boot is about to create. That is not a failure, and calling it
 * one would fail every update, including from a release much older than the
 * last. So the question is whether this release has already been recorded on
 * the database: until it has, a gap is expected, and afterwards it is real.
 *
 * @returns {"complete" | "pending-boot" | "incomplete"}
 */
export function assessSameVersionRun({
  missing,
  recordedAppVersion,
  appVersion,
}) {
  if (
    missing.missingTables.length === 0 &&
    missing.missingColumns.length === 0
  ) {
    return "complete";
  }
  if (!recordedAppVersion) return "pending-boot";
  const order = recordedAppVersion.localeCompare(appVersion, undefined, {
    numeric: true,
  });
  return order < 0 ? "pending-boot" : "incomplete";
}
