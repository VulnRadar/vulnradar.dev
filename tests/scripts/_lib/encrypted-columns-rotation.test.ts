import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptApiKey } from "@/lib/auth/crypto";
import { generateSecret } from "@/lib/auth/totp";
import { diagnose } from "../../../scripts/_lib/_lib.check-encrypted-columns.mjs";
import {
  classifyUser,
  CATEGORY,
  REPAIR_ELIGIBLE_CATEGORIES,
} from "../../../scripts/_lib/_lib.2fa-diagnostics.mjs";
import {
  getEncryptionKey,
  getPreviousEncryptionKey,
  isEncryptionConfigured,
} from "../../../scripts/_lib/_lib.2fa-crypto-mirror.mjs";
import { computeApiKeyLocatorMirror } from "../../../scripts/_lib/_lib.api-key-locator-mirror.mjs";
import { makeQueryRouterPool, containsAll } from "../_query-router-mock";

/**
 * gap-migration-upgrade-path-2. A key rotation is a documented procedure
 * (lib/auth/crypto.ts): the old value goes in PREVIOUS_API_KEY_ENCRYPTION_KEY
 * and the app keeps reading what was written under it. The repair tools only
 * knew about the current key, so in that window every healthy row looked
 * corrupt, and `--apply` then revoked API keys, deleted Discord and GitHub
 * connections, cleared webhook secrets and switched off 2FA.
 */

const OLD_HEX = randomBytes(32).toString("hex");
const NEW_HEX = randomBytes(32).toString("hex");
const OTHER_HEX = randomBytes(32).toString("hex");
const OLD_KEY = Buffer.from(OLD_HEX, "hex");
const NEW_KEY = Buffer.from(NEW_HEX, "hex");

const originalCurrent = process.env.API_KEY_ENCRYPTION_KEY;
const originalPrevious = process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** The real app encryption, with the key it would have held at the time. */
function encryptUnder(hex: string, plaintext: string): string {
  const current = process.env.API_KEY_ENCRYPTION_KEY;
  process.env.API_KEY_ENCRYPTION_KEY = hex;
  try {
    return encryptApiKey(plaintext);
  } finally {
    restore("API_KEY_ENCRYPTION_KEY", current);
  }
}

beforeEach(() => {
  process.env.API_KEY_ENCRYPTION_KEY = NEW_HEX;
  process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = OLD_HEX;
});

afterEach(() => {
  restore("API_KEY_ENCRYPTION_KEY", originalCurrent);
  restore("PREVIOUS_API_KEY_ENCRYPTION_KEY", originalPrevious);
});

function appUser(totpSecret: string) {
  return {
    id: 7,
    totp_enabled: true,
    totp_secret: totpSecret,
    backup_codes: "[]",
    two_factor_method: "app",
  };
}

describe("classifyUser during a key rotation", () => {
  it("does not offer to reset 2FA for a seed still on the previous key", () => {
    const result = classifyUser(
      appUser(encryptUnder(OLD_HEX, generateSecret())),
    );
    expect(result.repairEligible).toBe(false);
    expect(result.problems).toEqual([
      expect.objectContaining({
        category: CATEGORY.TOTP_SECRET_ON_PREVIOUS_KEY,
        severity: "warning",
      }),
    ]);
  });

  it("reports nothing for a seed already on the current key", () => {
    const result = classifyUser(
      appUser(encryptUnder(NEW_HEX, generateSecret())),
    );
    expect(result.problems).toEqual([]);
  });

  it("calls a seed broken only when neither key opens it", () => {
    const result = classifyUser(
      appUser(encryptUnder(OTHER_HEX, generateSecret())),
    );
    expect(result.repairEligible).toBe(true);
    expect(result.problems.map((p) => p.category)).toEqual([
      CATEGORY.TOTP_SECRET_DECRYPT_FAILED,
    ]);
  });

  it("still calls it broken when no rotation is in progress", () => {
    delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
    const result = classifyUser(
      appUser(encryptUnder(OLD_HEX, generateSecret())),
    );
    expect(result.repairEligible).toBe(true);
  });

  it("refuses to call anything broken while the previous key is unusable", () => {
    // The operator has said a rotation is in progress and mistyped the value.
    // Reading that as "no rotation" is how a typo would turn into a mass 2FA
    // reset, so the row is reported and left alone.
    process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = "g".repeat(64);
    const result = classifyUser(
      appUser(encryptUnder(OLD_HEX, generateSecret())),
    );
    expect(result.repairEligible).toBe(false);
    expect(result.problems.map((p) => p.category)).toEqual([
      CATEGORY.PREVIOUS_KEY_UNUSABLE,
    ]);
  });

  it("keeps the rotation categories out of what the repair may act on", () => {
    expect(
      REPAIR_ELIGIBLE_CATEGORIES.has(CATEGORY.TOTP_SECRET_ON_PREVIOUS_KEY),
    ).toBe(false);
    expect(REPAIR_ELIGIBLE_CATEGORIES.has(CATEGORY.PREVIOUS_KEY_UNUSABLE)).toBe(
      false,
    );
  });

  it("treats a 64-character value that is not hex as no key at all", () => {
    // Buffer.from(_, "hex") stops at the first bad pair, so this used to give
    // a short key and a decrypt failure on every row.
    process.env.API_KEY_ENCRYPTION_KEY = "z".repeat(64);
    const result = classifyUser(
      appUser(encryptUnder(NEW_HEX, generateSecret())),
    );
    expect(result.repairEligible).toBe(false);
    expect(result.problems.map((p) => p.category)).toEqual([
      CATEGORY.ENCRYPTION_NOT_CONFIGURED,
    ]);
  });
});

describe("the mirror's key validation", () => {
  it("applies the same 64-hex rule to both keys", () => {
    expect(getEncryptionKey()).toEqual(NEW_KEY);
    expect(getPreviousEncryptionKey()).toEqual(OLD_KEY);

    process.env.API_KEY_ENCRYPTION_KEY = "z".repeat(64);
    process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = "z".repeat(64);
    expect(getEncryptionKey()).toBeNull();
    expect(isEncryptionConfigured()).toBe(false);
    expect(getPreviousEncryptionKey()).toBeNull();
  });
});

function ctxFor(table: string, columns: string[]) {
  return {
    tables: new Set([table]),
    columnsDetailed: { [table]: columns.map((name) => ({ name })) },
    primaryKeys: {},
    foreignKeys: [],
    checkConstraintEnums: [],
  };
}

function poolReturning(table: string, rows: Record<string, unknown>[]) {
  return makeQueryRouterPool([
    { match: containsAll(`FROM "${table}"`), handler: () => ({ rows }) },
  ]);
}

interface Finding {
  severity: string;
  category: string;
  column: string;
  count: number;
  description: string;
  repair?: { sql: string };
}

const repairs = (findings: Finding[]) =>
  findings.filter((f) => f.severity === "auto-fixable");

describe("encrypted columns during a key rotation", () => {
  const CASES: [
    string,
    string[],
    (value: string) => Record<string, unknown>,
  ][] = [
    ["webhooks", ["id", "secret"], (value) => ({ id: 1, secret: value })],
    [
      "user_ai_configs",
      ["id", "api_key_encrypted"],
      (value) => ({ id: 1, api_key_encrypted: value }),
    ],
    [
      "github_connections",
      ["id", "access_token_encrypted"],
      (value) => ({ id: 1, access_token_encrypted: value }),
    ],
    [
      "discord_connections",
      ["id", "access_token", "refresh_token"],
      (value) => ({ id: 1, access_token: value, refresh_token: value }),
    ],
  ];

  it.each(CASES)(
    "leaves %s alone when its value is on the previous key",
    async (table, columns, row) => {
      const { findings } = await diagnose(
        poolReturning(table, [row(encryptUnder(OLD_HEX, "tok"))]),
        ctxFor(table, columns),
      );
      expect(repairs(findings)).toEqual([]);
      expect(findings.length).toBeGreaterThan(0);
      for (const finding of findings) {
        expect(finding.severity).toBe("needs-human");
        expect(finding.category).toBe("encrypted_column_on_previous_key");
        expect(finding.count).toBe(1);
        expect(finding.repair).toBeUndefined();
      }
    },
  );

  it.each(CASES)(
    "still repairs %s when neither key opens the value",
    async (table, columns, row) => {
      const { findings } = await diagnose(
        poolReturning(table, [row(encryptUnder(OTHER_HEX, "tok"))]),
        ctxFor(table, columns),
      );
      expect(repairs(findings)).toHaveLength(1);
    },
  );

  const apiKeyCtx = ctxFor("api_keys", ["id", "key_encrypted", "key_locator"]);
  const RAW = "vr_live_rotationcase";

  it("does not revoke an API key whose ciphertext and locator predate the rotation", async () => {
    const { findings } = await diagnose(
      poolReturning("api_keys", [
        {
          id: 1,
          key_encrypted: encryptUnder(OLD_HEX, RAW),
          key_locator: computeApiKeyLocatorMirror(RAW, OLD_KEY),
        },
      ]),
      apiKeyCtx,
    );
    expect(repairs(findings)).toEqual([]);
  });

  it("accepts a locator from either key, whichever key opened the ciphertext", async () => {
    // A row is rewritten on first use after a rotation, so the two columns
    // are not guaranteed to have moved together.
    const { findings } = await diagnose(
      poolReturning("api_keys", [
        {
          id: 1,
          key_encrypted: encryptUnder(NEW_HEX, RAW),
          key_locator: computeApiKeyLocatorMirror(RAW, OLD_KEY),
        },
        {
          id: 2,
          key_encrypted: encryptUnder(OLD_HEX, RAW),
          key_locator: computeApiKeyLocatorMirror(RAW, NEW_KEY),
        },
      ]),
      apiKeyCtx,
    );
    expect(repairs(findings)).toEqual([]);
  });

  it("still revokes a key whose locator matches under neither key", async () => {
    const { findings } = await diagnose(
      poolReturning("api_keys", [
        {
          id: 3,
          key_encrypted: encryptUnder(OLD_HEX, RAW),
          key_locator: "00000000",
        },
      ]),
      apiKeyCtx,
    );
    expect(repairs(findings)).toHaveLength(1);
    expect(repairs(findings)[0].repair?.sql).toContain("IN (3)");
  });

  it("names only the broken rows in a repair when some are merely on the old key", async () => {
    const { findings, meta } = await diagnose(
      poolReturning("webhooks", [
        { id: 1, secret: encryptUnder(OLD_HEX, "s") },
        { id: 2, secret: encryptUnder(OTHER_HEX, "s") },
        { id: 3, secret: encryptUnder(NEW_HEX, "s") },
      ]),
      ctxFor("webhooks", ["id", "secret"]),
    );
    expect(repairs(findings)).toHaveLength(1);
    expect(repairs(findings)[0].repair?.sql).toContain("IN (2)");
    expect((meta as { stillOnPreviousKey: number }).stillOnPreviousKey).toBe(1);
  });

  it("reports every column as unchecked while the previous key is unusable", async () => {
    process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = "g".repeat(64);
    const { findings } = await diagnose(
      poolReturning("webhooks", [
        { id: 1, secret: encryptUnder(OLD_HEX, "s") },
      ]),
      ctxFor("webhooks", ["id", "secret"]),
    );
    expect(repairs(findings)).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("needs-human");
    expect(findings[0].description).toContain(
      "PREVIOUS_API_KEY_ENCRYPTION_KEY",
    );
  });

  it("behaves as before when no rotation is in progress", async () => {
    delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
    const { findings, meta } = await diagnose(
      poolReturning("webhooks", [
        { id: 1, secret: encryptUnder(OLD_HEX, "s") },
      ]),
      ctxFor("webhooks", ["id", "secret"]),
    );
    expect(repairs(findings)).toHaveLength(1);
    expect((meta as { stillOnPreviousKey: number }).stillOnPreviousKey).toBe(0);
  });
});
