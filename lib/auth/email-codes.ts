import { randomBytes, randomInt } from "node:crypto";
import pool from "@/lib/database/db";
import { hashOneTimeCode, oneTimeCodeMatches } from "@/lib/auth/one-time-code";

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
  return {
    ok: true,
    code: await storeEmailCode(userId, purpose, expiryMinutes),
  };
}

/**
 * Replace this purpose's codes with a fresh one and return it for mailing,
 * with no resend cooldown. The sign-in paths (the password sign-in and the
 * OAuth and Discord callbacks) issue through this: each sign-in that reaches
 * the second step mails its own code. They used to hand-roll the DELETE and
 * the INSERT, which left the purpose to the column default and drew the code
 * from randomInt(100000, 999999), whose upper bound is exclusive, so 999999
 * was never sent.
 */
export async function storeEmailCode(
  userId: number,
  purpose: EmailCodePurpose,
  expiryMinutes: number,
): Promise<string> {
  await pool.query(
    "DELETE FROM email_2fa_codes WHERE user_id = $1 AND purpose = $2",
    [userId, purpose],
  );

  const code = randomInt(100000, 1000000).toString();
  const salt = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO email_2fa_codes (user_id, code_hash, code_salt, expires_at, purpose) VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 minute'), $5)",
    [userId, hashOneTimeCode(salt, code), salt, expiryMinutes, purpose],
  );
  return code;
}

/**
 * True exactly once for a live code of this purpose. The keyed digest is
 * compared in Node (lib/auth/one-time-code.ts), and the matched row is
 * deleted with RETURNING so
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
    if (oneTimeCodeMatches(row.code_hash, row.code_salt, code)) {
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
