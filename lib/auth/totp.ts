import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TOTP_ISSUER } from "@/lib/config/constants";
import { CONFIG_TOTP_VERIFY_WINDOW } from "@/lib/config/config-values";

// Generate a random base32 secret
export function generateSecret(): string {
  const bytes = randomBytes(20);
  return base32Encode(bytes);
}

// Verify a TOTP code (checks current and +/- `window` steps) using a
// constant-time compare so the comparison doesn't leak which window matched
// via timing. `window`'s default is NOT admin-configurable (see
// NEVER_CONFIGURABLE in lib/config/registry.ts): it's a brute-force/drift
// tradeoff on the second factor itself, and every caller relies on this
// same default since none passes an explicit window.
// Verify a code and return WHICH time-step counter it matched (or null).
// Callers that enforce single-use replay prevention must key their guard on
// the matched counter, not the current wall-clock step: a code is valid for
// `window` steps on either side, so recording the wall-clock step would let
// the same code be replayed once per step it stays valid for.
export function verifyTOTPWithCounter(
  secret: string,
  token: string,
  timeStep = 30,
  window = CONFIG_TOTP_VERIFY_WINDOW,
): { valid: boolean; counter: number | null } {
  // Normalize input — TOTP codes are always 6 digits
  if (typeof token !== "string" || !/^\d{6}$/.test(token)) {
    // Still do a comparison against a dummy token to keep the timing path
    // similar regardless of whether the input shape was valid.
    const dummy = hotpGenerate(
      secret,
      Math.floor(Date.now() / 1000 / timeStep),
    );
    timingSafeEqual(Buffer.from(dummy), Buffer.from(dummy));
    return { valid: false, counter: null };
  }

  const time = Math.floor(Date.now() / 1000 / timeStep);
  const actual = Buffer.from(token, "utf8");
  // Compare against every candidate (no early return) so all paths take the
  // same time; keep the highest matching counter if more than one collides.
  let matchedCounter: number | null = null;
  for (let i = -window; i <= window; i++) {
    const counter = time + i;
    const candidate = Buffer.from(hotpGenerate(secret, counter), "utf8");
    if (
      candidate.length === actual.length &&
      timingSafeEqual(candidate, actual)
    ) {
      matchedCounter = counter;
    }
  }
  return { valid: matchedCounter !== null, counter: matchedCounter };
}

export function verifyTOTP(
  secret: string,
  token: string,
  timeStep = 30,
  window = CONFIG_TOTP_VERIFY_WINDOW,
): boolean {
  return verifyTOTPWithCounter(secret, token, timeStep, window).valid;
}

// Generate the current 6-digit code for a secret (companion to verifyTOTP,
// used by enrollment self-checks and tests).
export function generateTOTP(
  secret: string,
  timeStep = 30,
  atMs = Date.now(),
): string {
  return hotpGenerate(secret, Math.floor(atMs / 1000 / timeStep));
}

// Generate the otpauth:// URI for QR code generation
export function generateOtpAuthUri(
  secret: string,
  email: string,
  issuer = TOTP_ISSUER,
): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// HOTP implementation
function hotpGenerate(secret: string, counter: number): string {
  const decodedSecret = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  let tmp = counter;
  for (let i = 7; i >= 0; i--) {
    buffer[i] = tmp & 0xff;
    tmp = Math.floor(tmp / 256);
  }

  const hmac = createHmac("sha1", decodedSecret);
  hmac.update(buffer);
  const hmacResult = hmac.digest();

  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const code =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  return (code % 1000000).toString().padStart(6, "0");
}

// Base32 encoding/decoding
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const cleanInput = input.replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of cleanInput) {
    const idx = BASE32_CHARS.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
