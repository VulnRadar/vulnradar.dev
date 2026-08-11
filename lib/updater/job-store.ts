/**
 * In-memory job registry for the self-update flow, polled by the admin
 * UI via GET /api/v3/admin/updater/apply?jobId=...
 *
 * In-memory (not DB-backed) is a deliberate choice, not a shortcut: the
 * job IS "rewrite the files of, and rebuild, this exact running Node
 * process" -- it can only ever be observed by the process that ran it.
 * A restart (which is the expected last step of an update, see
 * lib/updater/apply.ts) legitimately ends the job's visibility, so
 * persisting it across restarts would be misleading rather than useful.
 * Closest existing precedent in this codebase is the scan-jobs in-memory
 * cancellation registry (lib/scanner/scan-jobs.ts) paired with a durable
 * DB row for the parts that make sense to keep -- updater jobs have no
 * durable part worth keeping.
 */

import { randomUUID } from "node:crypto";

export type UpdaterJobStatus =
  | "pending"
  | "downloading"
  | "verifying"
  | "extracting"
  | "installing"
  | "building"
  | "migrating"
  | "completed"
  | "failed";

export type UpdaterStepStatus =
  "pending" | "running" | "done" | "failed" | "skipped";

export interface UpdaterJobStep {
  name: string;
  status: UpdaterStepStatus;
  detail?: string;
}

export interface UpdaterJob {
  id: string;
  targetVersion: string;
  status: UpdaterJobStatus;
  steps: UpdaterJobStep[];
  log: string[];
  error: string | null;
  cosignVerified: "verified" | "skipped" | "failed" | null;
  startedAt: string;
  finishedAt: string | null;
  startedByUserId: number;
}

const MAX_LOG_LINES = 4000;
const MAX_COMPLETED_JOBS = 20;

const jobs = new Map<string, UpdaterJob>();
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
    .filter((j) => j.status === "completed" || j.status === "failed")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  while (completed.length > MAX_COMPLETED_JOBS) {
    const oldest = completed.shift();
    if (oldest) jobs.delete(oldest.id);
  }
}

/**
 * Creates and reserves the active job slot, or refuses (returns null) if
 * one is already active. This check-and-set MUST stay a single
 * synchronous operation with no `await` in between -- that's what makes
 * it safe against two concurrent POST /apply requests each racing through
 * their own async gauntlet (rate limit, body parse, password re-auth)
 * before reaching this call. The route's own `getActiveJobId()` check
 * earlier is only a fast-path optimization to skip that work when a job
 * is already obviously running; this is the real, race-proof gate that
 * prevents two `runUpdateJob` calls from ever running concurrently
 * against the same app directory.
 */
export function createJob(
  targetVersion: string,
  startedByUserId: number,
): UpdaterJob | null {
  if (activeJobId !== null) return null;
  const job: UpdaterJob = {
    id: randomUUID(),
    targetVersion,
    status: "pending",
    steps: [],
    log: [],
    error: null,
    cosignVerified: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    startedByUserId,
  };
  jobs.set(job.id, job);
  activeJobId = job.id;
  pruneCompletedJobs();
  return job;
}

export function getJob(id: string): UpdaterJob | undefined {
  return jobs.get(id);
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

export function setStatus(id: string, status: UpdaterJobStatus): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = status;
}

/** Upserts a step by name: marks it running/done/failed/skipped, appending if new. */
export function setStep(
  id: string,
  name: string,
  status: UpdaterStepStatus,
  detail?: string,
): void {
  const job = jobs.get(id);
  if (!job) return;
  const existing = job.steps.find((s) => s.name === name);
  if (existing) {
    existing.status = status;
    if (detail !== undefined) existing.detail = detail;
  } else {
    job.steps.push({ name, status, detail });
  }
}

export function setCosignResult(
  id: string,
  result: "verified" | "skipped" | "failed",
): void {
  const job = jobs.get(id);
  if (!job) return;
  job.cosignVerified = result;
}

export function finishJob(
  id: string,
  status: "completed" | "failed",
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
