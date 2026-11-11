import type { NextRequest } from "next/server";
import { AUTH_2FA_PENDING_COOKIE } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { verifyPendingToken } from "@/lib/auth/pending-2fa";

/**
 * The three cookies that say "the first factor passed, the second is next":
 * a password login, a Discord sign-in, and a Google/GitHub/Discord OAuth
 * sign-in. Each is a signed { userId, ts } (lib/auth/pending-2fa.ts).
 */
export const DISCORD_PENDING_COOKIE = "discord_pending_login";
export const OAUTH_PENDING_COOKIE = "oauth_pending_login";

export const PENDING_COOKIE_NAMES = [
  AUTH_2FA_PENDING_COOKIE,
  DISCORD_PENDING_COOKIE,
  OAUTH_PENDING_COOKIE,
] as const;

export type PendingCookieName = (typeof PENDING_COOKIE_NAMES)[number];

/** The pending cookies a route setting `name` must clear in the same response. */
export function otherPendingCookies(name: PendingCookieName): string[] {
  return PENDING_COOKIE_NAMES.filter((other) => other !== name);
}

export type PendingUser =
  | { ok: true; userId: number; cookieName: PendingCookieName }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "expired"; cookieName: PendingCookieName };

/**
 * Whose second factor this request is for.
 *
 * email-send and verify used to answer this in opposite orders (password
 * cookie first in one, the provider cookies first in the other), so a browser
 * holding two of them had its code mailed to one account and checked against
 * the other, and the sign-in failed with nothing to explain why. Both now ask
 * here, and the answer is the most recent first factor: the validly signed
 * cookie with the newest `ts`. Setting one cookie clears the other two, so
 * this only matters for a stale leftover, and the newest is the sign-in the
 * person is in the middle of.
 */
export async function resolvePendingUser(
  request: NextRequest,
): Promise<PendingUser> {
  let newest: { userId: number; ts: number; name: PendingCookieName } | null =
    null;
  for (const name of PENDING_COOKIE_NAMES) {
    const payload = verifyPendingToken<{ userId?: unknown; ts?: unknown }>(
      request.cookies.get(name)?.value,
    );
    if (
      !payload ||
      typeof payload.userId !== "number" ||
      typeof payload.ts !== "number"
    ) {
      continue;
    }
    if (!newest || payload.ts > newest.ts) {
      newest = { userId: payload.userId, ts: payload.ts, name };
    }
  }
  if (!newest) return { ok: false, reason: "missing" };

  const maxAgeMs = (await getSetting("2FA_PENDING_MAX_AGE_SECONDS")) * 1000;
  if (Date.now() - newest.ts > maxAgeMs) {
    return { ok: false, reason: "expired", cookieName: newest.name };
  }
  return { ok: true, userId: newest.userId, cookieName: newest.name };
}
