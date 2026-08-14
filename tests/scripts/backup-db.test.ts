import { describe, it, expect } from "vitest";
import {
  backupFileName,
  selectExpiredBackups,
  createBackupCipher,
  createBackupDecipher,
} from "../../scripts/backup-db.mjs";

describe("backupFileName", () => {
  it("produces a filesystem-safe name with no colons or dots in the timestamp", () => {
    const name = backupFileName(new Date("2026-08-14T03:04:05.678Z"));
    expect(name).toBe("vulnradar-backup-2026-08-14T03-04-05-678Z.sql.gz");
    expect(name).not.toContain(":");
  });
});

describe("selectExpiredBackups", () => {
  const now = new Date("2026-08-14T00:00:00.000Z");
  const daysAgo = (n: number) => now.getTime() - n * 24 * 60 * 60 * 1000;

  it("selects only backup files older than the retention window", () => {
    const entries = [
      { name: "vulnradar-backup-old.sql.gz", mtimeMs: daysAgo(20) },
      { name: "vulnradar-backup-recent.sql.gz", mtimeMs: daysAgo(1) },
    ];
    expect(selectExpiredBackups(entries, 14, now)).toEqual([
      "vulnradar-backup-old.sql.gz",
    ]);
  });

  it("ignores files that aren't VulnRadar backups, even if old", () => {
    const entries = [{ name: "some-other-file.txt", mtimeMs: daysAgo(999) }];
    expect(selectExpiredBackups(entries, 14, now)).toEqual([]);
  });

  it("disables pruning entirely when retentionDays is 0 or falsy", () => {
    const entries = [
      { name: "vulnradar-backup-ancient.sql.gz", mtimeMs: daysAgo(9999) },
    ];
    expect(selectExpiredBackups(entries, 0, now)).toEqual([]);
    expect(selectExpiredBackups(entries, undefined, now)).toEqual([]);
  });

  it("treats a file exactly at the cutoff as not yet expired", () => {
    const entries = [
      { name: "vulnradar-backup-boundary.sql.gz", mtimeMs: daysAgo(14) },
    ];
    expect(selectExpiredBackups(entries, 14, now)).toEqual([]);
  });
});

describe("createBackupCipher / createBackupDecipher", () => {
  const key = "a".repeat(64); // valid 32-byte hex key

  it("round-trips plaintext through encryption and decryption", () => {
    const { cipher, ivHex, getAuthTagHex } = createBackupCipher(key);
    const plaintext = Buffer.from(
      "pg_dump output goes here, potentially large",
    );
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTagHex = getAuthTagHex();

    const decipher = createBackupDecipher(key, ivHex, authTagHex);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    expect(decrypted.toString()).toBe(plaintext.toString());
  });

  it("produces a different IV on every call, so no two backups share a keystream", () => {
    const a = createBackupCipher(key);
    const b = createBackupCipher(key);
    expect(a.ivHex).not.toBe(b.ivHex);
  });

  it("fails decryption (auth tag mismatch) if the ciphertext was tampered with", () => {
    const { cipher, ivHex, getAuthTagHex } = createBackupCipher(key);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from("original data")),
      cipher.final(),
    ]);
    const authTagHex = getAuthTagHex();

    const tampered = Buffer.from(encrypted);
    tampered[0] ^= 0xff;

    const decipher = createBackupDecipher(key, ivHex, authTagHex);
    expect(() => {
      decipher.update(tampered);
      decipher.final();
    }).toThrow();
  });

  it("rejects a key that isn't exactly 64 hex characters", () => {
    expect(() => createBackupCipher("too-short")).toThrow(
      /64-character hex string/,
    );
    expect(() => createBackupCipher("g".repeat(64))).toThrow(
      /64-character hex string/,
    );
  });
});
