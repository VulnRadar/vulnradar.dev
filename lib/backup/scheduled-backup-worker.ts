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
 *
 * Whether a backup is due is read off the disk, not off a timer started at
 * boot: a plain setInterval never fired on a deployment that restarts more
 * often than the interval, and every deploy reset the clock.
 */

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getSetting } from "@/lib/config/runtime-config";
import { createFailureEscalator } from "@/lib/admin/failure-escalation";
import { createJob, getActiveJobId } from "./job-store";
import { runBackupJob } from "./run-backup";
import { CONFIG_SCHEDULED_BACKUP_INTERVAL_MS } from "@/lib/config/config-values";
import { APP_NAME } from "@/lib/config/constants";

export type ScheduledBackupOutcome =
  "disabled" | "skipped_job_active" | "skipped_recent" | "started" | "failed";

/** How often to ask the disk whether a backup is due. */
export const BACKUP_TICK_MS = 15 * 60 * 1000;

/**
 * Long enough for the boot's own work to settle before a pg_dump starts, and
 * shorter than a tick, so a deployment that restarts often still gets a look.
 */
export const BACKUP_BOOT_CHECK_DELAY_MS = 60 * 1000;

/**
 * The mtime of the newest dump in BACKUP_DIR, or null when there is none yet.
 * Same directory and name filter as the admin backup listing; an encryption
 * sidecar is written beside its dump and is not a backup of its own.
 */
async function newestBackupMtimeMs(): Promise<number | null> {
  const dir = resolve(process.env.BACKUP_DIR || join(process.cwd(), "backups"));
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const stamps = await Promise.all(
    names
      .filter(
        (name) =>
          name.startsWith("vulnradar-backup-") && !name.endsWith(".json"),
      )
      .map((name) =>
        stat(join(dir, name)).then(
          (s) => s.mtimeMs,
          () => null,
        ),
      ),
  );
  const found = stamps.filter((t): t is number => t !== null);
  return found.length > 0 ? Math.max(...found) : null;
}

/**
 * One tick: enabled check, then is one due, then single-flight reservation,
 * then hand off to runBackupJob. Exported directly (not just via the periodic timer), same
 * as sendWeeklyDigests/runDueSchedules, so a "force a run now" caller (or a
 * test) has something to call without waiting for the interval.
 */
export async function runScheduledBackupPass(
  intervalMs: number = CONFIG_SCHEDULED_BACKUP_INTERVAL_MS,
): Promise<ScheduledBackupOutcome> {
  if (!(await getSetting("SCHEDULED_BACKUP_ENABLED"))) return "disabled";

  // Don't fight an admin's manual run (or a previous scheduled run that's
  // still going) for the single active-job slot -- just skip this tick and
  // let the next one try again.
  if (getActiveJobId()) return "skipped_job_active";

  const newest = await newestBackupMtimeMs();
  if (newest !== null && Date.now() - newest < intervalMs) {
    return "skipped_recent";
  }

  const job = createJob(null);
  if (!job) return "skipped_job_active";

  // runBackupJob never rejects: it reports a spawn error or a non-zero exit
  // through its resolved result. Awaiting it and returning "started"
  // unconditionally (the old shape) meant a backup that failed on every run
  // still looked like a clean pass to the escalator below, so the alert built
  // for a broken backup could never fire. Surface the failure instead.
  const result = await runBackupJob(job.id);
  return result.ok ? "started" : "failed";
}

let activeBackupTimer: NodeJS.Timeout | null = null;
let activeBootCheck: NodeJS.Timeout | null = null;

export function schedulePeriodicBackup(
  intervalMs: number = CONFIG_SCHEDULED_BACKUP_INTERVAL_MS,
): NodeJS.Timeout {
  stopPeriodicBackup();
  const safeInterval =
    Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : CONFIG_SCHEDULED_BACKUP_INTERVAL_MS;

  const escalator = createFailureEscalator("scheduled_backup_worker_failing");
  const tick = async () => {
    try {
      const outcome = await runScheduledBackupPass(safeInterval);
      if (outcome === "started") {
        console.log(`[${APP_NAME}] Scheduled backup worker: backup started.`);
      }
      if (outcome === "failed") {
        escalator.recordFailure(
          "Automatic database backups are failing -- the scheduled pg_dump exited with an error",
        );
      } else {
        escalator.recordSuccess();
      }
    } catch (err) {
      console.error(`[${APP_NAME}] Scheduled backup worker pass failed:`, err);
      escalator.recordFailure(
        "The scheduled-backup worker is failing on every pass -- automatic database backups are not being taken",
      );
    }
  };
  activeBackupTimer = setInterval(tick, BACKUP_TICK_MS);
  activeBackupTimer.unref?.();
  activeBootCheck = setTimeout(tick, BACKUP_BOOT_CHECK_DELAY_MS);
  activeBootCheck.unref?.();
  return activeBackupTimer;
}

export function stopPeriodicBackup(): void {
  if (activeBootCheck) {
    clearTimeout(activeBootCheck);
    activeBootCheck = null;
  }
  if (activeBackupTimer) {
    clearInterval(activeBackupTimer);
    activeBackupTimer = null;
  }
}
