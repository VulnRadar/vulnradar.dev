/**
 * Database cleanup utilities
 * Handles automatic cleanup of expired records and old data
 */
import pool from "@/lib/database/db";
import { DB_CLEANUP_INTERVAL } from "@/lib/config/constants";
import { getSetting, getSettings } from "@/lib/config/runtime-config";
import { archiveAdminAuditLogBeforePurge } from "@/lib/database/audit-log-archive";
import { createFailureEscalator } from "@/lib/admin/failure-escalation";
import { recordBrowserbaseSeconds } from "@/lib/billing/browserbase-usage";
import { releaseConcurrencySlot } from "@/lib/browserbase/concurrency-queue";

/**
 * How often the periodic cleanup pass runs. Sourced from
 * CONFIG_DB_CLEANUP_INTERVAL_MS so self-hosters change it in one place.
 */
const CLEANUP_INTERVAL_MS = DB_CLEANUP_INTERVAL;

/**
 * Retention for webhook_deliveries (AUDIT-012 perf-27).
 *
 * lib/webhooks/delivery.ts writes a row per delivery attempt and retries
 * once on failure, so a customer with a broken endpoint writes two rows per
 * event forever. This table had no retention rule at all: it was the one
 * append-only log in the schema the nightly pass never touched, and it grew
 * without bound.
 *
 * A plain constant rather than a CLEANUP_*_RETENTION_DAYS entry in the
 * settings registry, unlike every other log table here. That is a
 * deliberate, smaller change: adding an admin-configurable setting means
 * editing lib/config/config-values.ts and lib/config/registry.ts, and the
 * bug worth fixing today is "grows forever", not "is not tunable".
 * Promoting it to a real setting later is a mechanical follow-up.
 *
 * 30 days matches system_error_logs and email_logs, the two tables with the
 * same character: operational delivery output, not a compliance record.
 */
const WEBHOOK_DELIVERIES_RETENTION_DAYS = 30;

export interface CleanupStats {
  expiredSessions: number;
  oldApiUsage: number;
  revokedApiKeys: number;
  oldDataRequests: number;
  oldScans: number;
  oldRateLimits: number;
  expiredTokens: number;
  expiredInvites: number;
  expired2FACodes: number;
  expiredBillingCodes: number;
  expiredDeviceTrust: number;
  expiredNotifications: number;
  expiredGiftedSubs: number;
  oldAuditLogs: number;
  oldAdminNotes: number;
  oldStaffActivity: number;
  oldSubdomainCache: number;
  oldAiConversations: number;
  oldScanFindingFeedback: number;
  oldUserNotifications: number;
  oldGithubReviewUsage: number;
  oldBrowserSessions: number;
  oldKevCache: number;
  oldErrorLogs: number;
  archivedAuditLogs: number;
  oldEmailLogs: number;
  oldWebhookDeliveries: number;
}

/**
 * Rows one scan_history DELETE removes before the pass moves on. Small enough
 * that a batch finishes well inside the 30 s statement timeout on a large
 * table, large enough that a backlog drains in a few passes.
 */
export const SCAN_RETENTION_BATCH_SIZE = 2000;

/**
 * Wall-clock budget for the plan-scoped scan_history deletes in one pass. The
 * pass runs on the cleanup interval, so what is left when the budget runs out
 * is picked up by the next one; the budget only stops a single pass from
 * spending as long as the backlog is deep on this one table while every prune
 * after it waits.
 */
const SCAN_RETENTION_PASS_BUDGET_MS = 20_000;

interface ScanRetentionPlan {
  name: string;
  /** Retention in days. Zero or less means keep forever, so the plan is skipped. */
  days: number;
  /** A condition over `users` that selects the accounts on this plan. */
  userFilter: string;
}

/**
 * Delete scans past each plan's retention window, one batch at a time.
 *
 * These four prunes used to be one unbounded DELETE each. Turning retention on
 * for a deployment that already held a large backlog made the first of them
 * outrun the 30 s statement timeout, roll back and throw, every pass, so the
 * backlog never drained. A batch is `DELETE ... WHERE id IN (SELECT id ...
 * LIMIT n)` and autocommits, so a timeout part way through loses at most one
 * batch and everything before it stays deleted. By id and not ctid: a ctid is
 * not stable across a concurrent UPDATE, so a stale one could miss its row.
 *
 * Plans take turns, one batch each, so a deep backlog on the free plan cannot
 * starve the paid plans. A plan is done when a batch comes back short, and
 * all of them stop at the pass budget. A plan that fails is reported and
 * dropped from this pass without stopping the others.
 */
async function pruneScanHistory(
  plans: ScanRetentionPlan[],
  stats: CleanupStats,
  recordFailure: (name: string, error: unknown) => void,
): Promise<void> {
  const deadline = Date.now() + SCAN_RETENTION_PASS_BUDGET_MS;
  let pending = plans.filter((plan) => plan.days > 0);
  while (pending.length > 0 && Date.now() < deadline) {
    const notDone: ScanRetentionPlan[] = [];
    for (const plan of pending) {
      if (Date.now() >= deadline) return;
      try {
        const res = await pool.query(
          `DELETE FROM scan_history
           WHERE id IN (
             SELECT id FROM scan_history
             WHERE scanned_at < NOW() - ($1 * INTERVAL '1 day')
             AND user_id IN (SELECT id FROM users WHERE ${plan.userFilter})
             LIMIT $2
           )`,
          [plan.days, SCAN_RETENTION_BATCH_SIZE],
        );
        const deleted = res.rowCount || 0;
        stats.oldScans += deleted;
        if (deleted >= SCAN_RETENTION_BATCH_SIZE) notDone.push(plan);
      } catch (error) {
        recordFailure(`scan_history (${plan.name} plan)`, error);
      }
    }
    pending = notDone;
  }
}

/**
 * Record plan usage for browser sessions that expired without an explicit
 * DELETE /api/v3/browser/sessions call (a closed tab, a crashed client), and
 * give back the global concurrency slot each one held.
 *
 * app/api/v3/browser/sessions/route.ts's DELETE handler already records a
 * session's real elapsed duration when the user actually ends it, but a
 * session nobody explicitly closed would otherwise never get recorded at all,
 * silently undercounting real Browserbase cost against the account.
 * keepAlive: true (see lib/browserbase/client.ts) means the underlying session
 * genuinely stays alive on Browserbase's side until its TTL, so
 * expires_at - created_at is a real duration, not an estimate.
 *
 * Called right after the rows were deleted, from inside that prune. The delete
 * is autocommitted, so the sessions are durably gone and usage is never
 * recorded for one that was not actually reclaimed; and because this does not
 * wait for the prunes after it, one of them failing can no longer strand a
 * usage record or a slot. Fire-and-forget, same as the DELETE route's own
 * true-up: a failure here must never fail the cleanup pass over a
 * usage-accounting side effect.
 */
function trueUpExpiredBrowserSessions(
  rows: { user_id: number; created_at: string; expires_at: string | null }[],
): void {
  for (const row of rows) {
    const end = row.expires_at
      ? new Date(row.expires_at).getTime()
      : Date.now();
    const elapsedSeconds = Math.max(
      0,
      Math.round((end - new Date(row.created_at).getTime()) / 1000),
    );
    if (elapsedSeconds > 0) {
      // Swallowed on purpose (a usage write must not fail the cleanup pass)
      // but NOT silent: browserbase seconds are what the account is metered
      // on, so a persistent failure here means usage stops being counted
      // against every account while the operator's real bill keeps growing.
      // console.error routes this into system_error_logs.
      recordBrowserbaseSeconds(row.user_id, elapsedSeconds).catch((err) =>
        console.error(
          `[cleanup] Failed to record browserbase seconds for user ${row.user_id}:`,
          err,
        ),
      );
    }
    // Each reclaimed row held a global concurrency slot (see POST
    // /api/v3/browser/sessions' acquireConcurrencySlot) that nobody ever
    // released via an explicit DELETE -- free it now so a queued request
    // waiting on lib/browserbase/concurrency-queue.ts is admitted instead
    // of waiting out its own poll interval or timing out.
    // Same reasoning: a failing release leaks the global session slot
    // permanently, so queued browser sessions wait out their timeout and
    // eventually nobody can start one. Silence made that undiagnosable.
    releaseConcurrencySlot().catch((err) =>
      console.error(
        "[cleanup] Failed to release a browserbase concurrency slot:",
        err,
      ),
    );
  }
}

/**
 * What performDatabaseCleanup throws when the pass ran to the end and at least
 * one prune failed.
 *
 * `stats` is what the prunes that did succeed removed. It rides on the error
 * because a failed pass has still deleted rows: the caller that records a run
 * (the on-demand admin route writes an audit row) has to be able to say what
 * went, or a run that emptied most of the tables would leave no trace of it.
 */
export class CleanupPassError extends AggregateError {
  readonly stats: CleanupStats;

  constructor(errors: unknown[], message: string, stats: CleanupStats) {
    super(errors, message);
    this.name = "CleanupPassError";
    this.stats = stats;
  }
}

/**
 * Execute database cleanup operations
 * Removes expired and old records to maintain database health.
 *
 * Every prune is isolated from the others. One that fails is logged and the
 * pass carries on with the rest, then throws a CleanupPassError (an
 * AggregateError of everything that failed) once the last prune has run, so
 * the caller's failure escalator still fires. Before this, the pass stopped at
 * the first failure: a backlog too big for the statement timeout in an early
 * prune meant rate_limits, system_error_logs, email_logs and webhook_deliveries
 * were never reached, and grew without bound.
 */
export async function performDatabaseCleanup(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    expiredSessions: 0,
    oldApiUsage: 0,
    revokedApiKeys: 0,
    oldDataRequests: 0,
    oldScans: 0,
    oldRateLimits: 0,
    expiredTokens: 0,
    expiredInvites: 0,
    expired2FACodes: 0,
    expiredBillingCodes: 0,
    expiredDeviceTrust: 0,
    expiredNotifications: 0,
    expiredGiftedSubs: 0,
    oldAuditLogs: 0,
    oldAdminNotes: 0,
    oldStaffActivity: 0,
    oldSubdomainCache: 0,
    oldAiConversations: 0,
    oldScanFindingFeedback: 0,
    oldUserNotifications: 0,
    oldGithubReviewUsage: 0,
    oldBrowserSessions: 0,
    oldKevCache: 0,
    oldErrorLogs: 0,
    archivedAuditLogs: 0,
    oldEmailLogs: 0,
    oldWebhookDeliveries: 0,
  };

  // Resolve the admin-configurable per-plan retention windows once up front.
  // A cached read against system_settings, resolved once so no prune below
  // pays for it.
  const retention = await getSettings([
    "BILLING_FREE_RETENTION",
    "BILLING_CORE_SUPPORTER_RETENTION",
    "BILLING_PRO_SUPPORTER_RETENTION",
    "BILLING_ELITE_SUPPORTER_RETENTION",
  ] as const);
  const aiChatHistoryDays = await getSetting("AI_CHAT_HISTORY_DAYS");
  const cleanupRetention = await getSettings([
    "CLEANUP_API_USAGE_RETENTION_DAYS",
    "CLEANUP_REVOKED_API_KEYS_RETENTION_DAYS",
    "CLEANUP_DATA_REQUESTS_RETENTION_DAYS",
    "CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS",
    "CLEANUP_ADMIN_USER_NOTES_RETENTION_DAYS",
    "CLEANUP_SECURITY_ALERTS_RETENTION_DAYS",
    "CLEANUP_SYSTEM_ERROR_LOGS_RETENTION_DAYS",
    "CLEANUP_EMAIL_LOG_RETENTION_DAYS",
    "CLEANUP_SCAN_FINDING_FEEDBACK_RETENTION_DAYS",
    "CLEANUP_USER_NOTIFICATIONS_RETENTION_DAYS",
    "CLEANUP_GITHUB_REVIEW_USAGE_RETENTION_DAYS",
    "CLEANUP_KEV_CACHE_RETENTION_DAYS",
    "SUBDOMAIN_CACHE_TTL_HOURS",
  ] as const);

  const failures: { name: string; error: unknown }[] = [];
  const recordFailure = (name: string, error: unknown) => {
    failures.push({ name, error });
    console.error(`[Database Cleanup] Prune "${name}" failed:`, error);
  };
  const runPrune = async (name: string, prune: () => Promise<void>) => {
    try {
      await prune();
    } catch (error) {
      recordFailure(name, error);
    }
  };

  // Each prune below runs autocommitted on the pool, not inside one long
  // transaction. The pass used to open a single BEGIN/COMMIT around all
  // thirty DELETEs on one pooled client, which meant: one of the ten pool
  // connections was held for the whole pass; every row deleted stayed locked
  // for its entire duration, so any concurrent write touching those rows
  // blocked; and a failure on the last statement rolled back twenty-nine
  // prunes of unrelated tables that had nothing to do with it. None of this
  // work is transactionally coupled: these are independent retention prunes
  // on unrelated tables. The one genuine exception is archive-then-purge on
  // admin_audit_log, which keeps its own small transaction below.
  // ref: AUDIT-012#perf-22

  await runPrune("sessions", async () => {
    const res = await pool.query(
      "DELETE FROM sessions WHERE expires_at < NOW()",
    );
    stats.expiredSessions = res.rowCount || 0;
  });

  // Delete old API usage logs (admin-configurable retention)
  await runPrune("api_usage", async () => {
    const res = await pool.query(
      "DELETE FROM api_usage WHERE used_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_API_USAGE_RETENTION_DAYS],
    );
    stats.oldApiUsage = res.rowCount || 0;
  });

  // Delete revoked API keys past the admin-configurable retention
  await runPrune("api_keys", async () => {
    const res = await pool.query(
      "DELETE FROM api_keys WHERE revoked_at IS NOT NULL AND revoked_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_REVOKED_API_KEYS_RETENTION_DAYS],
    );
    stats.revokedApiKeys = res.rowCount || 0;
  });

  // Delete old data requests (admin-configurable retention)
  await runPrune("data_requests", async () => {
    const res = await pool.query(
      "DELETE FROM data_requests WHERE requested_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_DATA_REQUESTS_RETENTION_DAYS],
    );
    stats.oldDataRequests = res.rowCount || 0;
  });

  // Delete old scan history based on the admin-configured per-plan retention
  // (BILLING_*_RETENTION in the settings registry). -1 means keep forever, so
  // that plan is skipped entirely. Pro and elite ship at -1, but an admin may
  // configure a positive value.
  await pruneScanHistory(
    [
      {
        name: "free",
        days: retention.BILLING_FREE_RETENTION,
        userFilter: "plan = 'free' OR plan IS NULL",
      },
      {
        name: "core_supporter",
        days: retention.BILLING_CORE_SUPPORTER_RETENTION,
        userFilter: "plan = 'core_supporter'",
      },
      {
        name: "pro_supporter",
        days: retention.BILLING_PRO_SUPPORTER_RETENTION,
        userFilter: "plan = 'pro_supporter'",
      },
      {
        name: "elite_supporter",
        days: retention.BILLING_ELITE_SUPPORTER_RETENTION,
        userFilter: "plan = 'elite_supporter'",
      },
    ],
    stats,
    recordFailure,
  );

  // host_reputation is intentionally NOT touched anywhere in this
  // function. It is a host-keyed cache (no user_id column at all) of the
  // latest scan result per host, feeding the browser extension's popup --
  // public-safety data about a website, not personal data about who
  // scanned it. It must survive every retention delete above: when a
  // scan_history row above is deleted, host_reputation.source_scan_id
  // (a nullable, non-cascading FK) is auto-nulled by Postgres, but the
  // cached reputation row itself is never deleted or modified here. Do
  // not add a DELETE FROM host_reputation to this function.
  //
  // Delete old rate limit records (> 1 day)
  await runPrune("rate_limits", async () => {
    const res = await pool.query(
      "DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'",
    );
    stats.oldRateLimits = res.rowCount || 0;
  });

  // Delete expired password reset and verification tokens
  await runPrune("password_reset_tokens", async () => {
    const res = await pool.query(
      "DELETE FROM password_reset_tokens WHERE expires_at < NOW()",
    );
    stats.expiredTokens += res.rowCount || 0;
  });

  await runPrune("email_verification_tokens", async () => {
    const res = await pool.query(
      "DELETE FROM email_verification_tokens WHERE expires_at < NOW()",
    );
    stats.expiredTokens += res.rowCount || 0;
  });

  // Delete expired team invites that were never accepted
  await runPrune("team_invites", async () => {
    const res = await pool.query(
      "DELETE FROM team_invites WHERE expires_at < NOW() AND accepted_at IS NULL",
    );
    stats.expiredInvites = res.rowCount || 0;
  });

  // Delete expired email 2FA codes
  await runPrune("email_2fa_codes", async () => {
    const res = await pool.query(
      "DELETE FROM email_2fa_codes WHERE expires_at < NOW()",
    );
    stats.expired2FACodes = res.rowCount || 0;
  });

  // Delete expired billing verification codes
  await runPrune("billing_verification_codes", async () => {
    const res = await pool.query(
      "DELETE FROM billing_verification_codes WHERE expires_at < NOW()",
    );
    stats.expiredBillingCodes = res.rowCount || 0;
  });

  // Delete expired device trust records
  await runPrune("device_trust", async () => {
    const res = await pool.query(
      "DELETE FROM device_trust WHERE expires_at < NOW()",
    );
    stats.expiredDeviceTrust = res.rowCount || 0;
  });

  // Delete expired/ended admin notifications (ended more than 30 days ago)
  await runPrune("admin_notifications", async () => {
    const res = await pool.query(
      "DELETE FROM admin_notifications WHERE ends_at IS NOT NULL AND ends_at < NOW() - INTERVAL '30 days'",
    );
    stats.expiredNotifications = res.rowCount || 0;
  });

  // Revoke premium badges for users whose gifted subscriptions just expired
  // Only revoke if user doesn't have a paid plan (free plan only)
  try {
    const premiumBadge = await pool.query(
      "SELECT id FROM badges WHERE name = 'premium' LIMIT 1",
    );
    if (premiumBadge.rows.length > 0) {
      const badgeId = premiumBadge.rows[0].id;
      // Find users with expired gifts who are on free plan and remove their premium badge
      const revokeResult = await pool.query(
        `DELETE FROM user_badges
         WHERE badge_id = $1
         AND user_id IN (
           SELECT DISTINCT gs.user_id
           FROM gifted_subscriptions gs
           JOIN users u ON gs.user_id = u.id
           WHERE gs.expires_at < NOW()
           AND gs.expires_at > NOW() - INTERVAL '1 day'
           AND gs.revoked_at IS NULL
           AND (u.plan = 'free' OR u.plan IS NULL)
           AND NOT EXISTS (
             SELECT 1 FROM gifted_subscriptions gs2
             WHERE gs2.user_id = gs.user_id
             AND gs2.expires_at > NOW()
             AND gs2.revoked_at IS NULL
           )
         )`,
        [badgeId],
      );
      if (revokeResult.rowCount && revokeResult.rowCount > 0) {
        console.log(
          `[Database Cleanup] Revoked ${revokeResult.rowCount} premium badges from users with expired gifts`,
        );
      }
    }
  } catch (badgeErr) {
    console.error(
      "[Database Cleanup] Error revoking badges for expired gifts:",
      badgeErr,
    );
  }

  // Delete expired gifted subscriptions that ended more than 90 days ago
  await runPrune("gifted_subscriptions", async () => {
    const res = await pool.query(
      "DELETE FROM gifted_subscriptions WHERE expires_at < NOW() - INTERVAL '90 days'",
    );
    stats.expiredGiftedSubs = res.rowCount || 0;
  });

  // AUDIT-010 admin-feature-gap: archive the rows this delete is about to
  // remove permanently, before removing them. This is the ONE genuinely
  // coupled pair in the whole pass, so it keeps a transaction of its own:
  // within one transaction Postgres's NOW() is stable, so the archive
  // SELECT and the DELETE below see the identical cutoff and therefore the
  // identical row set, with no window in which a row is purged unarchived.
  // Scoped to just these two statements rather than the whole cleanup, so
  // it holds a connection and its locks for two statements, not thirty.
  // ref: AUDIT-012#perf-22, lib/database/audit-log-archive.ts
  await runPrune("admin_audit_log", async () => {
    const auditClient = await pool.connect();
    try {
      await auditClient.query("BEGIN");
      const archived = await archiveAdminAuditLogBeforePurge(
        auditClient,
        cleanupRetention.CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS,
      );
      const auditLogsRes = await auditClient.query(
        "DELETE FROM admin_audit_log WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
        [cleanupRetention.CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS],
      );
      await auditClient.query("COMMIT");
      // Only after the COMMIT. The stats of a failed pass are reported (see
      // CleanupPassError), and a rolled-back pair archived and deleted nothing.
      stats.archivedAuditLogs = archived;
      stats.oldAuditLogs = auditLogsRes.rowCount || 0;
    } catch (auditErr) {
      try {
        await auditClient.query("ROLLBACK");
      } catch {
        /* connection may be dead */
      }
      throw auditErr;
    } finally {
      auditClient.release();
    }
  });

  // Delete old admin user notes (admin-configurable retention)
  await runPrune("admin_user_notes", async () => {
    const res = await pool.query(
      "DELETE FROM admin_user_notes WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_ADMIN_USER_NOTES_RETENTION_DAYS],
    );
    stats.oldAdminNotes = res.rowCount || 0;
  });

  // Delete old staff activity records (> 30 days)
  await runPrune("staff_activity", async () => {
    const res = await pool.query(
      "DELETE FROM staff_activity WHERE last_heartbeat < NOW() - INTERVAL '30 days'",
    );
    stats.oldStaffActivity = res.rowCount || 0;
  });

  // Delete old subdomain cache entries past the admin-configurable TTL
  // (same setting the discover route and read-only lookup use). The scan
  // route re-resolves DNS for every scan via safeFetch; the cache is a
  // perf optimisation only. Anything older than the TTL has already been
  // re-resolved.
  await runPrune("subdomain_cache", async () => {
    const res = await pool.query(
      "DELETE FROM subdomain_cache WHERE cached_at < NOW() - ($1 * INTERVAL '1 hour')",
      [cleanupRetention.SUBDOMAIN_CACHE_TTL_HOURS],
    );
    stats.oldSubdomainCache = res.rowCount || 0;
  });

  // ai_conversations: GDPR data-minimization gap found in the 2026-08
  // compliance audit -- this table (chat history with the AI assistant,
  // JSONB message content) had no retention enforcement at all before
  // this fix and was kept indefinitely. Retention window is the
  // admin-configurable AI_CHAT_HISTORY_DAYS setting (default 90, matching
  // the "AI chat history: 90 days" promise in app/legal/privacy/page.tsx)
  // rather than a hardcoded interval, so an admin edit actually changes
  // what gets purged instead of silently doing nothing.
  await runPrune("ai_conversations", async () => {
    const res = await pool.query(
      "DELETE FROM ai_conversations WHERE last_message_at < NOW() - ($1 * INTERVAL '1 day')",
      [aiChatHistoryDays],
    );
    stats.oldAiConversations = res.rowCount || 0;
  });

  // security_alerts: admin-configurable retention. The table tracks
  // suspicious activity (brute-force attempts, anomaly hits), kept long
  // enough for SOC review and short enough to bound PII.
  await runPrune("security_alerts", async () => {
    const res = await pool.query(
      "DELETE FROM security_alerts WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_SECURITY_ALERTS_RETENTION_DAYS],
    );
    stats.expiredNotifications += res.rowCount || 0;
  });

  // access_rules: drop hit_count and last_hit_at on stale rows so
  // the table doesn't grow unboundedly from rule lookups.
  await runPrune("access_rules", async () => {
    const res = await pool.query(
      `UPDATE access_rules
       SET hit_count = 0, last_hit_at = NULL
       WHERE last_hit_at < NOW() - INTERVAL '90 days'`,
    );
    stats.expiredNotifications += res.rowCount || 0;
  });

  // scan_finding_feedback: admin-configurable retention, defaulting to
  // the same general account-data window used elsewhere in this function
  // (api_usage, ai_conversations).
  await runPrune("scan_finding_feedback", async () => {
    const res = await pool.query(
      "DELETE FROM scan_finding_feedback WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_SCAN_FINDING_FEEDBACK_RETENTION_DAYS],
    );
    stats.oldScanFindingFeedback = res.rowCount || 0;
  });

  // user_notifications: the in-app notification bell's feed.
  // Admin-configurable retention -- a read or unread notification is not
  // useful to keep indefinitely.
  await runPrune("user_notifications", async () => {
    const res = await pool.query(
      "DELETE FROM user_notifications WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_USER_NOTIFICATIONS_RETENTION_DAYS],
    );
    stats.oldUserNotifications = res.rowCount || 0;
  });

  // github_review_usage: one row per user per fixed AI_USAGE_WINDOW_HOURS
  // window (window_start, tokens_used) tracking AI review token spend.
  // Admin-configurable retention, defaulting to comfortably outliving any
  // single window's row while still bounding growth -- mirrors
  // security_alerts' retention above for the same "usage/history
  // tracking, not a live counter" shape.
  await runPrune("github_review_usage", async () => {
    const res = await pool.query(
      "DELETE FROM github_review_usage WHERE updated_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_GITHUB_REVIEW_USAGE_RETENTION_DAYS],
    );
    stats.oldGithubReviewUsage = res.rowCount || 0;
  });

  // browser_sessions: ownership mapping for the live-browser scan
  // viewer (AUDIT-004#idor-01). Deletes by the row's own expires_at
  // when set -- same idiom as sessions/device_trust above -- with a
  // 1-day created_at fallback for the rare row that never got one, so
  // this never depends solely on created_at the way a plain log table's
  // retention would. RETURNING the fields the plan-usage true-up needs:
  // a session a user never explicitly ended (closed the tab, let it sit)
  // still consumed real Browserbase minutes. The true-up runs here, right
  // after the delete, and not at the end of the pass: a prune failing later
  // must not leave the usage unrecorded and the slots held.
  await runPrune("browser_sessions", async () => {
    const res = await pool.query<{
      user_id: number;
      created_at: string;
      expires_at: string | null;
    }>(
      `DELETE FROM browser_sessions
       WHERE (expires_at IS NOT NULL AND expires_at < NOW())
          OR (expires_at IS NULL AND created_at < NOW() - INTERVAL '1 day')
       RETURNING user_id, created_at, expires_at`,
    );
    stats.oldBrowserSessions = res.rowCount || 0;
    trueUpExpiredBrowserSessions(res.rows);
  });

  // cve_kev_cache: whole-feed cache of CISA's Known Exploited
  // Vulnerabilities list (lib/scanner/cve-enrichment.ts), added
  // 2026-08. The read side already treats a row older than the
  // CVE_KEV_CACHE_TTL_HOURS window as stale and re-fetches, so nothing
  // here needs to survive past that -- this admin-configurable retention
  // is just a bound on dead rows accumulating, not a freshness guarantee;
  // it's a performance cache, not user data.
  await runPrune("cve_kev_cache", async () => {
    const res = await pool.query(
      "DELETE FROM cve_kev_cache WHERE cached_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_KEV_CACHE_RETENTION_DAYS],
    );
    stats.oldKevCache = res.rowCount || 0;
  });

  // system_error_logs: captured console.error calls (Admin > System >
  // Error Logs, see lib/database/error-log-capture.ts). Admin-configurable
  // retention, defaulting to enough runway for periodic reviews without
  // keeping debug noise forever -- shorter than admin_audit_log/
  // admin_user_notes (a genuine audit trail) and security_alerts (kept
  // for SOC review), since this table is operational debugging output,
  // not a compliance record.
  await runPrune("system_error_logs", async () => {
    const res = await pool.query(
      "DELETE FROM system_error_logs WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_SYSTEM_ERROR_LOGS_RETENTION_DAYS],
    );
    stats.oldErrorLogs = res.rowCount || 0;
  });

  // email_logs: outbound email attempt records (Admin > System > Email
  // Logs, see lib/email/email.ts's sendEmail()). Operational visibility,
  // not a compliance record, so it gets a similarly short default
  // retention to system_error_logs above.
  await runPrune("email_logs", async () => {
    const res = await pool.query(
      "DELETE FROM email_logs WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_EMAIL_LOG_RETENTION_DAYS],
    );
    stats.oldEmailLogs = res.rowCount || 0;
  });

  // webhook_deliveries: one row per outbound delivery attempt, written by
  // lib/webhooks/delivery.ts. See WEBHOOK_DELIVERIES_RETENTION_DAYS above
  // for why the window is a constant rather than a setting.
  await runPrune("webhook_deliveries", async () => {
    const res = await pool.query(
      "DELETE FROM webhook_deliveries WHERE attempted_at < NOW() - ($1 * INTERVAL '1 day')",
      [WEBHOOK_DELIVERIES_RETENTION_DAYS],
    );
    stats.oldWebhookDeliveries = res.rowCount || 0;
  });

  if (failures.length > 0) {
    // Thrown only after every prune has had its turn, so the caller's failure
    // escalation still fires on a pass that did most of its work. Each
    // failure was already logged with its own stack as it happened.
    const detail = failures
      .map(
        ({ name, error }) =>
          `${name}: ${error instanceof Error ? error.message : String(error)}`,
      )
      .join("; ");
    throw new CleanupPassError(
      failures.map(({ error }) => error),
      `${failures.length} database cleanup prune(s) failed (${detail})`,
      stats,
    );
  }

  return stats;
}

/**
 * Format cleanup stats into a readable log message
 */
export function formatCleanupStats(stats: CleanupStats): string {
  // archivedAuditLogs describes how many of the oldAuditLogs rows counted
  // below were durably archived before their delete -- it is metadata
  // about that same delete, not a separate class of deleted row, so it is
  // reported as its own line below but excluded from `total` to avoid
  // double-counting the same purged rows twice.
  const { archivedAuditLogs, ...deletionCounts } = stats;
  const total = Object.values(deletionCounts).reduce((a, b) => a + b, 0);
  if (total === 0) return "no records to clean";

  const items: string[] = [];
  if (stats.expiredSessions > 0)
    items.push(`${stats.expiredSessions} sessions`);
  if (stats.oldApiUsage > 0) items.push(`${stats.oldApiUsage} API logs`);
  if (stats.revokedApiKeys > 0)
    items.push(`${stats.revokedApiKeys} revoked keys`);
  if (stats.oldDataRequests > 0)
    items.push(`${stats.oldDataRequests} data requests`);
  if (stats.oldScans > 0) items.push(`${stats.oldScans} old scans`);
  if (stats.oldRateLimits > 0) items.push(`${stats.oldRateLimits} rate limits`);
  if (stats.expiredTokens > 0) items.push(`${stats.expiredTokens} tokens`);
  if (stats.expiredInvites > 0) items.push(`${stats.expiredInvites} invites`);
  if (stats.expired2FACodes > 0)
    items.push(`${stats.expired2FACodes} 2FA codes`);
  if (stats.expiredBillingCodes > 0)
    items.push(`${stats.expiredBillingCodes} billing codes`);
  if (stats.expiredDeviceTrust > 0)
    items.push(`${stats.expiredDeviceTrust} device trusts`);
  if (stats.expiredNotifications > 0)
    items.push(`${stats.expiredNotifications} notifications`);
  if (stats.expiredGiftedSubs > 0)
    items.push(`${stats.expiredGiftedSubs} gifted subs`);
  if (stats.oldAuditLogs > 0) items.push(`${stats.oldAuditLogs} audit logs`);
  if (stats.oldAdminNotes > 0) items.push(`${stats.oldAdminNotes} admin notes`);
  if (stats.oldStaffActivity > 0)
    items.push(`${stats.oldStaffActivity} staff activity`);
  if (stats.oldSubdomainCache > 0)
    items.push(`${stats.oldSubdomainCache} subdomain cache`);
  if (stats.oldAiConversations > 0)
    items.push(`${stats.oldAiConversations} AI conversations`);
  if (stats.oldScanFindingFeedback > 0)
    items.push(`${stats.oldScanFindingFeedback} finding feedback`);
  if (stats.oldUserNotifications > 0)
    items.push(`${stats.oldUserNotifications} in-app notifications`);
  if (stats.oldGithubReviewUsage > 0)
    items.push(`${stats.oldGithubReviewUsage} GitHub review usage rows`);
  if (stats.oldBrowserSessions > 0)
    items.push(`${stats.oldBrowserSessions} browser sessions`);
  if (stats.oldKevCache > 0) items.push(`${stats.oldKevCache} KEV cache rows`);
  if (stats.oldErrorLogs > 0) items.push(`${stats.oldErrorLogs} error logs`);
  if (stats.oldEmailLogs > 0) items.push(`${stats.oldEmailLogs} email logs`);
  if (stats.oldWebhookDeliveries > 0)
    items.push(`${stats.oldWebhookDeliveries} webhook deliveries`);
  if (archivedAuditLogs > 0)
    items.push(`${archivedAuditLogs} audit logs archived`);

  return `${total} total (${items.join(", ")})`;
}

/**
 * Schedule a repeating cleanup pass.
 *
 * The interval defaults to CONFIG_CLEANUP_INTERVAL_MS and can be
 * overridden per call. The previous signature took an `_initialDelayMs`
 * that was ignored, so `schedulePeriodicCleanup(5 * 60 * 1000)` in
 * instrumentation.ts logged "5min interval" while actually running every
 * 24 hours. The parameter now means what its name says.
 *
 * Returns the timer handle so callers can `clearInterval` on shutdown.
 * Module-level state tracks the active timer so subsequent calls cancel
 * any previously scheduled one (prevents double-scheduling on hot reload).
 *
 * The timer is unref'd: a pending cleanup must never be the reason a
 * process refuses to exit on SIGTERM.
 */
let activeCleanupTimer: NodeJS.Timeout | null = null;

export function schedulePeriodicCleanup(
  intervalMs: number = CLEANUP_INTERVAL_MS,
): NodeJS.Timeout {
  if (activeCleanupTimer) {
    clearInterval(activeCleanupTimer);
  }
  const safeInterval =
    Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : CLEANUP_INTERVAL_MS;
  const escalator = createFailureEscalator("cleanup_worker_failing");
  activeCleanupTimer = setInterval(async () => {
    try {
      const stats = await performDatabaseCleanup();
      console.log(
        `[Database Cleanup] Periodic cleanup completed: ${formatCleanupStats(stats)}`,
      );
      escalator.recordSuccess();
    } catch (error) {
      console.error("[Database Cleanup] Periodic cleanup failed:", error);
      escalator.recordFailure(
        "The periodic database cleanup worker is failing on every run",
      );
    }
  }, safeInterval);
  activeCleanupTimer.unref?.();
  return activeCleanupTimer;
}

export function stopPeriodicCleanup(): void {
  if (activeCleanupTimer) {
    clearInterval(activeCleanupTimer);
    activeCleanupTimer = null;
  }
}
