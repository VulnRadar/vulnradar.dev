import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import pool from "@/lib/database/db";

/**
 * The 6-digit codes kept in email_2fa_codes, one kind per `purpose`:
 *
 *   login  - the second factor at sign-in (login, OAuth and Discord callbacks)
 *   reauth - the step-up a password-less account enters before a security
 *            change (lib/auth/reauth.ts)
 *   setup  - the confirmation that an inbox gets our mail before email codes
 *            are turned on
 *
 * A code only ever verifies for its own purpose, and issuing one only replaces
 * codes of the same purpose. Without that, a step-up code mailed to a signed-in
 * account would also finish a pending sign-in for it, and asking for one code
 * would silently cancel another in flight.
 */
export type EmailCodePurpose = "login" | "reauth" | "setup";

function hashCode(salt: string, code: string): string {
  // L-2: salted, because the 6-digit space is small enough to table.
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

export type IssueResult =
  { ok: true; code: string } | { ok: false; retryAfterSeconds: number };

/**
 * Store a fresh code for this purpose and return it for mailing, or refuse
 * while the last one of this purpose is younger than the resend cooldown.
 */
export async function issueEmailCode(
  userId: number,
  purpose: EmailCodePurpose,
  expiryMinutes: number,
  cooldownSeconds: number,
): Promise<IssueResult> {
  const recent = await pool.query(
    "SELECT created_at FROM email_2fa_codes WHERE user_id = $1 AND purpose = $3 AND created_at > NOW() - ($2 * INTERVAL '1 second') ORDER BY created_at DESC LIMIT 1",
    [userId, cooldownSeconds, purpose],
  );
  if (recent.rows.length > 0) {
    return { ok: false, retryAfterSeconds: cooldownSeconds };
  }

  await pool.query(
    "DELETE FROM email_2fa_codes WHERE user_id = $1 AND purpose = $2",
    [userId, purpose],
  );

  const code = randomInt(100000, 1000000).toString();
  const salt = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO email_2fa_codes (user_id, code_hash, code_salt, expires_at, purpose) VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 minute'), $5)",
    [userId, hashCode(salt, code), salt, expiryMinutes, purpose],
  );
  return { ok: true, code };
}

/**
 * True exactly once for a live code of this purpose. The hash is compared in
 * Node with timingSafeEqual, and the matched row is deleted with RETURNING so
 * two concurrent requests with the same code cannot both pass: the second one
 * deletes nothing.
 */
export async function consumeEmailCode(
  userId: number,
  purpose: EmailCodePurpose,
  code: string,
): Promise<boolean> {
  const candidates = await pool.query<{
    id: number;
    code_salt: string;
    code_hash: string;
  }>(
    `SELECT id, code_salt, code_hash FROM email_2fa_codes
     WHERE user_id = $1
       AND purpose = $2
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 5`,
    [userId, purpose],
  );
  let matchedId: number | null = null;
  for (const row of candidates.rows) {
    const expected = Buffer.from(hashCode(row.code_salt, code), "hex");
    const stored = Buffer.from(row.code_hash ?? "", "hex");
    if (
      row.code_hash &&
      expected.length === stored.length &&
      timingSafeEqual(expected, stored)
    ) {
      matchedId = row.id;
      break;
    }
  }
  if (matchedId === null) return false;
  const deleted = await pool.query<{ id: number }>(
    "DELETE FROM email_2fa_codes WHERE id = $1 RETURNING id",
    [matchedId],
  );
  return deleted.rows.length > 0;
}

/** "us***@example.com", the only form of the address a code screen shows. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.substring(0, 2)}***@${domain}`;
}
