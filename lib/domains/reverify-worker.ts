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
import { APP_NAME, APP_URL, ROUTES } from "@/lib/config/constants";
import { logError } from "@/lib/logging/log";
import { createUserNotification } from "@/lib/notifications/user-notifications";

export interface ReverifyPassStats {
  checked: number;
  stillVerified: number;
  downgraded: number;
  /**
   * Domains whose DNS lookup got no answer (a timeout, SERVFAIL, a refused
   * connection), so the pass reached no verdict about them and left them
   * exactly as they were. Counted rather than only logged because without a
   * number here a pass in which every single lookup failed returned the same
   * all-zero-ish stats a pass with nothing due returns, and the timer below
   * reported both as healthy.
   */
  failed: number;
}

interface DueDomainRow {
  id: number;
  user_id: number;
  domain: string;
  verification_token: string;
}

/**
 * One tick: finds every verified domain due for a recheck (capped at
 * DOMAIN_REVERIFY_BATCH_SIZE), re-runs checkDnsVerification for each, and
 * updates last_checked_at (still verified) or downgrades status to
 * 'reverify_failed' with the reason recorded in last_check_error.
 *
 * Only an ANSWER that the record is gone downgrades a domain. A lookup that
 * got no answer (see DnsVerificationResult) leaves status and last_checked_at
 * as they were, so the domain stays due and is asked again. A resolver outage
 * used to downgrade the whole batch.
 *
 * Every attempt, answered or not, moves last_attempt_at, and the batch is
 * ordered by it. last_checked_at cannot do that job: it only moves on an
 * answer, so a domain whose nameserver never replies kept the oldest value
 * forever and, with enough of them, filled every batch and starved the
 * domains behind them. Those are exactly the domains that may have changed
 * hands. A domain that never answers still comes round again, just after
 * everything that has not been tried more recently.
 *
 * Exported directly (not just via the periodic timer) so a test or an
 * admin "force a run now" caller has something to call without waiting
 * for the interval.
 */
export async function runDomainReverifyPass(): Promise<ReverifyPassStats> {
  const stats: ReverifyPassStats = {
    checked: 0,
    stillVerified: 0,
    downgraded: 0,
    failed: 0,
  };

  const featureEnabled = await getSetting("FEATURE_DOMAIN_VERIFICATION");
  const reverifyEnabled = await getSetting("DOMAIN_REVERIFY_ENABLED");
  if (!featureEnabled || !reverifyEnabled) return stats;

  const intervalDays = await getSetting("DOMAIN_REVERIFY_INTERVAL_DAYS");
  const batchSize = await getSetting("DOMAIN_REVERIFY_BATCH_SIZE");

  const due = await pool.query<DueDomainRow>(
    `SELECT id, user_id, domain, verification_token FROM domains
     WHERE status = 'verified'
       AND (last_checked_at IS NULL OR last_checked_at < NOW() - ($1 * INTERVAL '1 day'))
     ORDER BY last_attempt_at ASC NULLS FIRST, last_checked_at ASC NULLS FIRST
     LIMIT $2`,
    [intervalDays, batchSize],
  );

  for (const row of due.rows) {
    stats.checked++;
    const result = await checkDnsVerification(
      row.domain,
      row.verification_token,
    );

    if (result.outcome === "verified") {
      stats.stillVerified++;
      await pool.query(
        `UPDATE domains
         SET last_checked_at = NOW(), last_attempt_at = NOW(), last_check_error = NULL
         WHERE id = $1`,
        [row.id],
      );
    } else if (result.outcome === "lookup_error") {
      stats.failed++;
      logError(
        "domain-reverify",
        "DNS lookup got no answer, domain left unchanged this tick",
        result.cause,
        { domainId: row.id, userId: row.user_id, domain: row.domain },
      );
      await pool.query(
        `UPDATE domains SET last_attempt_at = NOW() WHERE id = $1`,
        [row.id],
      );
    } else {
      stats.downgraded++;
      await pool.query(
        `UPDATE domains
         SET status = 'reverify_failed'::varchar,
             last_checked_at = NOW(),
             last_attempt_at = NOW(),
             last_check_error = $2
         WHERE id = $1`,
        [row.id, result.error],
      );
      await recordDowngrade(row, result.error);
    }
  }

  return stats;
}

/**
 * A downgrade takes a permission away from an account with nobody having
 * asked it to, and this worker is the only actor in it: there is no admin to
 * write an audit row for and no request to carry an error. So it is logged at
 * error level on purpose (the one place the decision is on record for staff),
 * and the owner is told, because the only other sign is a badge on a page they
 * may not open for weeks. Both are best-effort: the downgrade itself already
 * happened and the pass must go on to the next domain.
 */
async function recordDowngrade(
  row: DueDomainRow,
  reason: string,
): Promise<void> {
  logError(
    "domain-reverify",
    "verified domain no longer resolves its verification record, downgraded to reverify_failed",
    undefined,
    {
      domainId: row.id,
      userId: row.user_id,
      domain: row.domain,
      reason,
    },
  );
  try {
    await createUserNotification({
      userId: row.user_id,
      type: "domain_reverify_failed",
      title: "A verified domain needs re-verification",
      message: `${row.domain} no longer has its ${APP_NAME} verification record, so active scans against it are switched off. Publish the record again and verify the domain to turn them back on.`,
      actionLabel: "Re-verify",
      actionUrl: `${APP_URL}${ROUTES.ATTACK_SURFACE}`,
      relatedType: "domain",
      relatedId: row.id,
    });
  } catch (err) {
    logError(
      "domain-reverify",
      "could not notify the owner of the downgrade",
      err,
      { domainId: row.id, userId: row.user_id },
    );
  }
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
      if (stats.downgraded > 0 || stats.failed > 0) {
        console.log(
          `[${APP_NAME}] Domain reverify worker: ${stats.downgraded} domain(s) downgraded to reverify_failed, ${stats.failed} lookup(s) got no DNS answer (${stats.checked} checked).`,
        );
      }
      // runDomainReverifyPass counts a lookup that got no answer as `failed`
      // and moves on rather than rethrowing, so a pass in which 100% of the
      // lookups failed still returns normally. Recording that as a healthy
      // pass would reset the escalator's streak on every tick, so the "worker
      // is failing" alert could never fire no matter how long the resolver
      // had been unreachable, and the whole point of this worker is that a
      // domain which changed hands loses its active-probes permission. A pass
      // that checked domains and reached a verdict on none of them is a
      // failed pass, the same rule the scheduled-scans worker uses.
      if (stats.checked > 0 && stats.failed === stats.checked) {
        escalator.recordFailure(
          "Every domain re-verification check is failing -- domains that changed hands will keep the original account's active-probes permission indefinitely",
        );
      } else {
        escalator.recordSuccess();
      }
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
