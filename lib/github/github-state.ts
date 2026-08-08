import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed OAuth state for the GitHub repo-connect flow.
 *
 * This is a SEPARATE flow from any identity-only "Sign in with GitHub"
 * OAuth: an already-logged-in user connects their GitHub account so
 * VulnRadar can read their repo source for a security scan. It shares no
 * code path, cookie, or state format with that other flow — mirrors the
 * shape of lib/auth/discord-state.ts (HMAC-signed, short TTL, optional
 * userId binding) but is namespaced with a fixed `purpose` field baked
 * into the signed payload.
 *
 * Format: `base64url(JSON({purpose,nonce,ts,userId})).base64url(HMAC-SHA256(payload, secret))`
 *
 * Why a `purpose` field instead of just reusing discord-state.ts's shape:
 * both modules can derive their HMAC key from the same shared secret
 * (AUTH_SECRET / API_KEY_ENCRYPTION_KEY). Without a namespace baked into
 * the signed payload, a state value minted for one OAuth flow would also
 * verify successfully against another flow's verifier, since the
 * signature alone doesn't say which flow it was issued for. `purpose` is
 * checked with a strict equality, so a state minted here can never be
 * replayed against a different flow's callback even if that flow reused
 * the same secret.
 */

const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough to complete the GitHub consent screen
const STATE_PURPOSE = "github-connect-v1";

function getStateSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.API_KEY_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "[github-state] Either AUTH_SECRET or API_KEY_ENCRYPTION_KEY must be " +
        "configured to sign OAuth state. Set one in .env.",
    );
  }
  return secret;
}

export interface GithubStatePayload {
  purpose: typeof STATE_PURPOSE;
  nonce: string;
  ts: number;
  userId: number;
}

/**
 * Sign a state token bound to the connecting user's session. Unlike
 * discord-state.ts, userId is required (not optional): this flow only
 * ever runs for an already-logged-in user (Part 1 of the feature spec —
 * "an already-logged-in user connects"), there is no anonymous variant.
 */
export function signGithubState(userId: number): string {
  const payload: GithubStatePayload = {
    purpose: STATE_PURPOSE,
    nonce: randomBytes(16).toString("base64url"),
    ts: Date.now(),
    userId,
  };
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getStateSecret())
    .update(json)
    .digest("base64url");
  return `${json}.${sig}`;
}

export function verifyGithubState(
  state: string,
  expectedUserId: number,
):
  | { ok: true; payload: GithubStatePayload }
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

  let payload: GithubStatePayload;
  try {
    payload = JSON.parse(Buffer.from(json, "base64url").toString());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.purpose !== STATE_PURPOSE ||
    typeof payload.nonce !== "string" ||
    typeof payload.ts !== "number" ||
    typeof payload.userId !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (Date.now() - payload.ts > STATE_TTL_MS) {
    return { ok: false, reason: "expired" };
  }
  // Reject timestamps far in the future — see the identical guard (and
  // rationale) in lib/auth/discord-state.ts.
  const CLOCK_SKEW_MS = 5 * 60 * 1000;
  if (payload.ts - Date.now() > CLOCK_SKEW_MS) {
    return { ok: false, reason: "expired" };
  }

  if (payload.userId !== expectedUserId) {
    return { ok: false, reason: "user-mismatch" };
  }

  return { ok: true, payload };
}

/** Cookie carrying the state value between the connect and callback routes. */
export const GITHUB_CONNECT_STATE_COOKIE = "github_connect_state";

export const GITHUB_CONNECT_STATE_TTL_MS = STATE_TTL_MS;
