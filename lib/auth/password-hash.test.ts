import { describe, it, expect } from "vitest";
import { scryptSync } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  scryptMaxmem,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  SCRYPT_KEYLEN,
} from "./password-hash";

/**
 * These tests call the REAL scrypt primitive at the REAL production cost.
 *
 * That is the whole point. The previous suite mocked `node:crypto` away
 * because full-cost scrypt "would fail on memory-constrained runners", which
 * meant nothing ever executed the configured params. Shipping a maxmem
 * ceiling 3 KiB below what OpenSSL asks for therefore passed CI and broke
 * signup in production with ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
 *
 * A handful of ~0.6s hashes is a fair price for catching that.
 */
describe("scrypt production parameters", () => {
  it("hashes at the configured cost without exceeding the memory ceiling", () => {
    // The regression: this threw "memory limit exceeded" in 2.3.1/2.3.2.
    expect(() => hashPassword("correct horse battery staple")).not.toThrow();
  });

  it("allows enough memory for what OpenSSL actually allocates", () => {
    // OpenSSL needs 128 * r * (N + p + 2), which is strictly greater than the
    // textbook 128 * N * r. A ceiling based on the textbook figure is too low.
    const textbook = 128 * SCRYPT_N * SCRYPT_R;
    const actuallyRequired = 128 * SCRYPT_R * (SCRYPT_N + SCRYPT_P + 2);

    expect(actuallyRequired).toBeGreaterThan(textbook);
    expect(scryptMaxmem(SCRYPT_N, SCRYPT_R, SCRYPT_P)).toBeGreaterThan(
      actuallyRequired,
    );
  });

  it("passes a maxmem that OpenSSL accepts for the configured params", () => {
    expect(() =>
      scryptSync("pw", "salt", SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: scryptMaxmem(SCRYPT_N, SCRYPT_R, SCRYPT_P),
      }),
    ).not.toThrow();
  });

  it("meets the OWASP interactive-login cost floor", () => {
    expect(SCRYPT_N).toBeGreaterThanOrEqual(1 << 16);
    expect(SCRYPT_R).toBeGreaterThanOrEqual(8);
  });
});

describe("hashPassword", () => {
  it("emits the N:r:p:salt:hash format with current params", () => {
    const stored = hashPassword("hunter2hunter2");
    const parts = stored.split(":");

    expect(parts).toHaveLength(5);
    expect(Number(parts[0])).toBe(SCRYPT_N);
    expect(Number(parts[1])).toBe(SCRYPT_R);
    expect(Number(parts[2])).toBe(SCRYPT_P);
    expect(parts[3]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[4]).toHaveLength(SCRYPT_KEYLEN * 2);
  });

  it("salts each hash so identical passwords differ", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(a.split(":")[3]).not.toBe(b.split(":")[3]);
  });
});

describe("verifyPassword", () => {
  // One hash reused across cases; each full-cost hash costs ~0.6s.
  const password = "a-real-password-42";
  const stored = hashPassword(password);

  it("accepts the correct password", () => {
    expect(verifyPassword(password, stored)).toBe(true);
  });

  it("rejects the wrong password", () => {
    expect(verifyPassword("not-the-password", stored)).toBe(false);
  });

  it("rejects a tampered digest without throwing", () => {
    const [n, r, p, salt, hash] = stored.split(":");
    const flipped = (hash[0] === "a" ? "b" : "a") + hash.slice(1);
    expect(verifyPassword(password, `${n}:${r}:${p}:${salt}:${flipped}`)).toBe(
      false,
    );
  });

  it("rejects a truncated digest instead of throwing on length mismatch", () => {
    const [n, r, p, salt, hash] = stored.split(":");
    expect(() =>
      verifyPassword(password, `${n}:${r}:${p}:${salt}:${hash.slice(0, 32)}`),
    ).not.toThrow();
    expect(
      verifyPassword(password, `${n}:${r}:${p}:${salt}:${hash.slice(0, 32)}`),
    ).toBe(false);
  });

  it("verifies a legacy salt:hash record", () => {
    const salt = "deadbeefdeadbeefdeadbeefdeadbeef";
    const legacy = `${salt}:${scryptSync("legacy-pw", salt, SCRYPT_KEYLEN).toString("hex")}`;

    expect(verifyPassword("legacy-pw", legacy)).toBe(true);
    expect(verifyPassword("wrong-pw", legacy)).toBe(false);
  });

  it("verifies a hash written at a lower cost than the current default", () => {
    // Proves raising SCRYPT_N does not lock existing users out.
    const salt = "00112233445566778899aabbccddeeff";
    const n = 1 << 14;
    const digest = scryptSync("old-cost-pw", salt, SCRYPT_KEYLEN, {
      N: n,
      r: 8,
      p: 1,
      maxmem: scryptMaxmem(n, 8, 1),
    }).toString("hex");

    expect(verifyPassword("old-cost-pw", `${n}:8:1:${salt}:${digest}`)).toBe(
      true,
    );
  });

  describe("rejects malformed records rather than throwing a 500", () => {
    const salt = "00112233445566778899aabbccddeeff";
    const digest = "ab".repeat(SCRYPT_KEYLEN);

    const cases: Array<[string, string]> = [
      ["empty string", ""],
      ["non-numeric N", `abc:8:1:${salt}:${digest}`],
      ["non-power-of-two N", `100000:8:1:${salt}:${digest}`],
      [
        "absurdly large N (memory exhaustion)",
        `1073741824:8:1:${salt}:${digest}`,
      ],
      [
        "absurdly large r (memory exhaustion)",
        `${SCRYPT_N}:4096:1:${salt}:${digest}`,
      ],
      ["zero N", `0:8:1:${salt}:${digest}`],
      ["negative p", `${SCRYPT_N}:8:-1:${salt}:${digest}`],
      ["missing salt", `${SCRYPT_N}:8:1::${digest}`],
    ];

    for (const [name, record] of cases) {
      it(name, () => {
        expect(() => verifyPassword("pw", record)).not.toThrow();
        expect(verifyPassword("pw", record)).toBe(false);
      });
    }
  });
});

describe("needsRehash", () => {
  const salt = "00112233445566778899aabbccddeeff";
  const digest = "ab".repeat(SCRYPT_KEYLEN);

  it("is false for a hash at the current cost", () => {
    expect(needsRehash(hashPassword("pw"))).toBe(false);
  });

  it("is true for the legacy salt:hash format", () => {
    expect(needsRehash(`${salt}:${digest}`)).toBe(true);
  });

  it("is true for a hash below the current cost", () => {
    expect(needsRehash(`16384:8:1:${salt}:${digest}`)).toBe(true);
  });
});
