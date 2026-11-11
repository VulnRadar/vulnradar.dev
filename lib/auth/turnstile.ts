import { logError } from "@/lib/logging/log";

export const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * How long the siteverify call may take. The contact form, support tickets and
 * signup each had their own copy of this call with no timeout, so a Cloudflare
 * that accepted the connection and went quiet held every one of those requests
 * open for as long as the socket lived.
 */
export const TURNSTILE_TIMEOUT_MS = 10_000;

/**
 * Said when the check could not be run at all, which is not the sender's
 * fault and is worth retrying. Kept apart from the failed-token message so
 * nobody is told their captcha was wrong when Cloudflare never answered.
 */
export const TURNSTILE_UNAVAILABLE_MESSAGE =
  "We could not verify the captcha just now. Please try again.";

export type TurnstileResult =
  { ok: true } | { ok: false; status: 400 | 503; error: string };

/**
 * Verify a Turnstile token with Cloudflare. Callers decide whether Turnstile
 * is enabled (TURNSTILE_ENABLED); this only answers whether the token passed.
 *
 * Never throws. A missing or rejected token is a 400; a timeout, a network
 * failure, an error status or a reply that is not JSON is a 503, because the
 * old unguarded `.json()` turned a Cloudflare HTML error page into a 500.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string | null | undefined,
): Promise<TurnstileResult> {
  const response = typeof token === "string" ? token.trim() : "";
  if (!response) {
    return {
      ok: false,
      status: 400,
      error: "Captcha verification required.",
    };
  }

  let data: unknown;
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response,
        ...(ip ? { remoteip: ip } : {}),
      }),
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    if (!res.ok) {
      logError("turnstile", "siteverify answered with an error status", null, {
        status: res.status,
      });
      return { ok: false, status: 503, error: TURNSTILE_UNAVAILABLE_MESSAGE };
    }
    data = await res.json();
  } catch (err) {
    // A timeout, a network failure, or a reply that is not JSON.
    logError("turnstile", "siteverify gave no usable answer", err);
    return { ok: false, status: 503, error: TURNSTILE_UNAVAILABLE_MESSAGE };
  }

  const success =
    typeof data === "object" &&
    data !== null &&
    (data as { success?: unknown }).success === true;
  if (!success) {
    return {
      ok: false,
      status: 400,
      error: "Captcha verification failed. Please try again.",
    };
  }
  return { ok: true };
}
