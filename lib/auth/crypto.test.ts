import { describe, it, expect } from "vitest";
import {
  encryptApiKey,
  decryptApiKey,
  isEncryptionConfigured,
} from "@/lib/auth/crypto";

/**
 * Phase 8C Commit 1 (C-4): first test suite for security-critical code.
 *
 * Verifies AES-256-GCM roundtrip, IV uniqueness, and tampered-ciphertext
 * rejection.
 */

const VALID_KEY = "a".repeat(64);

function withValidKey<T>(fn: () => T): T {
  const previous = process.env.API_KEY_ENCRYPTION_KEY;
  process.env.API_KEY_ENCRYPTION_KEY = VALID_KEY;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.API_KEY_ENCRYPTION_KEY;
    } else {
      process.env.API_KEY_ENCRYPTION_KEY = previous;
    }
  }
}

describe("encryptApiKey / decryptApiKey", () => {
  it("roundtrips a plaintext value", () => {
    withValidKey(() => {
      const plaintext = "vr_live_" + "x".repeat(64);
      const cipher = encryptApiKey(plaintext);
      expect(decryptApiKey(cipher)).toBe(plaintext);
    });
  });

  it("produces a different ciphertext each call (random IV)", () => {
    withValidKey(() => {
      const plaintext = "vr_live_sameplaintext";
      const a = encryptApiKey(plaintext);
      const b = encryptApiKey(plaintext);
      expect(a).not.toBe(b);
      // But both decrypt to the same plaintext.
      expect(decryptApiKey(a)).toBe(plaintext);
      expect(decryptApiKey(b)).toBe(plaintext);
    });
  });

  it("rejects ciphertext with a tampered auth tag", () => {
    withValidKey(() => {
      const cipher = encryptApiKey("vr_live_tamperme");
      // Flip one base64 character in the last byte (auth tag).
      const bytes = Buffer.from(cipher, "base64");
      bytes[bytes.length - 1] ^= 0x01;
      const tampered = bytes.toString("base64");
      expect(() => decryptApiKey(tampered)).toThrow();
    });
  });

  it("rejects ciphertext with a tampered IV", () => {
    withValidKey(() => {
      const cipher = encryptApiKey("vr_live_ivtamper");
      const bytes = Buffer.from(cipher, "base64");
      bytes[0] ^= 0xff;
      const tampered = bytes.toString("base64");
      expect(() => decryptApiKey(tampered)).toThrow();
    });
  });

  it("rejects ciphertext with a tampered body", () => {
    withValidKey(() => {
      const cipher = encryptApiKey("vr_live_bodytamper");
      const bytes = Buffer.from(cipher, "base64");
      // Mutate a byte in the middle (body region).
      const mid = Math.floor(bytes.length / 2);
      bytes[mid] ^= 0x01;
      const tampered = bytes.toString("base64");
      expect(() => decryptApiKey(tampered)).toThrow();
    });
  });
});

describe("isEncryptionConfigured", () => {
  it("returns true with a 64-char hex key", () => {
    withValidKey(() => {
      expect(isEncryptionConfigured()).toBe(true);
    });
  });

  it("returns false when key is missing", () => {
    const previous = process.env.API_KEY_ENCRYPTION_KEY;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    try {
      expect(isEncryptionConfigured()).toBe(false);
    } finally {
      if (previous !== undefined) {
        process.env.API_KEY_ENCRYPTION_KEY = previous;
      }
    }
  });

  it("returns false when key is the wrong length", () => {
    const previous = process.env.API_KEY_ENCRYPTION_KEY;
    process.env.API_KEY_ENCRYPTION_KEY = "abc";
    try {
      expect(isEncryptionConfigured()).toBe(false);
    } finally {
      if (previous !== undefined) {
        process.env.API_KEY_ENCRYPTION_KEY = previous;
      }
    }
  });
});

describe("missing key is fatal at call time", () => {
  it("encryptApiKey throws when API_KEY_ENCRYPTION_KEY is missing", () => {
    const previous = process.env.API_KEY_ENCRYPTION_KEY;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    try {
      expect(() => encryptApiKey("anything")).toThrow(/API_KEY_ENCRYPTION_KEY/);
    } finally {
      if (previous !== undefined) {
        process.env.API_KEY_ENCRYPTION_KEY = previous;
      }
    }
  });
});
