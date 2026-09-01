/**
 * The three checks register() runs last, after the schema and every backfill
 * have had their chance.
 *
 * None of them is part of building the database. Each exists because something
 * upstream is allowed to fail quietly, and this is where that shows up: a
 * process killed mid-scan, a schema step that logged a warning and continued,
 * a sequence left behind by a bulk import.
 */

import type { Pool } from "pg";

export async function runBootSafetyNets(
  pool: Pool,
  appName: string,
): Promise<void> {
  await sweepStaleScansOnce(appName);
  await verifyRequiredTables(pool, appName);
  await repairSequences(pool, appName);
}

/**
 * Fails any scan left `pending`/`running` by a PREVIOUS process (killed by a
 * deploy, OOM, crash). See lib/scanner/scan-jobs.ts's sweepStaleScans for why
 * the in-memory watchdog alone cannot cover this case.
 */
async function sweepStaleScansOnce(appName: string): Promise<void> {
  try {
    const { sweepStaleScans } = await import("@/lib/scanner/scan-jobs");
    const swept = await sweepStaleScans();
    if (swept > 0) {
      console.error(
        `[${appName}] Failed ${swept} scan(s) left running/pending by a previous process.`,
      );
      const { sendAdminAlert } = await import("@/lib/admin/alert-webhook");
      void sendAdminAlert({
        event: "stale_scans_swept",
        severity: "warning",
        message: `${swept} scan(s) were left running/pending by a previous process (an unclean restart) and have been marked failed.`,
        context: { count: swept },
      });
    }
  } catch (err) {
    console.error(
      `[${appName}] Failed to sweep stale scans (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Every schema step marked "warn" only logs and continues on failure (so one
 * transient hiccup does not take the whole boot down), which means
 * schema_version can say "ready" while a table that step was supposed to
 * create does not actually exist. /api/v3/health checks this same list on
 * every poll; this fires a one-time alert at boot instead of paging on every
 * single health-check poll thereafter (AUDIT-010, production-readiness #3).
 */
async function verifyRequiredTables(
  pool: Pool,
  appName: string,
): Promise<void> {
  try {
    const { REQUIRED_TABLES } = await import("@/lib/database/required-tables");
    const tablesRes = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES],
    );
    const present = new Set(tablesRes.rows.map((r) => r.table_name));
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
    if (missing.length > 0) {
      console.error(
        `[${appName}] Boot completed but required table(s) are missing:`,
        missing.join(", "),
      );
      const { sendAdminAlert } = await import("@/lib/admin/alert-webhook");
      void sendAdminAlert({
        event: "boot_required_tables_missing",
        severity: "critical",
        message: `${appName} booted but ${missing.length} required table(s) are missing: ${missing.join(", ")}. Some routes will fail until this is fixed.`,
        context: { missingTables: missing },
      });
    }
  } catch (err) {
    console.error(
      `[${appName}] Failed to verify required tables (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Detects and fixes any SERIAL sequence that fell behind MAX(id), e.g. after a
 * bulk import, seed, or explicit-ID insert that bypassed the migration tool.
 * Only logs when something was actually broken and fixed.
 */
async function repairSequences(pool: Pool, appName: string): Promise<void> {
  try {
    const seqRes = await pool.query<{
      seq_name: string;
      tbl_name: string;
      col_name: string;
      last_value: string | null;
    }>(`
      SELECT
        s.relname                     AS seq_name,
        t.relname                     AS tbl_name,
        a.attname                     AS col_name,
        pg_sequence_last_value(s.oid) AS last_value
      FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid
        AND d.classid    = 'pg_class'::regclass
        AND d.refclassid = 'pg_class'::regclass
        AND d.deptype    = 'a'
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a
        ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE s.relkind = 'S'
        AND t.relnamespace = (
          SELECT oid FROM pg_namespace WHERE nspname = 'public'
        )
    `);

    const fixed: string[] = [];

    for (const row of seqRes.rows) {
      const maxRes = await pool.query<{ max_val: string | null }>(
        `SELECT MAX("${row.col_name}") AS max_val FROM "${row.tbl_name}"`,
      );
      const maxVal =
        maxRes.rows[0]?.max_val != null
          ? parseInt(maxRes.rows[0].max_val, 10)
          : 0;
      const seqVal = row.last_value != null ? parseInt(row.last_value, 10) : 0;

      if (maxVal > 0 && maxVal > seqVal) {
        await pool.query(`SELECT setval($1, $2)`, [row.seq_name, maxVal]);
        fixed.push(`${row.tbl_name} (was ${seqVal}, fixed to ${maxVal})`);
      }
    }

    if (fixed.length > 0) {
      console.log(
        `[${appName}] Sequence repair: fixed ${fixed.length} table(s): ${fixed.join("; ")}`,
      );
    }
  } catch (seqErr) {
    console.error(`[${appName}] Sequence repair failed (non-fatal):`, seqErr);
  }
}
