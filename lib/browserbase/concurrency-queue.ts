/**
 * Global concurrency cap + queue for live-browser (Browserbase) sessions.
 *
 * A user's browserbaseMinutesPerMonth plan limit (lib/billing/
 * browserbase-usage.ts) bounds how much of the month one account can use,
 * but nothing previously bounded how many sessions could be open AT ONCE
 * across every user combined -- and Browserbase's own account has a real
 * concurrency ceiling of its own, independent of any per-user allowance.
 * Once enough users hold live-browser sessions simultaneously, the next
 * POST /api/v3/browser/sessions would otherwise just fail outright against
 * Browserbase's own limit. This module queues that request instead: it
 * waits for a slot to free (up to BROWSERBASE_QUEUE_MAX_WAIT_MS), admitting
 * paid-plan callers ahead of free-plan ones when several are waiting for
 * the same freed slot, and gives up with `acquired: false` if the wait
 * exceeds the deadline so the route can return a clear "still busy" 503
 * rather than hang the request indefinitely.
 *
 * In-memory by design, the same choice lib/scanner/scan-jobs.ts's
 * cancelControllers Map already makes for this app's "one persistent Node
 * process, no job queue" architecture (see execute-scan.ts). A process
 * restart loses the in-memory counter, but the gap self-heals within one
 * session TTL (a few minutes) rather than persisting: reconcileFromDb()
 * below seeds the counter from the real browser_sessions table on module
 * load, and every acquire beyond that point is exact (no restart in
 * between) since a single Node process is single-threaded -- there is no
 * TOCTOU race between the "is a slot free" check and reserving it the way
 * there would be with two callers independently polling a live DB count.
 */

import pool from "@/lib/database/db";
import { getSetting } from "@/lib/config/runtime-config";
import { APP_NAME } from "@/lib/config/constants";
import { CONFIG_BROWSERBASE_MAX_CONCURRENT_SESSIONS } from "@/lib/config/config-values";

interface Waiter {
  resolve: (acquired: boolean) => void;
  priority: boolean;
  settled: boolean;
}

let inFlight = 0;
const waiters: Waiter[] = [];

/**
 * Seeds `inFlight` from the real browser_sessions table (rows that haven't
 * expired yet) once, on module load, so a fresh process doesn't start
 * believing every slot is free when sessions from before the restart are
 * still genuinely open on Browserbase's side. Best-effort: a query failure
 * here just leaves the counter at 0, the same permissive starting state as
 * before this reconciliation existed.
 */
async function reconcileFromDb(): Promise<void> {
  try {
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM browser_sessions WHERE expires_at > NOW()`,
    );
    inFlight = Math.max(inFlight, result.rows[0]?.count ?? 0);
  } catch (err) {
    console.error(
      `[${APP_NAME}] browserbase concurrency-queue: startup reconciliation failed (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}
void reconcileFromDb();

/** Admits as many waiters as there is room for, priority (paid-plan)
 *  callers first, FIFO within each priority bucket. Called after every
 *  release and whenever a new waiter joins, so a slot freed by any path
 *  (an explicit DELETE, or the periodic cleanup sweep reclaiming a session
 *  nobody closed) gets handed to the next waiter promptly. */
function admit(maxConcurrent: number): void {
  if (waiters.length === 0) return;
  waiters.sort((a, b) => Number(b.priority) - Number(a.priority));
  while (inFlight < maxConcurrent && waiters.length > 0) {
    const waiter = waiters.shift()!;
    if (waiter.settled) continue; // already timed out; don't reserve for it
    waiter.settled = true;
    inFlight++;
    waiter.resolve(true);
  }
}

export interface ConcurrencySlotResult {
  acquired: boolean;
  /** True if this request ever had to wait at all, even briefly. */
  queued: boolean;
}

/**
 * Reserves one concurrency slot, waiting (queueing) if none is free right
 * now. `priority` (paid-plan callers, see app/api/v3/browser/sessions/
 * route.ts) are admitted ahead of non-priority ones whenever a slot frees
 * while both are waiting. Every successful acquire (`acquired: true`) MUST
 * be matched by exactly one releaseConcurrencySlot() call once the session
 * actually ends (or immediately, if session creation itself failed after
 * acquiring) -- otherwise the slot leaks and the cap silently shrinks over
 * time.
 *
 * A BROWSERBASE_MAX_CONCURRENT_SESSIONS setting of -1 disables the cap
 * entirely (always acquires immediately, never queues) -- the same "-1
 * means unlimited" convention every other plan/setting numeric field in
 * this codebase uses.
 */
export async function acquireConcurrencySlot(
  priority: boolean,
): Promise<ConcurrencySlotResult> {
  const maxConcurrent = await getSetting("BROWSERBASE_MAX_CONCURRENT_SESSIONS");
  if (maxConcurrent === -1) return { acquired: true, queued: false };

  admit(maxConcurrent); // opportunistically clear any stale waiters first
  if (inFlight < maxConcurrent && waiters.length === 0) {
    inFlight++;
    return { acquired: true, queued: false };
  }

  const maxWaitMs = await getSetting("BROWSERBASE_QUEUE_MAX_WAIT_MS");

  return new Promise<ConcurrencySlotResult>((resolve) => {
    const waiter: Waiter = {
      priority,
      settled: false,
      resolve: (acquired) => resolve({ acquired, queued: true }),
    };
    waiters.push(waiter);
    admit(maxConcurrent);

    if (waiter.settled) return; // admit() above already resolved it

    const timer = setTimeout(() => {
      if (waiter.settled) return;
      waiter.settled = true;
      const idx = waiters.indexOf(waiter);
      if (idx !== -1) waiters.splice(idx, 1);
      resolve({ acquired: false, queued: true });
    }, maxWaitMs);
    timer.unref?.();
  });
}

/**
 * Releases a previously-acquired slot and immediately tries to admit the
 * next waiter(s). Safe to call even when the cap is disabled (-1) or
 * nothing was ever acquired in the first place -- inFlight never goes
 * negative.
 */
export async function releaseConcurrencySlot(): Promise<void> {
  if (inFlight === 0) return;
  inFlight--;
  // admit() must run even if the settings lookup fails. A throw from
  // getSetting used to propagate out of here with the counter already
  // decremented and every queued waiter left unadmitted, and every caller
  // swallows this function's rejection, so the queue simply stalled until each
  // waiter timed out with nothing in the error log. Fall back to the compiled
  // default rather than skipping the admit.
  let maxConcurrent: number;
  try {
    maxConcurrent = await getSetting("BROWSERBASE_MAX_CONCURRENT_SESSIONS");
  } catch (err) {
    console.error(
      `[${APP_NAME}] Browserbase concurrency: settings lookup failed on release, admitting against the compiled default:`,
      err,
    );
    maxConcurrent = CONFIG_BROWSERBASE_MAX_CONCURRENT_SESSIONS;
  }
  admit(maxConcurrent === -1 ? Infinity : maxConcurrent);
}

/** Test-only: resets in-memory state between tests. */
export function _resetConcurrencyQueueForTests(): void {
  inFlight = 0;
  waiters.length = 0;
}

/** Test-only: current in-flight count, for assertions. */
export function _getInFlightForTests(): number {
  return inFlight;
}
