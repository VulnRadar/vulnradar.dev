/**
 * Archive-before-purge for admin_audit_log (AUDIT-010, admin-feature-gap):
 * the periodic cleanup pass (lib/database/cleanup.ts) permanently deletes
 * admin_audit_log rows older than CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS
 * (365-day shipped default) with no durable copy kept anywhere -- the
 * platform's own compliance record of admin actions disappeared forever
 * the moment retention expired. This module adds a JSONB-blob archive
 * table plus a helper that copies the about-to-be-deleted rows into it
 * inside the SAME transaction as the DELETE, so archive-then-purge is
 * atomic: a purge can never run without its rows landing in the archive
 * first, and a mid-transaction failure rolls back both together.
 *
 * Table creation follows instrumentation.ts's CREATE TABLE IF NOT EXISTS
 * pattern but lives in its own file rather than being added directly to
 * instrumentation.ts, a shared file other concurrent work touches.
 * ensureAuditLogArchiveTable() is also called defensively from
 * archiveAdminAuditLogBeforePurge() below before every archive attempt,
 * so archiving works correctly even before someone wires the one-line
 * call into instrumentation.ts's boot sequence -- see that export's
 * doc comment for the exact snippet.
 */
import type { Pool, PoolClient } from "pg";

export interface ArchivedAuditLogRow {
  id: number;
  admin_id: number;
  target_user_id: number | null;
  action: string;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

/**
 * Idempotent CREATE TABLE IF NOT EXISTS for the archive table. Safe to call
 * on every boot and on every cleanup pass alike -- add this one-line call
 * to instrumentation.ts's register() near the other CREATE TABLE calls
 * (e.g. right after the admin_audit_log table is created):
 *
 *   const { ensureAuditLogArchiveTable } = await import("./lib/database/audit-log-archive");
 *   await ensureAuditLogArchiveTable(pool);
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
 * Copy every admin_audit_log row older than `retentionDays` into
 * admin_audit_log_archive as a single JSONB-array batch, BEFORE the
 * caller runs its own DELETE against the same cutoff. Must be called with
 * the same transactional client the subsequent DELETE runs on (see
 * lib/database/cleanup.ts) -- within one transaction Postgres's NOW() is
 * stable for the whole transaction, so the SELECT here and the DELETE
 * that follows see the identical cutoff and therefore the identical row
 * set, with no race window between the two.
 *
 * Returns the number of rows archived. Writes nothing when there are no
 * rows to archive -- an empty purge shouldn't leave an empty batch row
 * behind.
 */
export async function archiveAdminAuditLogBeforePurge(
  client: PoolClient,
  retentionDays: number,
): Promise<number> {
  await ensureAuditLogArchiveTable(client);

  const { rows } = await client.query<ArchivedAuditLogRow>(
    `SELECT id, admin_id, target_user_id, action, details, ip_address, created_at
     FROM admin_audit_log
     WHERE created_at < NOW() - ($1 * INTERVAL '1 day')`,
    [retentionDays],
  );

  if (rows.length === 0) return 0;

  await client.query(
    `INSERT INTO admin_audit_log_archive (retention_days, row_count, rows)
     VALUES ($1, $2, $3)`,
    [retentionDays, rows.length, JSON.stringify(rows)],
  );

  return rows.length;
}
