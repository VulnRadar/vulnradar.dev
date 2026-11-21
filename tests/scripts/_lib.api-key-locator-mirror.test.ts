import { describe, it, expect } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { computeApiKeyLocatorMirror } from "../../scripts/_lib/_lib.api-key-locator-mirror.mjs";

/**
 * The locator mirror computes the 8-hex-character HMAC locator that 3.9.1 and
 * earlier stored in api_keys.key_locator beside each key's ciphertext. This
 * used to cross-check against the app through generateApiKey's INSERT; the
 * app stores a one-way digest since 4.0.0 and writes no locator, so the only
 * locators left are on rows written before the upgrade, and the reference
 * here is the formula those rows were written with
 * (git show v3.9.1:lib/api/api-keys.ts, computeKeyLocator).
 */

const KEY_HEX = randomBytes(32).toString("hex");

function locatorAs391Wrote(rawKey: string, key: Buffer): string {
  return createHmac("sha256", key).update(rawKey).digest("hex").slice(0, 8);
}

function rawKey(): string {
  return `vr_live_${randomBytes(32).toString("hex")}`;
}

describe("computeApiKeyLocatorMirror matches the locator 3.9.1 stored", () => {
  it("matches the key_locator a 3.9.1 row carries", () => {
    const key = Buffer.from(KEY_HEX, "hex");
    for (let i = 0; i < 5; i++) {
      const raw = rawKey();
      expect(computeApiKeyLocatorMirror(raw, key)).toBe(
        locatorAs391Wrote(raw, key),
      );
    }
  });

  it("produces an 8-hex-char locator, matching the real format", () => {
    const key = Buffer.from(KEY_HEX, "hex");
    const mirrored = computeApiKeyLocatorMirror(rawKey(), key);
    expect(mirrored).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic for the same key and raw value", () => {
    const key = Buffer.from(KEY_HEX, "hex");
    const raw = "vr_live_deadbeefdeadbeefdeadbeefdeadbeef";
    expect(computeApiKeyLocatorMirror(raw, key)).toBe(
      computeApiKeyLocatorMirror(raw, key),
    );
  });

  it("differs for a different key (proves it's actually keyed, not a plain hash)", () => {
    const raw = "vr_live_deadbeefdeadbeefdeadbeefdeadbeef";
    const keyA = Buffer.from(KEY_HEX, "hex");
    const keyB = randomBytes(32);
    expect(computeApiKeyLocatorMirror(raw, keyA)).not.toBe(
      computeApiKeyLocatorMirror(raw, keyB),
    );
  });
});
