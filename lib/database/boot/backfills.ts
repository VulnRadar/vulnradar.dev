/**
 * Boot backfills and seeds: the writes that heal DATA rather than shape.
 *
 * Every one of these used to sit inline between two CREATE TABLE blocks in
 * instrumentation.ts, which is how one of them ended up in the wrong place
 * entirely: migratePlaintextSecretsToEncrypted() ran BEFORE any table was
 * created, so the very first boot of a self-hosted install printed two full
 * `relation "users" does not exist` stack traces at somebody who had done
 * nothing wrong. They now all run after the schema is complete, in the same
 * relative order they had before, so every table and column each one touches
 * is guaranteed to exist.
 *
 * All of them are idempotent and all of them are non-fatal: a backfill that
 * cannot run must not stop a boot.
 *
 * These run inside the boot advisory lock (see ./schema-lock.ts). That matters
 * for two of them specifically: the super_admin bootstrap and the staff-plan
 * reconciliation are read-then-write sequences that two processes booting at
 * once would otherwise both perform.
 */

import type { Pool } from "pg";
import { DEFAULT_BADGES_SQL } from "@/lib/database/schema/seeds.mjs";
import { logError } from "@/lib/logging/log";
import {
  FREQUENCIES,
  SCHEDULE_FREQUENCIES,
  computeNextRunAt,
  isScheduleFrequency,
} from "@/lib/scanner/schedule-timing";

export async function runBootBackfills(
  pool: Pool,
  appName: string,
): Promise<void> {
  await backfillEncryptedSecrets();
  await backfillAvatars(appName);
  await bootstrapSuperAdmin(pool, appName);
  await reconcileStaffPlans(appName);
  await seedDefaultBadges(pool, appName);
  await backfillWebhookSecrets(appName);
  await backfillSubDailyScheduleSlots(pool, appName);
}

/**
 * Encrypt any plaintext TOTP / Discord tokens that were stored before
 * encryption was added. Idempotent: rows already in ciphertext form are
 * skipped.
 */
async function backfillEncryptedSecrets(): Promise<void> {
  try {
    const { migratePlaintextSecretsToEncrypted } =
      await import("@/lib/auth/security-migration");
    await migratePlaintextSecretsToEncrypted();
  } catch (err) {
    console.error(
      "[security-migration] Failed to backfill plaintext secrets:",
      err,
    );
  }
}

/**
 * One-time backfill of legacy avatars into the user_avatars table, so a plain
 * upgrade heals itself with no separate command. Both steps skip a user that
 * already has a row: the base64 conversion moves the old serverless-fallback
 * data:image URLs out of users.avatar_url (pure database, a no-op when there
 * are none), and the file import moves legacy data/avatars/<id>.png files on
 * self-hosted Docker (a clean no-op when there is no such directory).
 */
async function backfillAvatars(appName: string): Promise<void> {
  try {
    const { migrateBase64AvatarsToDatabase, migrateAvatarFilesToDatabase } =
      await import("@/lib/uploads/avatar-migration");
    await migrateBase64AvatarsToDatabase();
    await migrateAvatarFilesToDatabase();
  } catch (err) {
    console.error(
      `[${appName}] Avatar backfill to database failed (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * SUPER_ADMIN BOOTSTRAP - the first registered account.
 *
 * super_admin is deliberately un-assignable through the admin panel
 * (app/api/v3/admin/route.ts's set_role, see STAFF_ROLES in
 * lib/rate-limiting/daily-limits.ts) since it gates real code execution on the
 * host (the self-updater, see app/api/v3/admin/updater/apply/route.ts). On a
 * self-hosted deployment that leaves no UI path to ever gain it: someone would
 * have to hand-edit the database. Instead: if the users table has NO
 * super_admin yet, promote the lowest-id row (the very first account ever
 * registered on this instance) automatically on boot. A no-op forever after
 * that first promotion, even if that user is later demoted or deleted.
 *
 * lib/billing/staff-plan.ts's syncPlanForRoleChange also grants the promoted
 * account elite_supporter (super_admin's plan tier, above the pro_supporter
 * the rest of staff get), the same real, non-Stripe grant/revoke bookkeeping
 * (pre_staff_plan) every other staff promotion uses.
 */
async function bootstrapSuperAdmin(pool: Pool, appName: string): Promise<void> {
  try {
    const existingSuperAdmin = await pool.query(
      "SELECT 1 FROM users WHERE role = 'super_admin' LIMIT 1",
    );
    if (existingSuperAdmin.rowCount !== 0) return;

    const firstUser = await pool.query<{ id: number; role: string | null }>(
      "SELECT id, role FROM users ORDER BY id ASC LIMIT 1",
    );
    const row = firstUser.rows[0];
    if (!row) return;

    await pool.query(
      "UPDATE users SET role = 'super_admin', updated_at = NOW() WHERE id = $1",
      [row.id],
    );
    const { syncPlanForRoleChange } = await import("@/lib/billing/staff-plan");
    await syncPlanForRoleChange(row.id, row.role, "super_admin");
    console.log(
      `[${appName}] Bootstrapped user #${row.id} as super_admin (first account, none existed yet).`,
    );
  } catch (err) {
    console.error(
      `[${appName}] Failed to bootstrap super_admin (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Self-heals any staff role assigned by directly editing users.role in the
 * database (hand-run SQL to grant super_admin on an existing account, say):
 * see lib/billing/staff-plan.ts's reconcileStaffPlans for why that bypasses
 * the real plan grant. Runs every boot; fully idempotent once reconciled.
 */
async function reconcileStaffPlans(appName: string): Promise<void> {
  try {
    const { reconcileStaffPlans: reconcile } =
      await import("@/lib/billing/staff-plan");
    const reconciled = await reconcile();
    if (reconciled > 0) {
      console.log(
        `[${appName}] Reconciled staff plan grant for ${reconciled} account(s) promoted outside the admin panel.`,
      );
    }
  } catch (err) {
    console.error(
      `[${appName}] Failed to reconcile staff plans (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** The default badge set, shared with `npm run db:create`. */
async function seedDefaultBadges(pool: Pool, appName: string): Promise<void> {
  try {
    await pool.query(DEFAULT_BADGES_SQL);
    console.log(`[${appName}] Default badges seeded.`);
  } catch (seedError) {
    console.error(`[${appName}] Failed to seed badges (non-fatal):`, seedError);
  }
}

/**
 * WEBHOOK SIGNING SECRETS (AUDIT-009 webhook-01).
 *
 * webhooks.secret was the only long-lived reversible secret still stored in
 * plaintext, so this backfills existing rows to the same AES-256-GCM form
 * every other secret uses. A row that is ciphertext under a key we no longer
 * hold is reported and left alone, never rewritten.
 */
async function backfillWebhookSecrets(appName: string): Promise<void> {
  try {
    const { migratePlaintextWebhookSecrets } =
      await import("@/lib/webhooks/secret");
    await migratePlaintextWebhookSecrets();
  } catch (err) {
    console.error(
      `[${appName}] Failed to backfill plaintext webhook secrets (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}

interface SubDailyScheduleRow {
  id: number;
  frequency: string;
  preferred_hour_utc: number;
  preferred_day_of_week: number;
  preferred_day_of_month: number;
  next_run_at: Date;
}

/**
 * HOURLY AND 6-HOURLY SCHEDULES PARKED TOO FAR AHEAD.
 *
 * computeNextRunAt used to start its slot search at the schedule's anchor hour
 * and only walk forward, so a sub-daily schedule that rolled past midnight
 * before its anchor jumped straight to the anchor and skipped every slot in
 * between (lib/scanner/schedule-timing.ts has the trace). The function is
 * fixed, but the worker only rewrites next_run_at after a run, so each row it
 * mis-scheduled still holds the bad value: an hourly schedule parked at 14:00
 * when it is 00:05 would sit idle for fourteen hours before the corrected
 * code ever got a chance to run for it.
 *
 * The correct next slot is never later than the buggy one, so a row whose
 * stored next_run_at is LATER than the recomputed value is exactly a parked
 * row, and moving it earlier is the whole repair. Rows that are due, overdue
 * or already correct are never touched, so this cannot postpone a scan. The
 * one thing it can move is a claim lease that happens to outlast the next
 * slot, and only on a boot that lands in the minutes after a claim; the worst
 * case there is the scan being claimed again once its slot arrives.
 *
 * Idempotent: once a row is correct the recomputed value equals the stored
 * one and nothing is written.
 */
export async function backfillSubDailyScheduleSlots(
  pool: Pool,
  appName: string,
): Promise<void> {
  try {
    const subDaily = SCHEDULE_FREQUENCIES.filter(
      (frequency) => FREQUENCIES[frequency].hours < 24,
    );
    const { rows } = await pool.query<SubDailyScheduleRow>(
      `SELECT id, frequency, preferred_hour_utc, preferred_day_of_week,
              preferred_day_of_month, next_run_at
         FROM scheduled_scans
        WHERE active = true
          AND next_run_at IS NOT NULL
          AND frequency = ANY($1::text[])`,
      [subDaily],
    );

    const now = new Date();
    let moved = 0;
    for (const row of rows) {
      if (!isScheduleFrequency(row.frequency)) continue;
      const correct = computeNextRunAt(
        row.id,
        {
          frequency: row.frequency,
          preferredHourUtc: row.preferred_hour_utc,
          preferredDayOfWeek: row.preferred_day_of_week,
          preferredDayOfMonth: row.preferred_day_of_month,
        },
        now,
      );
      if (row.next_run_at.getTime() <= correct.getTime()) continue;

      // Re-checked in the WHERE so a run that finished and rescheduled the row
      // between the SELECT and here is not overwritten with an older answer.
      const result = await pool.query(
        `UPDATE scheduled_scans
            SET next_run_at = $2
          WHERE id = $1 AND active = true AND next_run_at > $2`,
        [row.id, correct.toISOString()],
      );
      moved += result.rowCount ?? 0;
    }

    if (moved > 0) {
      console.log(
        `[${appName}] Moved ${moved} hourly or 6-hourly schedule(s) that were parked past their next slot back to it.`,
      );
    }
  } catch (err) {
    logError(
      "schedules",
      "Failed to recompute sub-daily schedule slots (non-fatal)",
      err,
    );
  }
}
