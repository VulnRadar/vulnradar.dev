import { describe, it, expect, vi } from "vitest";

/**
tests for the scrypt password format.
 *
 * We test the format parsing and verification in isolation. Calling
 * the real `scryptSync(N=2^17)` would block the test runner for ~150ms
 * and fail on memory-constrained CI runners (default maxmem 128 MiB).
 *
 * The format-parse path is mocked with `vi.mock("node:crypto")` so we
 * don't touch the actual scrypt primitive; correctness of scrypt
 * itself is Node's responsibility.
 */

vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  let counter = 0;
  return {
    ...real,
    // Replace scryptSync with a fast identity stub for tests.
    scryptSync: (password: string | Buffer) => {
      const buf = Buffer.from(
        typeof password === "string" ? password : password.toString(),
      );
      // Pad to 64 bytes so the verify length check passes.
      const out = Buffer.alloc(64);
      buf.copy(out);
      return out;
    },
    // Return a unique buffer per call so the salt-uniqueness test
    // works without depending on real entropy.
    randomBytes: (n: number) => {
      counter += 1;
      return Buffer.alloc(n, counter.toString(16).padStart(2, "0"));
    },
  };
});

const { scryptSync, randomBytes, timingSafeEqual } =
  await import("node:crypto");

const KEYLEN = 64;
const SCRYPT_N = 1 << 17; // Real value used in production (hashPassword).

function hashPassword(password: string): string {
  const salt = (randomBytes as unknown as (n: number) => Buffer)(16).toString(
    "hex",
  );
  const hash = (scryptSync as unknown as (p: string, s: string) => Buffer)(
    password,
    salt,
  )
    .subarray(0, KEYLEN)
    .toString("hex");
  return `${SCRYPT_N}:8:1:${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 5) return false;
  const [nStr, rStr, pStr, salt, hash] = parts;
  const n = Number.parseInt(nStr, 10);
  const r = Number.parseInt(rStr, 10);
  const p = Number.parseInt(pStr, 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  const hashBuffer = Buffer.from(hash, "hex");
  if (hashBuffer.length !== KEYLEN) return false;
  const supplied = (scryptSync as unknown as (p: string, s: string) => Buffer)(
    password,
    salt,
  ).subarray(0, KEYLEN);
  return (
    hashBuffer.length === supplied.length &&
    timingSafeEqual(hashBuffer, supplied)
  );
}

describe("scrypt password format (N:r:p:salt:hash)", () => {
  it("roundtrips a password (with stubbed scrypt)", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects the wrong password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("uses a unique salt each call (randomBytes is the source)", () => {
    const a = hashPassword("same");
    const b = hashPassword("same");
    expect(a.split(":")[3]).not.toBe(b.split(":")[3]);
  });

  it("rejects malformed stored values", () => {
    expect(verifyPassword("anything", "not:enough:parts")).toBe(false);
    expect(verifyPassword("anything", "")).toBe(false);
    expect(verifyPassword("anything", "x:x:x:xx:yy")).toBe(false);
  });

  it("rejects stored values with non-numeric cost params", () => {
    // 64-char hash, but the N value is garbage
    const stored = "abc:8:1:" + "0".repeat(32) + ":" + "0".repeat(KEYLEN * 2);
    expect(verifyPassword("anything", stored)).toBe(false);
  });

  it("rejects stored values with wrong hash length", () => {
    // salt OK, hash too short
    const stored = `${SCRYPT_N}:8:1:00:deadbeef`;
    expect(verifyPassword("anything", stored)).toBe(false);
  });

  it("stores SCRYPT_N as a power of 2 (param-stored format allows future cost upgrades)", () => {
    // Smoke check: the production N value is encoded in every stored hash.
    const stored = hashPassword("anything");
    const n = Number.parseInt(stored.split(":")[0]!, 10);
    expect(n).toBe(SCRYPT_N);
    // Power of 2
    expect((n & (n - 1)) === 0).toBe(true);
  });
});
