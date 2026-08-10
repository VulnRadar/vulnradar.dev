import { randomBytes } from "node:crypto";
import pool from "@/lib/database/db";
import { getSetting } from "@/lib/config/runtime-config";

/**
 * auth: trusted-device helper.
 *
 * Replaces the previous client-side 32-bit `deviceId` hash with an
 * opaque 256-bit random token. The token is stored in the
 * `device_trust` table keyed by `(user_id, device_fingerprint)` and
 * is only valid while the row is present and unexpired.
 */

export async function findTrustedDevice(
  userId: number,
  deviceFingerprint: string,
): Promise<boolean> {
  if (!deviceFingerprint || deviceFingerprint.length < 32) return false;
  const result = await pool.query(
    `SELECT 1 FROM device_trust
       WHERE user_id = $1
         AND device_fingerprint = $2
         AND expires_at > NOW()
       LIMIT 1`,
    [userId, deviceFingerprint],
  );
  if (result.rows.length === 0) return false;
  // Touch last_used_at so cleanup doesn't prematurely expire the row.
  await pool
    .query(
      "UPDATE device_trust SET last_used_at = NOW() WHERE user_id = $1 AND device_fingerprint = $2",
      [userId, deviceFingerprint],
    )
    .catch(() => undefined);
  return true;
}

/**
 * List this user's own trusted devices (unexpired), most recently used
 * first. Used by GET /api/v3/auth/trusted-devices. Includes
 * `device_fingerprint` -- the exact value stored in the httpOnly
 * DEVICE_TRUST_COOKIE_NAME cookie and checked verbatim by
 * findTrustedDevice() above -- so the route can determine which row is
 * "this device" by comparing it server-side. Callers MUST strip that
 * field before sending the list to the client: it is a bearer credential
 * (skips a 2FA prompt at login), not a display id, and returning it in a
 * JSON response would let any XSS on the page mint a trusted-device
 * cookie for itself.
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
    [userId, fingerprint, deviceName, ipAddress, userAgent, expiresAt],
  );
  return fingerprint;
}
