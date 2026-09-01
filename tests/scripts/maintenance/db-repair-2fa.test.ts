import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptApiKey } from "@/lib/auth/crypto";
import { generateSecret } from "@/lib/auth/totp";
import { runRepair } from "../../../scripts/maintenance/db-repair-2fa.mjs";
import { buildMockPool, buildMockClient } from "../_pg-mock";

const KEY_HEX = randomBytes(32).toString("hex");
const originalKey = process.env.API_KEY_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_KEY = KEY_HEX;
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = originalKey;
});

function goodUser(id: number) {
  return {
    id,
    totp_enabled: true,
    totp_secret: encryptApiKey(generateSecret()),
    backup_codes: JSON.stringify([]),
    two_factor_method: "app",
  };
}

function brokenUser(id: number) {
  return {
    id,
    totp_enabled: true,
    totp_secret: encryptApiKey(generateSecret()),
    backup_codes: "{not valid json",
    two_factor_method: "app",
  };
}

describe("runRepair: dry run (default) makes zero writes", () => {
  it("never calls pool.connect and only issues read queries", async () => {
    const pool = buildMockPool({
      enabledUsers: [goodUser(1), brokenUser(2), brokenUser(3)],
    });

    const result = await runRepair(pool, { apply: false });

    expect(result.dryRun).toBe(true);
    expect(result.repairTargets.map((t) => t.userId).sort()).toEqual([2, 3]);
    expect(result.results).toEqual([]);
    expect(result.backupFile).toBeNull();
    expect(pool.connect).not.toHaveBeenCalled();
    for (const call of pool.query.mock.calls) {
      const sql = String(call[0]).trim().toUpperCase();
      expect(sql.startsWith("SELECT")).toBe(true);
    }
  });

  it("also makes zero writes when apply is requested but there is nothing repair-eligible", async () => {
    const pool = buildMockPool({ enabledUsers: [goodUser(1)] });

    const result = await runRepair(pool, { apply: true, adminId: 1 });
    expect(result.repairTargets).toEqual([]);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe("runRepair: apply mode", () => {
  it("requires a valid --admin-id that exists in users (admin_audit_log FK)", async () => {
    const pool = buildMockPool({
      enabledUsers: [brokenUser(2)],
      adminRows: [],
    });
    await expect(
      runRepair(pool, { apply: true, adminId: 999 }),
    ).rejects.toThrow(/does not match any row/);

    const pool2 = buildMockPool({ enabledUsers: [brokenUser(2)] });
    await expect(
      runRepair(pool2, { apply: true, adminId: null }),
    ).rejects.toThrow(/valid --admin-id/);
  });

  it("only touches rows already proven broken, writes the backup file, and audit-logs each fix", async () => {
    const good = goodUser(1);
    const brokenA = brokenUser(2);
    const brokenB = brokenUser(3);
    const pool = buildMockPool({
      enabledUsers: [good, brokenA, brokenB],
      adminRows: [{ id: 10, email: "admin@example.com", role: "admin" }],
    });

    const clientA = buildMockClient(async () => ({ rows: [] }));
    const clientB = buildMockClient(async () => ({ rows: [] }));
    pool.connect = vi
      .fn()
      .mockResolvedValueOnce(clientA)
      .mockResolvedValueOnce(clientB);
    const connect = pool.connect;

    interface BackupEntry {
      userId: number;
      hadTotpSecret: boolean;
      method: string;
      categories: string[];
    }
    const writeBackupFile = vi.fn(
      (_args: { timestamp: Date; adminId: number; entries: BackupEntry[] }) =>
        "/fake/path/2fa-repair-test.json",
    );

    const result = await runRepair(pool, {
      apply: true,
      adminId: 10,
      writeBackupFile,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(result.backupFile).toBe("/fake/path/2fa-repair-test.json");

    // Backup file only records the fact-of-existence for the broken users.
    expect(writeBackupFile).toHaveBeenCalledTimes(1);
    const backupArg = writeBackupFile.mock.calls[0]?.[0];
    expect(backupArg).toBeDefined();
    expect(backupArg!.adminId).toBe(10);
    expect(backupArg!.entries.map((e) => e.userId).sort()).toEqual([2, 3]);
    for (const entry of backupArg!.entries) {
      expect(entry).not.toHaveProperty("totp_secret");
      expect(entry).not.toHaveProperty("backup_codes");
    }

    // Good user 1 is never touched by any transaction.
    const allSql = [
      ...clientA.query.mock.calls,
      ...clientB.query.mock.calls,
    ].map((c) => String(c[0]));
    expect(allSql.some((sql) => sql.includes("UPDATE users"))).toBe(true);

    const updateCallsA = clientA.query.mock.calls.filter((c) =>
      String(c[0]).includes("UPDATE users"),
    );
    expect(updateCallsA[0][1]).toEqual([2]);
    const updateCallsB = clientB.query.mock.calls.filter((c) =>
      String(c[0]).includes("UPDATE users"),
    );
    expect(updateCallsB[0][1]).toEqual([3]);

    // Every good user id (1) never appears as an UPDATE/audit target.
    for (const call of [
      ...clientA.query.mock.calls,
      ...clientB.query.mock.calls,
    ]) {
      const sql = String(call[0]);
      if (sql.includes("UPDATE users") || sql.includes("admin_audit_log")) {
        expect(call[1]).not.toContain(1);
      }
    }

    // Audit log entries use the same action string as the admin UI's
    // manual "Reset 2FA" button (app/api/v3/admin/route.ts).
    const auditCallsA = clientA.query.mock.calls.filter((c) =>
      String(c[0]).includes("admin_audit_log"),
    );
    const auditParamsA = auditCallsA[0]?.[1] ?? [];
    expect(auditParamsA[0]).toBe(10); // admin_id
    expect(auditParamsA[1]).toBe(2); // target_user_id
    expect(auditParamsA[2]).toBe("reset_2fa");

    expect(clientA.query).toHaveBeenCalledWith("BEGIN");
    expect(clientA.query).toHaveBeenCalledWith("COMMIT");
    expect(clientA.release).toHaveBeenCalled();
    expect(clientB.release).toHaveBeenCalled();

    expect(result.results).toEqual(
      expect.arrayContaining([
        { userId: 2, ok: true },
        { userId: 3, ok: true },
      ]),
    );
  });

  it("one user's transaction failure does not roll back or block another user's already-completed fix", async () => {
    const brokenA = brokenUser(2);
    const brokenB = brokenUser(3);
    const pool = buildMockPool({
      enabledUsers: [brokenA, brokenB],
      adminRows: [{ id: 10, email: "admin@example.com", role: "admin" }],
    });

    // Client A: the UPDATE itself fails (simulated DB error).
    const clientA = buildMockClient((sql: string) => {
      if (sql.includes("UPDATE users")) {
        throw new Error("simulated DB failure for user 2");
      }
      return { rows: [] };
    });
    // Client B: succeeds normally.
    const clientB = buildMockClient(async () => ({ rows: [] }));

    pool.connect = vi
      .fn()
      .mockResolvedValueOnce(clientA)
      .mockResolvedValueOnce(clientB);

    const result = await runRepair(pool, {
      apply: true,
      adminId: 10,
      writeBackupFile: () => "/fake/path.json",
    });

    expect(result.results).toEqual(
      expect.arrayContaining([
        {
          userId: 2,
          ok: false,
          error: expect.stringContaining("simulated DB failure"),
        },
        { userId: 3, ok: true },
      ]),
    );

    // A rolled back, never committed.
    expect(clientA.query).toHaveBeenCalledWith("ROLLBACK");
    expect(clientA.query).not.toHaveBeenCalledWith("COMMIT");

    // B was entirely unaffected by A's failure: it still ran and committed.
    expect(clientB.query).toHaveBeenCalledWith("BEGIN");
    expect(clientB.query).toHaveBeenCalledWith("COMMIT");
    const bUpdate = clientB.query.mock.calls.find((c) =>
      String(c[0]).includes("UPDATE users"),
    );
    expect(bUpdate?.[1]).toEqual([3]);

    // Both clients are released regardless of outcome.
    expect(clientA.release).toHaveBeenCalled();
    expect(clientB.release).toHaveBeenCalled();
  });
});
