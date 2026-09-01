import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackupCipher } from "../../scripts/backup-db.mjs";
import {
  restorePsqlArgs,
  decryptBackupToFile,
} from "../../scripts/restore-db.mjs";

describe("restorePsqlArgs", () => {
  it("passes ON_ERROR_STOP so a failed statement is not reported as success", () => {
    // psql defaults ON_ERROR_STOP to off: it logs each error, continues, and
    // exits 0. Without this flag a restore in which every statement failed
    // still printed "Restore complete."
    const args = restorePsqlArgs("postgresql://u@h:5432/db");
    expect(args).toContain("ON_ERROR_STOP=1");
    expect(args[args.indexOf("ON_ERROR_STOP=1") - 1]).toBe("-v");
  });

  it("wraps the whole dump in one transaction so a failure rolls back", () => {
    expect(restorePsqlArgs("postgresql://u@h:5432/db")).toContain(
      "--single-transaction",
    );
  });

  it("puts the connection string last and skips the operator's .psqlrc", () => {
    const args = restorePsqlArgs("postgresql://u@h:5432/db");
    expect(args.at(-1)).toBe("postgresql://u@h:5432/db");
    expect(args).toContain("-X");
  });
});

describe("decryptBackupToFile", () => {
  const key = "b".repeat(64); // valid 32-byte hex key

  async function withTempDir(fn: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "vulnradar-restore-test-"));
    try {
      await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  function encrypt(plaintext: Buffer) {
    const { cipher, ivHex, getAuthTagHex } = createBackupCipher(key);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return { ciphertext, meta: { iv: ivHex, authTag: getAuthTagHex() } };
  }

  it("writes the plaintext when the auth tag verifies", async () => {
    await withTempDir(async (dir) => {
      const plaintext = Buffer.from("CREATE TABLE users (id int);\n");
      const { ciphertext, meta } = encrypt(plaintext);
      const sourcePath = join(dir, "backup.sql.gz.enc");
      const destPath = join(dir, "backup.sql.gz");
      await writeFile(sourcePath, ciphertext);

      await decryptBackupToFile({ sourcePath, key, meta, destPath });

      expect((await readFile(destPath)).toString()).toBe(plaintext.toString());
    });
  });

  it("rejects a tampered backup instead of returning its leading plaintext", async () => {
    // The regression this guards: GCM emits plaintext block by block and only
    // authenticates on the final block, so piping the decipher straight into
    // psql executed most of a tampered dump before the check failed. This must
    // throw, and the caller must therefore never start psql at all.
    await withTempDir(async (dir) => {
      const plaintext = Buffer.from("x".repeat(4096));
      const { ciphertext, meta } = encrypt(plaintext);
      ciphertext[10] ^= 0xff;
      const sourcePath = join(dir, "backup.sql.gz.enc");
      const destPath = join(dir, "backup.sql.gz");
      await writeFile(sourcePath, ciphertext);

      await expect(
        decryptBackupToFile({ sourcePath, key, meta, destPath }),
      ).rejects.toThrow();
    });
  });

  it("rejects a truncated backup", async () => {
    await withTempDir(async (dir) => {
      const plaintext = Buffer.from("y".repeat(4096));
      const { ciphertext, meta } = encrypt(plaintext);
      const sourcePath = join(dir, "backup.sql.gz.enc");
      const destPath = join(dir, "backup.sql.gz");
      await writeFile(sourcePath, ciphertext.subarray(0, 2048));

      await expect(
        decryptBackupToFile({ sourcePath, key, meta, destPath }),
      ).rejects.toThrow();
    });
  });
});
