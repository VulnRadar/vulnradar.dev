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
 *
 * The boot pass is no longer the only one: startBackgroundWorkers arms the
 * same sweep on a timer (lib/scanner/stale-scan-sweep.ts), which is what
 * catches a row that goes stale while this process is up. Both share the one
 * reporting path so an operator gets the same alert either way.
 */
async function sweepStaleScansOnce(appName: string): Promise<void> {
  try {
    const { runStaleScanSweep } =
      await import("@/lib/scanner/stale-scan-sweep");
    await runStaleScanSweep("boot");
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

/** One sequence a SERIAL column owns, as the catalog query below lists it. */
export interface OwnedSequence {
  /** Schema-qualified and quoted where needed, ready for ::regclass. */
  seq_ref: string;
  /** quote_ident'd, ready to interpolate. */
  tbl_ident: string;
  col_ident: string;
  tbl_name: string;
}

/**
 * The repair for one sequence, as a single statement: read MAX(id) and the
 * sequence's current position together, and move it only when it is behind.
 *
 * This used to read last_value in one query, MAX(id) in a second and call
 * setval with the number it had computed in a third. A deploy boots while the
 * old instance is still taking inserts, so between the first read and the
 * setval the sequence could move past MAX(id), and setval then moved it back:
 * the next inserts got ids that were already taken and failed on the primary
 * key (bug-db-6). Here the comparison and the setval are one statement, and
 * the value handed to setval is re-read inside it with GREATEST, so the only
 * value it ever sets is one at or above where the sequence is at that moment.
 *
 * pg_sequence_last_value is NULL for a sequence nothing has drawn from yet;
 * COALESCE treats that as 0, so a table filled with explicit ids is repaired.
 */
export function sequenceRepairSql(seq: OwnedSequence): {
  text: string;
  values: unknown[];
} {
  return {
    text: `SELECT x.prev_value, setval($1::regclass, GREATEST(x.m, COALESCE(pg_sequence_last_value($1::regclass), 0))) AS new_value
             FROM (SELECT MAX(${seq.col_ident})::bigint AS m,
                          pg_sequence_last_value($1::regclass) AS prev_value
                     FROM ${seq.tbl_ident}) x
            WHERE x.m > COALESCE(pg_sequence_last_value($1::regclass), 0)`,
    values: [seq.seq_ref],
  };
}

/**
 * Detects and fixes any SERIAL sequence that fell behind MAX(id), e.g. after a
 * bulk import, seed, or explicit-ID insert that bypassed the migration tool.
 * Only logs when something was actually broken and fixed.
 */
export async function repairSequences(
  pool: Pool,
  appName: string,
): Promise<void> {
  try {
    const seqRes = await pool.query<OwnedSequence>(`
      SELECT
        s.oid::regclass::text         AS seq_ref,
        quote_ident(t.relname)        AS tbl_ident,
        quote_ident(a.attname)        AS col_ident,
        t.relname                     AS tbl_name
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

    for (const seq of seqRes.rows) {
      const { text, values } = sequenceRepairSql(seq);
      const result = await pool.query<{
        prev_value: string | null;
        new_value: string;
      }>(text, values);
      const row = result.rows[0];
      if (row) {
        fixed.push(
          `${seq.tbl_name} (was ${row.prev_value ?? "unused"}, fixed to ${row.new_value})`,
        );
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
