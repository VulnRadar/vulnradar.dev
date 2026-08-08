import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Async scrypt runs on the libuv threadpool. scryptSync pins the event loop
// for the full ~650ms of a single hash, which stalls every other request the
// server is handling, so only the async form is exported from this module.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options?: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Password hashing using scrypt (built-in, no extra dependency).
// Hash format: "N:r:p:salt:hash". Params are stored alongside the digest so
// the cost can be raised over time without invalidating older hashes.
// Defaults match OWASP 2024+ recommendations for interactive logins.
//
// This module deliberately imports nothing but node:crypto. It used to live
// in auth.ts next to `next/headers` and the pg pool, which made it impossible
// to unit test without mocking scrypt itself, and that mock is what hid the
// maxmem bug described below.
export const SCRYPT_N = 1 << 17; // 131072. Bumped from 16384 in the 2.3.0 release.
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 64;

// OpenSSL allocates 128 * r * (N + p + 2) bytes, not the textbook 128 * N * r.
// For N=2^17, r=8 that is 128.0029 MiB, so the flat `128 * 1024 * 1024` ceiling
// shipped in 2.3.x was ~3 KiB short and made every scrypt call throw
// ERR_CRYPTO_INVALID_SCRYPT_PARAMS ("memory limit exceeded"), which broke
// signup outright. Deriving the ceiling from the real formula means bumping
// N, r, or p can never reintroduce that off-by-a-hair failure.
export function scryptMaxmem(n: number, r: number, p: number): number {
  return 128 * r * (n + p + 2) * 2; // 2x for allocator overhead
}

// Guard rail for params read back out of a stored hash. A corrupted or
// tampered row must not be able to demand an arbitrarily large allocation.
const SCRYPT_MAX_N = 1 << 20;
const SCRYPT_MAX_R = 32;
const SCRYPT_MAX_P = 16;

function scryptOpts(n: number, r: number = SCRYPT_R, p: number = SCRYPT_P) {
  return { N: n, r, p, maxmem: scryptMaxmem(n, r, p) } as const;
}

function paramsInRange(n: number, r: number, p: number): boolean {
  return (
    Number.isInteger(n) &&
    n >= 2 &&
    (n & (n - 1)) === 0 && // scrypt requires N to be a power of two
    n <= SCRYPT_MAX_N &&
    Number.isInteger(r) &&
    r >= 1 &&
    r <= SCRYPT_MAX_R &&
    Number.isInteger(p) &&
    p >= 1 &&
    p <= SCRYPT_MAX_P
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (
    await scryptAsync(password, salt, SCRYPT_KEYLEN, scryptOpts(SCRYPT_N))
  ).toString("hex");
  return `${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${hash}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  // An OAuth-created account can have no password_hash at all (see
  // lib/auth/auth.ts's createOAuthUser). Every caller that gates an action
  // behind "confirm your current password" ends up here with whatever the
  // users row has, so a null/absent hash must fail the check rather than
  // throw -- there is nothing to match against, which is exactly what a
  // wrong password should also produce.
  if (!stored) return false;

  const parts = stored.split(":");

  if (parts.length !== 5) {
    // Legacy format "salt:hash" — verify with Node's historical defaults.
    const [salt, hash] = parts;
    if (!salt || !hash) return false;
    const hashBuffer = Buffer.from(hash, "hex");
    if (hashBuffer.length !== SCRYPT_KEYLEN) return false;
    const suppliedBuffer = await scryptAsync(password, salt, SCRYPT_KEYLEN);
    return timingSafeEqual(hashBuffer, suppliedBuffer);
  }

  const [nStr, rStr, pStr, salt, hash] = parts;
  const n = Number.parseInt(nStr, 10);
  const r = Number.parseInt(rStr, 10);
  const p = Number.parseInt(pStr, 10);

  // Reject params outside the supported envelope rather than handing them to
  // OpenSSL, so a malformed row fails the login instead of throwing a 500.
  if (!paramsInRange(n, r, p)) return false;
  if (!salt || !hash) return false;

  const hashBuffer = Buffer.from(hash, "hex");
  // Length is checked before timingSafeEqual, which throws on a mismatch.
  if (hashBuffer.length !== SCRYPT_KEYLEN) return false;

  // maxmem is derived from the stored params, not the current defaults, so a
  // hash written by a future higher-cost config still verifies.
  const suppliedBuffer = await scryptAsync(
    password,
    salt,
    SCRYPT_KEYLEN,
    scryptOpts(n, r, p),
  );
  return timingSafeEqual(hashBuffer, suppliedBuffer);
}

/** True when the stored hash was written with weaker params than current. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 5) return true; // legacy format
  const n = Number.parseInt(parts[0], 10);
  const r = Number.parseInt(parts[1], 10);
  const p = Number.parseInt(parts[2], 10);
  if (!paramsInRange(n, r, p)) return true;
  return n < SCRYPT_N || r < SCRYPT_R || p < SCRYPT_P;
}
