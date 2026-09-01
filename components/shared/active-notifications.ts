"use client";

import { apiGet } from "@/lib/api/client";

/**
 * One fetch of /api/v3/notifications/active, shared by the two components that
 * need it.
 *
 * Both the notification bell (components/shared/notification-center.tsx) and
 * the site-notification banner (components/shared/site-notifications.tsx) are
 * mounted in the root layout, and both used to issue their own request for the
 * same payload with the same two params, then each throw away the types the
 * other wanted. That doubled the request count and the database work for site
 * notifications on every page view in the app, including anonymous visitors on
 * the marketing pages.
 *
 * The audience params are part of the cache key because the server filters on
 * them: a signed-out and a signed-in caller get genuinely different payloads.
 */

/** Only the shape this module needs; callers narrow to their own type. */
interface ActiveNotificationLike {
  type: string;
}

const DEDUPE_MS = 30_000;

let cacheKey: string | null = null;
let cacheAt = 0;
let cached: ActiveNotificationLike[] | null = null;
let inflightKey: string | null = null;
let inflight: Promise<ActiveNotificationLike[]> | null = null;

/**
 * @param force bypass the dedupe window. The bell's poll timer passes this so
 *              a scheduled refresh is a real refresh; a second component
 *              mounting alongside it is not.
 */
export function fetchActiveNotifications<T extends ActiveNotificationLike>(
  authenticated: boolean,
  staff: boolean,
  force = false,
): Promise<T[]> {
  const params = new URLSearchParams({
    authenticated: authenticated ? "true" : "false",
    staff: staff ? "true" : "false",
  });
  const key = params.toString();

  if (!force) {
    if (cached && cacheKey === key && Date.now() - cacheAt < DEDUPE_MS) {
      return Promise.resolve(cached as T[]);
    }
    if (inflight && inflightKey === key) {
      return inflight as Promise<T[]>;
    }
  }

  const promise = apiGet<
    ActiveNotificationLike[] | { notifications?: unknown }
  >(`/api/v3/notifications/active?${key}`)
    .then((data) => {
      // The route returns the array directly. The object form is tolerated
      // because the banner wrapper used to accept it and a self-hoster on an
      // older build may still be serving it.
      const list = Array.isArray(data)
        ? data
        : ((data as { notifications?: ActiveNotificationLike[] })
            .notifications ?? []);
      cacheKey = key;
      cacheAt = Date.now();
      cached = list;
      return list;
    })
    .finally(() => {
      if (inflightKey === key) {
        inflight = null;
        inflightKey = null;
      }
    });

  inflightKey = key;
  inflight = promise;
  return promise as Promise<T[]>;
}

/** Drops the shared cache. Used by tests and by an explicit reload. */
export function clearActiveNotificationsCache() {
  cacheKey = null;
  cacheAt = 0;
  cached = null;
  inflightKey = null;
  inflight = null;
}
