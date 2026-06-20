/**
 * VulnRadar — Schema metadata table.
 *
 * Tracks which schema version a database is at. We use a tiny meta table
 * (single row) for two reasons:
 *
 *   1. Faster detection: a SELECT is cheaper than fingerprint-matching
 *      every table and column on every run.
 *   2. Authoritative: a partial migration won't fool the version picker
 *      into thinking we're at a version we're not actually at.
 *
 * The table is created lazily on the first migration run. If it doesn't
 * exist when we want to read it, the caller should fall back to fingerprint
 * detection (`_detect.mjs`).
 *
 * Schema:
 *   CREATE TABLE vulnradar_schema_meta (
 *     id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
 *     schema_version VARCHAR(20) NOT NULL,
 *     app_version VARCHAR(20) NOT NULL,
 *     applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *
 * The CHECK (id = 1) ensures there's only ever one row.
 */

import { info, success, warn, error } from "../_lib/_lib.output.mjs";

const META_TABLE = "vulnradar_schema_meta";

export async function ensureMetaTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${META_TABLE} (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      schema_version VARCHAR(20) NOT NULL,
      app_version VARCHAR(20) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Read the current schema version. Returns the version string, or null if
 * the meta table doesn't exist or has no row.
 */
export async function readMeta(pool) {
  try {
    const res = await pool.query(
      `SELECT schema_version, app_version, applied_at
       FROM ${META_TABLE}
       WHERE id = 1`,
    );
    if (res.rows.length === 0) return null;
    return {
      schemaVersion: res.rows[0].schema_version,
      appVersion: res.rows[0].app_version,
      appliedAt: res.rows[0].applied_at,
    };
  } catch (err) {
    // 42P01 = undefined_table. Anything else is a real error.
    if (err?.code === "42P01") return null;
    throw err;
  }
}

/**
 * Write the meta row, replacing any existing one (in case of downgrade).
 * Caller should have already called ensureMetaTable().
 */
export async function writeMeta(pool, { schemaVersion, appVersion }) {
  await pool.query(
    `INSERT INTO ${META_TABLE} (id, schema_version, app_version, applied_at)
     VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE
       SET schema_version = EXCLUDED.schema_version,
           app_version   = EXCLUDED.app_version,
           applied_at    = EXCLUDED.applied_at`,
    [schemaVersion, appVersion],
  );
}

export const META_TABLE_NAME = META_TABLE;
