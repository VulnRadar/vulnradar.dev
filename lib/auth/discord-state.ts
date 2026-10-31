import { randomBytes } from "node:crypto";
import {
  CONFIG_DISCORD_OAUTH_STATE_TTL_SECONDS,
  CONFIG_OAUTH_STATE_CLOCK_SKEW_SECONDS,
} from "@/lib/config/config-values";
import {
  openEnvelope,
  resolveStateSecret,
  sealEnvelope,
} from "@/lib/auth/signed-envelope";

/**
 * HMAC-signed OAuth state for Discord (H-5).
 *
 * Format: `base64url(JSON({nonce,action,userId,ts})).base64url(HMAC-SHA256(payload, secret))`,
 * sealed and opened by lib/auth/signed-envelope.ts.
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

// NOT admin-configurable (see NEVER_CONFIGURABLE in lib/config/registry.ts):
// this is the anti-replay window on the signed state token, and widening it
// at runtime weakens CSRF/replay protection on a login flow.
const STATE_TTL_MS = CONFIG_DISCORD_OAUTH_STATE_TTL_SECONDS * 1000;

const getStateSecret = () => resolveStateSecret("discord-state");

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
  return sealEnvelope(full, getStateSecret);
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
  const opened = openEnvelope(state, getStateSecret);
  if (!opened.ok) return opened;
  const payload = opened.payload as DiscordStatePayload;
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
  // auth: reject timestamps more than CLOCK_SKEW_MS in the future. Without
  // this, a state issued with `Date.now() + 60_000` would still pass the
  // TTL check and live for an extra minute; a much-larger clock skew
  // would let it live indefinitely. NOT admin-configurable (see
  // NEVER_CONFIGURABLE in lib/config/registry.ts).
  const CLOCK_SKEW_MS = CONFIG_OAUTH_STATE_CLOCK_SKEW_SECONDS * 1000;
  if (payload.ts - Date.now() > CLOCK_SKEW_MS) {
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

/**
 * Name of the short-lived httpOnly cookie that binds a Discord SIGN-IN
 * (`action=login`) to the browser that started it, the twin of
 * OAUTH_NONCE_COOKIE in lib/auth/oauth-state.ts.
 *
 * The userId binding above only fires when the state actually carries a
 * userId, which a logged-out sign-in never does. That left the sign-in flow
 * with no browser binding at all: an attacker could start the flow while
 * signed out, approve at Discord, capture the callback URL without following
 * it, and lure a victim to that URL inside the state's TTL. The HMAC verifies
 * (the server minted it), the login branch resolves the ATTACKER's account,
 * and createSession overwrites the victim's own session cookie: a silent
 * login CSRF / session fixation.
 *
 * The start route stores the state's nonce here and the callback requires it
 * to match before the login branch runs, so a state replayed into a browser
 * that never started the flow is rejected.
 */
export const DISCORD_NONCE_COOKIE = "vr_discord_nonce";
