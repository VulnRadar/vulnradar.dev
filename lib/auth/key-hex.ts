/**
 * The one check for an AES-256 key spelled as hex: API_KEY_ENCRYPTION_KEY and
 * the key a rotation keeps readable.
 *
 * `Buffer.from(value, "hex")` never fails. It stops at the first character it
 * cannot read and returns what it had, so counting 64 characters proves
 * nothing: a base64 key of that length decodes to a few bytes, or to none when
 * its first character is not hex. AES then throws on the first encrypt, but
 * HMAC accepts any key length, so the signed tokens went on being issued under
 * a key short enough to compute.
 *
 * No imports, because the boot-time env schema (lib/config/env.ts) shares the
 * pattern and has to agree with what the code that uses the key will accept.
 */
export const KEY_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

export function isKeyHex(value: string | undefined): value is string {
  return value !== undefined && KEY_HEX_PATTERN.test(value);
}

/** The 32 key bytes, or a throw with `message` for anything else. */
export function parseKeyHex(
  value: string | undefined,
  message: string,
): Buffer {
  if (!isKeyHex(value)) throw new Error(message);
  return Buffer.from(value, "hex");
}

/**
 * Throws unless API_KEY_ENCRYPTION_KEY can sign. `purpose` says what was being
 * signed, in words, so the error names the flow that needed the key.
 */
export function requireSigningKey(purpose: string): Buffer {
  return parseKeyHex(
    process.env.API_KEY_ENCRYPTION_KEY,
    `API_KEY_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes) to sign ${purpose}.`,
  );
}
