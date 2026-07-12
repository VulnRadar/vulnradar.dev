// Auth flow. The extension uses API-key auth (matches main repo's
// CONFIG_API_KEY_PREFIX = "vr_live_"). Two ways to set the key:
//   1. pasteKey()    - user pastes a key from sandbox.vulnradar.dev/profile
//   2. clear()       - sign out
// After pasting, validate() hits /auth/me to confirm the key works
// and to fetch the user/plan/role. Stores the result in storage.auth.

import { VULNRADAR } from "./constants";
import { api, VulnRadarApiError } from "./api";
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

/**
 * Re-validates the stored key against /me. Returns the latest user
 * info on success, or null + clears storage on failure (key revoked,
 * account deleted, network error). Used at extension startup to
 * detect stale keys.
 */
export async function refreshMe(): Promise<AuthMe | null> {
  const auth = await get("auth");
  if (!auth) return null;
  try {
    const result = await api.me(auth.apiKey);
    await set("auth", { apiKey: auth.apiKey, me: result.body });
    return result.body;
  } catch (err) {
    if (
      err instanceof VulnRadarApiError &&
      (err.status === 401 || err.status === 403)
    ) {
      await clear();
    }
    return null;
  }
}
