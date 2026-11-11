import { createHash, randomBytes } from "node:crypto";
import pool from "@/lib/database/db";
import { getSetting } from "@/lib/config/runtime-config";

/**
 * auth: trusted-device helper.
 *
 * The cookie carries an opaque 256-bit random token; the `device_trust` row
 * keyed by `(user_id, device_fingerprint)` holds only its SHA-256, and the
 * token is valid while that row is present and unexpired. The token skips the
 * second factor, so storing it raw (as this table did, unlike sessions) made a
 * database read a 2FA bypass for every account with a remembered browser.
 * Rows written before the hash hold the raw value, which no cookie hashes to,
 * so they stop working at once and age out at their expires_at.
 */

/** What device_trust.device_fingerprint holds for a cookie value. */
export function hashDeviceFingerprint(cookieValue: string): string {
  return createHash("sha256").update(cookieValue).digest("hex");
}

export async function findTrustedDevice(
  userId: number,
  deviceFingerprint: string,
): Promise<boolean> {
  if (!deviceFingerprint || deviceFingerprint.length < 32) return false;
  const stored = hashDeviceFingerprint(deviceFingerprint);
  const result = await pool.query(
    `SELECT 1 FROM device_trust
       WHERE user_id = $1
         AND device_fingerprint = $2
         AND expires_at > NOW()
       LIMIT 1`,
    [userId, stored],
  );
  if (result.rows.length === 0) return false;
  // Touch last_used_at so cleanup doesn't prematurely expire the row.
  await pool
    .query(
      "UPDATE device_trust SET last_used_at = NOW() WHERE user_id = $1 AND device_fingerprint = $2",
      [userId, stored],
    )
    .catch(() => undefined);
  return true;
}

/**
 * List this user's own trusted devices (unexpired), most recently used
 * first. Used by GET /api/v3/auth/trusted-devices. Includes
 * `device_fingerprint`, the SHA-256 of the httpOnly DEVICE_TRUST_COOKIE_NAME
 * cookie, so the route can find "this device" by comparing it with
 * hashDeviceFingerprint(cookie) server-side. Callers still strip that field
 * before sending the list to the client: it is no longer a credential, but
 * it is not a display id either, and it names the row the cookie unlocks.
 */
export async function listTrustedDevices(userId: number): Promise<
  Array<{
    id: number;
    device_fingerprint: string;
    device_name: string | null;
    ip_address: string | null;
    user_agent: string | null;
    last_used_at: string;
    created_at: string;
    expires_at: string;
  }>
> {
  const result = await pool.query(
    `SELECT id, device_fingerprint, device_name, ip_address, user_agent, last_used_at, created_at, expires_at
       FROM device_trust
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY last_used_at DESC`,
    [userId],
  );
  return result.rows;
}

/**
 * Revoke exactly one of this user's own trusted devices. The WHERE
 * clause enforces ownership at the query level -- it can never delete a
 * row belonging to another user_id, regardless of what `id` is passed.
 * Returns false when no matching row existed for that user.
 */
export async function revokeTrustedDevice(
  userId: number,
  id: number,
): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM device_trust WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function upsertTrustedDevice(
  userId: number,
  deviceName: string | null,
  ipAddress: string,
  userAgent: string,
): Promise<string> {
  const fingerprint = randomBytes(32).toString("hex");
  // auth: DEVICE_TRUST_DAYS is how long a device may skip the second
  // factor (the DB row's expires_at, checked by findTrustedDevice above).
  // The cookie carrying `fingerprint` gets its own, separately
  // admin-configurable Max-Age via DEVICE_TRUST_MAX_AGE_DAYS at the call
  // site (app/api/v3/auth/2fa/verify/route.ts).
  const deviceTrustDays = await getSetting("DEVICE_TRUST_DAYS");
  const expiresAt = new Date(
    Date.now() + deviceTrustDays * 24 * 60 * 60 * 1000,
  );
  await pool.query(
    `INSERT INTO device_trust
       (user_id, device_fingerprint, device_name, ip_address, user_agent, last_used_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6)
     ON CONFLICT (user_id, device_fingerprint) DO UPDATE
       SET last_used_at = NOW(),
           expires_at = EXCLUDED.expires_at,
           ip_address = EXCLUDED.ip_address,
           user_agent = EXCLUDED.user_agent`,
    [
      userId,
      hashDeviceFingerprint(fingerprint),
      deviceName,
      ipAddress,
      userAgent,
      expiresAt,
    ],
  );
  // The raw token goes only into the cookie.
  return fingerprint;
}
