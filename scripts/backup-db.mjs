#!/usr/bin/env node

/**
 * VulnRadar — Database backup.
 *
 * AUDIT-010, production-readiness #1: this app previously had NO backup or
 * disaster-recovery mechanism at all. Every customer's password hashes,
 * Stripe billing history, API keys, and scan history lived in one Postgres
 * instance with no scheduled dump, no offsite copy, and no restore path.
 *
 * What this does: `pg_dump` -> gzip -> AES-256-GCM encryption (on by default,
 * see BACKUP_ENCRYPTION_KEY below) -> local file under BACKUP_DIR, prunes
 * local backups past BACKUP_RETENTION_DAYS,
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
 *                               The dump is encrypted before being written to
 *                               disk or uploaded. When this is unset the script
 *                               falls back to API_KEY_ENCRYPTION_KEY (the app's
 *                               required base key), so backups are encrypted by
 *                               default rather than silently written in
 *                               plaintext. A separate BACKUP_ENCRYPTION_KEY is
 *                               still recommended for defense in depth: it keeps
 *                               the key that decrypts the backups distinct from
 *                               the one that decrypts the live DB's stored
 *                               secrets, so leaking one does not expose the
 *                               other. (Same fallback shape AUTH_SECRET uses.)
 *                               Deliberately an env var, never a runtime admin
 *                               setting -- storing the key that decrypts the
 *                               database's own backups IN that same database is
 *                               a chicken-and-egg security smell.
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
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { loadEnv, requireDatabaseUrl, ROOT } from "./_lib/_lib.env.mjs";
import { splitDbUrlForEnv } from "./_lib/_lib.db-url.mjs";
import {
  banner,
  info,
  success,
  warn,
  error,
  section,
} from "./_lib/_lib.output.mjs";

// Exported so the pre-migration backup path (scripts/_lib/_lib.backup.mjs)
// writes the same `.json` sidecar this file does, rather than hardcoding a
// second copy of the algorithm name that could drift from it.
export const ENCRYPTION_ALGORITHM = "aes-256-gcm";
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

/**
 * Map a pg_dump spawn error to an actionable message. A bare ENOENT means the
 * `pg_dump` binary isn't installed / on PATH -- common on minimal Node images
 * (e.g. the Pterodactyl Node egg) that ship without the postgresql-client
 * package -- which otherwise surfaces as a cryptic failure with no backups
 * written. Deliberately names the package to install, not a server path.
 * Exported for tests.
 */
export function describePgDumpError(err) {
  if (err && err.code === "ENOENT") {
    return new Error(
      "pg_dump not found. Database backups require the postgresql-client " +
        "package (which provides pg_dump) to be installed and on PATH in the " +
        "container/image. Minimal Node images (e.g. the Pterodactyl Node egg) " +
        "do not include it by default. See the self-hosting docs.",
    );
  }
  return err;
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
  // Fall back to the app's required base key (API_KEY_ENCRYPTION_KEY) when no
  // dedicated BACKUP_ENCRYPTION_KEY is set, so backups are encrypted by default
  // instead of silently written in plaintext. Both are the same 64-char-hex /
  // 32-byte AES-256 shape createBackupCipher validates. A separate
  // BACKUP_ENCRYPTION_KEY is still recommended for defense in depth (see the
  // header comment); restore-db.mjs uses the identical resolution so a backup
  // encrypted with the base-key fallback can always be decrypted again.
  const encryptionKey =
    process.env.BACKUP_ENCRYPTION_KEY ||
    process.env.API_KEY_ENCRYPTION_KEY ||
    null;
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

  // Keep the DB password out of pg_dump's argv (visible via `ps` on a shared
  // host); libpq reads it from PGPASSWORD in the child env instead.
  const { connArg, env } = splitDbUrlForEnv(process.env.DATABASE_URL);
  const pgDump = spawn(
    "pg_dump",
    ["--no-owner", "--no-privileges", "--format=plain", connArg],
    { stdio: ["ignore", "pipe", "pipe"], env },
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

  // spawn() reports a missing binary asynchronously via an 'error' event, not
  // a throw. Capture it (mapped to a clear message) rather than rejecting, so
  // whichever unwinds first -- this event or the pipeline teardown it triggers
  // -- the actionable message still wins. This stdout/stderr also streams
  // verbatim into the admin-panel job log via lib/backup/run-backup.ts.
  let spawnError = null;
  const exitCodePromise = new Promise((resolvePromise) => {
    pgDump.on("error", (err) => {
      spawnError = describePgDumpError(err);
      resolvePromise(-1);
    });
    pgDump.on("close", (code) => resolvePromise(code));
  });

  try {
    await pipeline(stages);
  } catch (err) {
    // A failed spawn (e.g. pg_dump missing) also tears the pipeline down; wait
    // for the child's own 'error' event so its clearer message wins over the
    // generic stream-teardown error.
    await exitCodePromise;
    throw spawnError || describePgDumpError(err);
  }
  const exitCode = await exitCodePromise;
  if (spawnError) throw spawnError;
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

// pathToFileURL, not a "file://" template. On Windows process.argv[1] is a
// backslashed drive path (C:\repo\scripts\backup-db.mjs), so the template
// produced "file://C:\repo\..." while import.meta.url is
// "file:///C:/repo/...". The two could never be equal, so this guard was false
// and the script exited 0 having done nothing at all: no output, no error, and
// an admin panel that reported a successful backup. It matched on Linux, which
// is why it shipped. pathToFileURL does the drive-letter and separator
// normalisation that makes the comparison correct on every platform.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBackup().catch((err) => {
    error(err.message);
    process.exit(1);
  });
}
