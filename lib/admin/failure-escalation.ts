/**
 * Tracks consecutive failures for a periodic background worker (DB
 * cleanup, scheduled scans, posture digests) and fires an admin alert
 * once a run has been failing long enough to be a real problem rather
 * than a single transient blip -- a worker whose every tick failed for
 * hours (e.g. after a bad deploy) previously only ever showed up in raw
 * stdout via console.error, with nobody paged.
 *
 * Alerts once per failure streak, not on every tick: crossing the
 * threshold fires exactly one alert, a later success resets the streak,
 * and failing again re-alerts. A long unbroken streak doesn't spam the
 * webhook forever.
 */
import { sendAdminAlert } from "@/lib/admin/alert-webhook";
import pool from "@/lib/database/db";

export interface FailureEscalator {
  recordSuccess(): void;
  recordFailure(message: string, context?: Record<string, unknown>): void;
}

// Best-effort DB persistence of the streak (worker_failure_state table). Kept
// off the sync interface: state is loaded once on create and written
// fire-and-forget on each record, so a DB hiccup degrades to the old in-memory
// behavior rather than blocking or throwing inside a worker's failure path.
async function loadState(
  event: string,
): Promise<{ consecutiveFailures: number; alerted: boolean } | null> {
  try {
    const r = await pool.query<{
      consecutive_failures: number;
      alerted: boolean;
    }>(
      "SELECT consecutive_failures, alerted FROM worker_failure_state WHERE event = $1",
      [event],
    );
    const row = r.rows[0];
    return row
      ? {
          consecutiveFailures: Number(row.consecutive_failures),
          alerted: row.alerted,
        }
      : null;
  } catch {
    return null;
  }
}

function persistState(
  event: string,
  consecutiveFailures: number,
  alerted: boolean,
): void {
  void pool
    .query(
      `INSERT INTO worker_failure_state (event, consecutive_failures, alerted, updated_at)
         VALUES ($1, $2, $3, NOW())
       ON CONFLICT (event) DO UPDATE
         SET consecutive_failures = EXCLUDED.consecutive_failures,
             alerted = EXCLUDED.alerted,
             updated_at = NOW()`,
      [event, consecutiveFailures, alerted],
    )
    .catch(() => {});
}

export function createFailureEscalator(
  event: string,
  threshold = 3,
): FailureEscalator {
  let consecutiveFailures = 0;
  let alerted = false;
  // Guards the async load below from clobbering a record() that happened to
  // land first (fast query vs. a slow first tick -- in practice the load wins,
  // but be safe).
  let touched = false;
  void loadState(event).then((s) => {
    if (s && !touched) {
      consecutiveFailures = s.consecutiveFailures;
      alerted = s.alerted;
    }
  });
  return {
    recordSuccess() {
      touched = true;
      consecutiveFailures = 0;
      alerted = false;
      persistState(event, 0, false);
    },
    recordFailure(message, context) {
      touched = true;
      consecutiveFailures++;
      const shouldAlert = consecutiveFailures >= threshold && !alerted;
      if (!shouldAlert) {
        persistState(event, consecutiveFailures, alerted);
        return;
      }

      // "Alerted" means an alert was DELIVERED, not that one was attempted.
      //
      // This used to set and persist the flag before the send, and discard
      // sendAdminAlert's result with a void. That result explicitly reports
      // {delivered:false} for a typo'd webhook URL, a revoked one, an SSRF
      // refusal or an HTTP 500 from the receiving end, so the first transient
      // failure at exactly the moment the threshold was crossed marked the
      // event as alerted and nothing else was sent for the rest of the
      // outage. Only a later success reset it, and a worker in an outage
      // produces no successes. The escalator disarmed itself precisely when
      // it was needed, across all five workers.
      //
      // Awaited, so the delivery result is known before it is recorded. The
      // failure count is persisted either way; the flag only advances on a
      // delivery that happened, so the next tick tries again.
      persistState(event, consecutiveFailures, alerted);
      void (async () => {
        try {
          const result = await sendAdminAlert({
            event,
            severity: "warning",
            message: `${message} (failed ${consecutiveFailures} times in a row).`,
            context,
          });
          if (result?.delivered) {
            alerted = true;
            persistState(event, consecutiveFailures, true);
          } else {
            console.error(
              `[FailureEscalation] ${event}: alert not delivered${result?.reason ? `: ${result.reason}` : ""}. Will retry on the next failure.`,
            );
          }
        } catch (err) {
          console.error(
            `[FailureEscalation] ${event}: alert threw:`,
            err instanceof Error ? err.message : err,
          );
        }
      })();
    },
  };
}
