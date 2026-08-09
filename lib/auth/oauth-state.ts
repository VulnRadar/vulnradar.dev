import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed OAuth state for the sign-up/sign-in providers (Google,
 * GitHub, Discord). Mirrors lib/auth/discord-state.ts's proven pattern
 * (same HMAC construction, same secret resolution, same timing-safe
 * compare) but is a separate module on purpose: keeping it separate means
 * this file can change without touching, or risking, the existing Discord
 * account-linking flow.
 *
 * `purpose` distinguishes a fresh sign-in/sign-up (the default -- omitted
 * entirely, so every previously-issued state and every existing test still
 * decodes the same way) from Google/GitHub account-linking: an
 * already-logged-in user attaching a provider identity to their existing
 * account (app/api/v3/auth/oauth/[provider]/route.ts's `?action=link`,
 * completed in .../callback/route.ts). `userId` is only ever set for a
 * "link" state and binds it to the session that requested it, the same
 * replay protection lib/auth/discord-state.ts already applies to its own
 * "connect" action.
 *
 * Format: `base64url(JSON({nonce,provider,ts,purpose?,userId?})).base64url(HMAC-SHA256(payload, secret))`
 */

// 5 minutes: generous enough to complete a provider's consent screen
// (typing a password, picking an account, approving scopes), longer than
// discord-state.ts's 60s because that state assumes an already-signed-in
// user re-approving a link, not a full first-time OAuth handshake.
const STATE_TTL_MS = 5 * 60 * 1000;

function getStateSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.API_KEY_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "[oauth-state] Either AUTH_SECRET or API_KEY_ENCRYPTION_KEY must be " +
        "configured to sign OAuth state. Set one in .env.",
    );
  }
  return secret;
}

export interface OAuthStatePayload {
  nonce: string;
  provider: string;
  ts: number;
  /** Present and `"link"` only for the account-linking flow; absent for a
   *  normal sign-in/sign-up state. */
  purpose?: "link";
  /** The signed-in user this "link" state was issued for. Always absent
   *  for `purpose` undefined. */
  userId?: number;
  /**
   * Which button the user actually clicked -- the login page's or the
   * signup page's -- absent for a "link" state (irrelevant there).
   * "login" means the callback must only ever sign in to an EXISTING
   * account and must never create one; "signup" is the only path allowed
   * to create a new account when no match is found. Without this, both
   * pages shared one OAuth flow that always created an account on no
   * match, so clicking "Sign in with Discord" for an account whose
   * Discord identity used a different email created a second, disconnected
   * account instead of failing with "sign up first."
   */
  intent?: "login" | "signup";
}

export function signOAuthState(
  provider: string,
  options?: { purpose?: "link"; userId?: number; intent?: "login" | "signup" },
): string {
  const payload: OAuthStatePayload = {
    nonce: randomBytes(16).toString("base64url"),
    provider,
    ts: Date.now(),
    purpose: options?.purpose,
    userId: options?.userId,
    intent: options?.intent,
  };
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getStateSecret())
    .update(json)
    .digest("base64url");
  return `${json}.${sig}`;
}

export function verifyOAuthState(
  state: string,
  expectedProvider: string,
):
  | { ok: true; payload: OAuthStatePayload }
  | {
      ok: false;
      reason: "malformed" | "bad-signature" | "expired" | "provider-mismatch";
    } {
  const dot = state.lastIndexOf(".");
  if (dot < 1 || dot >= state.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const json = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac("sha256", getStateSecret()).update(json).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, reason: "bad-signature" };
  }
  if (provided.length !== expected.length) {
    return { ok: false, reason: "bad-signature" };
  }
  if (!timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad-signature" };
  }
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(json, "base64url").toString());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.provider !== "string" ||
    typeof payload.ts !== "number" ||
    typeof payload.nonce !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (Date.now() - payload.ts > STATE_TTL_MS) {
    return { ok: false, reason: "expired" };
  }
  // Reject timestamps more than 5 minutes in the future, same guard as
  // discord-state.ts: without it a forged future `ts` would extend the
  // state's effective lifetime indefinitely.
  const CLOCK_SKEW_MS = 5 * 60 * 1000;
  if (payload.ts - Date.now() > CLOCK_SKEW_MS) {
    return { ok: false, reason: "expired" };
  }
  if (payload.provider !== expectedProvider) {
    return { ok: false, reason: "provider-mismatch" };
  }
  return { ok: true, payload };
}

export const OAUTH_STATE_TTL_MS = STATE_TTL_MS;
