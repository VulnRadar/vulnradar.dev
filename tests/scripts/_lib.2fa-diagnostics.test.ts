import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptApiKey } from "@/lib/auth/crypto";
import { generateSecret } from "@/lib/auth/totp";
import { hashPassword } from "@/lib/auth/password-hash";
import {
  classifyUser,
  classifyEmail2FACodeRow,
  CATEGORY,
  REPAIR_ELIGIBLE_CATEGORIES,
  describeCategory,
} from "../../scripts/_lib/_lib.2fa-diagnostics.mjs";

const KEY_HEX = randomBytes(32).toString("hex");
const originalKey = process.env.API_KEY_ENCRYPTION_KEY;

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_KEY = KEY_HEX;
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = originalKey;
});

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    totp_enabled: true,
    totp_secret: null,
    // A well-formed empty array by default, so tests focused on
    // totp_secret categories don't incidentally trip the unrelated
    // "backup_codes_missing" warning.
    backup_codes: "[]",
    two_factor_method: "app",
    ...overrides,
  };
}

describe("classifyUser: valid rows are never flagged", () => {
  it("a fully well-formed app-2FA user has no problems", async () => {
    const secret = encryptApiKey(generateSecret());
    const codes = JSON.stringify([
      await hashPassword("c1"),
      await hashPassword("c2"),
    ]);
    const result = classifyUser(
      baseRow({ totp_secret: secret, backup_codes: codes }),
    );
    expect(result.problems).toEqual([]);
    expect(result.repairEligible).toBe(false);
  });

  it("an email-2FA user with a null totp_secret and null backup_codes has no problems", () => {
    const result = classifyUser(
      baseRow({
        two_factor_method: "email",
        totp_secret: null,
        backup_codes: null,
      }),
    );
    expect(result.problems).toEqual([]);
    expect(result.repairEligible).toBe(false);
  });
});

describe("classifyUser: backup_codes categories", () => {
  it("flags malformed JSON as repair-eligible", () => {
    const secret = encryptApiKey(generateSecret());
    const result = classifyUser(
      baseRow({ totp_secret: secret, backup_codes: "{not json" }),
    );
    expect(result.repairEligible).toBe(true);
    expect(result.problems).toContainEqual(
      expect.objectContaining({
        category: CATEGORY.BACKUP_CODES_MALFORMED_JSON,
        severity: "repair-eligible",
      }),
    );
  });

  it("flags a non-array JSON value as repair-eligible", () => {
    const secret = encryptApiKey(generateSecret());
    const result = classifyUser(
      baseRow({ totp_secret: secret, backup_codes: JSON.stringify({ a: 1 }) }),
    );
    expect(result.repairEligible).toBe(true);
    expect(result.problems[0].category).toBe(CATEGORY.BACKUP_CODES_NOT_ARRAY);
  });

  it("flags a non-string array element as repair-eligible", () => {
    const secret = encryptApiKey(generateSecret());
    const result = classifyUser(
      baseRow({ totp_secret: secret, backup_codes: JSON.stringify([1, 2, 3]) }),
    );
    expect(result.repairEligible).toBe(true);
    expect(result.problems[0].category).toBe(CATEGORY.BACKUP_CODES_NON_STRING);
  });

  it("flags missing backup_codes for app-method as a warning, not repair-eligible", () => {
    const secret = encryptApiKey(generateSecret());
    const result = classifyUser(
      baseRow({ totp_secret: secret, backup_codes: null }),
    );
    expect(result.repairEligible).toBe(false);
    expect(result.problems).toContainEqual(
      expect.objectContaining({
        category: CATEGORY.BACKUP_CODES_MISSING,
        severity: "warning",
      }),
    );
  });

  it("does not flag missing backup_codes for email-method (never used)", () => {
    const result = classifyUser(
      baseRow({
        two_factor_method: "email",
        totp_secret: null,
        backup_codes: null,
      }),
    );
    expect(
      result.problems.find((p) => p.category === CATEGORY.BACKUP_CODES_MISSING),
    ).toBeUndefined();
  });

  it("flags dead (unrecognized-format) codes within an otherwise-valid array as a warning", async () => {
    const secret = encryptApiKey(generateSecret());
    const codes = JSON.stringify([
      await hashPassword("good"),
      "totally-not-a-hash",
    ]);
    const result = classifyUser(
      baseRow({ totp_secret: secret, backup_codes: codes }),
    );
    expect(result.repairEligible).toBe(false);
    const warning = result.problems.find(
      (p) => p.category === CATEGORY.BACKUP_CODES_BAD_FORMAT,
    );
    expect(warning?.severity).toBe("warning");
    expect(warning?.detail).toBe("1 of 2 backup codes");
  });
});

describe("classifyUser: totp_secret categories (app method only)", () => {
  it("flags a NULL totp_secret as repair-eligible (permanent lockout)", () => {
    const result = classifyUser(baseRow({ totp_secret: null }));
    expect(result.repairEligible).toBe(true);
    expect(result.problems).toContainEqual(
      expect.objectContaining({
        category: CATEGORY.TOTP_SECRET_MISSING,
        severity: "repair-eligible",
      }),
    );
  });

  it("does not check totp_secret for email-method users, even if null", () => {
    const result = classifyUser(
      baseRow({ two_factor_method: "email", totp_secret: null }),
    );
    expect(
      result.problems.find((p) => p.category === CATEGORY.TOTP_SECRET_MISSING),
    ).toBeUndefined();
  });

  it("flags the legacy 'plain:' marker as repair-eligible", () => {
    const result = classifyUser(
      baseRow({ totp_secret: "plain:some-old-secret" }),
    );
    expect(result.repairEligible).toBe(true);
    expect(result.problems[0].category).toBe(
      CATEGORY.TOTP_SECRET_LEGACY_PLAINTEXT,
    );
  });

  it("flags a value that fails to decrypt as repair-eligible", () => {
    const result = classifyUser(
      baseRow({ totp_secret: "not-valid-base64-ciphertext!!" }),
    );
    expect(result.repairEligible).toBe(true);
    expect(result.problems[0].category).toBe(
      CATEGORY.TOTP_SECRET_DECRYPT_FAILED,
    );
  });

  it("flags a value that decrypts cleanly but isn't a real TOTP seed as repair-eligible", () => {
    // Simulates security-migration.ts's migratePlaintextSecretsToEncrypted()
    // re-encrypting old ciphertext (garbage under the new key) as if it
    // were plaintext after an API_KEY_ENCRYPTION_KEY rotation.
    const garbage = encryptApiKey("this is not a base32 totp seed");
    const result = classifyUser(baseRow({ totp_secret: garbage }));
    expect(result.repairEligible).toBe(true);
    expect(result.problems[0].category).toBe(
      CATEGORY.TOTP_SECRET_DECRYPTS_TO_GARBAGE,
    );
  });

  it("does not flag a real, correctly-encrypted secret", () => {
    const secret = encryptApiKey(generateSecret());
    const result = classifyUser(baseRow({ totp_secret: secret }));
    expect(result.repairEligible).toBe(false);
    expect(result.problems).toEqual([]);
  });

  it("reports encryption-not-configured as a warning, never repair-eligible", () => {
    // Encrypt while the key IS configured (a real row written by the app
    // would have a genuinely valid ciphertext); only THEN simulate this
    // diagnostic run happening without the key available.
    const secret = encryptApiKey(generateSecret());
    const saved = process.env.API_KEY_ENCRYPTION_KEY;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    try {
      const result = classifyUser(baseRow({ totp_secret: secret }));
      expect(result.repairEligible).toBe(false);
      expect(result.problems).toContainEqual(
        expect.objectContaining({
          category: CATEGORY.ENCRYPTION_NOT_CONFIGURED,
          severity: "warning",
        }),
      );
    } finally {
      process.env.API_KEY_ENCRYPTION_KEY = saved;
    }
  });
});

describe("REPAIR_ELIGIBLE_CATEGORIES / describeCategory", () => {
  it("every repair-eligible category has a human-readable description", () => {
    for (const category of REPAIR_ELIGIBLE_CATEGORIES) {
      expect(describeCategory(category)).not.toBe(category);
      expect(typeof describeCategory(category)).toBe("string");
    }
  });

  it("warning-only categories are not in the repair-eligible set", () => {
    expect(
      REPAIR_ELIGIBLE_CATEGORIES.has(CATEGORY.BACKUP_CODES_BAD_FORMAT),
    ).toBe(false);
    expect(REPAIR_ELIGIBLE_CATEGORIES.has(CATEGORY.BACKUP_CODES_MISSING)).toBe(
      false,
    );
    expect(
      REPAIR_ELIGIBLE_CATEGORIES.has(CATEGORY.ENCRYPTION_NOT_CONFIGURED),
    ).toBe(false);
  });
});

describe("classifyEmail2FACodeRow", () => {
  it("flags an expired row", () => {
    const result = classifyEmail2FACodeRow(
      {
        id: 1,
        user_id: 5,
        code_hash: "a".repeat(64),
        code_salt: "somesalt",
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
      { hasCodeSalt: true },
    );
    expect(result.problems).toContainEqual(
      expect.objectContaining({ category: "email_2fa_code_expired_uncleaned" }),
    );
  });

  it("flags a malformed code_hash", () => {
    const result = classifyEmail2FACodeRow(
      {
        id: 1,
        user_id: 5,
        code_hash: "not-hex",
        code_salt: "somesalt",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      { hasCodeSalt: true },
    );
    expect(result.problems).toContainEqual(
      expect.objectContaining({ category: "email_2fa_code_malformed_hash" }),
    );
  });

  it("flags an unsalted sentinel row only when the column exists", () => {
    const row = {
      id: 1,
      user_id: 5,
      code_hash: "a".repeat(64),
      code_salt: "0",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(
      classifyEmail2FACodeRow(row, { hasCodeSalt: true }).problems,
    ).toContainEqual(
      expect.objectContaining({ category: "email_2fa_code_unsalted" }),
    );
    expect(
      classifyEmail2FACodeRow(row, { hasCodeSalt: false }).problems.find(
        (p) => p.category === "email_2fa_code_unsalted",
      ),
    ).toBeUndefined();
  });

  it("never returns a repair-eligible severity (hygiene-only, out of repair scope)", () => {
    const result = classifyEmail2FACodeRow(
      {
        id: 1,
        user_id: 5,
        code_hash: "not-hex",
        code_salt: "0",
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
      { hasCodeSalt: true },
    );
    expect(result.problems.every((p) => p.severity === "warning")).toBe(true);
  });

  it("reports no problems for a clean row", () => {
    const result = classifyEmail2FACodeRow(
      {
        id: 1,
        user_id: 5,
        code_hash: "a".repeat(64),
        code_salt: "realsalt",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      { hasCodeSalt: true },
    );
    expect(result.problems).toEqual([]);
  });
});
