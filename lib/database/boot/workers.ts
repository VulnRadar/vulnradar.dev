/**
 * The in-process background workers register() arms, and the one cleanup pass
 * it runs eagerly.
 *
 * Every setInterval here only fires in a long-lived deployment (Node, Docker,
 * self-hosted). On a serverless deployment the process does not live long
 * enough for any of them to tick, which is an accepted limitation: staff can
 * force a cleanup run from the admin UI (POST /api/v3/admin/cleanup), and the
 * scheduled-scan, digest, reverify and backup features are documented as
 * needing a long-running host.
 *
 * Each is scheduled inside its own try/catch: one worker failing to arm must
 * not stop the others or the boot.
 */

export async function runInitialCleanup(appName: string): Promise<void> {
  try {
    const { performDatabaseCleanup, formatCleanupStats } =
      await import("@/lib/database/cleanup");
    const stats = await performDatabaseCleanup();
    console.log(
      `[${appName}] Initial cleanup completed: ${formatCleanupStats(stats)}`,
    );
  } catch (cleanupError) {
    console.error(
      `[${appName}] Initial cleanup failed (non-fatal):`,
      cleanupError,
    );
  }
}

export async function startBackgroundWorkers(appName: string): Promise<void> {
  // Cleanup runs every 5 minutes. The shortest meaningful user-facing TTL is
  // email_2fa_codes (10 min), so a 5-minute cadence keeps stale entries from
  // lingering more than halfway through their next scheduled run.
  try {
    const { schedulePeriodicCleanup } = await import("@/lib/database/cleanup");
    schedulePeriodicCleanup(5 * 60 * 1000);
    console.log(
      `[${appName}] Scheduled periodic database cleanup (5min interval).`,
    );
  } catch (scheduleError) {
    console.error(
      `[${appName}] Failed to schedule periodic cleanup:`,
      scheduleError,
    );
  }

  // Polls scheduled_scans for anything due every
  // CONFIG_SCHEDULE_WORKER_POLL_INTERVAL_MS (2 min by default) rather than
  // trying to align exactly with each schedule's own frequency: the same "poll
  // on a short fixed cadence, not per-row timers" approach as the cleanup job.
  // See lib/scanner/scheduled-scans-worker.ts for the claim/concurrency design.
  try {
    const { schedulePeriodicScheduledScans } =
      await import("@/lib/scanner/scheduled-scans-worker");
    schedulePeriodicScheduledScans();
    console.log(`[${appName}] Scheduled the scheduled-scans worker.`);
  } catch (scheduleError) {
    console.error(
      `[${appName}] Failed to schedule the scheduled-scans worker:`,
      scheduleError,
    );
  }

  // The digest columns themselves (users.digest_email_enabled,
  // users.last_digest_sent_at, notification_preferences.email_posture_digest)
  // are a schema step now, not something this worker's start-up adds: they
  // used to be applied only here, so they existed on a booted database and on
  // no other path. See the posture-digest-columns step in
  // lib/database/schema/03-integrations.mjs.
  try {
    const { schedulePeriodicPostureDigest } =
      await import("@/lib/notifications/posture-digest");
    schedulePeriodicPostureDigest();
    console.log(`[${appName}] Scheduled the posture-digest worker.`);
  } catch (scheduleError) {
    console.error(
      `[${appName}] Failed to schedule the posture-digest worker:`,
      scheduleError,
    );
  }

  // On by default (DOMAIN_REVERIFY_ENABLED, see registry.ts): a safety
  // mechanism, not an opt-in convenience feature, unlike the scheduled-backup
  // worker below. Closes the gap where a verified domain that later changes
  // hands keeps the original account's active-probes permission forever.
  try {
    const { schedulePeriodicDomainReverify } =
      await import("@/lib/domains/reverify-worker");
    schedulePeriodicDomainReverify();
    console.log(`[${appName}] Scheduled the domain reverify worker.`);
  } catch (scheduleError) {
    console.error(
      `[${appName}] Failed to schedule the domain reverify worker:`,
      scheduleError,
    );
  }

  // Off by default (SCHEDULED_BACKUP_ENABLED, see registry.ts): the timer is
  // always registered so flipping the setting on takes effect on the next tick
  // without a restart, same as posture digests above.
  try {
    const { schedulePeriodicBackup } =
      await import("@/lib/backup/scheduled-backup-worker");
    schedulePeriodicBackup();
    console.log(`[${appName}] Scheduled the periodic backup worker.`);
  } catch (scheduleError) {
    console.error(
      `[${appName}] Failed to schedule the periodic backup worker:`,
      scheduleError,
    );
  }
}
