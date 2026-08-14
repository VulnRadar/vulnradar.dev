/**
 * In-memory job registry for the admin-triggered database backup flow,
 * polled by the admin UI via GET /api/v3/admin/backup.
 *
 * Same shape and same rationale as lib/updater/job-store.ts: in-memory
 * (not DB-backed) is deliberate, not a shortcut. The job IS "run
 * scripts/backup-db.mjs as a child process of this exact running Node
 * process" -- it can only ever be observed by the process that spawned
 * it, so a restart legitimately ends the job's visibility. Unlike the
 * updater, a lost job here has no lasting consequence: the durable part
 * (the actual backup file on disk) survives the restart fine and is
 * discoverable independently -- see listBackupFiles in
 * app/api/v3/admin/backup/route.ts.
 */

import { randomUUID } from "node:crypto";

export type BackupJobStatus = "running" | "success" | "failed";

export interface BackupJob {
  id: string;
  status: BackupJobStatus;
  log: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  startedByUserId: number;
}

const MAX_LOG_LINES = 2000;
const MAX_COMPLETED_JOBS = 20;

const jobs = new Map<string, BackupJob>();
let activeJobId: string | null = null;

export function getActiveJobId(): string | null {
  return activeJobId;
}

/** Test-only: clears all jobs and the active-job pointer between tests.
 *  No application code path calls this. */
export function __resetForTests(): void {
  jobs.clear();
  activeJobId = null;
}

function pruneCompletedJobs(): void {
  const completed = [...jobs.values()]
    .filter((j) => j.status === "success" || j.status === "failed")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  while (completed.length > MAX_COMPLETED_JOBS) {
    const oldest = completed.shift();
    if (oldest) jobs.delete(oldest.id);
  }
}

/**
 * Creates and reserves the active job slot, or refuses (returns null) if
 * one is already active. Same single-flight guarantee as the updater's
 * createJob (see that file's comment): this check-and-set is a single
 * synchronous operation with no `await` in between, so two concurrent
 * POST /api/v3/admin/backup requests can't both reserve the slot and
 * both end up spawning a pg_dump against the same database.
 */
export function createJob(startedByUserId: number): BackupJob | null {
  if (activeJobId !== null) return null;
  const job: BackupJob = {
    id: randomUUID(),
    status: "running",
    log: [],
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    startedByUserId,
  };
  jobs.set(job.id, job);
  activeJobId = job.id;
  pruneCompletedJobs();
  return job;
}

export function getJob(id: string): BackupJob | undefined {
  return jobs.get(id);
}

/** Most recently started job, active or finished -- used by GET to report
 *  "the latest backup's status" without the caller needing to know a
 *  job id. Ties (identical startedAt) resolve to whichever was inserted
 *  later, since only one job can be active at a time in practice. */
export function getLatestJob(): BackupJob | undefined {
  let latest: BackupJob | undefined;
  for (const job of jobs.values()) {
    if (!latest || job.startedAt >= latest.startedAt) {
      latest = job;
    }
  }
  return latest;
}

export function appendLog(id: string, line: string): void {
  const job = jobs.get(id);
  if (!job) return;
  for (const l of line.split(/\r?\n/)) {
    if (l.length === 0) continue;
    job.log.push(l);
  }
  if (job.log.length > MAX_LOG_LINES) {
    job.log.splice(0, job.log.length - MAX_LOG_LINES);
  }
}

export function finishJob(
  id: string,
  status: "success" | "failed",
  error?: string,
): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = status;
  job.error = error ?? null;
  job.finishedAt = new Date().toISOString();
  if (activeJobId === id) activeJobId = null;
  pruneCompletedJobs();
}
