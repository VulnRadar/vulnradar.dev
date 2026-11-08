/**
 * The parts of a webhook delivery a receiver depends on. Kept apart from
 * delivery.ts, which pulls in the database and the mailer, so /docs/webhooks
 * can state these numbers from the code instead of retyping them.
 */
import { randomUUID } from "node:crypto";

export const DELIVERY_TIMEOUT_MS = 10000;
export const RETRY_DELAY_MS = 5000;

// A test send is a POST our server makes to an address the caller chose, on
// request, as often as they click. These two bound it from each end: what one
// account can send, and what any number of accounts can send to one place.
export const TEST_SEND_USER_LIMIT = { maxAttempts: 10, windowSeconds: 600 };
export const TEST_SEND_TARGET_LIMIT = { maxAttempts: 30, windowSeconds: 3600 };

/** Header carrying the signature; value is `sha256=<hex>`, the same shape
 *  GitHub and Stripe use so existing webhook libraries can verify it. */
export const SIGNATURE_HEADER = "X-VulnRadar-Signature";
/** `t=<unix>,v1=<hex>`, the signature over `<unix>.<body>`. It is what lets a
 *  receiver refuse a replayed delivery. The header above signs the body alone
 *  and stays exactly as it is for every receiver already checking it. */
export const SIGNATURE_V2_HEADER = "X-VulnRadar-Signature-V2";
/** One id per delivery, the same on its retry, so a receiver can drop a repeat. */
export const DELIVERY_HEADER = "X-VulnRadar-Delivery";
export const EVENT_HEADER = "X-VulnRadar-Event";
export const ATTEMPT_HEADER = "X-VulnRadar-Attempt";
export const TIMESTAMP_HEADER = "X-VulnRadar-Timestamp";

/**
 * The version of the webhook payload. It moves on its own schedule: a receiver
 * must not break because the REST API went from v3 to v4.
 */
export const WEBHOOK_API_VERSION = "1";

/** What every generic JSON body carries at its top level. */
export interface DeliveryEnvelope {
  id: string;
  created_at: string;
  api_version: string;
}

/** `id` is also the delivery's X-VulnRadar-Delivery value. */
export function newDeliveryEnvelope(): DeliveryEnvelope {
  return {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    api_version: WEBHOOK_API_VERSION,
  };
}
