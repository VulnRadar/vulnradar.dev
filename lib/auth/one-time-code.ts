import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { serverHashKey } from "@/lib/auth/token-hash";
import { logError } from "@/lib/logging/log";
import { globalSingleton } from "@/lib/runtime/global-singleton";

/**
 * The stored digest of an emailed six-digit code: the email two-factor codes
 * in email_2fa_codes (sign-in, step-up, inbox check) and the billing
 * verification codes.
 *
 * These used to be sha256("<salt>:<code>") with the salt in the next column.
 * The salt stops a precomputed table, but a six-digit code has 10^6 values,
 * so anyone who could read the row recovered the code with a loop, and with
 * the password that finishes email two-factor (enc-13). Keyed with the
 * server secret, the row alone gives nothing.
 *
 * With neither AUTH_SECRET nor API_KEY_ENCRYPTION_KEY set it falls back to
 * the old unkeyed digest rather than breaking sign-in, and says so once.
 */

const unkeyedWarning = globalSingleton(
  "vulnradar.one-time-code.unkeyed-warning",
  () => ({ logged: false }),
);

export function hashOneTimeCode(salt: string, code: string): string {
  const message = `${salt}:${code}`;
  const key = serverHashKey();
  if (!key) {
    if (!unkeyedWarning.logged) {
      unkeyedWarning.logged = true;
      logError(
        "auth",
        "neither AUTH_SECRET nor API_KEY_ENCRYPTION_KEY is set, so emailed one-time codes are stored as an unkeyed sha256",
      );
    }
    return createHash("sha256").update(message).digest("hex");
  }
  return createHmac("sha256", key).update(message).digest("hex");
}

/**
 * True when `code` is the one `storedHex` was made from with this salt.
 * Compared with timingSafeEqual, and false for a missing, empty or malformed
 * digest or salt rather than a throw, so a bad row reads as a wrong code.
 */
export function oneTimeCodeMatches(
  storedHex: string | null | undefined,
  salt: string | null | undefined,
  code: string,
): boolean {
  if (!storedHex || !salt || !/^[0-9a-f]{64}$/i.test(storedHex)) return false;
  const expected = Buffer.from(hashOneTimeCode(salt, code), "hex");
  const stored = Buffer.from(storedHex, "hex");
  return expected.length === stored.length && timingSafeEqual(expected, stored);
}
