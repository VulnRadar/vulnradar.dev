import { isPublicScanId, parseIdParam } from "@/lib/api/path-id";
import { resolveScanRow } from "@/lib/history/resolve-scan";
import { getScanResourceAccess } from "@/lib/teams/scan-teams";

/**
 * Turn an id a caller already holds (an old numeric one from a bookmark or a
 * `?scan=` link, or the public one) into the public id, for the one caller
 * entitled to it.
 *
 * Only for a scan the caller owns or reads through a team, decided by the same
 * access check GET /history/[id] uses. Anything else answers null, and a scan
 * that does not exist answers null too, so "missing" and "not yours" cannot be
 * told apart.
 *
 * It must never answer merely because a scan is public. A numeric-to-public
 * map for other people's scans is exactly the enumeration oracle the opaque id
 * exists to prevent: with it anyone could walk the sequential ids and collect
 * the public id of every public scan on the instance.
 */
export async function resolvePublicIdForCaller(
  userId: number,
  rawId: string,
): Promise<string | null> {
  if (!isPublicScanId(rawId) && parseIdParam(rawId) === null) return null;

  const scan = await resolveScanRow(rawId);
  if (!scan?.public_id) return null;

  const access = await getScanResourceAccess(userId, scan);
  return access.canRead ? scan.public_id : null;
}
