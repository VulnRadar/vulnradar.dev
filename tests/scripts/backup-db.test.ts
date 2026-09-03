import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  backupFileName,
  selectExpiredBackups,
  createBackupCipher,
  createBackupDecipher,
  describePgDumpError,
  pgDumpAvailable,
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

describe("describePgDumpError", () => {
  it("turns a bare ENOENT into an actionable postgresql-client message", () => {
    const enoent = Object.assign(new Error("spawn pg_dump ENOENT"), {
      code: "ENOENT",
    });
    const mapped = describePgDumpError(enoent);
    expect(mapped.message).toMatch(/pg_dump not found/);
    expect(mapped.message).toMatch(/postgresql-client/);
  });

  it("never leaks an absolute server path in the message", () => {
    const enoent = Object.assign(new Error("spawn pg_dump ENOENT"), {
      code: "ENOENT",
    });
    const mapped = describePgDumpError(enoent);
    // No Windows drive path and no absolute POSIX path segment.
    expect(mapped.message).not.toMatch(/[A-Za-z]:\\/);
    expect(mapped.message).not.toMatch(/\/(home|var|usr|app|root)\//);
  });

  it("passes non-ENOENT errors through unchanged", () => {
    const other = Object.assign(new Error("connection refused"), {
      code: "ECONNREFUSED",
    });
    expect(describePgDumpError(other)).toBe(other);
  });
});

/**
 * A failed backup must leave nothing behind.
 *
 * `createWriteStream(finalPath)` creates the destination the instant it is
 * called, before pg_dump has produced a byte, and every failure path after
 * that used to throw without removing it. Running the backup on a machine
 * without pg_dump three times left three 20-byte files, which is a bare gzip
 * header and no data at all.
 *
 * The consequence is worse than clutter: the admin panel lists this directory,
 * so those husks are presented as backups. An operator reads "3 backups" and
 * believes the database is protected by three files that would restore
 * nothing, and finds out otherwise at the only moment it matters.
 *
 * Asserted on the source because the failure only happens inside `runBackup`,
 * which spawns a real pg_dump and streams to a real path. That belongs in the
 * integration tier, not here, where `pg` is faked. What this can prove is that
 * every throw between creating the file and declaring success still routes
 * through the cleanup.
 */
describe("a failed backup leaves no artefact", () => {
  const src = readFileSync("scripts/backup-db.mjs", "utf8");

  it("defines the cleanup helper", () => {
    expect(
      src,
      "discardPartial removes the half-written file and its sidecar",
    ).toContain("const discardPartial =");
    expect(src).toMatch(/unlink\(finalPath\)/);
    expect(src).toMatch(/unlink\(`\$\{finalPath\}\.json`\)/);
  });

  it("every throw after the file exists cleans up first", () => {
    // The window runs from createWriteStream to the success() call. Every
    // `throw` inside it must be preceded by a discardPartial() await.
    const from = src.indexOf("createWriteStream(finalPath)");
    const to = src.indexOf("success(");
    expect(from, "createWriteStream not found").toBeGreaterThan(-1);
    expect(to, "success() not found").toBeGreaterThan(from);

    const window = src.slice(from, to);
    const throws = [...window.matchAll(/\n(\s*)throw /g)];
    expect(
      throws.length,
      "expected throws in the danger window",
    ).toBeGreaterThan(1);

    for (const m of throws) {
      const before = window.slice(Math.max(0, m.index - 400), m.index);
      expect(
        before,
        `a throw at offset ${m.index} inside the write window does not call ` +
          `discardPartial() first, so a failed run would leave a file the ` +
          `admin panel lists as a backup.`,
      ).toContain("discardPartial()");
    }
  });

  it("cleans up on the built-in dumper's path too, not just pg_dump's", () => {
    // The window check above covers both branches because both live between
    // createWriteStream and success(). Named separately so a future
    // refactor that lifts the JavaScript branch out of that window has to
    // notice it is dropping the cleanup with it.
    const from = src.indexOf("const pool = createPool()");
    const to = src.indexOf("success(");
    expect(from, "the built-in dumper branch is gone").toBeGreaterThan(-1);
    expect(src.slice(from, to)).toContain("discardPartial()");
  });

  it("rejects a dump too small to contain anything", () => {
    // pg_dump can exit 0 having written only a gzip header. Keeping that is
    // the same lie as keeping a failed run's file.
    expect(src).toContain("MIN_USABLE_BACKUP_BYTES");
    expect(src).toMatch(/written\.size < MIN_USABLE_BACKUP_BYTES/);
    const declared = src.match(/MIN_USABLE_BACKUP_BYTES = (\d+)/)?.[1];
    expect(Number(declared)).toBeGreaterThan(20);
  });
});

/**
 * The fallback has to be AUTOMATIC.
 *
 * The audience for the built-in dumper is Pterodactyl and Pelican panel
 * installs, where postgresql-client cannot be added and pg_dump has therefore
 * never worked. A fallback sitting behind a flag somebody has to discover is
 * not a backup for them, so the flag exists as an override and the missing
 * binary is what actually triggers the switch.
 */
describe("choosing between pg_dump and the built-in dumper", () => {
  const src = readFileSync("scripts/backup-db.mjs", "utf8");

  it("probes for pg_dump without throwing, whether or not it is installed", async () => {
    // This machine may or may not have pg_dump; the probe has to answer
    // either way rather than rejecting or hanging, because it runs before
    // anything else on every backup.
    await expect(pgDumpAvailable()).resolves.toBeTypeOf("boolean");
  });

  it("switches on the probe, not on a flag", () => {
    expect(src).toMatch(
      /usePgDump\s*=\s*forceJs\s*\?\s*false\s*:\s*await pgDumpAvailable\(\)/,
    );
  });

  it("offers both a flag and an env var, because the admin panel passes no argv", () => {
    // lib/backup/run-backup.ts spawns this script with no arguments, so a
    // flag alone would be unreachable from the Backups page.
    expect(src).toContain('args.includes("--js")');
    expect(src).toContain('process.env.BACKUP_FORCE_JS === "1"');
  });

  it("shares gzip, encryption and the destination between both paths", () => {
    // Encryption, retention and offsite upload must not quietly become
    // pg_dump-only features: on the hosts this exists for, the built-in path
    // is the only one that ever runs.
    const tail = src.slice(src.indexOf("const tail = [gzip]"));
    expect(tail).toContain("createBackupCipher(encryptionKey)");
    expect(tail).toContain("pipeline([pgDump.stdout, ...tail])");
    expect(tail).toContain("pipeline([source, ...tail])");
  });
});
