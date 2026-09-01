import { describe, it, expect, vi } from "vitest";
import {
  encryptApiKey,
  decryptApiKey,
  decryptApiKeyWithKeyAge,
  isEncryptionConfigured,
} from "@/lib/auth/crypto";

/**
first test suite for security-critical code.
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

/**
 * Key rotation (AUDIT-007#auth-02). One key protects TOTP seeds, OAuth
 * tokens, user AI provider keys and API keys, and before this there was no
 * way to change it without every existing ciphertext becoming unreadable.
 */
describe("key rotation via PREVIOUS_API_KEY_ENCRYPTION_KEY", () => {
  const OLD_KEY = "b".repeat(64);
  const NEW_KEY = "c".repeat(64);

  function withKeys<T>(
    current: string,
    previous: string | null,
    fn: () => T,
  ): T {
    const savedCurrent = process.env.API_KEY_ENCRYPTION_KEY;
    const savedPrevious = process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
    process.env.API_KEY_ENCRYPTION_KEY = current;
    if (previous === null) {
      delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
    } else {
      process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = previous;
    }
    try {
      return fn();
    } finally {
      if (savedCurrent === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
      else process.env.API_KEY_ENCRYPTION_KEY = savedCurrent;
      if (savedPrevious === undefined)
        delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
      else process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = savedPrevious;
    }
  }

  it("still decrypts a value written under the old key", () => {
    const cipher = withKeys(OLD_KEY, null, () => encryptApiKey("totp-seed"));
    const plaintext = withKeys(NEW_KEY, OLD_KEY, () => decryptApiKey(cipher));
    expect(plaintext).toBe("totp-seed");
  });

  it("reports which key opened the value, so a caller can rewrite it", () => {
    const oldCipher = withKeys(OLD_KEY, null, () => encryptApiKey("seed"));
    withKeys(NEW_KEY, OLD_KEY, () => {
      expect(decryptApiKeyWithKeyAge(oldCipher).usedPreviousKey).toBe(true);
      const rewritten = encryptApiKey("seed");
      expect(decryptApiKeyWithKeyAge(rewritten).usedPreviousKey).toBe(false);
      expect(decryptApiKey(rewritten)).toBe("seed");
    });
  });

  it("always encrypts new values with the CURRENT key", () => {
    const cipher = withKeys(NEW_KEY, OLD_KEY, () => encryptApiKey("fresh"));
    // Readable with the new key alone, i.e. no dependence on the old one.
    expect(withKeys(NEW_KEY, null, () => decryptApiKey(cipher))).toBe("fresh");
  });

  it("still throws when neither key authenticates the ciphertext", () => {
    const cipher = withKeys("d".repeat(64), null, () => encryptApiKey("x"));
    expect(() =>
      withKeys(NEW_KEY, OLD_KEY, () => decryptApiKey(cipher)),
    ).toThrow();
  });

  it("ignores a malformed previous key loudly instead of breaking every decrypt", () => {
    const cipher = withKeys(NEW_KEY, null, () => encryptApiKey("still-fine"));
    const errors: unknown[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args) => void errors.push(args));
    try {
      // A current-key value keeps working; only the old-key fallback is lost.
      expect(withKeys(NEW_KEY, "not-hex", () => decryptApiKey(cipher))).toBe(
        "still-fine",
      );
      const oldCipher = withKeys(OLD_KEY, null, () => encryptApiKey("lost"));
      expect(() =>
        withKeys(NEW_KEY, "not-hex", () => decryptApiKey(oldCipher)),
      ).toThrow();
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });
});
