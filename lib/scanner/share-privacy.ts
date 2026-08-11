/**
 * Resolves whether a NEW share link should be listed in the public,
 * unauthenticated /public-scans directory.
 *
 * This is a deliberately separate mechanism from lib/scanner/scan-privacy.ts's
 * resolveScanIsPublic: that one decides scan_history.is_public, which gates
 * the per-host public cache at /host/[hostname]. This one decides
 * scan_history.share_publicly_listed, which gates GET /api/v3/public-scans
 * and the /public-scans page. A scan can be public on /host/[hostname] and
 * never listed here (or vice versa) -- the two flags don't read each other.
 *
 * Called from exactly one place: app/api/v3/history/[id]/share/route.ts's
 * POST handler, only when a share link is genuinely NEW (there wasn't a live
 * token yet). Re-fetching an already-live token, or updating its expiry,
 * never calls this -- an existing share's listing status only changes
 * through the explicit per-share toggle (PUT /api/v3/history/[id]/share/
 * publicly-listed, from the Shared page's row menu).
 */

import { APP_NAME } from "@/lib/config/constants";
import pool from "@/lib/database/db";

/**
 * `requestedPubliclyListed` is the caller's explicit choice for this one
 * share. When it is an actual boolean, it always wins.
 *
 * When it is `undefined` (no caller has ever needed to send this yet -- the
 * one-click "Share" action doesn't), this falls back to the account-level
 * `users.share_publicly_listed_by_default` setting (see
 * components/profile/tabs/profile-privacy-tab.tsx and
 * PUT /api/v3/account/share-privacy), scoped to the scan's OWNER (not
 * necessarily the person clicking "Share" -- a team admin can share on an
 * owner's behalf, and it's the owner's identity/scans that end up listed
 * publicly, so the owner's preference is the one that should apply).
 *
 * Fails closed, but the OPPOSITE direction from resolveScanIsPublic: if the
 * lookup itself fails (DB hiccup), the share is treated as NOT publicly
 * listed rather than silently falling through to listed -- a lookup failure
 * should never be the reason a share ends up in a public directory its
 * owner never got a chance to opt out of.
 */
export async function resolveSharePubliclyListed(
  userId: number,
  requestedPubliclyListed: boolean | undefined,
): Promise<boolean> {
  if (typeof requestedPubliclyListed === "boolean")
    return requestedPubliclyListed;

  try {
    const result = await pool.query<{
      share_publicly_listed_by_default: boolean;
    }>("SELECT share_publicly_listed_by_default FROM users WHERE id = $1", [
      userId,
    ]);
    // Missing row (shouldn't happen -- userId is the scan's own owner) falls
    // back to the column's own actual default (true), not the conservative
    // choice -- that conservative choice is reserved for a real lookup
    // failure below.
    return result.rows[0]?.share_publicly_listed_by_default ?? true;
  } catch (err) {
    console.error(
      `[${APP_NAME}] Failed to resolve the account's share-listing default; defaulting this share to NOT publicly listed:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
