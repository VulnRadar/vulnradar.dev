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
import { createHmac, randomUUID } from "node:crypto";
import pool from "@/lib/database/db";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { validateScanTarget, safeFetch } from "@/lib/scanner/safe-fetch";
import { safeReadBody } from "@/lib/scanner/read-bounded-body";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { webhookDeliveryFailedEmail } from "@/lib/email/email";
import { readWebhookSecret } from "@/lib/webhooks/secret";

import {
  ATTEMPT_HEADER,
  DELIVERY_HEADER,
  DELIVERY_TIMEOUT_MS,
  EVENT_HEADER,
  RETRY_DELAY_MS,
  SIGNATURE_HEADER,
  SIGNATURE_V2_HEADER,
  TIMESTAMP_HEADER,
} from "@/lib/webhooks/delivery-contract";

export { SIGNATURE_HEADER };

const RESPONSE_SNIPPET_MAX = 500;

// A receiver's error body is whatever it chooses to send, for as long as it
// chooses to send it. Read without a bound, a 500 that streams forever pinned
// the delivery, and on the test route the request that triggered it.
const RESPONSE_READ_MAX_BYTES = 512;
const RESPONSE_READ_TIMEOUT_MS = 3000;

export interface WebhookDeliveryTarget {
  id: number;
  /** The webhook's creator, the one person who can fix it. Not the person
   *  whose scan this is: on a team webhook those differ, and the failure
   *  email used to go to whichever teammate ran the scan. */
  ownerUserId: number;
  /** The scan belongs to someone other than the creator. */
  teammateScan?: boolean;
  url: string;
  type: string;
  /** The stored `webhooks.secret` column value, which is encrypted at rest
   *  since AUDIT-009#webhook-01. Callers pass the column through untouched;
   *  readWebhookSecret() below turns it back into the raw signing secret.
   *  null for a legacy row that predates signing, or a direct-DB insert
   *  that bypassed the app's secret generation. Delivery still happens,
   *  just unsigned, rather than dropping the notification outright. */
  secret: string | null;
}

interface DeliveryAttempt {
  ok: boolean;
  httpStatus: number | null;
  responseSnippet: string;
}

interface DeliveryIdentity {
  id: string;
  event: string;
  attempt: number;
}

/**
 * HMAC-SHA256 of the exact bytes being sent, hex-encoded. Exported so the
 * signature can be computed and verified independently in tests (and by a
 * receiver implementing their own check) without re-running a delivery.
 */
export function signWebhookPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/**
 * Every header a delivery carries, for scans and the test button alike. The
 * test used to be its own unsigned POST with no User-Agent, so a receiver that
 * rejects unsigned requests failed the test while real deliveries verified.
 *
 * Built per attempt: the retry signs a fresh timestamp, or a receiver with a
 * freshness window would refuse the delivery it most needs to accept.
 */
export function buildDeliveryHeaders(
  body: string,
  signingSecret: string | null,
  delivery: DeliveryIdentity,
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": `${APP_NAME}-Webhook/1.0`,
    [DELIVERY_HEADER]: delivery.id,
    [EVENT_HEADER]: delivery.event,
    [ATTEMPT_HEADER]: String(delivery.attempt),
    [TIMESTAMP_HEADER]: timestamp,
  };
  if (signingSecret) {
    const timestamped = signWebhookPayload(
      signingSecret,
      `${timestamp}.${body}`,
    );
    headers[SIGNATURE_HEADER] =
      `sha256=${signWebhookPayload(signingSecret, body)}`;
    headers[SIGNATURE_V2_HEADER] = `t=${timestamp},v1=${timestamped}`;
  }
  return headers;
}

/** The start of a receiver's error body, read under a byte and a time bound. */
export async function readResponseSnippet(
  res: Response,
  maxChars: number,
): Promise<string> {
  const text = await safeReadBody(
    res,
    RESPONSE_READ_MAX_BYTES,
    RESPONSE_READ_TIMEOUT_MS,
  );
  return text.slice(0, maxChars);
}

async function attemptDelivery(
  webhook: WebhookDeliveryTarget,
  body: string,
  signingSecret: string | null,
  delivery: DeliveryIdentity,
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

  try {
    const res = await safeFetch(webhook.url, {
      method: "POST",
      headers: buildDeliveryHeaders(body, signingSecret, delivery),
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    const snippet = res.ok
      ? ""
      : await readResponseSnippet(res, RESPONSE_SNIPPET_MAX);
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
      [webhook.ownerUserId],
    );
    if (userResult.rows.length === 0) return;

    const emailContent = webhookDeliveryFailedEmail(webhook.url, {
      firstStatus: first.httpStatus,
      retryStatus: retry.httpStatus,
      manageUrl: `${APP_URL}/profile?tab=developer&dtab=webhooks`,
      teammateScan: webhook.teammateScan === true,
    });
    await sendNotificationEmail({
      userId: webhook.ownerUserId,
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
 *
 * `deliveryId` is the X-VulnRadar-Delivery value both attempts share. A caller
 * whose body carries an envelope passes the envelope's id, so the header and
 * the body agree.
 */
export async function deliverWebhook(
  webhook: WebhookDeliveryTarget,
  eventType: string,
  body: string,
  deliveryId: string = randomUUID(),
): Promise<void> {
  // FEATURE_WEBHOOKS gated only registration (POST /api/v3/webhooks), never
  // delivery, so turning the feature off left every already-registered
  // endpoint receiving POSTs forever. Checked here rather than at the call
  // site so every future producer inherits the kill switch, matching the
  // way POSTURE_DIGEST_ENABLED gates its own worker.
  if (!(await getSetting("FEATURE_WEBHOOKS"))) return;

  // Decrypted once for both attempts rather than per attempt: the retry
  // signs the identical bytes with the identical secret, so a second
  // decrypt would only be extra work on the failure path.
  const signingSecret = readWebhookSecret(webhook.secret);
  const delivery = { id: deliveryId, event: eventType };

  const first = await attemptDelivery(webhook, body, signingSecret, {
    ...delivery,
    attempt: 1,
  });
  await logDelivery(webhook.id, eventType, first);
  if (first.ok) return;

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

  const retry = await attemptDelivery(webhook, body, signingSecret, {
    ...delivery,
    attempt: 2,
  });
  await logDelivery(webhook.id, eventType, retry);
  if (retry.ok) return;

  await notifyDeliveryFailed(webhook, first, retry);
}
