import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES, APP_VERSION } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { dataRequestCreatedEmail } from "@/lib/email/email";

/**
 * How many of the export's table reads run at once.
 *
 * The GDPR export used to hand all 25 queries to a single Promise.all, which
 * asked for 25 connections from a pool whose max is 10 (CONFIG_DB_POOL_MAX):
 * one request queued on itself for fifteen of them AND monopolised every
 * connection every other request in the process was waiting for, including
 * logins and in-flight scans' progress writes. Batching keeps the export
 * parallel enough to stay fast while leaving most of the pool free.
 */
const EXPORT_QUERY_CONCURRENCY = 4;

/**
 * Ceiling on the number of scans whose full findings blob is inlined.
 *
 * The scan_history read is the one query here that selects a fat JSONB
 * column for an unbounded row set, and the result is buffered in the Node
 * heap, stringified, written to data_requests.data and returned in the
 * response body, so a single export of a very large account can OOM the
 * process that also runs every in-flight scan (AUDIT-012#perf-19).
 *
 * Set well above any real account rather than as a data reduction: the
 * highest shipped plan allows 500 scans a day, so this is roughly three
 * weeks of continuously maxing out the largest plan. If it is ever reached
 * the export says so explicitly rather than silently handing back a subset,
 * because an incomplete copy presented as complete is the failure mode that
 * actually matters for a subject-access export.
 */
const EXPORT_MAX_SCANS = 10000;
/**
 * Ceiling for the per-row logs below (deliveries, email, usage windows,
 * audit entries). Scans get their own, larger ceiling because they are the
 * thing people actually come here for; these are supporting records, and an
 * account that has generated more than this many of one of them would
 * otherwise be able to build a file too large to serialise.
 */
const EXPORT_MAX_ROWS = 5000;

/** Run thunks in fixed-size batches, preserving input order in the result. */
async function runInBatches<T>(
  tasks: (() => Promise<T>)[],
  size = EXPORT_QUERY_CONCURRENCY,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += size) {
    out.push(...(await Promise.all(tasks.slice(i, i + size).map((t) => t()))));
  }
  return out;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  try {
    // Get most recent download
    const result = await pool.query(
      `SELECT data, downloaded_at FROM data_requests WHERE user_id = $1 AND downloaded_at IS NOT NULL ORDER BY downloaded_at DESC LIMIT 1`,
      [session.userId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({
        hasData: false,
        canDownloadNew: true,
        lastDownloadAt: null,
      });
    }

    const cooldownDays = await getSetting("DATA_EXPORT_COOLDOWN_DAYS");
    const lastDownload = new Date(result.rows[0].downloaded_at);
    const cooldownEnd = new Date(
      lastDownload.getTime() + cooldownDays * 24 * 60 * 60 * 1000,
    );
    const canDownloadNew = new Date() >= cooldownEnd;

    return NextResponse.json({
      hasData: true,
      canDownloadNew,
      lastDownloadAt: lastDownload.toISOString(),
      cooldownEndsAt: cooldownEnd.toISOString(),
      data: result.rows[0].data,
    });
  } catch (error) {
    return NextResponse.json({
      hasData: false,
      canDownloadNew: true,
      lastDownloadAt: null,
    });
  }
}

export async function POST(_request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  // Check if they can request new data (admin-configured cooldown)
  const cooldownDays = await getSetting("DATA_EXPORT_COOLDOWN_DAYS");
  const lastExport = await pool.query(
    `SELECT downloaded_at FROM data_requests WHERE user_id = $1 AND downloaded_at IS NOT NULL ORDER BY downloaded_at DESC LIMIT 1`,
    [session.userId],
  );

  if (lastExport.rows.length > 0) {
    const lastDownload = new Date(lastExport.rows[0].downloaded_at);
    const cooldownEnd = new Date(
      lastDownload.getTime() + cooldownDays * 24 * 60 * 60 * 1000,
    );
    if (new Date() < cooldownEnd) {
      const daysRemaining = Math.ceil(
        (cooldownEnd.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000),
      );
      return NextResponse.json(
        {
          error: `You can request fresh data once every ${cooldownDays} days. Try again in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}.`,
        },
        { status: 429 },
      );
    }
  }

  try {
    // Gather ALL user data from every table.
    //
    // Never queried here, and each for a stated reason rather than because
    // nobody got to it:
    //
    // - host_reputation is a host-keyed cache (no user_id column at all) of
    //   the latest scan result per host, feeding the browser extension's
    //   popup. It holds no personal identifier for anyone to export.
    // - password_reset_tokens, email_verification_tokens and
    //   billing_verification_codes hold live credentials. Handing them back
    //   in a downloadable file is the opposite of a privacy measure, and it
    //   is the same reason password_hash, totp_secret and backup_codes are
    //   excluded from the users row below.
    // - admin_notifications, access_rules, promoted_auto_tag_rules and
    //   broadcast_messages record staff actions by created_by. What a staff
    //   member did is exported as staffActivity and adminActionsOnYourAccount
    //   instead; the rules and notices themselves are the service's records,
    //   not the account holder's data.
    // - rate_limits and the various caches are transient and hold nothing a
    //   person could not derive from their own usage rows.
    //
    // Anything else that gains a user_id belongs in this list. It did not
    // used to say that, and twenty-one user-keyed tables accumulated outside
    // it, support correspondence and purchase records among them.
    const [
      userData,
      sessionsData,
      apiKeysData,
      apiUsageData,
      scanHistoryData,
      scanTagsData,
      scheduledScansData,
      webhooksData,
      userBadgesData,
      billingHistoryData,
      discordConnectionData,
      deviceTrustData,
      notificationPrefsData,
      teamMembershipsData,
      teamsOwnedData,
      teamInvitesSentData,
      giftedSubscriptionsData,
      adminNotesOnUserData,
      aiConfigData,
      scanFindingFeedbackData,
      inAppNotificationsData,
      browserSessionsData,
      aiConversationsData,
      githubConnectionData,
      securityAlertsData,
      supportTicketsData,
      supportTicketMessagesData,
      supportTicketSharesData,
      domainsData,
      hostBadgesData,
      findingRemediationData,
      autoTagDismissalsData,
      aiUsageData,
      githubReviewUsageData,
      browserbaseUsageData,
      creditPurchasesData,
      broadcastsReceivedData,
      emailLogData,
      avatarUploadData,
      staffActivityData,
      adminActionsData,
      exportHistoryData,
      webhookDeliveriesData,
      scanScreenshotsData,
      scanTeamSharesData,
      contactSubmissionsData,
    ] = await runInBatches([
      // Core user data (excluding password_hash, totp_secret, backup_codes for security)
      () =>
        pool.query(
          `
        SELECT id, email, name, avatar_url, discord_id, role, plan, 
               stripe_customer_id, subscription_status, current_period_end, cancel_at_period_end,
               beta_access, daily_scan_limit, email_verified_at, tos_accepted_at, disabled_at,
               onboarding_completed, totp_enabled, two_factor_method, created_at, updated_at
        FROM users WHERE id = $1
      `,
          [session.userId],
        ),

      // Sessions
      () =>
        pool.query(
          `
        SELECT id, ip_address, user_agent, expires_at, created_at
        FROM sessions WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // API Keys (excluding key_hash and key_encrypted for security)
      () =>
        pool.query(
          `
        SELECT id, key_prefix, name, daily_limit, created_at, last_used_at, revoked_at
        FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // API Usage
      () =>
        pool.query(
          `
        SELECT au.id, au.used_at, ak.key_prefix, ak.name as key_name
        FROM api_usage au
        JOIN api_keys ak ON au.api_key_id = ak.id
        WHERE ak.user_id = $1
        ORDER BY au.used_at DESC
      `,
          [session.userId],
        ),

      // Scan History (full data including findings)
      () =>
        pool.query(
          `
        SELECT id, url, summary, findings, findings_count, duration, source,
               share_token, response_headers, notes, scanned_at
        FROM scan_history WHERE user_id = $1 ORDER BY scanned_at DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_SCANS],
        ),

      // Scan Tags (source distinguishes an auto tag lib/tags/auto-tags.ts
      // derived from the scan's findings from one this user typed in)
      () =>
        pool.query(
          `
        SELECT st.id, st.scan_id, st.tag, st.source, sh.url as scan_url
        FROM scan_tags st
        JOIN scan_history sh ON st.scan_id = sh.id
        WHERE st.user_id = $1 ORDER BY st.id DESC
      `,
          [session.userId],
        ),

      // Scheduled Scans
      () =>
        pool.query(
          `
        SELECT id, url, frequency, active, last_run_at, next_run_at, created_at
        FROM scheduled_scans WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // Webhooks
      () =>
        pool.query(
          `
        SELECT id, url, name, type, active, created_at
        FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // User Badges
      () =>
        pool.query(
          `
        SELECT ub.awarded_at, b.name as badge_name, b.display_name, b.description, b.icon, b.color
        FROM user_badges ub
        JOIN badges b ON ub.badge_id = b.id
        WHERE ub.user_id = $1 ORDER BY ub.awarded_at DESC
      `,
          [session.userId],
        ),

      // Billing History
      () =>
        pool.query(
          `
        SELECT id, stripe_invoice_id, stripe_payment_intent_id, amount_cents, currency, 
               status, description, invoice_pdf_url, created_at
        FROM billing_history WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // Discord Connection (excluding tokens for security)
      () =>
        pool.query(
          `
        SELECT discord_id, discord_username, discord_discriminator, discord_avatar, 
               discord_email, guild_joined, connected_at, updated_at
        FROM discord_connections WHERE user_id = $1
      `,
          [session.userId],
        ),

      // Device Trust
      () =>
        pool.query(
          `
        SELECT id, device_fingerprint, device_name, ip_address, user_agent, 
               last_used_at, created_at, expires_at
        FROM device_trust WHERE user_id = $1 ORDER BY last_used_at DESC
      `,
          [session.userId],
        ),

      // Notification Preferences
      () =>
        pool.query(
          `
        SELECT * FROM notification_preferences WHERE user_id = $1
      `,
          [session.userId],
        ),

      // Team Memberships
      () =>
        pool.query(
          `
        SELECT tm.role, tm.joined_at, t.name as team_name, t.slug as team_slug
        FROM team_members tm
        JOIN teams t ON tm.team_id = t.id
        WHERE tm.user_id = $1 ORDER BY tm.joined_at DESC
      `,
          [session.userId],
        ),

      // Teams Owned
      () =>
        pool.query(
          `
        SELECT id, name, slug, created_at
        FROM teams WHERE owner_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // Team Invites Sent
      () =>
        pool.query(
          `
        SELECT ti.email, ti.role, ti.expires_at, ti.accepted_at, ti.created_at, t.name as team_name
        FROM team_invites ti
        JOIN teams t ON ti.team_id = t.id
        WHERE ti.invited_by = $1 ORDER BY ti.created_at DESC
      `,
          [session.userId],
        ),

      // Gifted Subscriptions Received
      () =>
        pool.query(
          `
        SELECT gs.plan, gs.reason, gs.expires_at, gs.revoked_at, gs.created_at,
               u.email as gifted_by_email
        FROM gifted_subscriptions gs
        LEFT JOIN users u ON gs.gifted_by = u.id
        WHERE gs.user_id = $1 ORDER BY gs.created_at DESC
      `,
          [session.userId],
        ),

      // Admin Notes on User (user should see notes about them)
      () =>
        pool.query(
          `
        SELECT aun.note, aun.created_at, u.email as admin_email
        FROM admin_user_notes aun
        LEFT JOIN users u ON aun.admin_id = u.id
        WHERE aun.user_id = $1 ORDER BY aun.created_at DESC
      `,
          [session.userId],
        ),

      // AI Provider Config (excluding api_key_encrypted for security)
      () =>
        pool.query(
          `
        SELECT use_vulnradar_ai, ai_disabled, provider, model_id, base_url, created_at, updated_at
        FROM user_ai_configs WHERE user_id = $1
      `,
          [session.userId],
        ),

      // Scan Finding Feedback (verdicts on individual findings)
      () =>
        pool.query(
          `
        SELECT id, scan_history_id, finding_id, finding_url, verdict, notes, created_at
        FROM scan_finding_feedback WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // In-App Notifications (notification bell)
      () =>
        pool.query(
          `
        SELECT id, type, title, message, action_label, action_url,
               related_type, related_id, read_at, created_at
        FROM user_notifications WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // Browser Sessions (live scan viewer / authenticated-scan sessions)
      () =>
        pool.query(
          `
        SELECT id, created_at, expires_at
        FROM browser_sessions WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // AI Chat Conversations (placed last alongside scan history: can be large)
      () =>
        pool.query(
          `
        SELECT id, session_id, messages, created_at, last_message_at
        FROM ai_conversations WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // GitHub Connection (excluding access_token_encrypted for security,
      // same redaction precedent as discordConnection's tokens above and
      // aiConfig's api_key_encrypted)
      () =>
        pool.query(
          `
        SELECT github_user_id, github_username, scopes, selected_repos,
               connected_at, updated_at
        FROM github_connections WHERE user_id = $1
      `,
          [session.userId],
        ),

      // Security Alerts (the subject's own IP/user-agent history behind
      // each alert raised on their account; resolved_by is surfaced as an
      // email, same transparency pattern as adminNotesOnUserData above,
      // rather than a bare internal user id)
      () =>
        pool.query(
          `
        SELECT sa.id, sa.alert_type, sa.severity, sa.description, sa.details,
               sa.ip_address, sa.user_agent, sa.resolved_at, sa.created_at,
               sa.action_taken, u.email as resolved_by_email
        FROM security_alerts sa
        LEFT JOIN users u ON sa.resolved_by = u.id
        WHERE sa.user_id = $1 ORDER BY sa.created_at DESC
      `,
          [session.userId],
        ),

      // Support tickets you opened. Correspondence with us is personal data
      // and was missing from every export until now, along with the twenty
      // other user-keyed tables below: the export named 25 of the schema's
      // 65 tables, and the omissions were not a considered exclusion list.
      // They were tables added after this route was written, never wired in.
      () =>
        pool.query(
          `
        SELECT id, subject, category, status, created_at, updated_at, last_message_at
        FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // Messages on those tickets, yours and ours. is_staff distinguishes the
      // two; the individual staff member is not named, matching how the
      // ticket UI attributes our replies to Support rather than to a person.
      () =>
        pool.query(
          `
        SELECT m.id, m.ticket_id, m.is_staff, m.body, m.created_at
        FROM support_ticket_messages m
        JOIN support_tickets t ON m.ticket_id = t.id
        WHERE t.user_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),

      // Tickets shared with you, or by you with a teammate.
      () =>
        pool.query(
          `
        SELECT s.ticket_id, s.created_at, t.subject,
               sw.email as shared_with_email, sb.email as shared_by_email
        FROM support_ticket_shares s
        JOIN support_tickets t ON s.ticket_id = t.id
        LEFT JOIN users sw ON s.shared_with_user_id = sw.id
        LEFT JOIN users sb ON s.shared_by_user_id = sb.id
        WHERE s.shared_with_user_id = $1 OR s.shared_by_user_id = $1
        ORDER BY s.created_at DESC
      `,
          [session.userId],
        ),

      // Verified domains. verification_token is withheld on the same grounds
      // as the OAuth tokens above: it proves control of the domain, and an
      // export file travels further than the settings page that shows it.
      () =>
        pool.query(
          `
        SELECT d.id, d.domain, d.status, d.verification_method, d.created_at,
               d.verified_at, d.last_checked_at, d.last_check_error,
               t.name as team_name
        FROM domains d
        LEFT JOIN teams t ON d.team_id = t.id
        WHERE d.user_id = $1 ORDER BY d.created_at DESC
      `,
          [session.userId],
        ),

      // Badges you generated for your own hosts. badge_token appears in the
      // public badge URL, so it is not withheld.
      () =>
        pool.query(
          `
        SELECT id, url, badge_token, created_at, revoked_at
        FROM host_badges WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // Remediation notes and assignments you wrote against findings.
      () =>
        pool.query(
          `
        SELECT id, finding_id, finding_url, status, note, assignee,
               due_at, created_at, updated_at
        FROM finding_remediation WHERE user_id = $1 ORDER BY created_at DESC
      `,
          [session.userId],
        ),

      // Auto-tags you dismissed.
      () =>
        pool.query(
          `
        SELECT id, scan_id, tag, dismissed_at
        FROM auto_tag_dismissals WHERE dismissed_by_user_id = $1
        ORDER BY dismissed_at DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),

      // AI token usage per window.
      () =>
        pool.query(
          `
        SELECT window_start, tokens_used, updated_at
        FROM ai_usage WHERE user_id = $1 ORDER BY window_start DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),

      // GitHub review token usage per window.
      () =>
        pool.query(
          `
        SELECT window_start, tokens_used, updated_at
        FROM github_review_usage WHERE user_id = $1 ORDER BY window_start DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),

      // Browser-automation seconds used per period.
      () =>
        pool.query(
          `
        SELECT period_start, seconds_used, updated_at
        FROM browserbase_usage WHERE user_id = $1 ORDER BY period_start DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),

      // Credit top-ups. These are purchases and belong beside billingHistory,
      // which only ever covered subscription invoices. Three tables, one
      // shape, so they arrive as one list with a kind column.
      () =>
        pool.query(
          `
        SELECT 'ai_tokens' as kind, payment_intent_id, tokens as quantity, credited_at
        FROM ai_credit_purchases WHERE user_id = $1
        UNION ALL
        SELECT 'github_review_tokens' as kind, payment_intent_id, tokens as quantity, credited_at
        FROM github_credit_purchases WHERE user_id = $1
        UNION ALL
        SELECT 'browser_seconds' as kind, payment_intent_id, seconds as quantity, credited_at
        FROM browserbase_credit_purchases WHERE user_id = $1
        ORDER BY credited_at DESC
      `,
          [session.userId],
        ),

      // Announcement emails addressed to you, and whether they were sent.
      () =>
        pool.query(
          `
        SELECT r.id, r.status, r.created_at,
               m.title, m.message_type, m.sent_at
        FROM broadcast_recipients r
        JOIN broadcast_messages m ON r.message_id = m.id
        WHERE r.user_id = $1 ORDER BY r.created_at DESC
      `,
          [session.userId],
        ),

      // The delivery log for mail we sent you. redacted_preview is the stored
      // body with links, codes and tokens already stripped, which is why it
      // is safe to hand back; redacted_html is the same content again and is
      // left out so the file does not double in size for no new information.
      () =>
        pool.query(
          `
        SELECT id, subject, status, error_message, redacted_preview, created_at
        FROM email_logs
        WHERE recipient = (SELECT email FROM users WHERE id = $1)
        ORDER BY created_at DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),

      // Uploaded avatar, described rather than embedded: the image bytes
      // would dominate the file, and the account section already carries the
      // URL that serves them.
      () =>
        pool.query(
          `
        SELECT content_type, octet_length(image_data) as bytes, updated_at
        FROM user_avatars WHERE user_id = $1
      `,
          [session.userId],
        ),

      // Admin-panel presence, which only exists for staff accounts.
      () =>
        pool.query(
          `
        SELECT current_section, ip_address, user_agent, last_heartbeat, created_at
        FROM staff_activity WHERE user_id = $1 ORDER BY last_heartbeat DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),

      // Actions staff took on your account, for the same transparency reason
      // adminNotesAboutYou is exported. The details column is withheld: it is
      // free-form and, on team and ticket actions, names other people.
      () =>
        pool.query(
          `
        SELECT action, created_at
        FROM admin_audit_log WHERE target_user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),

      // Previous exports. The stored payload is deliberately not included:
      // every export would then nest the one before it.
      () =>
        pool.query(
          `
        SELECT id, status, requested_at, downloaded_at
        FROM data_requests WHERE user_id = $1 ORDER BY requested_at DESC
      `,
          [session.userId],
        ),

      // What we sent to your webhook endpoints and what came back.
      () =>
        pool.query(
          `
        SELECT d.id, d.event_type, d.http_status, d.response_snippet,
               d.attempted_at, w.name as webhook_name, w.url as webhook_url
        FROM webhook_deliveries d
        JOIN webhooks w ON d.webhook_id = w.id
        WHERE w.user_id = $1
        ORDER BY d.attempted_at DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),

      // Screenshots captured during your scans, described rather than
      // embedded for the same reason as the avatar.
      () =>
        pool.query(
          `
        SELECT s.scan_id, s.content_type, s.width, s.height, s.captured_at,
               octet_length(s.image_data) as bytes, h.url
        FROM scan_screenshots s
        JOIN scan_history h ON s.scan_id = h.id
        WHERE h.user_id = $1
        ORDER BY s.captured_at DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),

      // Which of your scans you shared into which team.
      () =>
        pool.query(
          `
        SELECT st.scan_id, st.created_at, t.name as team_name, h.url
        FROM scan_history_teams st
        JOIN scan_history h ON st.scan_id = h.id
        LEFT JOIN teams t ON st.team_id = t.id
        WHERE h.user_id = $1
        ORDER BY st.created_at DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),

      // Messages you sent us through a contact form. Keyed on the address you
      // typed rather than on an account, because the landing form takes
      // messages from people who do not have one, which is also why it is
      // matched the same way emailLog above is.
      () =>
        pool.query(
          `
        SELECT id, source, name, subject, category, message,
               email_status, created_at
        FROM contact_submissions
        WHERE email = (SELECT email FROM users WHERE id = $1)
        ORDER BY created_at DESC
        LIMIT $2
      `,
          [session.userId, EXPORT_MAX_ROWS],
        ),
    ]);

    // Remove user_id from notification_preferences for cleaner export
    const notifPrefs = notificationPrefsData.rows[0] || null;
    if (notifPrefs) {
      delete notifPrefs.id;
      delete notifPrefs.user_id;
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      dataExportVersion: APP_VERSION,

      // Account Information
      account: userData.rows[0] || null,

      // Security & Access
      sessions: sessionsData.rows,
      deviceTrust: deviceTrustData.rows,
      discordConnection: discordConnectionData.rows[0] || null,
      githubConnection: githubConnectionData.rows[0] || null,
      securityAlerts: securityAlertsData.rows,

      // API & Developer
      apiKeys: apiKeysData.rows,
      apiUsage: apiUsageData.rows,
      webhooks: webhooksData.rows,

      // Scanning
      scheduledScans: scheduledScansData.rows,
      scanTags: scanTagsData.rows,
      scanFindingFeedback: scanFindingFeedbackData.rows,
      browserSessions: browserSessionsData.rows,

      // Billing & Subscription
      billingHistory: billingHistoryData.rows,
      giftedSubscriptions: giftedSubscriptionsData.rows,

      // Teams
      teamsOwned: teamsOwnedData.rows,
      teamMemberships: teamMembershipsData.rows,
      teamInvitesSent: teamInvitesSentData.rows,

      // Profile & Preferences
      badges: userBadgesData.rows,
      notificationPreferences: notifPrefs,
      inAppNotifications: inAppNotificationsData.rows,

      // AI (excludes any encrypted API key you configured)
      aiConfig: aiConfigData.rows[0] || null,

      // Support
      supportTickets: supportTicketsData.rows,
      supportTicketMessages: supportTicketMessagesData.rows,
      supportTicketShares: supportTicketSharesData.rows,

      // Domains and Badges
      domains: domainsData.rows,
      hostBadges: hostBadgesData.rows,

      // Findings you acted on
      findingRemediation: findingRemediationData.rows,
      autoTagDismissals: autoTagDismissalsData.rows,

      // Metered usage and credit top-ups
      aiUsage: aiUsageData.rows,
      githubReviewUsage: githubReviewUsageData.rows,
      browserAutomationUsage: browserbaseUsageData.rows,
      creditPurchases: creditPurchasesData.rows,

      // Mail we sent you
      broadcastsReceived: broadcastsReceivedData.rows,
      emailLog: emailLogData.rows,
      contactSubmissions: contactSubmissionsData.rows,

      // Files stored against your account, described rather than embedded
      avatarUpload: avatarUploadData.rows[0] || null,
      scanScreenshots: scanScreenshotsData.rows,

      // Webhook deliveries and team sharing
      webhookDeliveries: webhookDeliveriesData.rows,
      scanTeamShares: scanTeamSharesData.rows,

      // Staff-only, empty for an ordinary account
      staffActivity: staffActivityData.rows,

      // Admin Notes and actions (transparency)
      adminNotesAboutYou: adminNotesOnUserData.rows,
      adminActionsOnYourAccount: adminActionsData.rows,

      // Previous exports (metadata only, never the nested payload)
      exportHistory: exportHistoryData.rows,

      // Scan History and AI Chat History (placed last: potentially large)
      scanHistory: scanHistoryData.rows,
      // Only present when the cap above was actually reached, so an ordinary
      // export is not littered with a note about a limit it never met.
      ...(scanHistoryData.rows.length >= EXPORT_MAX_SCANS
        ? {
            scanHistoryNote: `Only the ${EXPORT_MAX_SCANS} most recent scans are included in this file. Contact support to receive the remainder.`,
          }
        : {}),
      aiConversations: aiConversationsData.rows,
    };

    const jsonString = JSON.stringify(exportData, null, 2);

    // Store the data for future re-downloads
    // Perform an update first; if no rows were updated, insert a new row.
    // This avoids relying on a UNIQUE constraint for `user_id` which may not exist.
    const updateResult = await pool.query(
      `UPDATE data_requests SET data = $2, downloaded_at = NOW() WHERE user_id = $1`,
      [session.userId, jsonString],
    );

    if (updateResult.rowCount === 0) {
      await pool.query(
        `INSERT INTO data_requests (user_id, data, downloaded_at) VALUES ($1, $2, NOW())`,
        [session.userId, jsonString],
      );
    }

    const cooldownEndsAt = new Date(
      Date.now() + cooldownDays * 24 * 60 * 60 * 1000,
    );

    // Notify: a GDPR-style export request was just created and fulfilled.
    // Best-effort/fire-and-forget, same pattern as every other post-action
    // notification in this codebase -- wrapped so nothing here (including
    // getClientIp/getUserAgent, which can throw outside a real request
    // scope) can ever turn an otherwise-successful export into a 500. The
    // caller already has their data in hand regardless of whether this
    // email goes out.
    try {
      const requesterEmail = userData.rows[0]?.email;
      if (requesterEmail) {
        const ip = await getClientIp();
        const userAgent = await getUserAgent();
        sendNotificationEmail({
          userId: session.userId,
          userEmail: requesterEmail,
          type: "data_requests",
          emailContent: dataRequestCreatedEmail("export", {
            ipAddress: ip,
            userAgent,
          }),
        }).catch((err) =>
          console.error(
            "[data-request] Failed to send confirmation email:",
            err,
          ),
        );
      }
    } catch (err) {
      console.error(
        "[data-request] Failed to prepare confirmation email:",
        err,
      );
    }

    return NextResponse.json({
      success: true,
      data: exportData,
      canDownloadNew: false,
      lastDownloadAt: new Date().toISOString(),
      cooldownEndsAt: cooldownEndsAt.toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to export data" },
      { status: 500 },
    );
  }
}
