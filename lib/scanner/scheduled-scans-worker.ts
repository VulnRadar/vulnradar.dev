/**
 * Executes the `scheduled_scans` feature end to end.
 *
 * Before this module existed, `app/api/v3/schedules/route.ts` let a user
 * create/list/delete rows in `scheduled_scans` (with a `next_run_at`
 * column), but nothing anywhere ever read that column and actually
 * triggered a scan -- the feature was a facade. This is the worker that
 * makes it real: a periodic in-process poll (same pattern as
 * lib/database/cleanup.ts's schedulePeriodicCleanup, registered from
 * instrumentation.ts's startup sequence) that finds due schedules, claims
 * them safely under concurrent workers, and runs each one through the same
 * `executeScan` path a manual scan uses.
 *
 * Design notes:
 *
 * - Claiming (`claimDueSchedules`) uses `SELECT ... FOR UPDATE SKIP LOCKED`
 *   inside a short transaction that immediately pushes the claimed rows'
 *   `next_run_at` into the near future (CLAIM_BUFFER_MINUTES) before
 *   committing. This both prevents two workers (or two overlapping polling
 *   ticks, if a scan runs longer than the poll interval) from double-running
 *   the same schedule, and self-heals if this process crashes mid-batch --
 *   the buffer expires and the row becomes claimable again instead of being
 *   stuck forever.
 *
 * - Processing (`runInBatches`) runs claimed schedules with bounded
 *   concurrency (SCHEDULE_WORKER_BATCH_CONCURRENCY at a time), not
 *   `Promise.all` across the whole claimed set. This is the actual
 *   thundering-herd guard: a signup wave of same-cadence schedules, or a
 *   backlog built up while the server was down, degrades to "runs a bit
 *   later than next_run_at, in order" instead of launching hundreds of
 *   concurrent scans and taking the process down. Deterministic per-schedule
 *   jitter on `next_run_at` (see schedule-timing.ts) reduces how often a
 *   large same-tick batch happens in the first place; this concurrency cap
 *   is what bounds the damage on the ticks where it does.
 *
 * - Failure isolation: a schedule whose scan attempt throws (DB hiccup,
 *   executeScan error) is logged and rescheduled at its normal cadence --
 *   never deactivated for a transient failure. A schedule whose target now
 *   fails validateScanTarget (SSRF / safe-target check) IS deactivated and
 *   the owner is emailed, because that condition describes the target
 *   itself (DNS now resolves privately, etc.) and won't clear on its own on
 *   the next run the way a network blip would.
 */

import pool from "@/lib/database/db";
import { getSetting } from "@/lib/config/runtime-config";
import {
  CONFIG_SCHEDULE_WORKER_POLL_INTERVAL_MS,
  CONFIG_SCHEDULE_WORKER_CLAIM_BUFFER_MINUTES,
} from "@/lib/config/config-values";
import { validateScanTarget } from "./safe-fetch";
import { resolveScanIsPublic } from "./scan-privacy";
import { getPlannedSyncCategories } from "./engine";
import { getPlannedAsyncBranches } from "./async-checks";
import {
  executeScan,
  normalizeUrl,
  isRawIpv4,
  getProtocolType,
} from "./execute-scan";
import {
  computeNextRunAt,
  isScheduleFrequency,
  FREQUENCIES,
  type ScheduleFrequency,
} from "./schedule-timing";
import { userMeetsScheduleFrequency } from "@/lib/billing/plan-limits";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import {
  scheduleDisabledEmail,
  scheduledScanCompleteEmail,
} from "@/lib/email/email";
import { APP_NAME, DEFAULT_SCAN_NOTE } from "@/lib/config/constants";
import { createFailureEscalator } from "@/lib/admin/failure-escalation";

/** Rows claimed per polling tick, admin-configurable (SCHEDULE_WORKER_CLAIM_LIMIT
 *  setting). A backlog larger than this just spreads across additional ticks
 *  (CONFIG_SCHEDULE_WORKER_POLL_INTERVAL_MS apart) rather than all being
 *  claimed -- and therefore all attempted -- at once. Used only as the
 *  default parameter value below; the shipped compiled default. */
const CLAIM_LIMIT = 200;

/** How long a claimed row is "soft-locked" (next_run_at pushed forward)
 *  while its scan runs. Comfortably above SCAN_TIMEOUT_SECONDS' typical
 *  range so a normal-length scan never has its own claim expire out from
 *  under it; a crashed worker self-heals after this window instead of
 *  leaving the row stuck forever. NOT admin-configurable (see
 *  NEVER_CONFIGURABLE in lib/config/registry.ts): must stay above the scan
 *  timeout settings or a long scan's claim can expire mid-run. */
const CLAIM_BUFFER_MINUTES = CONFIG_SCHEDULE_WORKER_CLAIM_BUFFER_MINUTES;

export interface DueSchedule {
  id: number;
  user_id: number;
  url: string;
  frequency: string;
  preferred_hour_utc: number;
  preferred_day_of_week: number;
  preferred_day_of_month: number;
}

export interface ProcessOutcome {
  id: number;
  outcome: "scanned" | "blocked" | "plan_gated" | "error";
  detail?: string;
}

/**
 * Claim up to `limit` due, active schedules with `FOR UPDATE SKIP LOCKED`
 * so concurrent callers (another process, or an overlapping polling tick)
 * never claim the same row twice. Immediately pushes each claimed row's
 * `next_run_at` forward by CLAIM_BUFFER_MINUTES as a soft lock before
 * releasing the row lock at COMMIT -- the real next_run_at (from
 * computeNextRunAt) is written later, once the scan attempt is known.
 */
export async function claimDueSchedules(
  limit: number = CLAIM_LIMIT,
): Promise<DueSchedule[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<DueSchedule>(
      `SELECT id, user_id, url, frequency, preferred_hour_utc, preferred_day_of_week, preferred_day_of_month
       FROM scheduled_scans
       WHERE active = true AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );

    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      await client.query(
        `UPDATE scheduled_scans
         SET next_run_at = NOW() + make_interval(mins => $2)
         WHERE id = ANY($1::int[])`,
        [ids, CLAIM_BUFFER_MINUTES],
      );
    }

    await client.query("COMMIT");
    return rows;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Persist the next occurrence for a schedule, and (only for an actual scan
 *  attempt) stamp last_run_at. Always overwrites the CLAIM_BUFFER_MINUTES
 *  soft-lock placeholder set by claimDueSchedules with the real computed
 *  value. */
async function rescheduleNext(
  schedule: DueSchedule,
  now: Date,
  { stampLastRun = false }: { stampLastRun?: boolean } = {},
): Promise<void> {
  const frequency: ScheduleFrequency = isScheduleFrequency(schedule.frequency)
    ? schedule.frequency
    : "weekly";
  const nextRunAt = computeNextRunAt(
    schedule.id,
    {
      frequency,
      preferredHourUtc: schedule.preferred_hour_utc,
      preferredDayOfWeek: schedule.preferred_day_of_week,
      preferredDayOfMonth: schedule.preferred_day_of_month,
    },
    now,
  );

  if (stampLastRun) {
    await pool.query(
      `UPDATE scheduled_scans SET next_run_at = $1, last_run_at = NOW() WHERE id = $2`,
      [nextRunAt.toISOString(), schedule.id],
    );
  } else {
    await pool.query(
      `UPDATE scheduled_scans SET next_run_at = $1 WHERE id = $2`,
      [nextRunAt.toISOString(), schedule.id],
    );
  }
}

/** Turn a schedule off because its target permanently fails the safety
 *  check, and tell the owner why -- this condition describes the target
 *  itself, not a transient run failure, so silently retrying forever would
 *  never recover on its own. */
async function deactivateForUnsafeTarget(
  schedule: DueSchedule,
  reason: string,
): Promise<void> {
  await pool.query(`UPDATE scheduled_scans SET active = false WHERE id = $1`, [
    schedule.id,
  ]);
  console.error(
    `[${APP_NAME}] Deactivated schedule #${schedule.id} (${schedule.url}): ${reason}`,
  );

  try {
    const userRes = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [schedule.user_id],
    );
    const userEmail = userRes.rows[0]?.email;
    if (!userEmail) return;
    const emailContent = scheduleDisabledEmail(schedule.url, reason);
    await sendNotificationEmail({
      userId: schedule.user_id,
      userEmail,
      type: "schedules",
      emailContent,
    });
  } catch (err) {
    console.error(
      `[${APP_NAME}] Failed to send schedule-disabled notification for #${schedule.id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Run one due schedule: re-validate the target, gate on the user's current
 * plan (a downgrade since creation can revoke a sub-day frequency), create
 * the scan_history row, and run it through the exact same executeScan path
 * a manual scan uses. Never throws -- every failure mode is caught, logged,
 * and turned into a ProcessOutcome so one bad schedule can never stop the
 * batch (see runDueSchedules).
 */
export async function processSchedule(
  schedule: DueSchedule,
  now: Date = new Date(),
): Promise<ProcessOutcome> {
  try {
    const normalizedUrl = normalizeUrl(schedule.url);

    // ssrf: re-validate at run time. A target that was safe when the
    // schedule was created can resolve to something blocked later (DNS
    // rebinding, infrastructure changes) -- never skip this just because it
    // passed once.
    const safetyCheck = await validateScanTarget(normalizedUrl);
    if (!safetyCheck.safe) {
      const reason = safetyCheck.reason || "Target blocked";
      await deactivateForUnsafeTarget(schedule, reason);
      return { id: schedule.id, outcome: "blocked", detail: reason };
    }

    const frequency: ScheduleFrequency = isScheduleFrequency(schedule.frequency)
      ? schedule.frequency
      : "weekly";

    // billing: re-check the frequency's plan gate at run time too, not just
    // at creation -- the user's plan could have been downgraded since. Not
    // a permanent problem the way an unsafe target is, so this reschedules
    // normally rather than deactivating; if the user re-upgrades, the next
    // occurrence just runs.
    const minPlan = FREQUENCIES[frequency].minPlan;
    if (!(await userMeetsScheduleFrequency(schedule.user_id, minPlan))) {
      await rescheduleNext(schedule, now);
      return { id: schedule.id, outcome: "plan_gated" };
    }

    const isRawIpTarget = isRawIpv4(schedule.url) || isRawIpv4(normalizedUrl);
    const protocolType = getProtocolType(normalizedUrl);
    const plannedSync = isRawIpTarget ? [] : getPlannedSyncCategories(null);
    const plannedAsync = getPlannedAsyncBranches(normalizedUrl, null);
    const categoriesTotal = plannedSync.length + plannedAsync.length;

    // A schedule has no per-run privacy UI of its own, so this always
    // falls back to the account's "scans are private by default" setting
    // (same helper manual scans use when their own request omits
    // isPublic) rather than hardcoding true.
    const isPublic = await resolveScanIsPublic(schedule.user_id, undefined);

    const insertRes = await pool.query<{ id: number }>(
      `INSERT INTO scan_history
         (user_id, url, source, notes, status, started_at, categories_total, is_public)
       VALUES ($1, $2, 'scheduled', $3, 'pending', NOW(), $4, $5)
       RETURNING id`,
      [
        schedule.user_id,
        normalizedUrl,
        DEFAULT_SCAN_NOTE,
        categoriesTotal,
        isPublic,
      ],
    );
    const scanHistoryId = insertRes.rows[0]?.id;
    if (!scanHistoryId) throw new Error("scan_history insert returned no id");

    await executeScan({
      scanId: scanHistoryId,
      url: schedule.url,
      normalizedUrl,
      protocolType,
      isRawIpTarget,
      selectedScanners: null,
      requestedProbes: [],
      authedUserId: schedule.user_id,
      categoriesTotal,
      silenceRoutineEmail: true,
    });

    // "Scheduled Scans Completed" (email_schedules) is its own preference,
    // separate from the routine "scan complete" email that
    // silenceRoutineEmail suppresses above -- that suppression exists so a
    // schedule that reruns every hour doesn't spam the *manual scan
    // complete* template, which isn't described anywhere as being about
    // scheduled runs. This is the dedicated notification the "Scheduled
    // Scans Completed" toggle already promises ("Alerts when your
    // scheduled scans finish"); a user who finds it too frequent for a
    // sub-daily schedule can turn the toggle off, the same way every other
    // preference in this app is opted out of.
    try {
      const rowRes = await pool.query<{
        summary: unknown;
        duration: number;
        status: string;
      }>(`SELECT summary, duration, status FROM scan_history WHERE id = $1`, [
        scanHistoryId,
      ]);
      const row = rowRes.rows[0];
      if (row?.status === "completed") {
        const userRes = await pool.query<{ email: string }>(
          `SELECT email FROM users WHERE id = $1`,
          [schedule.user_id],
        );
        const userEmail = userRes.rows[0]?.email;
        if (userEmail) {
          const summary =
            typeof row.summary === "string"
              ? JSON.parse(row.summary)
              : row.summary;
          await sendNotificationEmail({
            userId: schedule.user_id,
            userEmail,
            type: "schedules",
            emailContent: scheduledScanCompleteEmail(
              FREQUENCIES[frequency].label,
              schedule.url,
              summary,
              row.duration,
              scanHistoryId,
            ),
          });
        }
      }
    } catch (err) {
      console.error(
        `[${APP_NAME}] Failed to send schedule-complete notification for #${schedule.id}:`,
        err instanceof Error ? err.message : err,
      );
    }

    await rescheduleNext(schedule, now, { stampLastRun: true });
    return { id: schedule.id, outcome: "scanned" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[${APP_NAME}] Scheduled scan failed for schedule #${schedule.id} (${schedule.url}):`,
      message,
    );
    // A transient failure (DB hiccup, executeScan throwing) is not a
    // permanent target problem -- retry at the normal cadence rather than
    // disabling the user's schedule over a one-off error.
    await rescheduleNext(schedule, now).catch((rescheduleErr) => {
      console.error(
        `[${APP_NAME}] Failed to reschedule #${schedule.id} after a run failure:`,
        rescheduleErr instanceof Error ? rescheduleErr.message : rescheduleErr,
      );
    });
    return { id: schedule.id, outcome: "error", detail: message };
  }
}

/**
 * Run `items` through `worker` with bounded concurrency: `batchSize` items
 * in flight at once, waiting for each batch to fully settle before starting
 * the next. This -- not the jitter in schedule-timing.ts -- is what actually
 * prevents a large due-schedule backlog from launching an unbounded burst of
 * concurrent scans; jitter only reduces how often a large same-tick batch
 * happens in the first place.
 */
export async function runInBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.trunc(batchSize) || 1);
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const batchResults = await Promise.all(batch.map((item) => worker(item)));
    results.push(...batchResults);
  }
  return results;
}

export interface RunDueSchedulesStats {
  processed: number;
  scanned: number;
  blocked: number;
  planGated: number;
  errors: number;
}

/** One full pass: claim whatever is due, process it with bounded
 *  concurrency, and summarize the outcome. Exported directly (not just via
 *  the periodic timer) so the admin cleanup-style "force a run now" pattern
 *  is available if this ever gets a manual trigger endpoint. */
export async function runDueSchedules(): Promise<RunDueSchedulesStats> {
  const claimLimit = await getSetting("SCHEDULE_WORKER_CLAIM_LIMIT");
  const due = await claimDueSchedules(claimLimit);
  if (due.length === 0) {
    return { processed: 0, scanned: 0, blocked: 0, planGated: 0, errors: 0 };
  }

  const concurrency = await getSetting("SCHEDULE_WORKER_BATCH_CONCURRENCY");
  const now = new Date();
  const results = await runInBatches(due, concurrency, (schedule) =>
    processSchedule(schedule, now),
  );

  return {
    processed: results.length,
    scanned: results.filter((r) => r.outcome === "scanned").length,
    blocked: results.filter((r) => r.outcome === "blocked").length,
    planGated: results.filter((r) => r.outcome === "plan_gated").length,
    errors: results.filter((r) => r.outcome === "error").length,
  };
}

function formatStats(stats: RunDueSchedulesStats): string {
  return (
    `${stats.scanned} scanned, ${stats.blocked} disabled (unsafe target), ` +
    `${stats.planGated} deferred (plan), ${stats.errors} errored ` +
    `(of ${stats.processed} due)`
  );
}

let activeScheduleTimer: NodeJS.Timeout | null = null;

/**
 * Schedule a repeating pass over due scheduled scans. Same pattern as
 * lib/database/cleanup.ts's schedulePeriodicCleanup: an in-process
 * setInterval, unref'd so a pending pass never keeps the process alive on
 * SIGTERM, only fires in a long-lived deployment (Node/Docker/self-hosted --
 * not serverless, a limitation this codebase already accepts for the
 * cleanup job). Returns the timer handle so callers can clearInterval on
 * shutdown; a repeat call cancels any previously scheduled timer first
 * (prevents double-scheduling on hot reload).
 */
export function schedulePeriodicScheduledScans(
  intervalMs: number = CONFIG_SCHEDULE_WORKER_POLL_INTERVAL_MS,
): NodeJS.Timeout {
  if (activeScheduleTimer) {
    clearInterval(activeScheduleTimer);
  }
  const safeInterval =
    Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : CONFIG_SCHEDULE_WORKER_POLL_INTERVAL_MS;

  const escalator = createFailureEscalator("scheduled_scans_worker_failing");
  activeScheduleTimer = setInterval(async () => {
    try {
      const stats = await runDueSchedules();
      if (stats.processed > 0) {
        console.log(
          `[${APP_NAME}] Scheduled scan worker: ${formatStats(stats)}`,
        );
      }
      escalator.recordSuccess();
    } catch (err) {
      console.error(`[${APP_NAME}] Scheduled scan worker pass failed:`, err);
      escalator.recordFailure(
        "The scheduled-scans worker is failing on every pass -- due scheduled scans are not running",
      );
    }
  }, safeInterval);
  activeScheduleTimer.unref?.();
  return activeScheduleTimer;
}

export function stopPeriodicScheduledScans(): void {
  if (activeScheduleTimer) {
    clearInterval(activeScheduleTimer);
    activeScheduleTimer = null;
  }
}
