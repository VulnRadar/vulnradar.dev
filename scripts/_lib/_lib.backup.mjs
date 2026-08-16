/**
 * VulnRadar — Pre-migration database backup.
 *
 * Runs pg_dump against the target database before any DDL executes,
 * writing a plain-SQL dump to databases/ at the project root. Named with
 * the app version, the schema version being migrated FROM, and a
 * timestamp, so repeated runs (or migrating the same install twice)
 * never collide or silently overwrite an earlier backup.
 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT } from "./_lib.env.mjs";
import { info, warn, success } from "./_lib.output.mjs";

const BACKUP_DIR = resolve(ROOT, "databases");

function commandAvailable(cmd) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, ["--version"], { stdio: "ignore" });
    child.on("error", () => resolvePromise(false));
    child.on("exit", (code) => resolvePromise(code === 0));
  });
}

/**
 * Backs up `connectionString`'s database to
 * databases/vulnradar_v{appVersion}_schema-{schemaVersion}_{timestamp}.sql.
 * Returns the written file's path, or null if pg_dump isn't on PATH --
 * this warns rather than throwing, so a self-hosted install without
 * postgresql-client installed can still migrate, just without this
 * safety net (the Docker image ships pg_dump, so this is the common
 * case only for a bare, non-Docker Node install).
 */
export async function backupDatabase(
  connectionString,
  { appVersion, schemaVersion },
) {
  if (!(await commandAvailable("pg_dump"))) {
    warn(
      "pg_dump not found on PATH -- skipping the pre-migration backup. Install postgresql-client (the Docker image already includes it) to enable automatic backups.",
    );
    return null;
  }

  await mkdir(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `vulnradar_v${appVersion}_schema-${schemaVersion}_${timestamp}.sql`;
  const filePath = resolve(BACKUP_DIR, filename);

  info(`Backing up database to databases/${filename} before migrating...`);

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

  success(`Backup written: databases/${filename}`);
  return filePath;
}
