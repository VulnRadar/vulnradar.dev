import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { hashOneTimeCode, oneTimeCodeMatches } from "@/lib/auth/one-time-code";

/**
 * The digest every emailed six-digit code is stored under: the email
 * two-factor codes (sign-in, step-up, inbox check) and the billing
 * verification codes.
 *
 * The salt is stored beside the digest, so an unkeyed sha256 of
 * "<salt>:<code>" falls to a loop over the 10^6 possible codes as soon as
 * someone can read the table. Keyed with a server secret, the same read
 * gives nothing without the secret too.
 */
const saved = {
  auth: process.env.AUTH_SECRET,
  key: process.env.API_KEY_ENCRYPTION_KEY,
};

const SALT = "a1".repeat(32);
const CODE = "482915";

beforeEach(() => {
  delete process.env.AUTH_SECRET;
  delete process.env.API_KEY_ENCRYPTION_KEY;
});

afterAll(() => {
  if (saved.auth === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = saved.auth;
  if (saved.key === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = saved.key;
});

const unkeyed = (salt: string, code: string) =>
  createHash("sha256").update(`${salt}:${code}`).digest("hex");

describe("hashOneTimeCode", () => {
  it("is not the unkeyed sha256 of '<salt>:<code>' once a server key is set", () => {
    process.env.AUTH_SECRET = "s".repeat(32);
    const digest = hashOneTimeCode(SALT, CODE);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(unkeyed(SALT, CODE));
    expect(digest).toBe(
      createHmac("sha256", "s".repeat(32))
        .update(`${SALT}:${CODE}`)
        .digest("hex"),
    );
  });

  it("cannot be recovered by trying every code against the stored salt", () => {
    process.env.AUTH_SECRET = "s".repeat(32);
    const stored = hashOneTimeCode(SALT, CODE);
    // What a database reader without the key can compute.
    let recovered: string | null = null;
    for (let n = 482900; n < 483000; n++) {
      if (unkeyed(SALT, String(n)) === stored) recovered = String(n);
    }
    expect(recovered).toBeNull();
  });

  it("uses API_KEY_ENCRYPTION_KEY when AUTH_SECRET is unset, as token-hash does", () => {
    process.env.API_KEY_ENCRYPTION_KEY = "k".repeat(64);
    expect(hashOneTimeCode(SALT, CODE)).toBe(
      createHmac("sha256", "k".repeat(64))
        .update(`${SALT}:${CODE}`)
        .digest("hex"),
    );
  });

  it("differs for a different salt", () => {
    process.env.AUTH_SECRET = "s".repeat(32);
    expect(hashOneTimeCode(SALT, CODE)).not.toBe(
      hashOneTimeCode("b2".repeat(32), CODE),
    );
  });
});

describe("oneTimeCodeMatches", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "s".repeat(32);
  });

  it("accepts the code the digest was made from", () => {
    expect(oneTimeCodeMatches(hashOneTimeCode(SALT, CODE), SALT, CODE)).toBe(
      true,
    );
  });

  it("refuses a code one digit away", () => {
    const stored = hashOneTimeCode(SALT, CODE);
    expect(oneTimeCodeMatches(stored, SALT, "482914")).toBe(false);
    expect(oneTimeCodeMatches(stored, SALT, "582915")).toBe(false);
  });

  it("verifies only under the key the digest was made with", () => {
    const stored = hashOneTimeCode(SALT, CODE);
    process.env.AUTH_SECRET = "t".repeat(32);
    expect(oneTimeCodeMatches(stored, SALT, CODE)).toBe(false);
  });

  it("refuses a digest stored the old unkeyed way", () => {
    expect(oneTimeCodeMatches(unkeyed(SALT, CODE), SALT, CODE)).toBe(false);
  });

  it.each([
    ["a missing digest", null, SALT],
    ["an empty digest", "", SALT],
    ["a digest that is not hex", "z".repeat(64), SALT],
    ["a truncated digest", "ab".repeat(16), SALT],
    ["a missing salt", "ab".repeat(32), null],
    ["an empty salt", "ab".repeat(32), ""],
  ])("refuses %s without throwing", (_label, stored, salt) => {
    expect(oneTimeCodeMatches(stored, salt, CODE)).toBe(false);
  });
});

describe("with no server key configured", () => {
  it("falls back to the plain sha256 and says so once, never naming the code", async () => {
    // The once-only flag lives on globalThis (lib/runtime/global-singleton),
    // so clear it along with the module cache to start from a fresh process.
    delete (globalThis as unknown as Record<symbol, unknown>)[
      Symbol.for("vulnradar.one-time-code.unkeyed-warning")
    ];
    vi.resetModules();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fresh = await import("@/lib/auth/one-time-code");
      const first = fresh.hashOneTimeCode(SALT, CODE);
      fresh.hashOneTimeCode(SALT, "111111");

      expect(first).toBe(unkeyed(SALT, CODE));
      expect(fresh.oneTimeCodeMatches(first, SALT, CODE)).toBe(true);
      expect(errors).toHaveBeenCalledTimes(1);
      const logged = errors.mock.calls.flat().map(String).join(" ");
      expect(logged).toMatch(/AUTH_SECRET/);
      expect(logged).not.toContain(CODE);
      expect(logged).not.toContain("111111");
      expect(logged).not.toContain(SALT);
    } finally {
      errors.mockRestore();
    }
  });
});
