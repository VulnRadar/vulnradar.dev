import { createHash } from "node:crypto";
import { findTrustedDevice } from "@/lib/auth/device-trust";
import { getRateLimit } from "@/lib/rate-limiting/rate-limit";

/**
 * The per-address sign-in lock. The login route fills it on every failed
 * password and empties it on a successful one; a password reset empties it
 * too (app/api/v3/auth/reset-password), which is why the key lives here
 * rather than in the route.
 *
 * Keyed on the submitted address, hashed, rather than on users.id: only a
 * real account could ever have had an id-keyed counter, which made the lock
 * message proof the address exists. Hashed so the rate-limit table does not
 * become a list of every address anyone has tried to sign in as.
 */
function addressDigest(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export function loginLockKey(email: string): string {
  return `login-fail:${addressDigest(email)}`;
}

/** The one-shot key that keeps the lock alert to one email an hour. */
export function loginLockAlertKey(email: string): string {
  return `login-fail-alert:${addressDigest(email)}`;
}

/**
 * How much larger the per-ACCOUNT failed-login bucket is than the per-IP one.
 * Derived rather than a second registry key so an operator tuning the login
 * limit moves both together and the two can never drift into the state where
 * one IP's whole allowance is exactly enough to lock an account out.
 */
const ACCOUNT_LOCK_ATTEMPT_MULTIPLIER = 5;
const ACCOUNT_LOCK_WINDOW_MULTIPLIER = 4;

export async function resolveAccountLockLimit(): Promise<{
  maxAttempts: number;
  windowSeconds: number;
}> {
  const { maxAttempts, windowSeconds } = await getRateLimit("login");
  return {
    maxAttempts: maxAttempts * ACCOUNT_LOCK_ATTEMPT_MULTIPLIER,
    windowSeconds: windowSeconds * ACCOUNT_LOCK_WINDOW_MULTIPLIER,
  };
}

/**
 * Whether a sign-in may go past a full bucket: the right password, sent from
 * a browser this account already trusts (ATK-8). Anyone who knows an address
 * can fill its bucket from a few source addresses and refill it every window,
 * so as a hard gate it kept the real owner out for as long as someone cared
 * to. A trusted-device cookie is a 256-bit token an attacker filling the
 * bucket does not hold, so letting it through costs the lock nothing against
 * the brute force it is there for.
 *
 * The device is looked up whenever a cookie is sent, before the password
 * result is consulted. Looking it up only after a correct password would make
 * a locked address answer a right guess one query slower than a wrong one,
 * which is the brute force again, read off the clock instead of the status.
 * An address with no account looks up user id 0, which no row has.
 */
export async function passesAccountLock({
  userId,
  passwordValid,
  deviceCookie,
}: {
  userId: number | null;
  passwordValid: boolean;
  deviceCookie: string | undefined;
}): Promise<boolean> {
  if (!deviceCookie) return false;
  const trusted = await findTrustedDevice(userId ?? 0, deviceCookie);
  return userId !== null && passwordValid && trusted;
}
