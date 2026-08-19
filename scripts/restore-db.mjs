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
 *
 * Destructive: this runs `psql` against DATABASE_URL and will apply
 * whatever the dump contains on top of it. Requires --yes -- without it,
 * this only prints what it would do and exits.
 */
import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";
import { loadEnv, requireDatabaseUrl } from "./_lib/_lib.env.mjs";
import {
  banner,
  info,
  success,
  error,
  section,
  warningBox,
} from "./_lib/_lib.output.mjs";
import { createBackupDecipher } from "./backup-db.mjs";

async function runRestore() {
  banner("VulnRadar Database Restore");

  loadEnv();
  requireDatabaseUrl();

  const args = process.argv.slice(2);
  const filePath = args
    .find((a) => a.startsWith("--file="))
    ?.slice("--file=".length);
  const confirmed = args.includes("--yes");

  if (!filePath) {
    error("Usage: npm run db:restore -- --file=<path-to-backup> --yes");
    process.exit(1);
  }

  if (!confirmed) {
    warningBox("This will restore into the CURRENT DATABASE_URL database.", [
      `File: ${filePath}`,
      "This is destructive -- it applies the dump on top of whatever is there now.",
      "Re-run with --yes once you're sure, ideally against a throwaway/staging DB first.",
    ]);
    process.exit(0);
  }

  section("Preparing");
  let source = createReadStream(filePath);

  if (filePath.endsWith(".enc")) {
    // Identical resolution to backup-db.mjs: fall back to API_KEY_ENCRYPTION_KEY
    // when no dedicated BACKUP_ENCRYPTION_KEY is set. If backup-db.mjs encrypted
    // this file using that base-key fallback, restoring with a different key
    // resolution would make it permanently undecryptable. A separate
    // BACKUP_ENCRYPTION_KEY is still recommended for defense in depth.
    const key =
      process.env.BACKUP_ENCRYPTION_KEY || process.env.API_KEY_ENCRYPTION_KEY;
    if (!key) {
      error(
        "This backup is encrypted. Set BACKUP_ENCRYPTION_KEY (or " +
          "API_KEY_ENCRYPTION_KEY, the fallback it was likely encrypted with) " +
          "to restore it.",
      );
      process.exit(1);
    }
    const meta = JSON.parse(await readFile(`${filePath}.json`, "utf8"));
    const decipher = createBackupDecipher(key, meta.iv, meta.authTag);
    const decrypted = new PassThrough();
    pipeline(source, decipher, decrypted).catch((err) => {
      error(`Decryption failed: ${err.message}`);
      process.exit(1);
    });
    source = decrypted;
    info("Decrypting...");
  }

  section("Restoring");
  const psql = spawn("psql", [process.env.DATABASE_URL], {
    stdio: ["pipe", "inherit", "inherit"],
  });

  const exitCodePromise = new Promise((resolvePromise, rejectPromise) => {
    psql.on("error", rejectPromise);
    psql.on("close", (code) => resolvePromise(code));
  });

  await pipeline(source, createGunzip(), psql.stdin);
  const exitCode = await exitCodePromise;
  if (exitCode !== 0) {
    throw new Error(`psql exited with code ${exitCode}`);
  }

  success("Restore complete.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRestore().catch((err) => {
    error(err.message);
    process.exit(1);
  });
}
