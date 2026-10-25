/**
 * The background workers whose health the admin Overview reports.
 *
 * Each of these arms a timer at boot and records every tick through
 * createFailureEscalator (lib/admin/failure-escalation.ts), which keeps one
 * row per `event` in worker_failure_state. The health route reads those rows
 * back; it needs a name and a cadence for each, and the cadence is what turns
 * "this row was last written 20 hours ago" into "that worker has stopped".
 *
 * The interval is the one the worker actually arms with (the boot default
 * from lib/config/config-values.ts), not a copy of its number.
 * tests/lib/admin/worker-registry.test.ts reads every createFailureEscalator
 * call in lib/ and fails if one is missing here, so a seventh worker cannot
 * be added without appearing in the panel.
 */
import {
  CONFIG_DB_CLEANUP_INTERVAL_MS,
  CONFIG_DOMAIN_REVERIFY_TICK_INTERVAL_MS,
  CONFIG_POSTURE_DIGEST_POLL_INTERVAL_MS,
  CONFIG_SCHEDULED_BACKUP_INTERVAL_MS,
  CONFIG_SCHEDULE_WORKER_POLL_INTERVAL_MS,
  CONFIG_STALE_SCAN_SWEEP_INTERVAL_MS,
} from "@/lib/config/config-values";

export interface BackgroundWorker {
  /** The worker_failure_state.event the worker's escalator writes under. */
  event: string;
  /** What staff call it in the panel. */
  label: string;
  /** How often it ticks, which is how often it records. */
  intervalMs: number;
}

export const BACKGROUND_WORKERS: readonly BackgroundWorker[] = [
  {
    event: "cleanup_worker_failing",
    label: "Database cleanup",
    intervalMs: CONFIG_DB_CLEANUP_INTERVAL_MS,
  },
  {
    event: "stale_scan_sweep_failing",
    label: "Stale-scan sweep",
    intervalMs: CONFIG_STALE_SCAN_SWEEP_INTERVAL_MS,
  },
  {
    event: "scheduled_scans_worker_failing",
    label: "Scheduled scans",
    intervalMs: CONFIG_SCHEDULE_WORKER_POLL_INTERVAL_MS,
  },
  {
    event: "posture_digest_worker_failing",
    label: "Posture digests",
    intervalMs: CONFIG_POSTURE_DIGEST_POLL_INTERVAL_MS,
  },
  {
    event: "domain_reverify_worker_failing",
    label: "Domain re-verification",
    intervalMs: CONFIG_DOMAIN_REVERIFY_TICK_INTERVAL_MS,
  },
  {
    event: "scheduled_backup_worker_failing",
    label: "Scheduled backups",
    intervalMs: CONFIG_SCHEDULED_BACKUP_INTERVAL_MS,
  },
];

/**
 * Whether this host cannot run in-process timers at all. On a serverless
 * platform the process does not live long enough for any worker to tick,
 * which lib/database/boot/workers.ts documents as an accepted limitation, so
 * a worker that never reports there is the expected state and not a fault.
 * VERCEL is the signal lib/updater/environment.ts also keys off; the other two
 * are the equivalents on AWS Lambda and Netlify.
 */
export function hostRunsWorkers(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY);
}
