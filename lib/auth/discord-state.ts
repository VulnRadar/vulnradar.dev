import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed OAuth state for Discord (H-5).
 *
 * Format: `base64url(JSON({nonce,action,userId,ts})).base64url(HMAC-SHA256(payload, secret))`
 *
 * The previous implementation base64url-encoded the payload without a
 * signature, so any caller who observed a `state` value (or guessed one)
 * could forge a callback to log in as a different linked user. The HMAC
 * ties the payload to a server-side secret.
 *
 * Binding: when the caller has a session, the userId is included in the
 * signed payload and `verifyDiscordState` rejects any state whose userId
 * doesn't match. This prevents an attacker who shares/leaks the state
 * URL from replaying it on behalf of a different signed-in user.
 */

const STATE_TTL_MS = 60 * 1000; // 60 seconds (tight enough to limit replay)

function getStateSecret(): string {
  // The namespace used to be a hardcoded `"vulnradar-discord-state-v1"`
  // string. Anyone who read the source could forge a state value if it
  // was used as the HMAC key. Fail closed — require one of the real secrets.
  const secret = process.env.AUTH_SECRET || process.env.API_KEY_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "[discord-state] Either AUTH_SECRET or API_KEY_ENCRYPTION_KEY must be " +
        "configured to sign OAuth state. Set one in .env.",
    );
  }
  return secret;
}

export interface DiscordStatePayload {
  nonce: string;
  action: string;
  ts: number;
  // Optional user binding — when set, verify() rejects mismatches so
  // a state URL shared with another signed-in user can't be replayed.
  userId?: number;
}

export function signDiscordState(
  payload: Omit<DiscordStatePayload, "nonce" | "ts"> &
    Partial<Pick<DiscordStatePayload, "nonce" | "ts">>,
): string {
  const full: DiscordStatePayload = {
    nonce: payload.nonce ?? randomBytes(16).toString("base64url"),
    action: payload.action,
    ts: payload.ts ?? Date.now(),
    userId: payload.userId,
  };
  const json = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", getStateSecret())
    .update(json)
    .digest("base64url");
  return `${json}.${sig}`;
}

export function verifyDiscordState(
  state: string,
  expectedUserId?: number,
):
  | { ok: true; payload: DiscordStatePayload }
  | {
      ok: false;
      reason: "malformed" | "bad-signature" | "expired" | "user-mismatch";
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
  let payload: DiscordStatePayload;
  try {
    payload = JSON.parse(Buffer.from(json, "base64url").toString());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.action !== "string" ||
    typeof payload.ts !== "number" ||
    typeof payload.nonce !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (Date.now() - payload.ts > STATE_TTL_MS) {
    return { ok: false, reason: "expired" };
  }
  if (
    typeof expectedUserId === "number" &&
    payload.userId !== undefined &&
    payload.userId !== expectedUserId
  ) {
    return { ok: false, reason: "user-mismatch" };
  }
  return { ok: true, payload };
}

export const DISCORD_STATE_TTL_MS = STATE_TTL_MS;
