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

/** The longest failure reason the table keeps; the alert carries the rest. */
const MAX_LAST_ERROR_LENGTH = 1000;

/**
 * What a persist call is recording, so each timestamp only moves for the
 * event it describes. "alerted" is the same failure being marked as
 * announced: it must not push last_failure_at forward, or the health view
 * would read a delivered alert as a fresh failure.
 */
type Outcome =
  | { kind: "success" }
  | { kind: "failure"; reason: string }
  | { kind: "alerted" };

// last_success_at / last_failure_at / last_error are what the Admin health
// view needs to say more than "3 in a row": when the worker last worked, when
// it last broke, and how. updated_at alone could not tell a worker that
// recovered an hour ago from one that has not ticked since.
//
// A success leaves last_failure_at and last_error alone on purpose: they are
// the history of the last break, which is still worth reading after recovery.
// Three statements rather than one with CASE-guarded columns, so each says
// plainly which columns it moves.
const UPSERT_SUCCESS = `INSERT INTO worker_failure_state (event, consecutive_failures, alerted, last_success_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
   ON CONFLICT (event) DO UPDATE
     SET consecutive_failures = EXCLUDED.consecutive_failures,
         alerted = EXCLUDED.alerted,
         last_success_at = NOW(),
         updated_at = NOW()`;

const UPSERT_FAILURE = `INSERT INTO worker_failure_state (event, consecutive_failures, alerted, last_failure_at, last_error, updated_at)
     VALUES ($1, $2, $3, NOW(), $4, NOW())
   ON CONFLICT (event) DO UPDATE
     SET consecutive_failures = EXCLUDED.consecutive_failures,
         alerted = EXCLUDED.alerted,
         last_failure_at = NOW(),
         last_error = EXCLUDED.last_error,
         updated_at = NOW()`;

const UPSERT_ALERTED = `INSERT INTO worker_failure_state (event, consecutive_failures, alerted, updated_at)
     VALUES ($1, $2, $3, NOW())
   ON CONFLICT (event) DO UPDATE
     SET consecutive_failures = EXCLUDED.consecutive_failures,
         alerted = EXCLUDED.alerted,
         updated_at = NOW()`;

function persistState(
  event: string,
  consecutiveFailures: number,
  alerted: boolean,
  outcome: Outcome,
): void {
  const base = [event, consecutiveFailures, alerted];
  const [sql, params] =
    outcome.kind === "success"
      ? [UPSERT_SUCCESS, base]
      : outcome.kind === "failure"
        ? [
            UPSERT_FAILURE,
            [...base, outcome.reason.slice(0, MAX_LAST_ERROR_LENGTH)],
          ]
        : [UPSERT_ALERTED, base];
  void pool.query(sql, params).catch(() => {});
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
      persistState(event, 0, false, { kind: "success" });
    },
    recordFailure(message, context) {
      touched = true;
      consecutiveFailures++;
      const shouldAlert = consecutiveFailures >= threshold && !alerted;
      const failure: Outcome = { kind: "failure", reason: message };
      if (!shouldAlert) {
        persistState(event, consecutiveFailures, alerted, failure);
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
      persistState(event, consecutiveFailures, alerted, failure);
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
            persistState(event, consecutiveFailures, true, {
              kind: "alerted",
            });
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
