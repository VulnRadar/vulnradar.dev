/**
 * Webhook delivery: HMAC signing, one attempt + one retry, and a
 * webhook_deliveries audit row for every attempt.
 *
 * AUDIT-00X follow-up. Previously (lib/scanner/execute-scan.ts) a webhook
 * POST was pure fire-and-forget: no signature (a receiver had no way to
 * prove a payload actually came from VulnRadar), and the response was
 * never inspected, so a receiver returning 500 or timing out was
 * completely invisible. This module fixes both without turning a
 * best-effort notification into a guaranteed-delivery queue -- one retry,
 * a lean per-attempt log row (status + short snippet, never the full
 * body), and an email if both attempts fail.
 */
import { createHmac } from "node:crypto";
import pool from "@/lib/database/db";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { validateScanTarget, safeFetch } from "@/lib/scanner/safe-fetch";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { webhookDeliveryFailedEmail } from "@/lib/email/email";

const DELIVERY_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 5000;
const RESPONSE_SNIPPET_MAX = 500;

/** Header carrying the signature; value is `sha256=<hex>`, the same shape
 *  GitHub and Stripe use so existing webhook libraries can verify it. */
export const SIGNATURE_HEADER = "X-VulnRadar-Signature";

export interface WebhookDeliveryTarget {
  id: number;
  userId: number;
  url: string;
  type: string;
  /** null for a legacy row that predates signing, or a direct-DB insert
   *  that bypassed the app's secret generation. Delivery still happens,
   *  just unsigned, rather than dropping the notification outright. */
  secret: string | null;
}

interface DeliveryAttempt {
  ok: boolean;
  httpStatus: number | null;
  responseSnippet: string;
}

/**
 * HMAC-SHA256 of the exact bytes being sent, hex-encoded. Exported so the
 * signature can be computed and verified independently in tests (and by a
 * receiver implementing their own check) without re-running a delivery.
 */
export function signWebhookPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

async function attemptDelivery(
  webhook: WebhookDeliveryTarget,
  body: string,
): Promise<DeliveryAttempt> {
  // SSRF guard: re-validate the registered webhook URL through safeFetch
  // before POSTing. The URL was checked at registration (and at edit
  // time), but DNS / routing may have changed since, and safeFetch also
  // blocks redirects to private IPs.
  const safety = await validateScanTarget(webhook.url);
  if (!safety.safe) {
    return {
      ok: false,
      httpStatus: null,
      responseSnippet: `Blocked: ${safety.reason || "unsafe URL"}`,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": `${APP_NAME}-Webhook/1.0`,
  };
  if (webhook.secret) {
    headers[SIGNATURE_HEADER] =
      `sha256=${signWebhookPayload(webhook.secret, body)}`;
  }

  try {
    const res = await safeFetch(webhook.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    const snippet = res.ok
      ? ""
      : (await res.text().catch(() => "")).slice(0, RESPONSE_SNIPPET_MAX);
    return { ok: res.ok, httpStatus: res.status, responseSnippet: snippet };
  } catch (err) {
    return {
      ok: false,
      httpStatus: null,
      responseSnippet: (err instanceof Error ? err.message : String(err)).slice(
        0,
        RESPONSE_SNIPPET_MAX,
      ),
    };
  }
}

async function logDelivery(
  webhookId: number,
  eventType: string,
  attempt: DeliveryAttempt,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO webhook_deliveries (webhook_id, event_type, http_status, response_snippet)
       VALUES ($1, $2, $3, $4)`,
      [
        webhookId,
        eventType,
        attempt.httpStatus,
        attempt.responseSnippet || null,
      ],
    );
  } catch (err) {
    console.error(`[${APP_NAME}] Failed to record webhook delivery log`, {
      webhookId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function notifyDeliveryFailed(
  webhook: WebhookDeliveryTarget,
  first: DeliveryAttempt,
  retry: DeliveryAttempt,
): Promise<void> {
  try {
    const userResult = await pool.query<{ email: string }>(
      "SELECT email FROM users WHERE id = $1",
      [webhook.userId],
    );
    if (userResult.rows.length === 0) return;

    const emailContent = webhookDeliveryFailedEmail(webhook.url, {
      firstStatus: first.httpStatus,
      retryStatus: retry.httpStatus,
      manageUrl: `${APP_URL}/profile?tab=developer&dtab=webhooks`,
    });
    await sendNotificationEmail({
      userId: webhook.userId,
      userEmail: userResult.rows[0].email,
      type: "webhook_failures",
      emailContent,
    });
  } catch (err) {
    console.error(`[${APP_NAME}] Failed to send webhook failure notification`, {
      webhookId: webhook.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Delivers one webhook payload with a single retry: on network error,
 * an SSRF block, or a non-2xx response, wait RETRY_DELAY_MS and try
 * exactly once more. Every attempt gets its own webhook_deliveries row --
 * that's the fix for a receiver returning 500 being invisible. If both
 * attempts fail, the webhook_failures notification email fires. This is
 * intentionally not a backoff/retry-queue system: a fire-and-forget scan
 * notification doesn't need guaranteed delivery, just visibility when it
 * fails.
 */
export async function deliverWebhook(
  webhook: WebhookDeliveryTarget,
  eventType: string,
  body: string,
): Promise<void> {
  const first = await attemptDelivery(webhook, body);
  await logDelivery(webhook.id, eventType, first);
  if (first.ok) return;

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

  const retry = await attemptDelivery(webhook, body);
  await logDelivery(webhook.id, eventType, retry);
  if (retry.ok) return;

  await notifyDeliveryFailed(webhook, first, retry);
}
