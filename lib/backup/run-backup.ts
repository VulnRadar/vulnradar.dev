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

export function runBackupJob(
  jobId: string,
  appRoot: string = process.cwd(),
): Promise<void> {
  return new Promise((resolveJob) => {
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
      resolveJob();
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (code === 0) {
        finishJob(jobId, "success");
      } else {
        finishJob(jobId, "failed", `Backup script exited with code ${code}`);
      }
      resolveJob();
    });
  });
}
