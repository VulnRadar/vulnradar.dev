/**
 * The boot schema advisory lock (AUDIT-013 migrate-11).
 *
 * The schema runs as ~160 separate steps with no enclosing transaction.
 * PostgreSQL's IF NOT EXISTS is a catalog check followed by an insert, not an
 * atomic operation, so two Node processes booting against the same database at
 * the same time (a rolling restart, a scaled-up replica, a supervisor
 * restarting a crashed process while the old one is still initializing) can
 * both pass the check and one gets "duplicate key value violates unique
 * constraint pg_type_typname_nsp_index" or "tuple concurrently updated". Since
 * register()'s outer catch exits the process, that race would crash-loop a
 * container for a schema that is actually fine.
 *
 * A session-level advisory lock on a DEDICATED client (not the pool: a
 * pool.query returns its connection immediately and would drop the lock) makes
 * the second booter wait and then find every object already present.
 *
 * What the lock has to cover is everything that writes: the schema itself and
 * every boot backfill after it (the super_admin bootstrap and the staff-plan
 * reconciliation are both read-then-write races between two booting
 * processes). It does NOT cover the version check, which runs before it and is
 * a read plus one ON CONFLICT DO NOTHING insert.
 *
 * Failing to take the lock is not fatal: a single-process deployment behaves
 * exactly as it did before.
 */

import type { Pool } from "pg";

/** Arbitrary constant, unique to this one purpose. */
export const BOOT_SCHEMA_LOCK_ID = 4_150_921_733;

/**
 * pg types connect() with both a promise and a callback overload, and
 * ReturnType picks the callback one (which returns void), so the awaited type
 * has to be named explicitly rather than inferred.
 */
type SchemaLockClient = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};

export type BootSchemaLock = SchemaLockClient | null;

export async function acquireBootSchemaLock(
  pool: Pool,
  appName: string,
): Promise<BootSchemaLock> {
  let client: SchemaLockClient | null = null;
  try {
    client = await pool.connect();
    await client.query("SELECT pg_advisory_lock($1)", [BOOT_SCHEMA_LOCK_ID]);
    return client;
  } catch (err) {
    if (client) client.release();
    console.error(
      `[${appName}] Could not take the boot schema advisory lock (continuing without it):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Release the boot lock so the next booting instance can proceed. Not reached
 * on register()'s process.exit(1) path, which is fine: the connection dies
 * with the process and PostgreSQL drops every session-level advisory lock it
 * held.
 */
export async function releaseBootSchemaLock(
  lock: BootSchemaLock,
): Promise<void> {
  if (!lock) return;
  try {
    await lock.query("SELECT pg_advisory_unlock($1)", [BOOT_SCHEMA_LOCK_ID]);
  } catch {
    // Releasing is best-effort; the lock also goes away when the connection is
    // returned to the pool and eventually closed.
  }
  lock.release();
}
