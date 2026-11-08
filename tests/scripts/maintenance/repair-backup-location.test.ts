import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultWriteBackupFile as writeRepairBackup } from "../../../scripts/maintenance/db-repair.mjs";
import { defaultWriteBackupFile as write2faRepairBackup } from "../../../scripts/maintenance/db-repair-2fa.mjs";

/**
 * `npm run db:repair` and `db:repair-2fa` write this file before they change a
 * row, and fail if they cannot. In the published image everything under
 * scripts/ is root-owned, so the only place they can write is BACKUP_DIR: the
 * folder they used to create under scripts/ stopped the documented repair with
 * EACCES before it did anything.
 */

const REPO_SCRIPTS = path.resolve(__dirname, "../../../scripts");
const FACTS = {
  timestamp: new Date("2026-01-02T03:04:05.000Z"),
  adminId: 7,
  entries: [],
};

describe.each([
  ["db-repair", writeRepairBackup, "db-repair"],
  ["db-repair-2fa", write2faRepairBackup, "2fa-repair"],
] as const)("%s's backup file", (_name, write, folder) => {
  let backupDir: string;
  const saved = process.env.BACKUP_DIR;

  beforeEach(() => {
    backupDir = mkdtempSync(path.join(tmpdir(), "repair-backup-"));
    process.env.BACKUP_DIR = backupDir;
  });

  afterEach(() => {
    rmSync(backupDir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = saved;
  });

  it("lands in a subfolder of BACKUP_DIR", () => {
    const file = write(FACTS);
    expect(path.dirname(file)).toBe(path.join(backupDir, folder));
    expect(JSON.parse(readFileSync(file, "utf8")).performedByAdminId).toBe(7);
  });

  it("does not need scripts/ to be writable", () => {
    expect(path.relative(REPO_SCRIPTS, write(FACTS))).toMatch(/^\.\./);
  });
});
