/**
 * VulnRadar - Pre-migration database backup.
 *
 * Runs pg_dump against the target database before any DDL executes,
 * writing the dump under databases/v{major}/{schemaVersion}/ at the
 * project root -- organized by schema version (the thing a backup is
 * actually versioned by, for restore purposes) rather than crammed into
 * the filename, so the filename itself just needs a timestamp to stay
 * unique within that version's folder.
 *
 * AUDIT-013 migrate-12: this used to be a second, weaker dump path that
 * had none of the properties scripts/backup-db.mjs was explicitly fixed
 * to have. It spawned `pg_dump [DATABASE_URL]`, putting the production
 * password in argv where every local user can read it out of `ps`; it
 * wrote plain uncompressed SQL containing every password hash, every
 * encrypted API key and token, every Stripe id and the full scan history,
 * unencrypted, under the app directory that self-hosted panels expose
 * through their file manager; and it pruned nothing, so it accumulated
 * one such file per migration forever.
 *
 * It now reuses backup-db.mjs's own primitives rather than maintaining a
 * parallel implementation: splitDbUrlForEnv for the password, gzip plus
 * AES-256-GCM with the same BACKUP_ENCRYPTION_KEY -> API_KEY_ENCRYPTION_KEY
 * resolution, the same `.json` sidecar carrying the IV and auth tag, and
 * the same retention pruning. The output is therefore restorable with the
 * documented `npm run db:restore -- --file=<path> --yes`, which the old
 * plain-SQL file was not.
 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import { ROOT } from "./_lib.env.mjs";
import { splitDbUrlForEnv } from "./_lib.db-url.mjs";
import { info, warn, success } from "./_lib.output.mjs";
import {
  backupFileName,
  createBackupCipher,
  selectExpiredBackups,
  ENCRYPTION_ALGORITHM,
} from "../backup-db.mjs";

const BACKUP_ROOT = resolve(ROOT, "databases");

function commandAvailable(cmd) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, ["--version"], { stdio: "ignore" });
    child.on("error", () => resolvePromise(false));
    child.on("exit", (code) => resolvePromise(code === 0));
  });
}

/** "3.0.0" -> "v3". Falls back to the raw string if it doesn't look like semver. */
function majorFolder(schemaVersion) {
  const major = schemaVersion.split(".")[0];
  return /^\d+$/.test(major) ? `v${major}` : schemaVersion;
}

/**
 * Delete pre-migration dumps in `dir` older than MIGRATION_BACKUP_RETENTION_DAYS
 * (default 90; 0 keeps everything). Deliberately more generous than
 * BACKUP_RETENTION_DAYS' 14 days: these are the "before we changed the
 * schema" snapshots, and the reason to reach for one can surface long
 * after the migration ran.
 */
async function pruneOldMigrationBackups(dir) {
  const retentionDays = Number(
    process.env.MIGRATION_BACKUP_RETENTION_DAYS ?? 90,
  );
  if (!retentionDays || retentionDays <= 0) return;
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const entries = [];
  for (const name of names) {
    try {
      const s = await stat(resolve(dir, name));
      entries.push({ name, mtimeMs: s.mtimeMs });
    } catch {
      // Raced with something else deleting it; nothing to prune.
    }
  }
  const expired = selectExpiredBackups(entries, retentionDays);
  for (const name of expired) {
    // The .json sidecar shares the dump's name plus a suffix, so it is
    // matched by the same prefix filter and removed alongside it.
    await unlink(resolve(dir, name)).catch(() => {});
  }
  if (expired.length > 0) {
    info(
      `Pruned ${expired.length} pre-migration backup file(s) older than ${retentionDays} days.`,
    );
  }
}

/**
 * Backs up `connectionString`'s database to
 * databases/v{major}/{schemaVersion}/vulnradar-backup-{timestamp}.sql.gz
 * (plus `.enc` and a `.json` sidecar when an encryption key is available).
 * Returns the written file's path, or null if pg_dump isn't on PATH --
 * this warns rather than throwing, so a self-hosted install without
 * postgresql-client installed can still migrate, just without this
 * safety net (the Docker image ships pg_dump, so this is the common
 * case only for a bare, non-Docker Node install).
 */
export async function backupDatabase(connectionString, schemaVersion) {
  if (!(await commandAvailable("pg_dump"))) {
    warn(
      "pg_dump not found on PATH -- skipping the pre-migration backup. Install postgresql-client (the Docker image already includes it) to enable automatic backups.",
    );
    return null;
  }

  const backupDir = resolve(
    BACKUP_ROOT,
    majorFolder(schemaVersion),
    schemaVersion,
  );
  await mkdir(backupDir, { recursive: true });

  // Identical key resolution to backup-db.mjs and restore-db.mjs, so a
  // dump written here is decryptable by the documented restore command.
  const encryptionKey =
    process.env.BACKUP_ENCRYPTION_KEY ||
    process.env.API_KEY_ENCRYPTION_KEY ||
    null;
  if (!encryptionKey) {
    warn(
      "Neither BACKUP_ENCRYPTION_KEY nor API_KEY_ENCRYPTION_KEY is set: the pre-migration dump will be written unencrypted.",
    );
  }

  const baseName = backupFileName();
  const filename = encryptionKey ? `${baseName}.enc` : baseName;
  const filePath = resolve(backupDir, filename);
  const relativePath = `databases/${majorFolder(schemaVersion)}/${schemaVersion}/${filename}`;

  info(`Backing up database to ${relativePath} before migrating...`);

  // Keep the DB password out of pg_dump's argv (visible via `ps` on a
  // shared host); libpq reads it from PGPASSWORD in the child env instead.
  const { connArg, env } = splitDbUrlForEnv(connectionString);
  const child = spawn(
    "pg_dump",
    ["--no-owner", "--no-privileges", "--format=plain", connArg],
    { stdio: ["ignore", "pipe", "pipe"], env },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exitCodePromise = new Promise((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise(code));
  });

  const stages = [child.stdout, createGzip()];
  let cipherInfo = null;
  if (encryptionKey) {
    cipherInfo = createBackupCipher(encryptionKey);
    stages.push(cipherInfo.cipher);
  }
  stages.push(createWriteStream(filePath));

  await pipeline(stages);
  const exitCode = await exitCodePromise;
  if (exitCode !== 0) {
    throw new Error(
      `pg_dump exited with code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`,
    );
  }

  if (cipherInfo) {
    await writeFile(
      `${filePath}.json`,
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

  success(
    `Backup written: ${relativePath}${cipherInfo ? " (encrypted)" : ""}. Restore with: npm run db:restore -- --file=${relativePath} --yes`,
  );
  await pruneOldMigrationBackups(backupDir);
  return filePath;
}
