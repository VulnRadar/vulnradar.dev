import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackupCipher } from "../../scripts/backup-db.mjs";
import {
  restorePsqlArgs,
  decryptBackupToFile,
  backupKeyCandidates,
  decryptBackupWithFallback,
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

describe("backupKeyCandidates", () => {
  const CURRENT = "a".repeat(64);
  const PREVIOUS = "b".repeat(64);
  const DEDICATED = "c".repeat(64);

  it("is empty when no key is configured", () => {
    expect(backupKeyCandidates({})).toEqual([]);
  });

  it("uses API_KEY_ENCRYPTION_KEY as the fallback the way backup-db.mjs does", () => {
    expect(backupKeyCandidates({ API_KEY_ENCRYPTION_KEY: CURRENT })).toEqual([
      { name: "API_KEY_ENCRYPTION_KEY", key: CURRENT },
    ]);
  });

  it("prefers a dedicated BACKUP_ENCRYPTION_KEY", () => {
    const [first] = backupKeyCandidates({
      BACKUP_ENCRYPTION_KEY: DEDICATED,
      API_KEY_ENCRYPTION_KEY: CURRENT,
    });
    expect(first).toEqual({ name: "BACKUP_ENCRYPTION_KEY", key: DEDICATED });
  });

  it("tries PREVIOUS_API_KEY_ENCRYPTION_KEY second", () => {
    expect(
      backupKeyCandidates({
        API_KEY_ENCRYPTION_KEY: CURRENT,
        PREVIOUS_API_KEY_ENCRYPTION_KEY: PREVIOUS,
      }),
    ).toEqual([
      { name: "API_KEY_ENCRYPTION_KEY", key: CURRENT },
      { name: "PREVIOUS_API_KEY_ENCRYPTION_KEY", key: PREVIOUS },
    ]);
  });

  it("does not try the same key twice", () => {
    expect(
      backupKeyCandidates({
        API_KEY_ENCRYPTION_KEY: CURRENT,
        PREVIOUS_API_KEY_ENCRYPTION_KEY: CURRENT,
      }),
    ).toHaveLength(1);
  });

  it("does not treat a previous key alone as a key to restore with", () => {
    // Nothing configured as the current key means the operator has not set the
    // environment up, and the caller's "set BACKUP_ENCRYPTION_KEY" message is
    // the right answer rather than quietly decrypting with a retired key.
    expect(
      backupKeyCandidates({ PREVIOUS_API_KEY_ENCRYPTION_KEY: PREVIOUS }),
    ).toEqual([]);
  });
});

describe("decryptBackupWithFallback", () => {
  const OLD_KEY = "d".repeat(64);
  const NEW_KEY = "e".repeat(64);
  const plaintext = Buffer.from("CREATE TABLE users (id int);\n");

  async function withEncryptedBackup(
    key: string,
    fn: (args: {
      sourcePath: string;
      destPath: string;
      meta: { iv: string; authTag: string };
    }) => Promise<void>,
  ) {
    const dir = await mkdtemp(join(tmpdir(), "vulnradar-restore-fallback-"));
    try {
      const { cipher, ivHex, getAuthTagHex } = createBackupCipher(key);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const sourcePath = join(dir, "backup.sql.gz.enc");
      await writeFile(sourcePath, ciphertext);
      await fn({
        sourcePath,
        destPath: join(dir, "backup.sql.gz"),
        meta: { iv: ivHex, authTag: getAuthTagHex() },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("opens a backup from before a rotation with the previous key", async () => {
    await withEncryptedBackup(OLD_KEY, async (args) => {
      const fallbacks: string[] = [];
      const used = await decryptBackupWithFallback({
        ...args,
        candidates: [
          { name: "API_KEY_ENCRYPTION_KEY", key: NEW_KEY },
          { name: "PREVIOUS_API_KEY_ENCRYPTION_KEY", key: OLD_KEY },
        ],
        onFallback: (failed, next) =>
          fallbacks.push(`${failed.name} -> ${next.name}`),
      });

      expect(used).toBe("PREVIOUS_API_KEY_ENCRYPTION_KEY");
      expect(fallbacks).toEqual([
        "API_KEY_ENCRYPTION_KEY -> PREVIOUS_API_KEY_ENCRYPTION_KEY",
      ]);
      expect((await readFile(args.destPath)).toString()).toBe(
        plaintext.toString(),
      );
    });
  });

  it("does not fall back when the first key already opens the backup", async () => {
    await withEncryptedBackup(NEW_KEY, async (args) => {
      let fellBack = false;
      const used = await decryptBackupWithFallback({
        ...args,
        candidates: [
          { name: "API_KEY_ENCRYPTION_KEY", key: NEW_KEY },
          { name: "PREVIOUS_API_KEY_ENCRYPTION_KEY", key: OLD_KEY },
        ],
        onFallback: () => {
          fellBack = true;
        },
      });

      expect(used).toBe("API_KEY_ENCRYPTION_KEY");
      expect(fellBack).toBe(false);
    });
  });

  it("rejects when neither key opens the backup", async () => {
    await withEncryptedBackup(OLD_KEY, async (args) => {
      await expect(
        decryptBackupWithFallback({
          ...args,
          candidates: [
            { name: "API_KEY_ENCRYPTION_KEY", key: NEW_KEY },
            { name: "PREVIOUS_API_KEY_ENCRYPTION_KEY", key: "f".repeat(64) },
          ],
        }),
      ).rejects.toThrow();
    });
  });

  it("survives a previous key that is not a valid key at all", async () => {
    await withEncryptedBackup(NEW_KEY, async (args) => {
      const used = await decryptBackupWithFallback({
        ...args,
        candidates: [
          { name: "API_KEY_ENCRYPTION_KEY", key: NEW_KEY },
          { name: "PREVIOUS_API_KEY_ENCRYPTION_KEY", key: "not-hex" },
        ],
      });
      expect(used).toBe("API_KEY_ENCRYPTION_KEY");
    });
  });

  it("reports the first key's failure, not the last, when none works", async () => {
    await withEncryptedBackup(OLD_KEY, async (args) => {
      // The first candidate is malformed, so its error is a key-length one;
      // the second is well formed but wrong, so its error is an auth failure.
      // The operator is expected to have the first, so that is the one shown.
      const error = await decryptBackupWithFallback({
        ...args,
        candidates: [
          { name: "API_KEY_ENCRYPTION_KEY", key: "short" },
          { name: "PREVIOUS_API_KEY_ENCRYPTION_KEY", key: "f".repeat(64) },
        ],
      }).catch((e: Error) => e);
      expect((error as Error).message).toMatch(/key length/i);
    });
  });

  it("rejects when there are no candidates at all", async () => {
    await withEncryptedBackup(OLD_KEY, async (args) => {
      await expect(
        decryptBackupWithFallback({ ...args, candidates: [] }),
      ).rejects.toThrow(/No decryption key/);
    });
  });
});
