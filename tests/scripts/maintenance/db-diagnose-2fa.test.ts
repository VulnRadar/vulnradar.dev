import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptApiKey } from "@/lib/auth/crypto";
import { generateSecret } from "@/lib/auth/totp";
import { runDiagnostics } from "../../../scripts/maintenance/db-diagnose-2fa.mjs";
import {
  buildMockPool,
  V5_5_SCHEMA_ROWS,
  V2_SCHEMA_ROWS_NO_CODE_SALT,
} from "../_pg-mock";

const KEY_HEX = randomBytes(32).toString("hex");
const originalKey = process.env.API_KEY_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_KEY = KEY_HEX;
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = originalKey;
});

function goodUserRow(id: number) {
  return {
    id,
    totp_enabled: true,
    totp_secret: encryptApiKey(generateSecret()),
    backup_codes: JSON.stringify([]),
    two_factor_method: "app",
  };
}

describe("runDiagnostics: read-only, never writes", () => {
  it("only ever issues SELECT/COUNT queries", async () => {
    const pool = buildMockPool({
      totalUsers: 1,
      enabledUsers: [goodUserRow(1)],
    });
    await runDiagnostics(pool);
    for (const call of pool.query.mock.calls) {
      const sql = String(call[0]).trim().toUpperCase();
      expect(sql.startsWith("SELECT")).toBe(true);
    }
  });
});

describe("runDiagnostics: backup_codes classification", () => {
  it("identifies a malformed backup_codes JSON string as repair-eligible", async () => {
    const row = {
      id: 42,
      totp_enabled: true,
      totp_secret: encryptApiKey(generateSecret()),
      backup_codes: "{not valid json",
      two_factor_method: "app",
    };
    const pool = buildMockPool({ totalUsers: 1, enabledUsers: [row] });
    const report = await runDiagnostics(pool);

    expect(report.userResults).toHaveLength(1);
    const result = report.userResults[0];
    expect(result.userId).toBe(42);
    expect(result.repairEligible).toBe(true);
    expect(result.problems[0].category).toBe("backup_codes_malformed_json");
  });

  it("reports no problems for a well-formed, valid user", async () => {
    const pool = buildMockPool({
      totalUsers: 1,
      enabledUsers: [goodUserRow(7)],
    });
    const report = await runDiagnostics(pool);

    expect(report.userResults).toHaveLength(1);
    expect(report.userResults[0].repairEligible).toBe(false);
    expect(report.userResults[0].problems).toEqual([]);
  });
});

describe("runDiagnostics: 2FA-disabled users are skipped entirely", () => {
  it("excludes disabled users from the enabled-user classification, but still counts them in totalUsers", async () => {
    // enabledUsers simulates the DB's own `WHERE totp_enabled = true`
    // filter already having excluded a disabled user; totalUsers reflects
    // the unfiltered COUNT(*).
    const pool = buildMockPool({ totalUsers: 5, enabledUsers: [] });
    const report = await runDiagnostics(pool);

    expect(report.totalUsers).toBe(5);
    expect(report.totpEnabledUsers).toBe(0);
    expect(report.userResults).toEqual([]);

    const usersQuery = pool.query.mock.calls.find((c) =>
      String(c[0]).includes("FROM users WHERE"),
    );
    expect(usersQuery?.[0]).toContain("totp_enabled = true");
  });
});

describe("runDiagnostics: schema-aware degradation", () => {
  it("degrades gracefully when email_2fa_codes.code_salt is missing (older schema)", async () => {
    const pool = buildMockPool({
      schemaRows: V2_SCHEMA_ROWS_NO_CODE_SALT,
      totalUsers: 1,
      enabledUsers: [goodUserRow(1)],
      emailCodeRows: [
        {
          id: 1,
          user_id: 1,
          code_hash: "a".repeat(64),
          expires_at: new Date().toISOString(),
        },
      ],
    });
    const report = await runDiagnostics(pool);

    expect(report.fatal).toBeUndefined();
    expect(report.skipped.some((s: string) => s.includes("code_salt"))).toBe(
      true,
    );
    // The rest of the email hygiene check still runs.
    expect(report.emailCodesScanned).toBe(1);
  });

  it("degrades gracefully (fatal, not a crash) when the users table doesn't exist", async () => {
    const pool = buildMockPool({ schemaRows: [] });
    const report = await runDiagnostics(pool);
    expect(report.fatal).toMatch(/users.*does not exist/i);
  });

  it("degrades gracefully (fatal, not a crash) when a required users column is missing", async () => {
    const pool = buildMockPool({
      schemaRows: V5_5_SCHEMA_ROWS.filter(
        (r) =>
          !(r.table_name === "users" && r.column_name === "two_factor_method"),
      ),
    });
    const report = await runDiagnostics(pool);
    expect(report.fatal).toMatch(/two_factor_method/);
  });

  it("skips the email hygiene check (without crashing) when email_2fa_codes doesn't exist at all", async () => {
    const pool = buildMockPool({
      schemaRows: V5_5_SCHEMA_ROWS.filter(
        (r) => r.table_name !== "email_2fa_codes",
      ),
      totalUsers: 1,
      enabledUsers: [goodUserRow(1)],
    });
    const report = await runDiagnostics(pool);
    expect(report.fatal).toBeUndefined();
    expect(report.emailCodesScanned).toBe(0);
    expect(
      report.skipped.some((s: string) => s.includes("email_2fa_codes table")),
    ).toBe(true);
  });

  it("notes when API_KEY_ENCRYPTION_KEY is unset instead of crashing", async () => {
    // Build the row (which needs a real key to produce valid ciphertext)
    // before removing the key, to simulate this diagnostic run happening
    // without the key available -- not a database full of invalid data.
    const row = goodUserRow(1);
    const saved = process.env.API_KEY_ENCRYPTION_KEY;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    try {
      const pool = buildMockPool({ totalUsers: 1, enabledUsers: [row] });
      const report = await runDiagnostics(pool);
      expect(report.fatal).toBeUndefined();
      expect(
        report.skipped.some((s: string) =>
          s.includes("API_KEY_ENCRYPTION_KEY"),
        ),
      ).toBe(true);
    } finally {
      process.env.API_KEY_ENCRYPTION_KEY = saved;
    }
  });
});
