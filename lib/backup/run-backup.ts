/**
 * Spawns scripts/backup-db.mjs as a real child process and wires its
 * stdout/stderr into the job-store's log tail -- the same
 * spawn-and-observe shape lib/updater/apply.ts uses against
 * lib/updater/job-store.ts, kept as its own small file (rather than
 * inlined in the route) so the route handler stays thin.
 *
 * Invoked exactly as `npm run db:backup` runs it --
 * `node scripts/backup-db.mjs` with no extra flags -- because the script
 * is a standalone CLI entrypoint (its own argv parsing, its own
 * `process.exit` on failure) that reads BACKUP_DIR,
 * BACKUP_RETENTION_DAYS, BACKUP_ENCRYPTION_KEY, and
 * BACKUP_OFFSITE_UPLOAD_URL from process.env exactly like it does when
 * run from a shell or cron. Never built as a shell string -- argv array,
 * `shell: false` -- same defense-in-depth stance as lib/updater/exec.ts.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { appendLog, finishJob } from "./job-store";

// pg_dump against a large production database can legitimately run for a
// while; this is a backstop against a hung/wedged process leaving the
// job (and the single-flight active-job slot) stuck "running" forever,
// not a tuned expectation of how long a normal backup takes.
const BACKUP_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Resolved outcome of one backup run.
 *
 * This used to be `Promise<void>`, which made every failure invisible to the
 * caller: the scheduled worker awaited it and unconditionally reported a clean
 * pass to the failure escalator, so a pg_dump that failed every single night
 * never fired the admin alert built for exactly that case. The status is now
 * part of the return value, and both failure paths also console.error so
 * lib/database/error-log-capture.ts records them in system_error_logs (the
 * in-memory job store is capped at 20 jobs and wiped on every restart, so it
 * cannot be the only record of a failure).
 */
export interface BackupRunResult {
  ok: boolean;
  error?: string;
}

export function runBackupJob(
  jobId: string,
  appRoot: string = process.cwd(),
): Promise<BackupRunResult> {
  return new Promise<BackupRunResult>((resolveJob) => {
    const scriptPath = join(appRoot, "scripts", "backup-db.mjs");
    const child = spawn(process.execPath, [scriptPath], {
      cwd: appRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }, BACKUP_TIMEOUT_MS);
    killTimer.unref();

    child.stdout?.on("data", (chunk: Buffer) => {
      appendLog(jobId, chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      appendLog(jobId, chunk.toString("utf8"));
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      appendLog(jobId, `Failed to start backup process: ${err.message}`);
      finishJob(jobId, "failed", err.message);
      console.error("[backup] Failed to start backup process:", err.message);
      resolveJob({ ok: false, error: err.message });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (code === 0) {
        finishJob(jobId, "success");
        resolveJob({ ok: true });
        return;
      }
      const error = `Backup script exited with code ${code}`;
      finishJob(jobId, "failed", error);
      console.error(`[backup] ${error}`);
      resolveJob({ ok: false, error });
    });
  });
}
