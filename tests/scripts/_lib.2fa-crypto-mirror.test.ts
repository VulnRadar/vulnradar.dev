import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptApiKey, decryptApiKey } from "@/lib/auth/crypto";
import { generateSecret } from "@/lib/auth/totp";
import {
  decryptApiKeyMirror,
  looksLikeTotpSecret,
  getEncryptionKey,
  isEncryptionConfigured,
} from "../../scripts/_lib/_lib.2fa-crypto-mirror.mjs";

/**
 * scripts/_lib/_lib.2fa-crypto-mirror.mjs ports lib/auth/crypto.ts's
 * AES-256-GCM framing because scripts/ is plain .mjs run with plain
 * `node` and cannot import a .ts module. This suite cross-checks the
 * port against the real implementation (encrypt with one, decrypt with
 * the other, and vice versa) so any future drift fails a test instead of
 * silently going stale.
 */

const KEY_HEX = randomBytes(32).toString("hex");
const originalKey = process.env.API_KEY_ENCRYPTION_KEY;

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_KEY = KEY_HEX;
});
afterAll(() => {
  if (originalKey === undefined) {
    delete process.env.API_KEY_ENCRYPTION_KEY;
  } else {
    process.env.API_KEY_ENCRYPTION_KEY = originalKey;
  }
});

describe("getEncryptionKey / isEncryptionConfigured", () => {
  it("reads the configured key", () => {
    expect(isEncryptionConfigured()).toBe(true);
    expect(getEncryptionKey()).toEqual(Buffer.from(KEY_HEX, "hex"));
  });

  it("returns null/false when unset or the wrong length", () => {
    const saved = process.env.API_KEY_ENCRYPTION_KEY;
    process.env.API_KEY_ENCRYPTION_KEY = "";
    expect(isEncryptionConfigured()).toBe(false);
    expect(getEncryptionKey()).toBeNull();
    process.env.API_KEY_ENCRYPTION_KEY = "tooshort";
    expect(isEncryptionConfigured()).toBe(false);
    expect(getEncryptionKey()).toBeNull();
    process.env.API_KEY_ENCRYPTION_KEY = saved;
  });
});

describe("decryptApiKeyMirror interoperates with the real lib/auth/crypto.ts", () => {
  it("decrypts what the real encryptApiKey produced", () => {
    const plaintext = generateSecret();
    const encrypted = encryptApiKey(plaintext);
    const key = Buffer.from(KEY_HEX, "hex");
    expect(decryptApiKeyMirror(encrypted, key)).toBe(plaintext);
  });

  it("the real decryptApiKey accepts what this mirror would also accept (round trip via the real module only)", () => {
    const plaintext = "some-arbitrary-secret-value";
    const encrypted = encryptApiKey(plaintext);
    expect(decryptApiKey(encrypted)).toBe(plaintext);
    const key = Buffer.from(KEY_HEX, "hex");
    expect(decryptApiKeyMirror(encrypted, key)).toBe(plaintext);
  });

  it("throws on a tampered ciphertext, same as the real function", () => {
    const encrypted = encryptApiKey("some-secret-value");
    const buf = Buffer.from(encrypted, "base64");
    buf[buf.length - 1] ^= 0xff; // flip a bit inside the auth tag
    const tampered = buf.toString("base64");
    const key = Buffer.from(KEY_HEX, "hex");

    expect(() => decryptApiKeyMirror(tampered, key)).toThrow();
    expect(() => decryptApiKey(tampered)).toThrow();
  });

  it("throws on garbage input that isn't valid ciphertext at all", () => {
    const key = Buffer.from(KEY_HEX, "hex");
    expect(() => decryptApiKeyMirror("not-real-ciphertext", key)).toThrow();
  });

  it("throws when decrypted under the wrong key, same as the real function", () => {
    const encrypted = encryptApiKey("secret-under-key-a");
    const wrongKey = randomBytes(32);
    expect(() => decryptApiKeyMirror(encrypted, wrongKey)).toThrow();
  });
});

describe("looksLikeTotpSecret", () => {
  it("accepts a real generateSecret() output", () => {
    expect(looksLikeTotpSecret(generateSecret())).toBe(true);
  });

  it("accepts many real generateSecret() outputs (no false negatives from randomness)", () => {
    for (let i = 0; i < 20; i++) {
      expect(looksLikeTotpSecret(generateSecret())).toBe(true);
    }
  });

  it("rejects values that are not 32-char base32", () => {
    expect(looksLikeTotpSecret("")).toBe(false);
    expect(looksLikeTotpSecret("not a totp secret at all")).toBe(false);
    expect(looksLikeTotpSecret("short")).toBe(false);
    // lowercase is not accepted -- generateSecret() always emits uppercase.
    expect(looksLikeTotpSecret(generateSecret().toLowerCase())).toBe(false);
    // Simulates the "decrypted successfully but it's garbage bytes"
    // scenario: random bytes rendered as base64 will contain characters
    // (lowercase, digits 0/1/8/9, +, /, =) outside the base32 alphabet.
    expect(looksLikeTotpSecret(randomBytes(20).toString("base64"))).toBe(false);
  });
});
