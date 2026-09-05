/**
 * The finalisation tail every scan path runs once its result is persisted:
 * the scan-complete email, the critical/high regression alert, and every
 * webhook the scan's owner (or the team the scan belongs to) has registered.
 *
 * This used to live inline at the bottom of lib/scanner/execute-scan.ts and
 * nowhere else, which meant exactly one of the five ways a scan can be
 * produced actually notified anyone. A crawl scan sent the regression alert
 * and nothing else; an authenticated scan and a GitHub repo scan completed in
 * total silence, despite being the two deepest scans on offer. The README's
 * claim that webhooks "fire when a background scan actually finishes" was
 * true of one path.
 *
 * It is one shared module rather than a block copied per path for the reason
 * app/api/v3/admin/features/route.ts records about its own broadcast loop:
 * two byte-identical copies of a send loop drift, and then only one of them
 * gets the fix.
 *
 * Two rules the payload builders below exist to hold:
 *
 * 1. Never invent a field. A GitHub repo scan has no URL, so its payload
 *    carries `repository` and no `url` key at all rather than a URL-shaped
 *    string that is not one. Consumers branch on `event` and on which
 *    identity key is present.
 * 2. An incomplete scan is reported as incomplete. "We found nothing" and
 *    "we could not finish looking" are different claims, and a notification
 *    that flattens them is the same defect the result UI has now had fixed
 *    three separate times (ScanResult.incomplete's contract in
 *    lib/scanner/types.ts: a listed area means not checked, not clean).
 *
 * Nothing in here is allowed to fail a scan. The scan is the product; a
 * receiver that 500s, an SMTP timeout, or a webhook row that cannot be read
 * is caught and logged here, never propagated to the caller. Callers invoke
 * it fire-and-forget (`void notifyScanComplete(...)`), matching how
 * execute-scan.ts already detached its email and webhook chains.
 */

import pool from "@/lib/database/db";
import { APP_NAME } from "@/lib/config/constants";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { scanCompleteEmail, criticalFindingsEmail } from "@/lib/email/email";
import {
  checkForNewCriticalOrHighFindings,
  type RegressionCheckResult,
} from "@/lib/scanner/regression-alert";
import {
  getSafetyRating,
  type SafetyRating,
} from "@/lib/scanner/safety-rating";
import type { Vulnerability } from "@/lib/scanner/types";
import { deliverWebhook } from "@/lib/webhooks/delivery";

/** Webhook event names this module can emit. */
export const SCAN_COMPLETED_EVENT = "scan.completed";
export const SCAN_REGRESSED_EVENT = "scan.regressed";

export interface ScanNotificationSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
}

/**
 * What was scanned, in the only two shapes the product actually produces.
 *
 * `value` must be the exact string the path persisted as scan_history.url:
 * it is both the label shown to a human and the key
 * lib/scanner/regression-alert.ts diffs on, so a value that does not match
 * the stored row silently turns every scan into "first scan of this target"
 * and re-alerts forever.
 */
export interface ScanNotificationTarget {
  kind: "url" | "repository";
  value: string;
}

export interface ScanNotificationParams {
  userId: number;
  /** scan_history row id, or null when the row could not be written. */
  scanId: number | null;
  target: ScanNotificationTarget;
  summary: ScanNotificationSummary;
  findings: Vulnerability[];
  /** Wall-clock milliseconds the scan took. */
  duration: number;
  /** ISO timestamp of completion. */
  scannedAt: string;
  /**
   * Areas that did not reach a conclusion (ScanResult.incomplete). Empty or
   * omitted means every planned branch ran.
   */
  incomplete?: string[];
  /**
   * Skip the routine "scan complete" email while still sending the
   * critical/high alert. Set by the scheduled-scans worker: an hourly
   * schedule mailing "nothing changed" every run is noise, but a schedule
   * that finds something new must still notify.
   */
  silenceRoutineEmail?: boolean;
}

/** Human-readable one-liner naming what did not finish. */
function incompleteNote(incomplete: string[]): string {
  return `Incomplete: ${incomplete.join(", ")} did not finish, so findings from those areas are missing rather than absent.`;
}

/**
 * The identity keys for a target. A URL scan keeps `normalizedUrl`, the key
 * the generic payload has always shipped, and gains `url`, the key
 * app/docs/webhooks/page.tsx has always documented: the two had drifted, so a
 * receiver written against the docs read `undefined`. A repository scan gets
 * `repository` and neither of the URL keys.
 */
function targetPayloadKeys(
  target: ScanNotificationTarget,
): Record<string, string> {
  return target.kind === "repository"
    ? { repository: target.value }
    : { url: target.value, normalizedUrl: target.value };
}

/** Label for the identity row in a Discord embed / Slack block. */
function targetLabel(target: ScanNotificationTarget): string {
  return target.kind === "repository" ? "Repository" : "URL";
}

/**
 * The `scan.completed` body for one webhook platform. Discord and Slack get
 * their native rich formats; everything else gets `{ event, data }`.
 */
export function buildScanCompletedBody(
  webhookType: string,
  params: ScanNotificationParams,
): string {
  const { target, summary, findings, duration, scannedAt } = params;
  const incomplete = params.incomplete ?? [];

  if (webhookType === "discord") {
    // Colour follows the canonical safe/caution/unsafe tier every other
    // surface uses (the public host page, history, the extension) instead of
    // a raw severity-count threshold: a "critical > 0 or high > 0" rule
    // cannot tell an exploitable finding from a pure hardening one such as a
    // lone missing HSTS header, so it painted embeds red for scans the
    // canonical scorer calls safe.
    const VERDICT_COLOR: Record<SafetyRating, number> = {
      safe: 0x22c55e,
      caution: 0xeab308,
      unsafe: 0xef4444,
    };
    return JSON.stringify({
      embeds: [
        {
          title: `${APP_NAME} Scan Complete`,
          description: `Scan finished for **${target.value}**`,
          color: VERDICT_COLOR[getSafetyRating(findings)],
          fields: [
            { name: "Critical", value: String(summary.critical), inline: true },
            { name: "High", value: String(summary.high), inline: true },
            { name: "Medium", value: String(summary.medium), inline: true },
            { name: "Low", value: String(summary.low), inline: true },
            { name: "Info", value: String(summary.info), inline: true },
            {
              name: "Total Issues",
              value: String(summary.total),
              inline: true,
            },
            {
              name: "Duration",
              value: `${(duration / 1000).toFixed(1)}s`,
              inline: true,
            },
            ...(incomplete.length > 0
              ? [
                  {
                    name: "Coverage",
                    value: incompleteNote(incomplete),
                    inline: false,
                  },
                ]
              : []),
          ],
          footer: { text: `${APP_NAME} Security Scanner` },
          timestamp: scannedAt,
        },
      ],
    });
  }

  if (webhookType === "slack") {
    return JSON.stringify({
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `${APP_NAME} Scan Complete` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${targetLabel(target)}:* ${target.value}`,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Critical:* ${summary.critical}` },
            { type: "mrkdwn", text: `*High:* ${summary.high}` },
            { type: "mrkdwn", text: `*Medium:* ${summary.medium}` },
            { type: "mrkdwn", text: `*Low:* ${summary.low}` },
            { type: "mrkdwn", text: `*Total:* ${summary.total}` },
            {
              type: "mrkdwn",
              text: `*Duration:* ${(duration / 1000).toFixed(1)}s`,
            },
          ],
        },
        ...(incomplete.length > 0
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*${incompleteNote(incomplete)}*`,
                },
              },
            ]
          : []),
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `Sent by ${APP_NAME} Security Scanner` },
          ],
        },
      ],
    });
  }

  return JSON.stringify({
    event: SCAN_COMPLETED_EVENT,
    data: {
      ...targetPayloadKeys(target),
      scan_id: params.scanId,
      summary,
      findings_count: summary.total,
      duration,
      scanned_at: scannedAt,
      // Present only when something genuinely did not finish. Sending an
      // empty array every time would make "complete" and "incomplete"
      // indistinguishable to a consumer that only checks for the key.
      ...(incomplete.length > 0 ? { incomplete } : {}),
    },
  });
}

/** The subset of a finding a diff-driven alert needs to route it to a human. */
function findingDigest(f: Vulnerability) {
  return {
    id: f.id,
    title: f.title,
    severity: f.severity,
    category: f.category,
  };
}

/**
 * The `scan.regressed` body: the same diff lib/scanner/regression-alert.ts
 * already computes for the critical/high email, carrying the findings
 * themselves rather than only counts, so a receiver can route an alert to a
 * person without a second API call.
 */
export function buildScanRegressedBody(
  webhookType: string,
  params: ScanNotificationParams,
  regression: RegressionCheckResult,
): string {
  const { target, scannedAt } = params;
  const newCount = regression.newFindings.length;
  const headline =
    newCount === 1
      ? "1 new critical or high finding"
      : `${newCount} new critical or high findings`;
  const list = regression.newFindings
    .slice(0, 10)
    .map((f) => `${f.severity.toUpperCase()}: ${f.title}`);
  const overflow = newCount > list.length ? newCount - list.length : 0;

  if (webhookType === "discord") {
    return JSON.stringify({
      embeds: [
        {
          title: `${APP_NAME} Regression Detected`,
          description: `${headline} since the previous scan of **${target.value}**`,
          color: 0xef4444,
          fields: [
            { name: targetLabel(target), value: target.value, inline: false },
            {
              name: "New findings",
              value:
                list.map((line) => `- ${line}`).join("\n") +
                (overflow > 0 ? `\n- and ${overflow} more` : ""),
              inline: false,
            },
            {
              name: "Still outstanding",
              value: String(regression.outstandingFindings.length),
              inline: true,
            },
          ],
          footer: { text: `${APP_NAME} Security Scanner` },
          timestamp: scannedAt,
        },
      ],
    });
  }

  if (webhookType === "slack") {
    return JSON.stringify({
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `${APP_NAME} Regression Detected` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${targetLabel(target)}:* ${target.value}\n${headline} since the previous scan.`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              list.map((line) => `- ${line}`).join("\n") +
              (overflow > 0 ? `\n- and ${overflow} more` : ""),
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `${regression.outstandingFindings.length} still outstanding. Sent by ${APP_NAME} Security Scanner`,
            },
          ],
        },
      ],
    });
  }

  return JSON.stringify({
    event: SCAN_REGRESSED_EVENT,
    data: {
      ...targetPayloadKeys(target),
      scan_id: params.scanId,
      scanned_at: scannedAt,
      new_findings_count: newCount,
      outstanding_findings_count: regression.outstandingFindings.length,
      new_findings: regression.newFindings.map(findingDigest),
      outstanding_findings: regression.outstandingFindings.map(findingDigest),
    },
  });
}

/**
 * Diff this scan against the previous completed scan of the same target.
 * Returns null when the diff could not be run at all (no persisted row to
 * exclude, or the lookup threw), which is different from "ran and found
 * nothing new": a null result sends no alert and no `scan.regressed` event,
 * rather than claiming a clean diff.
 */
async function runRegressionCheck(
  params: ScanNotificationParams,
): Promise<RegressionCheckResult | null> {
  if (params.scanId === null) return null;
  try {
    return await checkForNewCriticalOrHighFindings({
      userId: params.userId,
      url: params.target.value,
      scanId: params.scanId,
      currentFindings: params.findings,
    });
  } catch (error) {
    console.error(`[${APP_NAME}] Regression check failed:`, {
      target: params.target.value,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function sendScanEmails(
  params: ScanNotificationParams,
  regression: RegressionCheckResult | null,
): Promise<void> {
  const { rows } = await pool.query<{ email: string }>(
    "SELECT email FROM users WHERE id = $1",
    [params.userId],
  );
  if (rows.length === 0) return;
  const userEmail = rows[0].email;

  if (!params.silenceRoutineEmail) {
    try {
      await sendNotificationEmail({
        userId: params.userId,
        userEmail,
        type: "scan_complete",
        emailContent: scanCompleteEmail(
          params.target.value,
          params.summary,
          params.duration,
          params.scanId ?? undefined,
        ),
      });
    } catch (error) {
      console.error(
        `[${APP_NAME}] Failed to send scan complete email:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // The crawl path used to send its own copy of this email inline. That copy
  // was deleted rather than left in place beside this one, so the alert has
  // exactly one producer and a crawl cannot double-send it.
  if (regression?.hasNewCriticalOrHigh === true) {
    try {
      await sendNotificationEmail({
        userId: params.userId,
        userEmail,
        type: "severity_alerts",
        emailContent: criticalFindingsEmail(
          params.target.value,
          regression.newFindings,
          regression.outstandingFindings,
          params.scanId ?? undefined,
        ),
      });
    } catch (error) {
      console.error(
        `[${APP_NAME}] Failed to send critical findings email:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

interface WebhookRow {
  id: number;
  url: string;
  type: string;
  secret: string | null;
}

async function deliverScanWebhooks(
  params: ScanNotificationParams,
  regression: RegressionCheckResult | null,
): Promise<void> {
  // Both the scan owner's own webhooks AND any webhook assigned to the team
  // this scan belongs to. Team-assigned webhooks were once never delivered
  // (the query filtered on user_id only), so a webhook shared to a team fired
  // only for its creator's scans. The subquery resolves the scan's team_id
  // (NULL for a personal scan, so the team clause matches nothing there), and
  // a webhook matching both clauses is still one row, so it fires once.
  const { rows } = await pool.query<WebhookRow>(
    `SELECT id, url, type, secret FROM webhooks
         WHERE active = true
           AND (
             user_id = $1
             OR team_id = (SELECT team_id FROM scan_history WHERE id = $2)
           )`,
    [params.userId, params.scanId],
  );

  await Promise.all(
    rows.map(async (row) => {
      const target = {
        id: row.id,
        userId: params.userId,
        url: row.url,
        type: row.type,
        secret: row.secret ?? null,
      };
      // Signed (HMAC-SHA256 of the body via the webhook's own secret, sent as
      // X-VulnRadar-Signature: sha256=<hex>), logged to webhook_deliveries and
      // retried once on failure. deliverWebhook re-validates the URL through
      // safeFetch's SSRF check before every attempt, so no separate
      // validateScanTarget call belongs here.
      try {
        await deliverWebhook(
          target,
          SCAN_COMPLETED_EVENT,
          buildScanCompletedBody(row.type, params),
        );
      } catch (err) {
        console.error(`[${APP_NAME}] Webhook delivery failed`, {
          event: SCAN_COMPLETED_EVENT,
          type: row.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (regression?.hasNewCriticalOrHigh !== true) return;
      try {
        await deliverWebhook(
          target,
          SCAN_REGRESSED_EVENT,
          buildScanRegressedBody(row.type, params, regression),
        );
      } catch (err) {
        console.error(`[${APP_NAME}] Webhook delivery failed`, {
          event: SCAN_REGRESSED_EVENT,
          type: row.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}

/**
 * Run the whole notification tail for one finished scan. Never rejects and
 * never throws: every branch is individually guarded so one broken receiver
 * or one unreachable SMTP server cannot take down another notification, let
 * alone the scan that produced them.
 *
 * Callers detach it (`void notifyScanComplete(...)`) because a webhook is
 * allowed to take up to 25 seconds of retry and a scan must not wait on that.
 * It still returns a promise so a test can await the whole tail deterministically.
 */
export async function notifyScanComplete(
  params: ScanNotificationParams,
): Promise<void> {
  // One diff, two consumers: the critical/high email and the scan.regressed
  // webhook event. Running it twice would double the queries and could
  // disagree with itself if a scan landed in between.
  const regression = await runRegressionCheck(params);

  const results = await Promise.allSettled([
    sendScanEmails(params, regression),
    deliverScanWebhooks(params, regression),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`[${APP_NAME}] Scan notification tail failed:`, {
        target: params.target.value,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  }
}
