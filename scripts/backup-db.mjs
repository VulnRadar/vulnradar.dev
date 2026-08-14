#!/usr/bin/env node

/**
 * VulnRadar — Database backup.
 *
 * AUDIT-010, production-readiness #1: this app previously had NO backup or
 * disaster-recovery mechanism at all. Every customer's password hashes,
 * Stripe billing history, API keys, and scan history lived in one Postgres
 * instance with no scheduled dump, no offsite copy, and no restore path.
 *
 * What this does: `pg_dump` -> gzip -> (optional) AES-256-GCM encryption ->
 * local file under BACKUP_DIR, prunes local backups past BACKUP_RETENTION_DAYS,
 * and (optional) uploads the result to BACKUP_OFFSITE_UPLOAD_URL via a plain
 * HTTP PUT. That URL is deliberately provider-agnostic: a presigned S3/R2/B2
 * PUT URL, or any receiver that accepts one, works identically -- this app
 * never needs to hold long-lived cloud credentials to get an offsite copy.
 *
 * Restore with: npm run db:restore -- --file=<path>
 *
 * Usage:
 *   npm run db:backup
 *   npm run db:backup -- --dir=/custom/backups
 *
 * Env vars (all optional except DATABASE_URL):
 *   BACKUP_DIR                 Local directory for backups. Default: ./backups
 *   BACKUP_RETENTION_DAYS      Local backups older than this are deleted after
 *                               a successful run. Default: 14. Set to 0 to keep
 *                               everything.
 *   BACKUP_ENCRYPTION_KEY      64-char hex string (32 bytes). Same shape as
 *                               API_KEY_ENCRYPTION_KEY -- generate with:
 *                               node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *                               When set, the dump is encrypted before being
 *                               written to disk or uploaded. Deliberately an
 *                               env var, never a runtime admin setting --
 *                               storing the key that decrypts the database's
 *                               own backups IN that same database is a
 *                               chicken-and-egg security smell.
 *   BACKUP_OFFSITE_UPLOAD_URL  A presigned PUT URL (or any HTTP receiver).
 *                               When set, the finished backup file is PUT
 *                               there after the local write succeeds.
 */
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { loadEnv, requireDatabaseUrl, ROOT } from "./_lib/_lib.env.mjs";
import {
  banner,
  info,
  success,
  warn,
  error,
  section,
} from "./_lib/_lib.output.mjs";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/** `vulnradar-backup-<ISO-with-safe-chars>.sql.gz`. Exported for tests. */
export function backupFileName(date = new Date()) {
  const iso = date.toISOString().replace(/[:.]/g, "-");
  return `vulnradar-backup-${iso}.sql.gz`;
}

/**
 * Given a directory listing's { name, mtimeMs } entries, return the names of
 * every VulnRadar backup file older than retentionDays. retentionDays <= 0
 * disables pruning entirely (returns []). Exported for tests -- pure
 * function, no filesystem access.
 */
export function selectExpiredBackups(entries, retentionDays, now = new Date()) {
  if (!retentionDays || retentionDays <= 0) return [];
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return entries
    .filter((e) => e.name.startsWith("vulnradar-backup-"))
    .filter((e) => e.mtimeMs < cutoffMs)
    .map((e) => e.name);
}

/**
 * AES-256-GCM cipher for one backup. Returns the cipher stream plus a
 * function that resolves the hex-encoded IV/authTag once the stream has
 * finished -- the auth tag is only available after every byte has been
 * written, so it can't be read up front. Exported for tests.
 */
export function createBackupCipher(hexKey) {
  if (!/^[0-9a-f]{64}$/i.test(hexKey)) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).",
    );
  }
  const key = Buffer.from(hexKey, "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  return {
    cipher,
    ivHex: iv.toString("hex"),
    getAuthTagHex: () => cipher.getAuthTag().toString("hex"),
  };
}

/** Inverse of createBackupCipher, for restore. Exported for tests. */
export function createBackupDecipher(hexKey, ivHex, authTagHex) {
  const key = Buffer.from(hexKey, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return decipher;
}

async function pruneOldBackups(dir, retentionDays) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const entries = await Promise.all(
    names.map(async (name) => {
      const s = await stat(join(dir, name)).catch(() => null);
      return s ? { name, mtimeMs: s.mtimeMs } : null;
    }),
  );
  const expired = selectExpiredBackups(entries.filter(Boolean), retentionDays);
  for (const name of expired) {
    await unlink(join(dir, name)).catch(() => {});
    info(`Pruned expired local backup: ${name}`);
  }
}

async function uploadOffsite(filePath, url) {
  const body = createReadStream(filePath);
  const res = await fetch(url, { method: "PUT", body, duplex: "half" });
  if (!res.ok) {
    throw new Error(`Offsite upload failed: HTTP ${res.status}`);
  }
}

async function runBackup() {
  banner("VulnRadar Database Backup");

  loadEnv();
  requireDatabaseUrl();

  const args = process.argv.slice(2);
  const dirArg = args
    .find((a) => a.startsWith("--dir="))
    ?.slice("--dir=".length);
  const backupDir = resolve(
    dirArg || process.env.BACKUP_DIR || join(ROOT, "backups"),
  );
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 14);
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY || null;
  const offsiteUrl = process.env.BACKUP_OFFSITE_UPLOAD_URL || null;

  await mkdir(backupDir, { recursive: true });

  const baseName = backupFileName();
  const finalName = encryptionKey ? `${baseName}.enc` : baseName;
  const finalPath = join(backupDir, finalName);

  section("Dumping");
  // Deliberately logs the filename, not the full finalPath: this stdout
  // stream is piped verbatim into the admin-panel job log (see
  // lib/backup/run-backup.ts + GET /api/v3/admin/backup), which the
  // browser can read. The absolute path on the server's disk must never
  // reach the client -- see the same rule for BACKUP_DIR in that route.
  info(`Target: ${finalName}`);

  const pgDump = spawn(
    "pg_dump",
    [
      "--no-owner",
      "--no-privileges",
      "--format=plain",
      process.env.DATABASE_URL,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderrOutput = "";
  pgDump.stderr.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });

  const gzip = createGzip();
  const dest = createWriteStream(finalPath);

  let cipherInfo = null;
  const stages = [pgDump.stdout, gzip];
  if (encryptionKey) {
    cipherInfo = createBackupCipher(encryptionKey);
    stages.push(cipherInfo.cipher);
  }
  stages.push(dest);

  const exitCodePromise = new Promise((resolvePromise, rejectPromise) => {
    pgDump.on("error", rejectPromise);
    pgDump.on("close", (code) => resolvePromise(code));
  });

  await pipeline(stages);
  const exitCode = await exitCodePromise;
  if (exitCode !== 0) {
    throw new Error(
      `pg_dump exited with code ${exitCode}: ${stderrOutput.trim()}`,
    );
  }

  if (cipherInfo) {
    await writeFile(
      `${finalPath}.json`,
      JSON.stringify(
        {
          algorithm: ENCRYPTION_ALGORITHM,
          iv: cipherInfo.ivHex,
          authTag: cipherInfo.getAuthTagHex(),
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
  }

  const written = await stat(finalPath);
  success(
    `Wrote ${finalName} (${(written.size / 1024 / 1024).toFixed(2)} MB)${
      cipherInfo ? ", encrypted" : ""
    }`,
  );

  if (offsiteUrl) {
    section("Offsite upload");
    await uploadOffsite(finalPath, offsiteUrl);
    if (cipherInfo) {
      await uploadOffsite(`${finalPath}.json`, `${offsiteUrl}.json`).catch(
        (err) =>
          warn(
            `Offsite upload of the encryption metadata sidecar failed (the backup itself uploaded fine, but you'll need the .json file to decrypt it): ${err.message}`,
          ),
      );
    }
    success("Offsite upload complete.");
  }

  section("Retention");
  if (retentionDays > 0) {
    await pruneOldBackups(backupDir, retentionDays);
  } else {
    info("Retention pruning disabled (BACKUP_RETENTION_DAYS=0).");
  }

  success("Backup complete.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBackup().catch((err) => {
    error(err.message);
    process.exit(1);
  });
}
