/**
 * Periodic re-verification of already-verified domains.
 *
 * A domain's "verified" status, once earned, previously never expired or
 * got re-checked: lib/domains/scope.ts's findVerifiedDomainForHost only
 * ever filters on `status = 'verified'`, with no freshness window. If a
 * domain changed hands (sold, expired, DNS repointed) after being
 * verified, the ORIGINAL account kept standing active-probes permission
 * for it indefinitely -- there was no mechanism that would ever notice.
 *
 * This worker re-checks the DNS TXT record for every verified domain
 * whose last check is older than DOMAIN_REVERIFY_INTERVAL_DAYS, and
 * downgrades status to 'reverify_failed' the moment the token no longer
 * resolves. That downgrade alone is what revokes the account's
 * active-probes scope for it -- scope.ts's query only ever matches
 * status = 'verified', so a 'reverify_failed' row simply stops matching.
 * The domains UI (components/profile/tabs/developer/domains-section.tsx)
 * already renders 'reverify_failed' with its own "Needs re-verification"
 * badge and lets the owner re-verify manually via the existing POST
 * /api/v3/domains/[id]/verify route -- this worker only needed to be the
 * thing that actually calls checkDnsVerification on a schedule.
 */

import pool from "@/lib/database/db";
import { getSetting } from "@/lib/config/runtime-config";
import { checkDnsVerification } from "./verification";
import { createFailureEscalator } from "@/lib/admin/failure-escalation";
import { CONFIG_DOMAIN_REVERIFY_TICK_INTERVAL_MS } from "@/lib/config/config-values";
import { APP_NAME } from "@/lib/config/constants";

export interface ReverifyPassStats {
  checked: number;
  stillVerified: number;
  downgraded: number;
}

interface DueDomainRow {
  id: number;
  domain: string;
  verification_token: string;
}

/**
 * One tick: finds every verified domain due for a recheck (capped at
 * DOMAIN_REVERIFY_BATCH_SIZE), re-runs checkDnsVerification for each, and
 * updates last_checked_at (still verified) or downgrades status to
 * 'reverify_failed' with the reason recorded in last_check_error.
 * Exported directly (not just via the periodic timer) so a test or an
 * admin "force a run now" caller has something to call without waiting
 * for the interval.
 */
export async function runDomainReverifyPass(): Promise<ReverifyPassStats> {
  const stats: ReverifyPassStats = {
    checked: 0,
    stillVerified: 0,
    downgraded: 0,
  };

  const featureEnabled = await getSetting("FEATURE_DOMAIN_VERIFICATION");
  const reverifyEnabled = await getSetting("DOMAIN_REVERIFY_ENABLED");
  if (!featureEnabled || !reverifyEnabled) return stats;

  const intervalDays = await getSetting("DOMAIN_REVERIFY_INTERVAL_DAYS");
  const batchSize = await getSetting("DOMAIN_REVERIFY_BATCH_SIZE");

  const due = await pool.query<DueDomainRow>(
    `SELECT id, domain, verification_token FROM domains
     WHERE status = 'verified'
       AND (last_checked_at IS NULL OR last_checked_at < NOW() - ($1 * INTERVAL '1 day'))
     ORDER BY last_checked_at ASC NULLS FIRST
     LIMIT $2`,
    [intervalDays, batchSize],
  );

  for (const row of due.rows) {
    stats.checked++;
    let result;
    try {
      result = await checkDnsVerification(row.domain, row.verification_token);
    } catch (err) {
      console.error(
        `[${APP_NAME}] domain reverify: DNS check threw for domain id ${row.id} (non-fatal, left unchanged this tick):`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    if (result.verified) {
      stats.stillVerified++;
      await pool.query(
        `UPDATE domains SET last_checked_at = NOW(), last_check_error = NULL WHERE id = $1`,
        [row.id],
      );
    } else {
      stats.downgraded++;
      await pool.query(
        `UPDATE domains
         SET status = 'reverify_failed'::varchar,
             last_checked_at = NOW(),
             last_check_error = $2
         WHERE id = $1`,
        [
          row.id,
          result.error ??
            "Periodic re-check found the TXT record no longer verifies this domain.",
        ],
      );
    }
  }

  return stats;
}

let activeReverifyTimer: NodeJS.Timeout | null = null;

export function schedulePeriodicDomainReverify(
  intervalMs: number = CONFIG_DOMAIN_REVERIFY_TICK_INTERVAL_MS,
): NodeJS.Timeout {
  if (activeReverifyTimer) {
    clearInterval(activeReverifyTimer);
  }
  const safeInterval =
    Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : CONFIG_DOMAIN_REVERIFY_TICK_INTERVAL_MS;

  const escalator = createFailureEscalator("domain_reverify_worker_failing");
  activeReverifyTimer = setInterval(async () => {
    try {
      const stats = await runDomainReverifyPass();
      if (stats.downgraded > 0) {
        console.log(
          `[${APP_NAME}] Domain reverify worker: ${stats.downgraded} domain(s) downgraded to reverify_failed (${stats.checked} checked).`,
        );
      }
      escalator.recordSuccess();
    } catch (err) {
      console.error(`[${APP_NAME}] Domain reverify worker pass failed:`, err);
      escalator.recordFailure(
        "The domain re-verification worker is failing on every pass -- domains that changed hands will keep the original account's active-probes permission indefinitely",
      );
    }
  }, safeInterval);
  activeReverifyTimer.unref?.();
  return activeReverifyTimer;
}

export function stopPeriodicDomainReverify(): void {
  if (activeReverifyTimer) {
    clearInterval(activeReverifyTimer);
    activeReverifyTimer = null;
  }
}
