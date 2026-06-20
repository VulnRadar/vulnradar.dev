import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed OAuth state for Discord (H-5).
 *
 * Format: `base64url(JSON({nonce,action,ts})).base64url(HMAC-SHA256(payload, secret))`
 *
 * The previous implementation base64url-encoded the payload without a
 * signature, so any caller who observed a `state` value (or guessed one)
 * could forge a callback to log in as a different linked user. The HMAC
 * ties the payload to a server-side secret.
 */

const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getStateSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.API_KEY_ENCRYPTION_KEY ||
    "vulnradar-discord-state-v1"
  );
}

export interface DiscordStatePayload {
  nonce: string;
  action: string;
  ts: number;
}

export function signDiscordState(
  payload: Omit<DiscordStatePayload, "nonce" | "ts"> &
    Partial<Pick<DiscordStatePayload, "nonce" | "ts">>,
): string {
  const full: DiscordStatePayload = {
    nonce: payload.nonce ?? randomBytes(16).toString("base64url"),
    action: payload.action,
    ts: payload.ts ?? Date.now(),
  };
  const json = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", getStateSecret())
    .update(json)
    .digest("base64url");
  return `${json}.${sig}`;
}

export function verifyDiscordState(
  state: string,
):
  | { ok: true; payload: DiscordStatePayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" } {
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
  return { ok: true, payload };
}

export const DISCORD_STATE_TTL_MS = STATE_TTL_MS;
