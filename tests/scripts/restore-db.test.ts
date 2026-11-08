import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createGunzip, gzipSync } from "node:zlib";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackupCipher } from "../../scripts/backup-db.mjs";
import {
  restorePsqlArgs,
  decryptBackupToFile,
  backupKeyCandidates,
  decryptBackupWithFallback,
  REPLACE_SCHEMA_SQL,
  assertGzipIntact,
  preflightTarget,
  psqlRestoreInput,
} from "../../scripts/restore-db.mjs";
import {
  DUMP_FORMAT,
  DUMP_FORMAT_VERSION,
  marker,
  restoreSqlDump,
} from "../../scripts/_lib/_lib.sql-backup.mjs";

describe("restorePsqlArgs", () => {
  it("passes ON_ERROR_STOP so a failed statement is not reported as success", () => {
    // psql defaults ON_ERROR_STOP to off: it logs each error, continues, and
    // exits 0. Without this flag a restore in which every statement failed
    // still printed "Restore complete."
    const args = restorePsqlArgs("postgresql://u@h:5432/db");
    expect(args).toContain("ON_ERROR_STOP=1");
    expect(args[args.indexOf("ON_ERROR_STOP=1") - 1]).toBe("-v");
  });

  it("does not ask psql for a transaction that commits at end of input", () => {
    // --single-transaction sends COMMIT when stdin ends, and a killed process
    // ends stdin too. The transaction is in the input instead: see
    // psqlRestoreInput.
    expect(restorePsqlArgs("postgresql://u@h:5432/db")).not.toContain(
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

describe("psql follows the shared TLS rule", () => {
  const src = readFileSync("scripts/restore-db.mjs", "utf8");

  it("takes its connection from pgToolConnection and removes the CA file after", () => {
    expect(src).toContain("await pgToolConnection(");
    expect(src).not.toContain("splitDbUrlForEnv");
    expect(src).toContain("await releaseTlsFiles()");
  });
});

describe("--replace", () => {
  const src = readFileSync("scripts/restore-db.mjs", "utf8");
  let logged: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logged = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logged.push(args.join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const output = () => logged.join("\n");

  it("resets the public schema and leaves it reachable by other roles", () => {
    expect(REPLACE_SCHEMA_SQL).toMatch(/DROP SCHEMA public CASCADE;/);
    expect(REPLACE_SCHEMA_SQL).toMatch(/CREATE SCHEMA public;/);
    expect(REPLACE_SCHEMA_SQL).toMatch(
      /GRANT USAGE ON SCHEMA public TO PUBLIC;/,
    );
    expect(REPLACE_SCHEMA_SQL.indexOf("DROP")).toBeLessThan(
      REPLACE_SCHEMA_SQL.indexOf("CREATE"),
    );
  });

  it("sends the reset to psql ahead of the dump, inside its one transaction", async () => {
    // The transaction is opened on stdin, so the reset has to be on stdin too:
    // a separate psql -c would commit the DROP before the restore could fail.
    async function* dump() {
      yield Buffer.from("CREATE TABLE a ();\n");
      yield Buffer.from("COPY a FROM stdin;\n");
    }
    const parts: string[] = [];
    for await (const chunk of psqlRestoreInput(dump(), { replace: true })) {
      parts.push(chunk.toString());
    }
    expect(parts[0]).toBe("BEGIN;\n");
    expect(parts[1]).toBe(REPLACE_SCHEMA_SQL);
    expect(parts.slice(2).join("")).toContain("CREATE TABLE a");
    expect(parts.at(-1)).toBe("\nCOMMIT;\n");
  });

  it("never reaches COMMIT when the dump stops part way", async () => {
    // A killed process or a failed read looks like this from psql's side:
    // the input simply ends. Without a COMMIT in it, nothing is kept.
    async function* dump() {
      yield Buffer.from("CREATE TABLE a ();\n");
      throw new Error("the read failed here");
    }
    const parts: string[] = [];
    const reading = (async () => {
      for await (const chunk of psqlRestoreInput(dump(), { replace: true })) {
        parts.push(chunk.toString());
      }
    })();
    await expect(reading).rejects.toThrow("the read failed here");
    expect(parts).toContain(REPLACE_SCHEMA_SQL);
    expect(parts.join("")).not.toContain("COMMIT");
  });

  it("composes with gunzip in a real stream pipeline", async () => {
    // pipeline() treats a generator function as a transform, which is how the
    // psql path uses this. Asserted because no CI job exercises that path.
    const chunks: Buffer[] = [];
    await pipeline(
      Readable.from([gzipSync(Buffer.from("CREATE TABLE a ();\n"))]),
      createGunzip(),
      (dump: AsyncIterable<Buffer>) =>
        psqlRestoreInput(dump, { replace: true }),
      new Writable({
        write(chunk, _encoding, done) {
          chunks.push(Buffer.from(chunk));
          done();
        },
      }),
    );
    expect(Buffer.concat(chunks).toString()).toBe(
      `BEGIN;\n${REPLACE_SCHEMA_SQL}CREATE TABLE a ();\n\nCOMMIT;\n`,
    );
  });

  it("sends no reset without the flag", async () => {
    async function* dump() {
      yield Buffer.from("CREATE TABLE a ();\n");
    }
    const parts: string[] = [];
    for await (const chunk of psqlRestoreInput(dump(), { replace: false })) {
      parts.push(chunk.toString());
    }
    expect(parts.join("")).toBe("BEGIN;\nCREATE TABLE a ();\n\nCOMMIT;\n");
  });

  it("refuses a populated target with neither flag", () => {
    expect(() => preflightTarget(3, { force: false, replace: false })).toThrow(
      /Refusing/,
    );
    expect(output()).toContain("--replace");
  });

  it("lets --force start the attempt without claiming it replaces anything", () => {
    preflightTarget(3, { force: true, replace: false });
    expect(output()).toMatch(/--force only lets the attempt start/);
    expect(output()).toMatch(/--replace/);
  });

  it("proceeds with --replace and says what it drops", () => {
    preflightTarget(3, { force: false, replace: true });
    expect(output()).toMatch(/3 table\(s\)/);
    expect(output()).toMatch(/same transaction/);
  });

  it("has nothing to warn about on an empty target", () => {
    preflightTarget(0, { force: false, replace: false });
    expect(output()).toContain("empty");
  });

  it("does nothing without --yes", () => {
    // The explicit confirmation comes first: the unconfirmed branch exits
    // before the flag can reach either restore path.
    const unconfirmed = src.indexOf("if (!confirmed)");
    const firstUse = src.indexOf(
      "await restoreWithBuiltInReader(",
      unconfirmed,
    );
    expect(unconfirmed).toBeGreaterThan(-1);
    expect(src.slice(unconfirmed, firstUse)).toContain("process.exit(0)");
  });

  it("names the flag in the header and stops offering --force as a way to overwrite", () => {
    expect(src).toMatch(/--yes --replace/);
    expect(src).not.toMatch(/add --force to restore into one/);
  });

  it("proves the file is whole before psql can drop anything", async () => {
    // A damaged copy would roll back without this, but only after psql had
    // held every table exclusively for as long as it took to reach the damage.
    const dir = await mkdtemp(join(tmpdir(), "vulnradar-gzip-check-"));
    try {
      const whole = join(dir, "whole.sql.gz");
      const compressed = gzipSync(Buffer.from("SELECT 1;\n".repeat(5000)));
      await writeFile(whole, compressed);
      await expect(assertGzipIntact(whole)).resolves.toBeUndefined();

      const cut = join(dir, "cut.sql.gz");
      await writeFile(cut, compressed.subarray(0, compressed.length - 12));
      await expect(assertGzipIntact(cut)).rejects.toThrow();

      const preflight = src.indexOf("assertGzipIntact(plaintextPath)");
      const spawnPsql = src.indexOf('spawn("psql", restorePsqlArgs(');
      expect(preflight).toBeGreaterThan(-1);
      expect(preflight).toBeLessThan(spawnPsql);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("restoreSqlDump with a reset", () => {
  function recorder() {
    const queries: string[] = [];
    return {
      queries,
      client: {
        query: async (sql: unknown) => {
          queries.push(typeof sql === "string" ? sql : "(parameterised)");
          return { rows: [] };
        },
      },
    };
  }

  const header = marker("DUMP", {
    format: DUMP_FORMAT,
    version: DUMP_FORMAT_VERSION,
  });

  async function* minimalDump() {
    yield header;
    yield marker("END", { rows: 0 });
  }

  it("runs the reset straight after BEGIN, so a later failure rolls it back", async () => {
    const { queries, client } = recorder();
    await restoreSqlDump({
      client,
      lines: minimalDump(),
      resetSql: REPLACE_SCHEMA_SQL,
    });
    expect(queries[0]).toBe("BEGIN");
    expect(queries[1]).toBe(REPLACE_SCHEMA_SQL);
    expect(queries).toContain("COMMIT");
  });

  it("rolls the reset back when the file turns out to be truncated", async () => {
    const { queries, client } = recorder();
    async function* truncated() {
      yield header;
    }
    await expect(
      restoreSqlDump({
        client,
        lines: truncated(),
        resetSql: REPLACE_SCHEMA_SQL,
      }),
    ).rejects.toThrow(/truncated/);
    expect(queries).toContain(REPLACE_SCHEMA_SQL);
    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
  });

  it("runs no reset unless asked", async () => {
    const { queries, client } = recorder();
    await restoreSqlDump({ client, lines: minimalDump() });
    expect(queries.join("\n")).not.toContain("DROP SCHEMA");
  });
});
