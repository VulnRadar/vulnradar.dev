#!/usr/bin/env node

/**
 * VulnRadar — Database restore. The other half of scripts/backup-db.mjs
 * (AUDIT-010, production-readiness #1): a backup mechanism nobody has
 * rehearsed restoring from is a hope, not a disaster-recovery plan. Run
 * this against a throwaway/staging database at least once after setting up
 * backups, before trusting it in a real incident.
 *
 * Usage:
 *   npm run db:restore -- --file=./backups/vulnradar-backup-2026-08-14T00-00-00-000Z.sql.gz --yes
 *   npm run db:restore -- --file=./backups/vulnradar-backup-...sql.gz.enc --yes   (needs BACKUP_ENCRYPTION_KEY, or API_KEY_ENCRYPTION_KEY, the fallback)
 *   npm run db:restore -- --file=... --yes --force   (allow restoring into a database that already has tables)
 *
 * Destructive: this runs `psql` against DATABASE_URL and will apply
 * whatever the dump contains on top of it. Requires --yes -- without it,
 * this only prints what it would do and exits.
 */
import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { loadEnv, requireDatabaseUrl } from "./_lib/_lib.env.mjs";
import { splitDbUrlForEnv } from "./_lib/_lib.db-url.mjs";
import {
  banner,
  info,
  success,
  warn,
  error,
  section,
  warningBox,
} from "./_lib/_lib.output.mjs";
import { createBackupDecipher } from "./backup-db.mjs";

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
 * argv for the psql process the dump is streamed into.
 *
 * ON_ERROR_STOP is the whole point: psql defaults it to off, so it printed
 * every SQL error to stderr, carried on with the next statement and exited 0
 * as long as it consumed its input. The only failure check here was on that
 * exit code, so a restore in which every single statement failed still printed
 * "Restore complete." --single-transaction then makes the first error roll the
 * whole thing back instead of leaving the database half-applied.
 *
 * Exported so a test can assert both flags are present: they are the
 * difference between a disaster-recovery rehearsal that proves something and
 * one that proves nothing.
 */
export function restorePsqlArgs(connArg) {
  return ["-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", connArg];
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
    createReadStream(sourcePath),
    decipher,
    createWriteStream(destPath),
  );
  return destPath;
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

  if (!filePath) {
    error("Usage: npm run db:restore -- --file=<path-to-backup> --yes");
    process.exit(1);
  }

  if (!confirmed) {
    warningBox("This will restore into the CURRENT DATABASE_URL database.", [
      `File: ${filePath}`,
      "This is destructive -- it applies the dump on top of whatever is there now.",
      "Re-run with --yes once you're sure, ideally against a throwaway/staging DB first.",
      "The target must be an empty database; add --force to restore into one that already has tables.",
    ]);
    process.exit(0);
  }

  // Keep the DB password out of psql's argv (visible via `ps` on a shared
  // host); libpq reads it from PGPASSWORD in the child env instead.
  const { connArg, env } = splitDbUrlForEnv(process.env.DATABASE_URL);

  section("Preflight");
  // backup-db.mjs dumps with --format=plain and no --clean/--create, so the
  // dump has no DROP statements. Restoring it into a database that already has
  // the schema means every CREATE TABLE fails with "relation already exists"
  // and every COPY collides on the primary key. That used to be invisible
  // (see below); refusing outright is better than reporting it well.
  const tableCount = await psqlQuery(
    connArg,
    env,
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  if (!tableCount.ok) {
    error(
      `Could not query the target database: ${tableCount.error || "psql failed"}`,
    );
    process.exit(1);
  }
  const existingTables = Number(tableCount.value);
  if (!Number.isFinite(existingTables)) {
    // An unparseable count means the preflight did not actually run. Treating
    // that as "0 tables, go ahead" is exactly the kind of silent assumption
    // this whole preflight exists to remove.
    error(
      `Could not read the target's table count (psql returned "${tableCount.value}").`,
    );
    process.exit(1);
  }
  if (existingTables > 0 && !force) {
    warningBox("The target database is not empty.", [
      `It already has ${existingTables} table(s) in the public schema.`,
      "This dump contains no DROP statements, so restoring on top of an",
      "existing schema fails on every CREATE and every COPY.",
      "Restore into a fresh database, or pass --force if you know the dump",
      "and the target are compatible.",
    ]);
    process.exit(1);
  }
  info(
    existingTables === 0
      ? "Target database is empty."
      : `Target has ${existingTables} existing table(s), continuing because --force was passed.`,
  );

  section("Preparing");
  // Opened lazily: the encrypted path below reads a decrypted temp file
  // instead, and eagerly opening the .enc file here just leaked a descriptor.
  let source = null;
  let tempDir = null;

  try {
    if (filePath.endsWith(".enc")) {
      // Identical resolution to backup-db.mjs: fall back to API_KEY_ENCRYPTION_KEY
      // when no dedicated BACKUP_ENCRYPTION_KEY is set. If backup-db.mjs encrypted
      // this file using that base-key fallback, restoring with a different key
      // resolution would make it permanently undecryptable. A separate
      // BACKUP_ENCRYPTION_KEY is still recommended for defense in depth.
      const key =
        process.env.BACKUP_ENCRYPTION_KEY || process.env.API_KEY_ENCRYPTION_KEY;
      if (!key) {
        // Thrown rather than process.exit'd: exit skips the finally below, and
        // from here on there may be a temp directory to clean up.
        throw new Error(
          "This backup is encrypted. Set BACKUP_ENCRYPTION_KEY (or " +
            "API_KEY_ENCRYPTION_KEY, the fallback it was likely encrypted with) " +
            "to restore it.",
        );
      }
      const meta = JSON.parse(await readFile(`${filePath}.json`, "utf8"));

      // Decrypt and authenticate in full before a single byte reaches psql.
      // See decryptBackupToFile above for why streaming straight into psql was
      // wrong.
      tempDir = await mkdtemp(join(tmpdir(), "vulnradar-restore-"));
      const plaintextPath = join(tempDir, "backup.sql.gz");
      info("Decrypting and verifying...");
      try {
        await decryptBackupToFile({
          sourcePath: filePath,
          key,
          meta,
          destPath: plaintextPath,
        });
      } catch (err) {
        throw new Error(
          `Decryption failed: ${err.message}. Nothing was applied to the database.`,
        );
      }
      success("Backup integrity verified.");
      source = createReadStream(plaintextPath);
    } else {
      source = createReadStream(filePath);
    }

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
      await pipeline(source, createGunzip(), psql.stdin);
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
        `psql exited with code ${exitCode}. The restore was rolled back (--single-transaction); the database is unchanged.`,
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
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRestore().catch((err) => {
    error(err.message);
    process.exit(1);
  });
}
