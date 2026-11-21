import type { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { ApiResponse } from "@/lib/api/api-utils";
import { decryptApiKey } from "@/lib/auth/crypto";
import { verifyTOTPWithCounter } from "@/lib/auth/totp";
import { verifyReauthAgainstHash } from "@/lib/auth/reauth";
import { isEmailConfigured } from "@/lib/email/email";
import {
  SECOND_FACTOR_MESSAGES,
  SECOND_FACTOR_REQUIRED,
  type SecondFactorKind,
} from "@/lib/auth/staff-second-factor-kind";

/**
 * A second factor in front of the two staff powers that reach furthest:
 * applying an update, which runs code on the host, and impersonation, which
 * signs in as a customer. ENFORCE_STAFF_2FA ships off, and with it off both
 * asked for the staff password and nothing more, so one stolen staff
 * password was enough for either. This runs after verifyReauthPassword and
 * ignores that setting: the setting decides who reaches the panel at all,
 * this decides who may do these two things in it.
 *
 * What counts as the second factor depends on how the account signs in:
 *
 * - An authenticator app: a current code from it, checked by the same
 *   verifier and single-use step counter the sign-in route uses, so a code
 *   already spent at sign-in (or here) within its step is refused. Backup
 *   codes are not taken: they exist to get back into an account, and one
 *   written on paper beside the password is not a second factor.
 * - Email codes, on an account with a password: the step-up cookie
 *   POST /auth/2fa/verify { purpose: "reauth" } sets after a fresh mailed
 *   code, for this user on this session.
 * - Email codes, on an account with no password: refused. For that account
 *   the same cookie already stood in for the password, so the mailbox would
 *   be both factors.
 */

export { SECOND_FACTOR_REQUIRED, SECOND_FACTOR_MESSAGES };
export type { SecondFactorKind };

export type StaffSecondFactorResult =
  { ok: true } | { ok: false; secondFactor: SecondFactorKind; error: string };

const SIX_DIGITS = /^\d{6}$/;

interface FactorRow {
  password_hash: string | null;
  totp_enabled: boolean | null;
  totp_secret: string | null;
  two_factor_method: string | null;
}

function refuse(
  secondFactor: SecondFactorKind,
  error: string,
): StaffSecondFactorResult {
  return { ok: false, secondFactor, error };
}

/**
 * Spend one TOTP time step for this account: true when `counter` is past the
 * last one used, which is then recorded; false for a replay. Locked, so two
 * requests with the same code cannot both pass. The same rule
 * POST /auth/2fa/verify applies at sign-in, on the same column, so a code
 * used there cannot be used again here and the reverse.
 */
export async function consumeTotpStep(
  userId: number,
  counter: number,
): Promise<boolean> {
  const step = BigInt(counter);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      "SELECT totp_last_counter FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const last = res.rows[0]?.totp_last_counter;
    if (last !== null && last !== undefined && BigInt(last) >= step) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      "UPDATE users SET totp_last_counter = $1 WHERE id = $2",
      [String(step), userId],
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function verifyTotp(
  userId: number,
  row: FactorRow,
  body: Record<string, unknown>,
): Promise<StaffSecondFactorResult> {
  const code = body.totpCode;
  if (typeof code !== "string" || !SIX_DIGITS.test(code)) {
    return refuse("totp", SECOND_FACTOR_MESSAGES.totpMissing);
  }
  // Legacy "plain:" seeds are refused at sign-in too, never trusted.
  if (!row.totp_secret || row.totp_secret.startsWith("plain:")) {
    return refuse("totp", SECOND_FACTOR_MESSAGES.totpBroken);
  }
  let secret: string;
  try {
    secret = decryptApiKey(row.totp_secret);
  } catch {
    return refuse("totp", SECOND_FACTOR_MESSAGES.totpBroken);
  }
  const result = verifyTOTPWithCounter(secret, code);
  if (!result.valid || result.counter === null) {
    return refuse("totp", SECOND_FACTOR_MESSAGES.totpWrong);
  }
  if (!(await consumeTotpStep(userId, result.counter))) {
    return refuse("totp", SECOND_FACTOR_MESSAGES.totpReplayed);
  }
  return { ok: true };
}

/**
 * The mailed step-up, read through the re-auth helper's own cookie check so
 * there is one verifier for it. Passing no stored hash is what sends
 * verifyReauthAgainstHash to that check. Mail has to be working: without it
 * the helper takes a fresh sign-in instead of the cookie, and a sign-in is
 * the first factor, not a second one.
 */
async function verifyEmailStepUp(
  userId: number,
): Promise<StaffSecondFactorResult> {
  if (!isEmailConfigured()) {
    return refuse("authenticator", SECOND_FACTOR_MESSAGES.noMail);
  }
  const stepUp = await verifyReauthAgainstHash(userId, null, undefined, {
    missing: SECOND_FACTOR_MESSAGES.emailMissing,
    wrong: SECOND_FACTOR_MESSAGES.emailMissing,
  });
  return stepUp.ok
    ? { ok: true }
    : refuse("email", SECOND_FACTOR_MESSAGES.emailMissing);
}

/**
 * The second factor for the signed-in staff account. Call it after
 * verifyReauthPassword has passed. `body` is the request body: an
 * authenticator code travels as `totpCode`, the email step-up as its cookie.
 * Fails closed on a missing users row.
 */
export async function verifyStaffSecondFactor(
  session: { userId: number },
  body: unknown,
): Promise<StaffSecondFactorResult> {
  const { rows } = await pool.query<FactorRow>(
    "SELECT password_hash, totp_enabled, totp_secret, two_factor_method FROM users WHERE id = $1",
    [session.userId],
  );
  const row = rows[0];
  if (!row || row.totp_enabled !== true) {
    return refuse("none", SECOND_FACTOR_MESSAGES.none);
  }
  if (row.two_factor_method === "email") {
    if (!row.password_hash) {
      return refuse("authenticator", SECOND_FACTOR_MESSAGES.authenticator);
    }
    return verifyEmailStepUp(session.userId);
  }
  const fields =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return verifyTotp(session.userId, row, fields);
}

/** The 403 for a refusal: the message, SECOND_FACTOR_REQUIRED and the factor. */
export function secondFactorRefusal(
  result: Extract<StaffSecondFactorResult, { ok: false }>,
): NextResponse {
  return ApiResponse.forbidden(result.error, {
    code: SECOND_FACTOR_REQUIRED,
    secondFactor: result.secondFactor,
  });
}
