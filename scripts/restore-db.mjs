#!/usr/bin/env node

/**
 * VulnRadar — Database restore. The other half of scripts/backup-db.mjs
 * (AUDIT-010, production-readiness #1): a backup mechanism nobody has
 * rehearsed restoring from is a hope, not a disaster-recovery plan. Run
 * this against a throwaway/staging database at least once after setting up
 * backups, before trusting it in a real incident.
 *
 * Two dump formats, detected from the file's CONTENT rather than its name
 * -----------------------------------------------------------------------
 * A `pg_dump --format=plain` dump is streamed into `psql`, as it always was.
 * A dump written by VulnRadar's own built-in dumper (see
 * scripts/_lib/_lib.sql-backup.mjs, used automatically when pg_dump is not
 * installed) is applied over the `pg` connection instead, with no child
 * process at all. That is not a stylistic choice: the hosts the built-in
 * dumper exists for (Pterodactyl / Pelican panel installs on a bare Node egg)
 * have no `psql` either, so a restore that shelled out would break for exactly
 * the operators whose only backup this is. The same file still restores with
 * `psql -v ON_ERROR_STOP=1 --single-transaction -f ...` anywhere psql exists.
 *
 * Usage:
 *   npm run db:restore -- --file=./backups/vulnradar-backup-2026-08-14T00-00-00-000Z.sql.gz --yes
 *   npm run db:restore -- --file=./backups/vulnradar-backup-...sql.gz.enc --yes   (needs BACKUP_ENCRYPTION_KEY, or API_KEY_ENCRYPTION_KEY, the fallback;
 *                                                                                  a backup from before a key rotation also tries PREVIOUS_API_KEY_ENCRYPTION_KEY)
 *   npm run db:restore -- --file=... --yes --replace (drop everything in the public schema, then load the backup, in one transaction)
 *   npm run db:restore -- --file=... --yes --force   (only let the attempt start on a database that already has tables; see below)
 *
 * Destructive: this applies whatever the dump contains on top of the database
 * DATABASE_URL points at. Requires --yes -- without it, this only prints what
 * it would do and exits.
 *
 * Neither dump format contains DROP statements, so loading one over the schema
 * it came from stops at its first CREATE. --replace is what makes that case
 * work, and the reset runs in the restore's own transaction: if the backup does
 * not apply, the DROP goes back with it and the database is untouched. --force
 * replaces nothing; it is for a dump that shares no objects with the target.
 */
import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { open, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadEnv, requireDatabaseUrl } from "./_lib/_lib.env.mjs";
import { createPool, pgToolConnection } from "./_lib/_lib.db.mjs";
import {
  banner,
  info,
  success,
  warn,
  error,
  section,
  warningBox,
} from "./_lib/_lib.output.mjs";
import {
  BACKUP_HEADER_BYTES,
  createBackupDecipher,
  parseBackupHeader,
} from "./backup-db.mjs";
import {
  detectBackupFormat,
  readDumpLines,
  restoreSqlDump,
  DUMP_LIMITS_NOTICE,
} from "./_lib/_lib.sql-backup.mjs";
import { repairAllSequences } from "./migrate/_runner.mjs";

// Tables printed back to the operator after a successful restore. A restore
// that reports success but left the database empty is the failure this whole
// script exists to make impossible, so the run ends with positive evidence
// rather than just an exit code. Missing tables are reported, not fatal: an
// older dump legitimately predates some of these.
const EVIDENCE_TABLES = [
  "users",
  "sessions",
  "api_keys",
  "scan_history",
  "teams",
];

/**
 * What --replace runs first, in the restore's own transaction. The GRANT is
 * Postgres's default for the schema and DROP takes it away: without it a
 * restore run as an admin role leaves the app's own role unable to see a single
 * table.
 */
export const REPLACE_SCHEMA_SQL =
  "DROP SCHEMA public CASCADE;\nCREATE SCHEMA public;\nGRANT USAGE ON SCHEMA public TO PUBLIC;\n";

/**
 * What psql reads: the dump, in a transaction that commits only once the last
 * byte of it has gone through.
 *
 * The framing is written here rather than asked for with psql's
 * --single-transaction, because that flag sends COMMIT when stdin ends, and
 * stdin ends the same way when this process is killed or a read fails part way
 * through. Under --replace that commits a dropped schema and half a backup.
 * With the COMMIT in the stream, input that stops early leaves psql to
 * disconnect with the transaction still open, and the server rolls it back.
 *
 * The reset goes down the same stdin as the dump for the same reason: a
 * separate `psql -c` would commit the DROP before the restore could fail.
 */
export async function* psqlRestoreInput(dump, { replace }) {
  yield "BEGIN;\n";
  if (replace) yield REPLACE_SCHEMA_SQL;
  yield* dump;
  yield "\nCOMMIT;\n";
}

/**
 * Read a whole gzip file and throw if it is damaged, so a bad copy is refused
 * before psql has locked anything. It would roll back without this, but only
 * after holding every table exclusively for as long as it took to reach the
 * damage. Encrypted files already passed GCM by this point; a plain .sql.gz
 * has nothing else protecting it.
 */
export async function assertGzipIntact(gzPath) {
  await pipeline(
    createReadStream(gzPath),
    createGunzip(),
    new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  );
}

/**
 * The same decision for both restore paths: what to do about tables that are
 * already there. Throws rather than exiting because the caller has a decrypted
 * temp file to clean up.
 */
export function preflightTarget(existingTables, { force, replace }) {
  if (existingTables === 0) {
    info("Target database is empty.");
    return;
  }
  if (replace) {
    warn(
      `--replace: all ${existingTables} table(s) in the public schema, and ` +
        "everything else in it, are dropped in the same transaction as the " +
        "restore. If the backup does not apply, none of it happens.",
    );
    return;
  }
  if (!force) {
    warningBox("The target database is not empty.", [
      `It already has ${existingTables} table(s) in the public schema.`,
      "This dump contains no DROP statements, so restoring on top of an",
      "existing schema fails on every CREATE.",
      "Pass --replace to drop the public schema and load this backup in its",
      "place, or restore into a fresh database.",
    ]);
    throw new Error("Refusing to restore into a database that has tables.");
  }
  info(
    `Target has ${existingTables} existing table(s), continuing because --force was passed.`,
  );
  // Said out loud rather than left to be discovered: --force does not turn
  // this into a merge or an overwrite.
  warn(
    "--force only lets the attempt start. This dump creates objects and never " +
      "drops them, so it will stop at the first one that already exists and " +
      "roll the whole restore back, leaving this database unchanged. To " +
      "overwrite the database with this backup, use --replace.",
  );
}

/**
 * argv for the psql process the dump is streamed into.
 *
 * ON_ERROR_STOP is the whole point: psql defaults it to off, so it printed
 * every SQL error to stderr, carried on with the next statement and exited 0
 * as long as it consumed its input. The only failure check here was on that
 * exit code, so a restore in which every single statement failed still printed
 * "Restore complete." Stopping at the first error also leaves the transaction
 * psqlRestoreInput opened unfinished, which is what rolls the restore back.
 *
 * Exported so a test can assert the flag is present: it is the difference
 * between a disaster-recovery rehearsal that proves something and one that
 * proves nothing.
 */
export function restorePsqlArgs(connArg) {
  return ["-X", "-q", "-v", "ON_ERROR_STOP=1", connArg];
}

/**
 * Decrypt an encrypted backup to `destPath`, fully, before anything reads it.
 *
 * AES-256-GCM emits plaintext block by block and only validates the auth tag
 * when the final block is processed. The old code piped the decipher straight
 * into psql, so a tampered or bit-rotted dump had most of its statements
 * executed before the integrity check failed. Awaiting the whole stream to a
 * file first means an unauthenticated backup is refused outright, which is the
 * guarantee authenticating the backup was supposed to buy.
 */
export async function decryptBackupToFile({ sourcePath, key, meta, destPath }) {
  const decipher = createBackupDecipher(key, meta.iv, meta.authTag);
  await pipeline(
    createReadStream(sourcePath, { start: meta.payloadOffset ?? 0 }),
    decipher,
    createWriteStream(destPath),
  );
  return destPath;
}

/**
 * Where to find the IV and auth tag: the file's own header, or for a backup
 * written before the header existed (and for db:migrate's pre-migration dumps,
 * which still use only the sidecar) `<file>.json`. A new-format file whose
 * header was damaged lands on the sidecar too, and its payload still starts
 * after the header, so the sidecar's offset is honoured.
 * Exported for tests.
 *
 * @param {string} filePath
 * @returns {Promise<{ iv: string, authTag: string, payloadOffset?: number }>}
 */
export async function readBackupEncryption(filePath) {
  const file = await open(filePath, "r");
  let header;
  try {
    const { buffer, bytesRead } = await file.read(
      Buffer.alloc(BACKUP_HEADER_BYTES),
      0,
      BACKUP_HEADER_BYTES,
      0,
    );
    header = parseBackupHeader(buffer.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
  if (header) return header;

  const sidecar = `${filePath}.json`;
  let text;
  try {
    text = await readFile(sidecar, "utf8");
  } catch {
    throw new Error(
      `This backup has no encryption header and ${sidecar} could not be ` +
        "read, so it cannot be decrypted. Backups from before the header " +
        "existed need that file beside them.",
    );
  }
  const { iv, authTag, payloadOffset } = JSON.parse(text);
  return { iv, authTag, payloadOffset };
}

/**
 * The keys a backup may have been encrypted with, in the order they are tried.
 *
 * The first is the key backup-db.mjs would use today (BACKUP_ENCRYPTION_KEY,
 * else the API_KEY_ENCRYPTION_KEY fallback). The second is
 * PREVIOUS_API_KEY_ENCRYPTION_KEY, which exists for exactly one situation: the
 * operator rotated API_KEY_ENCRYPTION_KEY and kept the old value around so
 * data written under it still opens (lib/auth/crypto.ts). A backup taken
 * before that rotation, on an install that relies on the base-key fallback, was
 * encrypted with the old value, and without this it became undecryptable the
 * moment the rotation was done, in a restore that is by definition happening
 * under pressure.
 *
 * AES-GCM authenticates, so a wrong key fails rather than producing garbage;
 * trying a second key can never "succeed" with the wrong one.
 * Exported for tests.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ name: string, key: string }[]}
 */
export function backupKeyCandidates(env = process.env) {
  const candidates = [];
  const primary = env.BACKUP_ENCRYPTION_KEY || env.API_KEY_ENCRYPTION_KEY;
  if (primary) {
    candidates.push({
      name: env.BACKUP_ENCRYPTION_KEY
        ? "BACKUP_ENCRYPTION_KEY"
        : "API_KEY_ENCRYPTION_KEY",
      key: primary,
    });
  }
  const previous = env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
  if (primary && previous && previous !== primary) {
    candidates.push({ name: "PREVIOUS_API_KEY_ENCRYPTION_KEY", key: previous });
  }
  return candidates;
}

/**
 * decryptBackupToFile with each candidate key in turn. Returns the name of the
 * key that opened the file; throws the FIRST key's error when none does, since
 * that is the key the operator is expected to have and so the failure worth
 * reporting. `onFallback(failed, next)` is called before each retry so the
 * caller can say what is happening.
 * Exported for tests.
 *
 * @param {object} args
 * @param {string} args.sourcePath
 * @param {{ iv: string, authTag: string }} args.meta
 * @param {string} args.destPath
 * @param {{ name: string, key: string }[]} args.candidates
 * @param {(failed: { name: string }, next: { name: string }) => void} [args.onFallback]
 * @returns {Promise<string>}
 */
export async function decryptBackupWithFallback({
  sourcePath,
  meta,
  destPath,
  candidates,
  onFallback,
}) {
  let firstError = null;
  for (let i = 0; i < candidates.length; i++) {
    try {
      await decryptBackupToFile({
        sourcePath,
        key: candidates[i].key,
        meta,
        destPath,
      });
      return candidates[i].name;
    } catch (err) {
      firstError ??= err;
      if (i + 1 < candidates.length)
        onFallback?.(candidates[i], candidates[i + 1]);
    }
  }
  throw firstError ?? new Error("No decryption key was provided.");
}

/**
 * Run a single read-only query through psql and capture stdout. `-X` skips the
 * operator's .psqlrc, `-A -t` give one bare value per line. Never throws: the
 * caller decides what a failed query means (a missing table is fine, an
 * unreachable database is not).
 */
export function psqlQuery(connArg, env, sql) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "psql",
      ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql, connArg],
      { stdio: ["ignore", "pipe", "pipe"], env },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("error", (e) =>
      resolvePromise({ ok: false, value: "", error: e.message }),
    );
    child.on("close", (code) =>
      resolvePromise({ ok: code === 0, value: out.trim(), error: err.trim() }),
    );
  });
}

/**
 * Refuse to restore onto a database that already has tables, without shelling
 * out to psql.
 *
 * Same rule the psql path applies for the same reason: neither dump format
 * contains DROP statements, so restoring on top of an existing schema fails on
 * every CREATE. This one uses the `pg` connection because the hosts the
 * built-in dumper exists for have no psql to ask.
 */
export async function countPublicTables(pool) {
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  return res.rows[0].n;
}

/**
 * Apply one of our own SQL dumps through `pg`.
 *
 * Throws rather than process.exit()ing on a refusal, because the caller has a
 * decrypted temp file to clean up in its finally.
 *
 * Sequences are set twice on purpose. The dump carries a `setval` for every
 * sequence, which is the authoritative position; repairAllSequences then runs
 * as a backstop for anything the file could not name (a sequence added by an
 * extension, an identity column whose sequence was created by its own
 * GENERATED clause on a server that renders it differently). It is forward
 * only, so it can never move a sequence backwards over the file's value.
 */
async function restoreWithBuiltInReader(plaintextPath, { force, replace }) {
  const pool = createPool();
  let client = null;
  try {
    client = await pool.connect();

    section("Preflight");
    preflightTarget(await countPublicTables(pool), { force, replace });
    for (const line of DUMP_LIMITS_NOTICE) info(line);

    section("Restoring");
    info("Applying with the built-in reader (no psql needed).");
    const result = await restoreSqlDump({
      client,
      lines: readDumpLines(plaintextPath),
      onLog: info,
      resetSql: replace ? REPLACE_SCHEMA_SQL : undefined,
    });
    success(
      `Applied ${result.statements} statement(s) and ${result.rows} row(s) ` +
        `across ${result.tables} table(s).`,
    );

    section("Sequences");
    await repairAllSequences(client);
    success("Sequences checked.");

    section("Verifying");
    for (const table of EVIDENCE_TABLES) {
      try {
        const count = await pool.query(
          `SELECT count(*)::int AS n FROM public."${table.replace(/"/g, '""')}"`,
        );
        info(`${table}: ${count.rows[0].n} row(s)`);
      } catch {
        warn(`${table}: not present in this dump`);
      }
    }
  } finally {
    client?.release();
    await pool.end().catch(() => {});
  }
}

async function runRestore() {
  banner("VulnRadar Database Restore");

  loadEnv();
  requireDatabaseUrl();

  const args = process.argv.slice(2);
  const filePath = args
    .find((a) => a.startsWith("--file="))
    ?.slice("--file=".length);
  const confirmed = args.includes("--yes");
  const force = args.includes("--force");
  const replace = args.includes("--replace");

  if (!filePath) {
    error("Usage: npm run db:restore -- --file=<path-to-backup> --yes");
    process.exit(1);
  }

  if (!confirmed) {
    warningBox("This will restore into the CURRENT DATABASE_URL database.", [
      `File: ${filePath}`,
      "This is destructive -- it applies the dump on top of whatever is there now.",
      "Re-run with --yes once you're sure, ideally against a throwaway/staging DB first.",
      replace
        ? "--replace drops everything in the public schema first, in the same transaction as the restore."
        : "The target must be an empty database. Add --replace to drop what is there and load this backup instead.",
    ]);
    process.exit(0);
  }

  section("Preparing");
  // Resolved to a plain .gz path first, because the format can only be read
  // out of the decrypted bytes and the format decides which restore path (and
  // therefore which preflight) runs.
  let plaintextPath = filePath;
  let tempDir = null;
  let releaseTlsFiles = async () => {};

  try {
    if (filePath.endsWith(".enc")) {
      // First key: identical resolution to backup-db.mjs, falling back to
      // API_KEY_ENCRYPTION_KEY when no dedicated BACKUP_ENCRYPTION_KEY is set.
      // If backup-db.mjs encrypted this file using that base-key fallback,
      // restoring with a different key resolution would make it permanently
      // undecryptable. A separate BACKUP_ENCRYPTION_KEY is still recommended
      // for defense in depth. After a rotation, PREVIOUS_API_KEY_ENCRYPTION_KEY
      // is tried second (see backupKeyCandidates).
      const candidates = backupKeyCandidates();
      if (candidates.length === 0) {
        // Thrown rather than process.exit'd: exit skips the finally below, and
        // from here on there may be a temp directory to clean up.
        throw new Error(
          "This backup is encrypted. Set BACKUP_ENCRYPTION_KEY (or " +
            "API_KEY_ENCRYPTION_KEY, the fallback it was likely encrypted with) " +
            "to restore it.",
        );
      }
      const meta = await readBackupEncryption(filePath);

      // Decrypt and authenticate in full before a single byte reaches the
      // database. See decryptBackupToFile above for why streaming a decipher
      // straight into psql was wrong.
      tempDir = await mkdtemp(join(tmpdir(), "vulnradar-restore-"));
      plaintextPath = join(tempDir, "backup.sql.gz");
      info("Decrypting and verifying...");
      let usedKey;
      try {
        usedKey = await decryptBackupWithFallback({
          sourcePath: filePath,
          meta,
          destPath: plaintextPath,
          candidates,
          onFallback: (failed, next) =>
            warn(
              `${failed.name} did not open this backup; trying ${next.name}.`,
            ),
        });
      } catch (err) {
        throw new Error(
          `Decryption failed: ${err.message}. Nothing was applied to the database. ` +
            `Tried ${candidates.map((cand) => cand.name).join(", ")}; the ` +
            "backup is either damaged or was encrypted with a key that is " +
            "not set here.",
        );
      }
      if (usedKey === "PREVIOUS_API_KEY_ENCRYPTION_KEY") {
        info(
          "Opened with PREVIOUS_API_KEY_ENCRYPTION_KEY: this backup predates a key rotation.",
        );
      }
      success("Backup integrity verified.");
    }

    // Content, not filename: a renamed or hand-copied backup is still routed
    // to the reader that understands it.
    const format = await detectBackupFormat(plaintextPath);
    if (format === "vulnradar-sql") {
      info("Format: VulnRadar built-in SQL dump.");
      await restoreWithBuiltInReader(plaintextPath, { force, replace });
      success("Restore complete.");
      return;
    }
    info("Format: pg_dump plain SQL.");

    // Keep the DB password out of psql's argv (visible via `ps` on a shared
    // host); libpq reads it from PGPASSWORD in the child env instead. The same
    // env carries the TLS rule, so a URL's sslmode cannot loosen it.
    const { connArg, env, cleanup } = await pgToolConnection(
      process.env.DATABASE_URL,
    );
    releaseTlsFiles = cleanup;

    section("Preflight");
    // backup-db.mjs dumps with --format=plain and no --clean/--create, so the
    // dump has no DROP statements. Restoring it into a database that already
    // has the schema means every CREATE TABLE fails with "relation already
    // exists" and every COPY collides on the primary key. That used to be
    // invisible; refusing outright is better than reporting it well.
    const tableCount = await psqlQuery(
      connArg,
      env,
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    if (!tableCount.ok) {
      const missingPsql = /ENOENT/.test(tableCount.error || "");
      throw new Error(
        `Could not query the target database: ${tableCount.error || "psql failed"}` +
          (missingPsql
            ? ". This is a pg_dump-format dump, which needs psql (the " +
              "postgresql-client package) to restore. VulnRadar's own dumps " +
              "restore without it; take one with `npm run db:backup -- --js`."
            : ""),
      );
    }
    const existingTables = Number(tableCount.value);
    if (!Number.isFinite(existingTables)) {
      // An unparseable count means the preflight did not actually run.
      // Treating that as "0 tables, go ahead" is exactly the kind of silent
      // assumption this whole preflight exists to remove.
      throw new Error(
        `Could not read the target's table count (psql returned "${tableCount.value}").`,
      );
    }
    preflightTarget(existingTables, { force, replace });
    await assertGzipIntact(plaintextPath);

    const source = createReadStream(plaintextPath);

    section("Restoring");
    const psql = spawn("psql", restorePsqlArgs(connArg), {
      stdio: ["pipe", "inherit", "inherit"],
      env,
    });

    const exitCodePromise = new Promise((resolvePromise, rejectPromise) => {
      psql.on("error", rejectPromise);
      psql.on("close", (code) => resolvePromise(code));
    });

    try {
      await pipeline(
        source,
        createGunzip(),
        (dump) => psqlRestoreInput(dump, { replace }),
        psql.stdin,
      );
    } catch (err) {
      // With ON_ERROR_STOP psql aborts mid-dump and closes its stdin, so the
      // pipe fails with EPIPE before it has written everything. The child's
      // exit code below is the real diagnosis, so let it do the reporting.
      if (err?.code !== "EPIPE" && err?.code !== "ERR_STREAM_PREMATURE_CLOSE") {
        throw err;
      }
    }

    const exitCode = await exitCodePromise;
    if (exitCode !== 0) {
      throw new Error(
        `psql exited with code ${exitCode}. The restore was rolled back; the database is unchanged.`,
      );
    }

    section("Verifying");
    for (const table of EVIDENCE_TABLES) {
      const count = await psqlQuery(
        connArg,
        env,
        `SELECT count(*) FROM public.${table}`,
      );
      if (!count.ok) {
        warn(`${table}: not present in this dump`);
        continue;
      }
      info(`${table}: ${count.value} row(s)`);
    }

    success("Restore complete.");
  } finally {
    await releaseTlsFiles().catch(() => {});
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

// pathToFileURL, not a "file://" template. On Windows process.argv[1] is a
// backslashed drive path (C:\repo\scripts\backup-db.mjs), so the template
// produced "file://C:\repo\..." while import.meta.url is
// "file:///C:/repo/...". The two could never be equal, so this guard was false
// and the script exited 0 having done nothing at all: no output, no error, and
// an admin panel that reported a successful backup. It matched on Linux, which
// is why it shipped. pathToFileURL does the drive-letter and separator
// normalisation that makes the comparison correct on every platform.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRestore().catch((err) => {
    error(err.message);
    process.exit(1);
  });
}
