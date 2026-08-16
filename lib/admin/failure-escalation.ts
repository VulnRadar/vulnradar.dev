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

export interface FailureEscalator {
  recordSuccess(): void;
  recordFailure(message: string, context?: Record<string, unknown>): void;
}

export function createFailureEscalator(
  event: string,
  threshold = 3,
): FailureEscalator {
  let consecutiveFailures = 0;
  let alerted = false;
  return {
    recordSuccess() {
      consecutiveFailures = 0;
      alerted = false;
    },
    recordFailure(message, context) {
      consecutiveFailures++;
      if (consecutiveFailures >= threshold && !alerted) {
        alerted = true;
        void sendAdminAlert({
          event,
          severity: "warning",
          message: `${message} (failed ${consecutiveFailures} times in a row).`,
          context,
        });
      }
    },
  };
}
