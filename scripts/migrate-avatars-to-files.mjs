#!/usr/bin/env node

/**
 * VulnRadar — Migrate base64 avatars from the database to real files.
 *
 * Historically, uploaded profile pictures were validated (PNG/JPEG only,
 * magic-bytes checked, 5 MiB cap — see lib/uploads/avatar.ts) and then
 * stored AS-IS in users.avatar_url as a `data:image/...;base64,...`
 * string. New uploads now go straight to a real file on disk
 * (lib/uploads/avatar-storage.ts) so avatar_url holds a small URL instead
 * of a multi-KB/MB blob — smaller DB rows, smaller GDPR data-export
 * payloads, and a portable file instead of an opaque text column. This
 * script performs the one-time backfill for rows that predate that
 * change.
 *
 * This is a plain Node script (no TypeScript loader is configured for
 * scripts/, matching every other file here), so the storage-path logic
 * and validation rules are re-implemented rather than imported from
 * lib/uploads/avatar.ts / lib/uploads/avatar-storage.ts. Keep this in
 * sync if either of those files' rules change.
 *
 * Scope: only rows where avatar_url starts with "data:image/" are
 * touched. External references (Discord CDN URLs, Gravatar URLs) are
 * left exactly as they are — they're already small, portable URLs with
 * nothing to migrate.
 *
 * Idempotent: the SELECT only ever matches "data:image/%" values. A
 * migrated row's avatar_url becomes "/api/v3/avatar/<id>?v=...", which
 * never matches that filter again, so re-running finds zero eligible
 * rows once every base64 avatar has been converted. Each row is
 * processed independently, file write BEFORE the DB update, so a crash
 * mid-run always leaves a row either untouched (still base64, picked up
 * again on retry) or fully migrated — never a DB row pointing at a file
 * that was never written.
 *
 * Refuses to run when VERCEL is set: that deployment has no durable
 * local filesystem to write these files to (see
 * lib/uploads/avatar-storage.ts's isLocalAvatarStorageAvailable).
 *
 * Usage:
 *   npm run db:migrate-avatars                # dry run (default)
 *   npm run db:migrate-avatars -- --apply      # perform the migration
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, requireDatabaseUrl, ROOT } from "./_lib/_lib.env.mjs";
import { createPool, connect } from "./_lib/_lib.db.mjs";
import { log, info, success, warn, error, banner, section } from "./_lib/_lib.output.mjs";

const DATA_URL_RE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Decode + validate one row's avatar_url. Mirrors
 * lib/uploads/avatar.ts's validateAvatarDataUrl rules (MIME allowlist,
 * magic-bytes check) so this script never writes out something the app
 * itself would have rejected on upload.
 *
 * @param {string} value
 * @returns {{ ok: true, mime: "image/png" | "image/jpeg", bytes: Buffer } | { ok: false, reason: string }}
 */
export function decodeDataUrlAvatar(value) {
  const match = DATA_URL_RE.exec(value ?? "");
  if (!match) {
    return { ok: false, reason: "not a recognized data:image/(png|jpeg) URL" };
  }
  const mime = match[1] === "png" ? "image/png" : "image/jpeg";
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) {
    return { ok: false, reason: "empty after base64 decode" };
  }
  const magic = mime === "image/png" ? PNG_MAGIC : JPEG_MAGIC;
  if (
    bytes.length < magic.length ||
    !bytes.subarray(0, magic.length).equals(magic)
  ) {
    return { ok: false, reason: "bytes do not match declared signature" };
  }
  return { ok: true, mime, bytes };
}

function avatarStorageDir() {
  return process.env.AVATAR_STORAGE_DIR || resolve(ROOT, "data", "avatars");
}

/**
 * Write one user's decoded avatar to disk, matching
 * lib/uploads/avatar-storage.ts's saveAvatarFile behavior (same
 * directory, same filename scheme, same returned URL shape, and the
 * same clean-up of the other possible extension so a format change
 * never leaves an orphaned file).
 */
export async function writeAvatarFile(userId, mime, bytes) {
  const dir = avatarStorageDir();
  await mkdir(dir, { recursive: true });
  const ext = mime === "image/png" ? "png" : "jpg";
  for (const otherExt of ["png", "jpg"]) {
    if (otherExt !== ext) {
      await rm(resolve(dir, `${userId}.${otherExt}`), { force: true });
    }
  }
  await writeFile(resolve(dir, `${userId}.${ext}`), bytes);
  return `/api/v3/avatar/${userId}?v=${Date.now()}`;
}

/**
 * Core migration logic. `pool` and `saveAvatarFile` are both injected so
 * tests can exercise the row-selection/skip/apply logic against a fake
 * pool without touching a real database or the real filesystem.
 *
 * @param {{query: Function}} pool
 * @param {{apply?: boolean, saveAvatarFile?: Function}} [options]
 */
export async function runAvatarMigration(
  pool,
  { apply = false, saveAvatarFile: save = writeAvatarFile } = {},
) {
  const result = await pool.query(
    "SELECT id, avatar_url FROM users WHERE avatar_url LIKE 'data:image/%'",
  );

  const migrated = [];
  const skipped = [];

  for (const row of result.rows) {
    const decoded = decodeDataUrlAvatar(row.avatar_url);
    if (!decoded.ok) {
      skipped.push({ userId: row.id, reason: decoded.reason });
      continue;
    }
    if (!apply) {
      migrated.push({
        userId: row.id,
        mime: decoded.mime,
        bytes: decoded.bytes.length,
      });
      continue;
    }
    // Write the file first. The UPDATE only runs once the write has
    // actually succeeded, so a crash between the two steps leaves the
    // row untouched (still base64, still matched on the next run)
    // instead of pointing at a file that was never written.
    const newUrl = await save(row.id, decoded.mime, decoded.bytes);
    await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [
      newUrl,
      row.id,
    ]);
    migrated.push({
      userId: row.id,
      mime: decoded.mime,
      bytes: decoded.bytes.length,
      newUrl,
    });
  }

  return { migrated, skipped, dryRun: !apply };
}

async function main() {
  const apply = process.argv.includes("--apply");

  banner(
    "VulnRadar — Migrate Avatars to Files",
    apply ? "Writing base64 avatars to disk" : "Dry run (pass --apply to write)",
  );

  if (process.env.VERCEL) {
    error(
      "VERCEL is set — this deployment has no durable local filesystem for " +
        "avatar files. Nothing to migrate; avatars stay stored as data URLs.",
    );
    process.exit(1);
  }

  loadEnv();
  requireDatabaseUrl();

  const pool = createPool();
  if (!(await connect(pool))) {
    await pool.end();
    process.exit(1);
  }

  try {
    const { migrated, skipped, dryRun } = await runAvatarMigration(pool, {
      apply,
    });

    section(dryRun ? "Dry run results" : "Migration results");

    if (migrated.length === 0 && skipped.length === 0) {
      success("No base64 avatars found. Nothing to do.");
    } else {
      for (const m of migrated) {
        const verb = dryRun ? "would migrate" : "migrated";
        log(`  ${verb} user #${m.userId} (${m.mime}, ${m.bytes} bytes)`);
      }
      for (const s of skipped) {
        warn(`  skipping user #${s.userId}: ${s.reason}`);
      }
      log("");
      if (dryRun) {
        info(
          `${migrated.length} row(s) would be migrated, ${skipped.length} ` +
            `would be skipped. Re-run with --apply to write the files.`,
        );
      } else {
        success(
          `Migrated ${migrated.length} row(s), skipped ${skipped.length}.`,
        );
      }
    }
  } catch (err) {
    error(`Avatar migration failed: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly (`node scripts/migrate-avatars-to-files.mjs`),
// not when imported by the test suite.
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
