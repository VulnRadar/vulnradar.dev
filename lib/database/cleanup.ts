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
 * Execute database cleanup operations
 * Removes expired and old records to maintain database health.
 *
 * All deletes run inside a single SERIALIZABLE-style transaction so a
 * mid-run failure rolls back the entire cleanup pass instead of leaving
 * the database in a partially-cleaned state.
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
  try {
    // Delete expired sessions
    const sessionsRes = await pool.query(
      "DELETE FROM sessions WHERE expires_at < NOW()",
    );
    stats.expiredSessions = sessionsRes.rowCount || 0;

    // Delete old API usage logs (admin-configurable retention)
    const apiUsageRes = await pool.query(
      "DELETE FROM api_usage WHERE used_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_API_USAGE_RETENTION_DAYS],
    );
    stats.oldApiUsage = apiUsageRes.rowCount || 0;

    // Delete revoked API keys past the admin-configurable retention
    const revokedKeysRes = await pool.query(
      "DELETE FROM api_keys WHERE revoked_at IS NOT NULL AND revoked_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_REVOKED_API_KEYS_RETENTION_DAYS],
    );
    stats.revokedApiKeys = revokedKeysRes.rowCount || 0;

    // Delete old data requests (admin-configurable retention)
    const dataReqRes = await pool.query(
      "DELETE FROM data_requests WHERE requested_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_DATA_REQUESTS_RETENTION_DAYS],
    );
    stats.oldDataRequests = dataReqRes.rowCount || 0;

    // Delete old scan history based on the admin-configured per-plan
    // retention (BILLING_*_RETENTION in the settings registry). -1 means
    // keep forever, so that plan is skipped entirely.
    let totalScansDeleted = 0;

    // Delete scans for free users
    if (retention.BILLING_FREE_RETENTION > 0) {
      const freeScansRes = await pool.query(
        `DELETE FROM scan_history
         WHERE scanned_at < NOW() - ($1 * INTERVAL '1 day')
         AND user_id IN (SELECT id FROM users WHERE plan = 'free' OR plan IS NULL)`,
        [retention.BILLING_FREE_RETENTION],
      );
      totalScansDeleted += freeScansRes.rowCount || 0;
    }

    // Delete scans for core_supporter users
    if (retention.BILLING_CORE_SUPPORTER_RETENTION > 0) {
      const coreScansRes = await pool.query(
        `DELETE FROM scan_history
         WHERE scanned_at < NOW() - ($1 * INTERVAL '1 day')
         AND user_id IN (SELECT id FROM users WHERE plan = 'core_supporter')`,
        [retention.BILLING_CORE_SUPPORTER_RETENTION],
      );
      totalScansDeleted += coreScansRes.rowCount || 0;
    }

    // Delete scans for pro_supporter users. Shipped default is -1
    // (unlimited, skipped), but an admin may configure a positive value.
    if (retention.BILLING_PRO_SUPPORTER_RETENTION > 0) {
      const proScansRes = await pool.query(
        `DELETE FROM scan_history
         WHERE scanned_at < NOW() - ($1 * INTERVAL '1 day')
         AND user_id IN (SELECT id FROM users WHERE plan = 'pro_supporter')`,
        [retention.BILLING_PRO_SUPPORTER_RETENTION],
      );
      totalScansDeleted += proScansRes.rowCount || 0;
    }

    // Delete scans for elite_supporter users. Shipped default is -1
    // (unlimited, skipped), but an admin may configure a positive value.
    if (retention.BILLING_ELITE_SUPPORTER_RETENTION > 0) {
      const eliteScansRes = await pool.query(
        `DELETE FROM scan_history
         WHERE scanned_at < NOW() - ($1 * INTERVAL '1 day')
         AND user_id IN (SELECT id FROM users WHERE plan = 'elite_supporter')`,
        [retention.BILLING_ELITE_SUPPORTER_RETENTION],
      );
      totalScansDeleted += eliteScansRes.rowCount || 0;
    }

    stats.oldScans = totalScansDeleted;

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
    const rateLimitsRes = await pool.query(
      "DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'",
    );
    stats.oldRateLimits = rateLimitsRes.rowCount || 0;

    // Delete expired password reset and verification tokens
    const tokensRes = await pool.query(
      "DELETE FROM password_reset_tokens WHERE expires_at < NOW()",
    );
    stats.expiredTokens = tokensRes.rowCount || 0;

    const verifyTokensRes = await pool.query(
      "DELETE FROM email_verification_tokens WHERE expires_at < NOW()",
    );
    stats.expiredTokens += verifyTokensRes.rowCount || 0;

    // Delete expired team invites that were never accepted
    const invitesRes = await pool.query(
      "DELETE FROM team_invites WHERE expires_at < NOW() AND accepted_at IS NULL",
    );
    stats.expiredInvites = invitesRes.rowCount || 0;

    // Delete expired email 2FA codes
    const email2faRes = await pool.query(
      "DELETE FROM email_2fa_codes WHERE expires_at < NOW()",
    );
    stats.expired2FACodes = email2faRes.rowCount || 0;

    // Delete expired billing verification codes
    const billingVerifyRes = await pool.query(
      "DELETE FROM billing_verification_codes WHERE expires_at < NOW()",
    );
    stats.expiredBillingCodes = billingVerifyRes.rowCount || 0;

    // Delete expired device trust records
    const deviceTrustRes = await pool.query(
      "DELETE FROM device_trust WHERE expires_at < NOW()",
    );
    stats.expiredDeviceTrust = deviceTrustRes.rowCount || 0;

    // Delete expired/ended admin notifications (ended more than 30 days ago)
    const notificationsRes = await pool.query(
      "DELETE FROM admin_notifications WHERE ends_at IS NOT NULL AND ends_at < NOW() - INTERVAL '30 days'",
    );
    stats.expiredNotifications = notificationsRes.rowCount || 0;

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
    const giftedSubsRes = await pool.query(
      "DELETE FROM gifted_subscriptions WHERE expires_at < NOW() - INTERVAL '90 days'",
    );
    stats.expiredGiftedSubs = giftedSubsRes.rowCount || 0;

    // AUDIT-010 admin-feature-gap: archive the rows this delete is about to
    // remove permanently, before removing them. This is the ONE genuinely
    // coupled pair in the whole pass, so it keeps a transaction of its own:
    // within one transaction Postgres's NOW() is stable, so the archive
    // SELECT and the DELETE below see the identical cutoff and therefore the
    // identical row set, with no window in which a row is purged unarchived.
    // Scoped to just these two statements rather than the whole cleanup, so
    // it holds a connection and its locks for two statements, not thirty.
    // ref: AUDIT-012#perf-22, lib/database/audit-log-archive.ts
    const auditClient = await pool.connect();
    try {
      await auditClient.query("BEGIN");
      stats.archivedAuditLogs = await archiveAdminAuditLogBeforePurge(
        auditClient,
        cleanupRetention.CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS,
      );
      const auditLogsRes = await auditClient.query(
        "DELETE FROM admin_audit_log WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
        [cleanupRetention.CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS],
      );
      stats.oldAuditLogs = auditLogsRes.rowCount || 0;
      await auditClient.query("COMMIT");
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

    // Delete old admin user notes (admin-configurable retention)
    const adminNotesRes = await pool.query(
      "DELETE FROM admin_user_notes WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_ADMIN_USER_NOTES_RETENTION_DAYS],
    );
    stats.oldAdminNotes = adminNotesRes.rowCount || 0;

    // Delete old staff activity records (> 30 days)
    const staffActivityRes = await pool.query(
      "DELETE FROM staff_activity WHERE last_heartbeat < NOW() - INTERVAL '30 days'",
    );
    stats.oldStaffActivity = staffActivityRes.rowCount || 0;

    // Delete old subdomain cache entries past the admin-configurable TTL
    // (same setting the discover route and read-only lookup use). The scan
    // route re-resolves DNS for every scan via safeFetch; the cache is a
    // perf optimisation only. Anything older than the TTL has already been
    // re-resolved.
    const subdomainCacheRes = await pool.query(
      "DELETE FROM subdomain_cache WHERE cached_at < NOW() - ($1 * INTERVAL '1 hour')",
      [cleanupRetention.SUBDOMAIN_CACHE_TTL_HOURS],
    );
    stats.oldSubdomainCache = subdomainCacheRes.rowCount || 0;

    // ai_conversations: GDPR data-minimization gap found in the 2026-08
    // compliance audit -- this table (chat history with the AI assistant,
    // JSONB message content) had no retention enforcement at all before
    // this fix and was kept indefinitely. Retention window is the
    // admin-configurable AI_CHAT_HISTORY_DAYS setting (default 90, matching
    // the "AI chat history: 90 days" promise in app/legal/privacy/page.tsx)
    // rather than a hardcoded interval, so an admin edit actually changes
    // what gets purged instead of silently doing nothing.
    const aiConversationsRes = await pool.query(
      "DELETE FROM ai_conversations WHERE last_message_at < NOW() - ($1 * INTERVAL '1 day')",
      [aiChatHistoryDays],
    );
    stats.oldAiConversations = aiConversationsRes.rowCount || 0;

    // security_alerts: admin-configurable retention. The table tracks
    // suspicious activity (brute-force attempts, anomaly hits) — kept
    // long enough for SOC review, short enough to bound PII.
    const securityAlertsRes = await pool.query(
      "DELETE FROM security_alerts WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_SECURITY_ALERTS_RETENTION_DAYS],
    );
    stats.expiredNotifications += securityAlertsRes.rowCount || 0;

    // access_rules: drop hit_count and last_hit_at on stale rows so
    // the table doesn't grow unboundedly from rule lookups.
    const accessRulesRes = await pool.query(
      `UPDATE access_rules
       SET hit_count = 0, last_hit_at = NULL
       WHERE last_hit_at < NOW() - INTERVAL '90 days'`,
    );
    stats.expiredNotifications += accessRulesRes.rowCount || 0;

    // scan_finding_feedback: admin-configurable retention, defaulting to
    // the same general account-data window used elsewhere in this function
    // (api_usage, ai_conversations).
    const scanFindingFeedbackRes = await pool.query(
      "DELETE FROM scan_finding_feedback WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_SCAN_FINDING_FEEDBACK_RETENTION_DAYS],
    );
    stats.oldScanFindingFeedback = scanFindingFeedbackRes.rowCount || 0;

    // user_notifications: the in-app notification bell's feed.
    // Admin-configurable retention -- a read or unread notification is not
    // useful to keep indefinitely.
    const userNotificationsRes = await pool.query(
      "DELETE FROM user_notifications WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_USER_NOTIFICATIONS_RETENTION_DAYS],
    );
    stats.oldUserNotifications = userNotificationsRes.rowCount || 0;

    // github_review_usage: one row per user per fixed AI_USAGE_WINDOW_HOURS
    // window (window_start, tokens_used) tracking AI review token spend.
    // Admin-configurable retention, defaulting to comfortably outliving any
    // single window's row while still bounding growth -- mirrors
    // security_alerts' retention above for the same "usage/history
    // tracking, not a live counter" shape.
    const githubReviewUsageRes = await pool.query(
      "DELETE FROM github_review_usage WHERE updated_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_GITHUB_REVIEW_USAGE_RETENTION_DAYS],
    );
    stats.oldGithubReviewUsage = githubReviewUsageRes.rowCount || 0;

    // browser_sessions: ownership mapping for the live-browser scan
    // viewer (AUDIT-004#idor-01). Deletes by the row's own expires_at
    // when set -- same idiom as sessions/device_trust above -- with a
    // 1-day created_at fallback for the rare row that never got one, so
    // this never depends solely on created_at the way a plain log table's
    // retention would. RETURNING the fields the plan-usage true-up below
    // needs: a session a user never explicitly ended (closed the tab,
    // let it sit) still consumed real Browserbase minutes -- see the
    // comment on expiredBrowserSessions below.
    const browserSessionsRes = await pool.query<{
      user_id: number;
      created_at: string;
      expires_at: string | null;
    }>(
      `DELETE FROM browser_sessions
       WHERE (expires_at IS NOT NULL AND expires_at < NOW())
          OR (expires_at IS NULL AND created_at < NOW() - INTERVAL '1 day')
       RETURNING user_id, created_at, expires_at`,
    );
    stats.oldBrowserSessions = browserSessionsRes.rowCount || 0;
    const expiredBrowserSessions = browserSessionsRes.rows;

    // cve_kev_cache: whole-feed cache of CISA's Known Exploited
    // Vulnerabilities list (lib/scanner/cve-enrichment.ts), added
    // 2026-08. The read side already treats a row older than the
    // CVE_KEV_CACHE_TTL_HOURS window as stale and re-fetches, so nothing
    // here needs to survive past that -- this admin-configurable retention
    // is just a bound on dead rows accumulating, not a freshness guarantee;
    // it's a performance cache, not user data.
    const kevCacheRes = await pool.query(
      "DELETE FROM cve_kev_cache WHERE cached_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_KEV_CACHE_RETENTION_DAYS],
    );
    stats.oldKevCache = kevCacheRes.rowCount || 0;

    // system_error_logs: captured console.error calls (Admin > System >
    // Error Logs, see lib/database/error-log-capture.ts). Admin-configurable
    // retention, defaulting to enough runway for periodic reviews without
    // keeping debug noise forever -- shorter than admin_audit_log/
    // admin_user_notes (a genuine audit trail) and security_alerts (kept
    // for SOC review), since this table is operational debugging output,
    // not a compliance record.
    const errorLogsRes = await pool.query(
      "DELETE FROM system_error_logs WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_SYSTEM_ERROR_LOGS_RETENTION_DAYS],
    );
    stats.oldErrorLogs = errorLogsRes.rowCount || 0;

    // email_logs: outbound email attempt records (Admin > System > Email
    // Logs, see lib/email/email.ts's sendEmail()). Operational visibility,
    // not a compliance record, so it gets a similarly short default
    // retention to system_error_logs above.
    const emailLogsRes = await pool.query(
      "DELETE FROM email_logs WHERE created_at < NOW() - ($1 * INTERVAL '1 day')",
      [cleanupRetention.CLEANUP_EMAIL_LOG_RETENTION_DAYS],
    );
    stats.oldEmailLogs = emailLogsRes.rowCount || 0;

    // webhook_deliveries: one row per outbound delivery attempt, written by
    // lib/webhooks/delivery.ts. See WEBHOOK_DELIVERIES_RETENTION_DAYS above
    // for why the window is a constant rather than a setting.
    const webhookDeliveriesRes = await pool.query(
      "DELETE FROM webhook_deliveries WHERE attempted_at < NOW() - ($1 * INTERVAL '1 day')",
      [WEBHOOK_DELIVERIES_RETENTION_DAYS],
    );
    stats.oldWebhookDeliveries = webhookDeliveriesRes.rowCount || 0;

    // Plan-usage true-up for sessions that expired without an explicit
    // DELETE /api/v3/browser/sessions call (a closed tab, a crashed
    // client): app/api/v3/browser/sessions/route.ts's DELETE handler
    // already records a session's real elapsed duration when the user
    // actually ends it, but a session nobody explicitly closed would
    // otherwise never get recorded at all, silently undercounting real
    // Browserbase cost against the account. keepAlive: true (see
    // lib/browserbase/client.ts) means the underlying session genuinely
    // stays alive on Browserbase's side until its TTL, so expires_at -
    // created_at is a real duration, not an estimate. Runs after the DELETE
    // has already committed (the prune is autocommitted now, so the rows are
    // durably gone by the time this loop starts, and usage is never recorded
    // for a session that was not actually reclaimed) and fire-and-forget,
    // same as the DELETE route's own true-up -- a failure here must never
    // fail the whole cleanup pass over a usage-accounting side effect.
    for (const row of expiredBrowserSessions) {
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

    return stats;
  } catch (error) {
    // No ROLLBACK: each prune above is its own autocommitted statement, so
    // the ones that already succeeded stay done. That is the point of the
    // split -- a failure pruning webhook_deliveries used to undo twenty-nine
    // unrelated retention prunes. The throw is preserved so the caller's
    // failure escalation still fires. ref: AUDIT-012#perf-22
    console.error("[Database Cleanup] Error during cleanup:", error);
    throw error;
  }
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
