/**
 * Periodic pg_dump backup, independent of a migration running or an admin
 * remembering to click the manual-backup button (AUDIT-010, prodready-05).
 *
 * Reuses the exact same spawn/observe path the admin-triggered flow uses
 * (lib/backup/run-backup.ts + lib/backup/job-store.ts), so a scheduled run
 * shows up in the admin backup panel's job history and file listing like
 * any other backup, and shares the same single-flight guarantee: if an
 * admin is already running a manual backup when this tick fires (or vice
 * versa), the second one is skipped rather than spawning a second pg_dump
 * against the same database.
 */

import { getSetting } from "@/lib/config/runtime-config";
import { createFailureEscalator } from "@/lib/admin/failure-escalation";
import { createJob, getActiveJobId } from "./job-store";
import { runBackupJob } from "./run-backup";
import { CONFIG_SCHEDULED_BACKUP_INTERVAL_MS } from "@/lib/config/config-values";
import { APP_NAME } from "@/lib/config/constants";

export type ScheduledBackupOutcome =
  "disabled" | "skipped_job_active" | "started";

/**
 * One tick: enabled check, then single-flight reservation, then hand off to
 * runBackupJob. Exported directly (not just via the periodic timer), same
 * as sendWeeklyDigests/runDueSchedules, so a "force a run now" caller (or a
 * test) has something to call without waiting for the interval.
 */
export async function runScheduledBackupPass(): Promise<ScheduledBackupOutcome> {
  if (!(await getSetting("SCHEDULED_BACKUP_ENABLED"))) return "disabled";

  // Don't fight an admin's manual run (or a previous scheduled run that's
  // still going) for the single active-job slot -- just skip this tick and
  // let the next one try again.
  if (getActiveJobId()) return "skipped_job_active";

  const job = createJob(null);
  if (!job) return "skipped_job_active";

  await runBackupJob(job.id);
  return "started";
}

let activeBackupTimer: NodeJS.Timeout | null = null;

export function schedulePeriodicBackup(
  intervalMs: number = CONFIG_SCHEDULED_BACKUP_INTERVAL_MS,
): NodeJS.Timeout {
  if (activeBackupTimer) {
    clearInterval(activeBackupTimer);
  }
  const safeInterval =
    Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : CONFIG_SCHEDULED_BACKUP_INTERVAL_MS;

  const escalator = createFailureEscalator("scheduled_backup_worker_failing");
  activeBackupTimer = setInterval(async () => {
    try {
      const outcome = await runScheduledBackupPass();
      if (outcome === "started") {
        console.log(`[${APP_NAME}] Scheduled backup worker: backup started.`);
      }
      escalator.recordSuccess();
    } catch (err) {
      console.error(`[${APP_NAME}] Scheduled backup worker pass failed:`, err);
      escalator.recordFailure(
        "The scheduled-backup worker is failing on every pass -- automatic database backups are not being taken",
      );
    }
  }, safeInterval);
  activeBackupTimer.unref?.();
  return activeBackupTimer;
}

export function stopPeriodicBackup(): void {
  if (activeBackupTimer) {
    clearInterval(activeBackupTimer);
    activeBackupTimer = null;
  }
}
