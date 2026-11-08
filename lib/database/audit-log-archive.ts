/**
 * Archive-before-purge for admin_audit_log (AUDIT-010, admin-feature-gap):
 * the periodic cleanup pass (lib/database/cleanup.ts) permanently deletes
 * admin_audit_log rows older than CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS
 * (365-day shipped default) with no durable copy kept anywhere -- the
 * platform's own compliance record of admin actions disappeared forever
 * the moment retention expired. This module adds a JSONB-blob archive
 * table plus a helper that deletes the expired rows and archives them in
 * ONE statement, so a purge can never run without its rows landing in the
 * archive, and a failure takes back both together.
 *
 * Table creation follows instrumentation.ts's CREATE TABLE IF NOT EXISTS
 * pattern but lives in this file rather than inline in instrumentation.ts;
 * instrumentation.ts calls ensureAuditLogArchiveTable(pool) once at boot,
 * and scripts/_lib/_lib.schema-parity.mjs parses the DDL below out of here
 * as part of the canonical schema, so the table is covered by the
 * boot/migration parity guard like any inline CREATE TABLE.
 */
import type { Pool, PoolClient } from "pg";

/**
 * Idempotent CREATE TABLE IF NOT EXISTS for the archive table. Called once
 * per boot from instrumentation.ts's STAFF INVITES + ADMIN AUDIT LOG
 * ARCHIVE block, and from nowhere else: it used to also run on every cleanup
 * pass, which put DDL inside the nightly cleanup's long transaction
 * (AUDIT-013 schema-02).
 */
export async function ensureAuditLogArchiveTable(
  executor: Pool | PoolClient,
): Promise<void> {
  await executor.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_log_archive (
      id SERIAL PRIMARY KEY,
      purged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      retention_days INTEGER,
      row_count INTEGER NOT NULL,
      rows JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_log_archive_purged_at
      ON admin_audit_log_archive(purged_at DESC);
  `);
}

/**
 * Delete every admin_audit_log row older than `retentionDays` and write them
 * to admin_audit_log_archive as a single JSONB-array batch.
 *
 * The batch is built from the DELETE's own RETURNING rather than from a SELECT
 * before it. With a SELECT, two overlapping passes (the timer and the admin's
 * on-demand run) both read the same expired rows and both archived them, and
 * the archive is what a compliance count gets taken from. A row can only be
 * returned by the DELETE that actually removed it, so a second pass waits on
 * the first one's row locks, finds nothing left, and writes no batch.
 *
 * Returns the number of rows purged and archived. HAVING is what keeps an
 * empty purge from leaving an empty batch behind.
 *
 * The parameter is not called `executor` on purpose. db:create reads every
 * `executor.query` in this file as schema DDL (moduleStepStatements in
 * scripts/_lib/_lib.schema-parity.mjs), so that name would run this purge
 * during a clone, with no parameter to bind.
 */
export async function purgeExpiredAdminAuditLog(
  db: Pool | PoolClient,
  retentionDays: number,
): Promise<number> {
  const { rows } = await db.query<{ row_count: number }>(
    `WITH purged AS (
       DELETE FROM admin_audit_log
       WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')
       RETURNING *
     )
     INSERT INTO admin_audit_log_archive (retention_days, row_count, rows)
     SELECT $1::int, count(*), jsonb_agg(purged ORDER BY purged.id)
     FROM purged
     HAVING count(*) > 0
     RETURNING row_count`,
    [retentionDays],
  );

  return rows[0]?.row_count ?? 0;
}
