import { describe, it, expect, beforeAll } from "vitest";
import { scryptSync } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  SCRYPT_KEYLEN,
  SCRYPT_N,
} from "@/lib/auth/password-hash";
import {
  looksLikeValidHashRecord,
  classifyBackupCodesColumn,
  SCRYPT_KEYLEN as MIRROR_KEYLEN,
} from "../../scripts/_lib/_lib.2fa-hash-mirror.mjs";

/**
 * scripts/_lib/_lib.2fa-hash-mirror.mjs ports the structural parsing
 * branch of lib/auth/password-hash.ts's verifyPassword() because
 * scripts/ is plain .mjs run with plain `node` and cannot import a .ts
 * module. This suite cross-checks the port against the real
 * implementation so any future drift between the two fails a test
 * instead of silently going stale -- see the header comment in the
 * mirror module for the full rationale.
 */

describe("SCRYPT_KEYLEN stays in sync with the real module", () => {
  it("matches", () => {
    expect(MIRROR_KEYLEN).toBe(SCRYPT_KEYLEN);
  });
});

describe("looksLikeValidHashRecord", () => {
  let realHash: string;
  beforeAll(async () => {
    realHash = await hashPassword("cross-check-pw");
  });

  it("accepts a real hashPassword() record, and the real verifyPassword agrees it's a usable shape", async () => {
    expect(looksLikeValidHashRecord(realHash)).toBe(true);
    await expect(verifyPassword("cross-check-pw", realHash)).resolves.toBe(
      true,
    );
  });

  it("accepts a legacy salt:hash record", () => {
    const salt = "deadbeefdeadbeefdeadbeefdeadbeef";
    const legacy = `${salt}:${scryptSync("legacy-pw", salt, SCRYPT_KEYLEN).toString("hex")}`;
    expect(looksLikeValidHashRecord(legacy)).toBe(true);
  });

  it("accepts a hash written at a lower cost than the current default", () => {
    const salt = "00112233445566778899aabbccddeeff";
    const n = 1 << 14;
    const digest = scryptSync("old-cost-pw", salt, SCRYPT_KEYLEN, {
      N: n,
      r: 8,
      p: 1,
      maxmem: 128 * 8 * (n + 1 + 2) * 2,
    }).toString("hex");
    expect(looksLikeValidHashRecord(`${n}:8:1:${salt}:${digest}`)).toBe(true);
  });

  it("rejects non-string values without throwing", () => {
    expect(looksLikeValidHashRecord(12345)).toBe(false);
    expect(looksLikeValidHashRecord(null)).toBe(false);
    expect(looksLikeValidHashRecord(undefined)).toBe(false);
    expect(looksLikeValidHashRecord({ not: "a string" })).toBe(false);
  });

  // Same malformed-record battery as tests/lib/auth/password-hash.test.ts's
  // "rejects malformed records rather than throwing a 500" suite. Every one
  // of these resolves to `false` from the real verifyPassword (never
  // throws) -- this mirror must classify every one of them as "not a valid
  // shape" too.
  describe("agrees with the real verifyPassword on malformed records", () => {
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
      ["truncated digest", `${SCRYPT_N}:8:1:${salt}:${digest.slice(0, 32)}`],
    ];

    for (const [name, record] of cases) {
      it(name, async () => {
        expect(looksLikeValidHashRecord(record)).toBe(false);
        await expect(verifyPassword("pw", record)).resolves.toBe(false);
      });
    }
  });
});

describe("classifyBackupCodesColumn", () => {
  it("flags null/undefined as empty", () => {
    expect(classifyBackupCodesColumn(null).status).toBe("empty");
    expect(classifyBackupCodesColumn(undefined).status).toBe("empty");
  });

  it("flags a non-string column value", () => {
    expect(classifyBackupCodesColumn(12345).status).toBe("malformed_json");
  });

  it("flags invalid JSON", () => {
    expect(classifyBackupCodesColumn("{not valid json").status).toBe(
      "malformed_json",
    );
  });

  it("flags valid JSON that isn't an array", () => {
    expect(classifyBackupCodesColumn(JSON.stringify({ a: 1 })).status).toBe(
      "not_array",
    );
    expect(classifyBackupCodesColumn(JSON.stringify("a string")).status).toBe(
      "not_array",
    );
  });

  it("flags an array containing a non-string element", () => {
    const result = classifyBackupCodesColumn(
      JSON.stringify(["a:b:c:d:e", 5, null]),
    );
    expect(result.status).toBe("contains_non_string");
    expect(result.badFormatCount).toBe(2);
  });

  it("accepts a well-formed array of real hash records", async () => {
    const h1 = await hashPassword("code1");
    const h2 = await hashPassword("code2");
    const result = classifyBackupCodesColumn(JSON.stringify([h1, h2]));
    expect(result.status).toBe("ok");
    expect(result.total).toBe(2);
    expect(result.badFormatCount).toBe(0);
    // Two real scrypt (N=2^17) hashes -- generous timeout so it doesn't flake
    // under a loaded parallel full-suite run.
  }, 20_000);

  it("counts bad-format entries within an otherwise-valid array (dead code slots)", () => {
    const result = classifyBackupCodesColumn(
      JSON.stringify(["not-a-hash-at-all", "also-not-one"]),
    );
    expect(result.status).toBe("ok");
    expect(result.total).toBe(2);
    expect(result.badFormatCount).toBe(2);
  });

  it("treats an empty array as ok with zero codes", () => {
    const result = classifyBackupCodesColumn(JSON.stringify([]));
    expect(result.status).toBe("ok");
    expect(result.total).toBe(0);
    expect(result.badFormatCount).toBe(0);
  });
});
