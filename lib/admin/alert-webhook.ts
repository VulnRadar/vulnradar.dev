/**
 * Outbound alert webhook for critical system events an operator should
 * find out about without keeping /admin open (AUDIT-010, production-
 * readiness #4: "everything is pull-based"). Disabled unless an admin sets
 * ADMIN_ALERT_WEBHOOK_URL -- no vendor SDK, no account to create; the URL
 * can point at Slack's/Discord's own incoming-webhook endpoint, PagerDuty,
 * or any SIEM ingester that accepts a POST.
 *
 * Deliberately a single best-effort attempt, unlike lib/webhooks/delivery.ts's
 * customer-facing webhooks (one retry + a webhook_deliveries audit row):
 * the event that triggered an alert is already logged wherever it happened
 * (console.error, captured into system_error_logs by
 * lib/database/error-log-capture.ts), so this is a push notification on
 * top of an already-durable record, not the record itself.
 */
import { signWebhookPayload } from "@/lib/webhooks/delivery";
import { validateScanTarget, safeFetch } from "@/lib/scanner/safe-fetch";
import { getSetting } from "@/lib/config/runtime-config";
import { APP_NAME } from "@/lib/config/constants";

const DELIVERY_TIMEOUT_MS = 10000;

export type AdminAlertSeverity = "critical" | "warning";

export interface AdminAlert {
  /** Short machine-readable event name, e.g. "boot_schema_failure". */
  event: string;
  severity: AdminAlertSeverity;
  /** One-line, human-readable summary -- this is what actually renders in Slack/Discord. */
  message: string;
  /** Optional structured detail (table names, counts, ids). Never raw driver/stack text -- see the same redaction rule error-log-capture.ts follows. */
  context?: Record<string, unknown>;
}

/** What actually happened to one alert delivery. */
export type AdminAlertResult =
  { delivered: true; status: number } | { delivered: false; reason: string };

/**
 * Fire an admin alert. No-op (and no network call at all) when no webhook
 * URL is configured. Never throws -- a failed alert must not be able to
 * fail whatever critical-path code triggered it in the first place.
 *
 * Reports a result rather than returning void, so a caller can tell the
 * operator what happened. Every escalation path in the app routes through
 * here and the setting ships empty, so someone who pastes in a Slack or
 * PagerDuty URL had no way to confirm it works: a typo, a revoked webhook,
 * or a URL validateScanTarget now rejects all produced a silent no-op whose
 * only trace was a console.error in a log they would have to already be
 * reading. The first sign of trouble was the incident the alert existed for
 * (AUDIT-012#obs-11). Existing fire-and-forget callers ignore the return
 * value and are unaffected.
 */
export async function sendAdminAlert(
  alert: AdminAlert,
): Promise<AdminAlertResult> {
  try {
    const url = await getSetting("ADMIN_ALERT_WEBHOOK_URL");
    if (!url) {
      return {
        delivered: false,
        reason: "No admin alert webhook URL is configured.",
      };
    }

    // Same SSRF re-validation as every other admin/operator-configured
    // outbound URL in this codebase (lib/webhooks/delivery.ts) -- an admin
    // is trusted to configure this, but re-checking costs nothing and
    // catches a URL that resolves somewhere unsafe today even if it didn't
    // when it was first saved.
    const safety = await validateScanTarget(url);
    if (!safety.safe) {
      console.error(
        `[${APP_NAME}] Admin alert webhook URL is no longer safe to reach, skipping delivery:`,
        safety.reason,
      );
      return {
        delivered: false,
        reason: `The configured URL was blocked: ${safety.reason || "unsafe target"}`,
      };
    }

    const body = JSON.stringify({
      app: APP_NAME,
      event: alert.event,
      severity: alert.severity,
      message: alert.message,
      context: alert.context ?? {},
      timestamp: new Date().toISOString(),
    });

    const secret = await getSetting("ADMIN_ALERT_WEBHOOK_SECRET");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": `${APP_NAME}-Admin-Alert/1.0`,
    };
    if (secret) {
      headers["X-VulnRadar-Signature"] =
        `sha256=${signWebhookPayload(secret, body)}`;
    }

    const res = await safeFetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(
        `[${APP_NAME}] Admin alert webhook responded with ${res.status}`,
      );
      return {
        delivered: false,
        reason: `The endpoint responded with HTTP ${res.status}.`,
      };
    }
    return { delivered: true, status: res.status };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[${APP_NAME}] Failed to deliver admin alert (non-fatal):`,
      reason,
    );
    return { delivered: false, reason };
  }
}
