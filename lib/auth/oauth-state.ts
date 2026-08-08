import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed OAuth state for the sign-up/sign-in providers (Google,
 * GitHub, Discord). Mirrors lib/auth/discord-state.ts's proven pattern
 * (same HMAC construction, same secret resolution, same timing-safe
 * compare) but is a separate module on purpose: this state has no
 * `action` ("connect" vs "login") or `userId` binding because this flow
 * never links a provider onto an already-signed-in user's account --
 * every callback either creates a new account or logs in an existing one
 * by verified email. Keeping it separate also means this file can change
 * without touching, or risking, the existing Discord account-linking flow.
 *
 * Format: `base64url(JSON({nonce,provider,ts})).base64url(HMAC-SHA256(payload, secret))`
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
}

export function signOAuthState(provider: string): string {
  const payload: OAuthStatePayload = {
    nonce: randomBytes(16).toString("base64url"),
    provider,
    ts: Date.now(),
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
