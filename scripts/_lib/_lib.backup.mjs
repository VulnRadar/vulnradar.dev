/**
 * VulnRadar — Pre-migration database backup.
 *
 * Runs pg_dump against the target database before any DDL executes,
 * writing a plain-SQL dump under databases/v{major}/{schemaVersion}/ at
 * the project root -- organized by schema version (the thing a backup
 * is actually versioned by, for restore purposes) rather than crammed
 * into the filename, so the filename itself just needs a timestamp to
 * stay unique within that version's folder.
 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT } from "./_lib.env.mjs";
import { info, warn, success } from "./_lib.output.mjs";

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
 * Backs up `connectionString`'s database to
 * databases/v{major}/{schemaVersion}/vulnradar_backup_{timestamp}.sql.
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
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `vulnradar_backup_${timestamp}.sql`;
  const filePath = resolve(backupDir, filename);
  const relativePath = `databases/${majorFolder(schemaVersion)}/${schemaVersion}/${filename}`;

  info(`Backing up database to ${relativePath} before migrating...`);

  await new Promise((resolvePromise, reject) => {
    const out = createWriteStream(filePath);
    const child = spawn("pg_dump", [connectionString], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(out);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    out.on("error", reject);
    child.on("exit", (code) => {
      out.end();
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(
            `pg_dump exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
          ),
        );
    });
  });

  success(`Backup written: ${relativePath}`);
  return filePath;
}
