// Auth flow. The extension uses API-key auth (matches main repo's
// CONFIG_API_KEY_PREFIX = "vr_live_"). Two ways to set the key:
//   1. pasteKey()    - user pastes a key from vulnradar.dev/profile
//   2. clear()       - sign out
// After pasting, validate() hits /auth/me to confirm the key works
// and to fetch the user/plan/role. Stores the result in storage.auth.

import { VULNRADAR } from "./constants";
import { api, isAuthRejection } from "./api";
import { get, set, remove } from "./storage";
import type { AuthMe } from "./types";

export function looksLikeApiKey(input: string): boolean {
  return VULNRADAR.apiKeyPattern.test(input.trim());
}

export async function loadAuth(): Promise<AuthMe | null> {
  const auth = await get("auth");
  return auth?.me ?? null;
}

export async function pasteKey(rawKey: string): Promise<AuthMe> {
  const key = rawKey.trim();
  if (!looksLikeApiKey(key)) {
    throw new Error(
      `That doesn't look like a VulnRadar API key. Expected format: vr_live_ followed by 64 hex characters.`,
    );
  }
  const result = await api.me(key);
  await set("auth", { apiKey: key, me: result.body });
  return result.body;
}

export async function clear(): Promise<void> {
  await remove("auth");
}

export interface RefreshMeResult {
  readonly me: AuthMe | null;
  /** True when an API key is stored but the most recent /me call failed
   *  for a reason other than the key being rejected (network error,
   *  timeout, 5xx, or any other non-2xx status). Lets the UI show
   *  "Failed to connect" instead of "Not connected" - the key is
   *  presumably fine, VulnRadar's API just didn't answer. */
  readonly connectionFailed: boolean;
}

/**
 * Re-validates the stored key against /me.
 *   - No key stored: { me: null, connectionFailed: false } - genuinely
 *     not connected.
 *   - Key rejected as invalid (401/403): clears storage and returns
 *     { me: null, connectionFailed: false } - also "not connected",
 *     the user needs to paste a working key.
 *   - Any other failure (network error, timeout, 5xx): storage is left
 *     alone and this returns { me: null, connectionFailed: true } - the
 *     key is likely fine, the API just didn't respond.
 * Used at extension startup to detect stale keys.
 */
export async function refreshMe(): Promise<RefreshMeResult> {
  const auth = await get("auth");
  if (!auth) return { me: null, connectionFailed: false };
  try {
    const result = await api.me(auth.apiKey);
    await set("auth", { apiKey: auth.apiKey, me: result.body });
    return { me: result.body, connectionFailed: false };
  } catch (err) {
    if (isAuthRejection(err)) {
      await clear();
      return { me: null, connectionFailed: false };
    }
    return { me: null, connectionFailed: true };
  }
}
