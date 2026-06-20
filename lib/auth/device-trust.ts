import { randomBytes } from "node:crypto";
import pool from "@/lib/database/db";
import { DEVICE_TRUST_MAX_AGE } from "@/lib/config/constants";

/**
 * H-3: Trusted-device helper.
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

export async function upsertTrustedDevice(
  userId: number,
  deviceName: string | null,
  ipAddress: string,
  userAgent: string,
): Promise<string> {
  const fingerprint = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + DEVICE_TRUST_MAX_AGE * 1000);
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
