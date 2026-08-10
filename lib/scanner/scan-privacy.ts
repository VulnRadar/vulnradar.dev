/**
 * Resolves whether a new scan should publish to the public host_reputation
 * cache and the public /host/[hostname] page.
 *
 * Shared by every path that creates a scan_history row and needs to fill in
 * its `is_public` column: app/api/v3/scan/route.ts, app/api/v3/scan/crawl/
 * route.ts, and lib/scanner/scheduled-scans-worker.ts. (app/api/v3/scan/
 * authenticated/route.ts deliberately does NOT use this -- see its own
 * comment for why an authenticated scan gets a stricter, account-setting-
 * independent default instead.)
 */

import { APP_NAME } from "@/lib/config/constants";
import pool from "@/lib/database/db";

/**
 * `requestedIsPublic` is the caller's explicit choice for this one scan --
 * the pre-scan "Keep this scan private" toggle (components/scanner/
 * scan-form.tsx) or an API client's own `isPublic` field. When it is an
 * actual boolean, it always wins: that is the entire point of a per-scan
 * override.
 *
 * When it is `undefined` (the field was never in the request body -- an
 * older API client, a re-scan triggered without going through the toggle,
 * or a scheduled run with no per-scan UI at all), this falls back to the
 * account-level `users.scans_private_by_default` setting (see
 * components/profile/tabs/profile-privacy-tab.tsx and
 * PUT /api/v3/account/privacy), so an account that opted into "private by
 * default" gets that behavior everywhere a scan can start, not only from
 * the one form that happens to send the flag.
 *
 * Fails closed: if the lookup itself fails (DB hiccup), the scan is
 * treated as private rather than silently falling through to public --
 * a lookup failure should never be the reason a scan's findings end up on
 * a public page.
 */
export async function resolveScanIsPublic(
  userId: number,
  requestedIsPublic: boolean | undefined,
): Promise<boolean> {
  if (typeof requestedIsPublic === "boolean") return requestedIsPublic;

  try {
    const result = await pool.query<{
      scans_private_by_default: boolean;
    }>("SELECT scans_private_by_default FROM users WHERE id = $1", [userId]);
    return !(result.rows[0]?.scans_private_by_default ?? false);
  } catch (err) {
    console.error(
      `[${APP_NAME}] Failed to resolve the account's scan-privacy default; defaulting this scan to private:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
