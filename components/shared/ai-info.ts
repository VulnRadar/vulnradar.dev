"use client";

import { apiGet } from "@/lib/api/client";
import { API } from "@/lib/config/client-constants";

/**
 * One fetch of /ai/info, shared by the three places that ask whether AI is
 * available: the floating chat widget (mounted in the root layout, so on every
 * page), the dashboard page and the scan actions menu. A dashboard page view
 * used to issue the same request two or three times in the first second.
 *
 * The response is not the same for everyone. `aiDisabled` is the signed-in
 * user's own opt-out, resolved from the session cookie, so the cache is keyed
 * by who is asking. Without that, an anonymous answer fetched on the login
 * page would be served to the same tab seconds after sign-in and a user who
 * switched AI off would be shown AI actions. The window is short for the same
 * reason: it only has to cover one page load, not hold a setting.
 */

export interface AiInfo {
  configured: boolean;
  model: string;
  provider: string;
  aiDisabled?: boolean;
}

const DEDUPE_MS = 10_000;

let cachedFor: number | null | undefined;
let cachedAt = 0;
let cached: AiInfo | null = null;
let inflightFor: number | null | undefined;
let inflight: Promise<AiInfo> | null = null;

/**
 * @param viewer the signed-in user's id, or null for an anonymous caller.
 * @param force  bypass the dedupe window.
 */
export function fetchAiInfo(
  viewer: number | null,
  force = false,
): Promise<AiInfo> {
  if (!force) {
    if (cached && cachedFor === viewer && Date.now() - cachedAt < DEDUPE_MS) {
      return Promise.resolve(cached);
    }
    if (inflight && inflightFor === viewer) {
      return inflight;
    }
  }

  const promise = apiGet<AiInfo>(API.AI_INFO)
    .then((info) => {
      cachedFor = viewer;
      cachedAt = Date.now();
      cached = info;
      return info;
    })
    .finally(() => {
      if (inflight === promise) {
        inflight = null;
        inflightFor = undefined;
      }
    });

  inflightFor = viewer;
  inflight = promise;
  return promise;
}

/** Whether AI features should be offered, from a /ai/info payload. */
export function isAiAvailable(info: AiInfo): boolean {
  return Boolean(info.configured) && !info.aiDisabled;
}

/** Drops the shared cache. Used by tests and after the opt-out changes. */
export function clearAiInfoCache() {
  cachedFor = undefined;
  cachedAt = 0;
  cached = null;
  inflightFor = undefined;
  inflight = null;
}
