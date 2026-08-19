/**
 * One-time import of legacy on-disk avatars into the database.
 *
 * This is the SELF-HOSTED-DOCKER half of the "avatars now live in
 * Postgres" migration. Older Docker builds stored uploaded avatars as
 * files at data/avatars/<id>.(png|jpg) and pointed users.avatar_url at
 * /api/v3/avatar/<id>. This reads any such files and writes their bytes
 * into user_avatars so the (now database-backed) serving route keeps
 * working, then refreshes the avatar_url cache-buster.
 *
 * The OTHER half -- converting base64 `data:image/...` avatar_url values
 * (the old serverless fallback, which never touched the filesystem) -- is
 * a pure-database step and lives in the versioned migration
 * scripts/migrate/versions/3.0.0-to-3.5.0.mjs, applied with the standard
 * `npm run db:migrate` command. It is kept out of here so production,
 * which has no data/avatars directory at all, never depends on the
 * filesystem.
 *
 * Safe to run on every boot: a user that already has a user_avatars row is
 * skipped, a missing data/avatars directory is a clean no-op, and any
 * single unreadable file is logged and skipped rather than aborting the
 * import. Never throws. External OAuth avatar URLs (cdn.discordapp.com,
 * Google, GitHub) are left exactly as they are -- they are not ours.
 */

import { Buffer } from "node:buffer";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pool from "@/lib/database/db";

const MIME_BY_EXT: Record<string, "image/png" | "image/jpeg"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** 5 MiB, matching lib/uploads/avatar.ts's upload cap. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** The legacy on-disk avatar directory (honors the old override env). */
function legacyAvatarDir(): string {
  return (
    process.env.AVATAR_STORAGE_DIR || path.join(process.cwd(), "data", "avatars")
  );
}

function magicOk(mime: "image/png" | "image/jpeg", bytes: Buffer): boolean {
  const expected = mime === "image/png" ? PNG_MAGIC : JPEG_MAGIC;
  return (
    bytes.length >= expected.length &&
    bytes.subarray(0, expected.length).equals(expected)
  );
}

/**
 * Import every legacy data/avatars/<id>.(png|jpg) file into user_avatars,
 * skipping users that already have a row. Returns the number imported.
 * Never throws.
 */
export async function migrateAvatarFilesToDatabase(): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(legacyAvatarDir());
  } catch (err) {
    // No legacy directory (the common case on a fresh or serverless
    // deployment): nothing to import.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
    console.error(
      "[avatar-migration] Could not read legacy avatar directory:",
      err instanceof Error ? err.message : err,
    );
    return 0;
  }

  let imported = 0;
  for (const name of entries) {
    const match = /^(\d+)\.(png|jpe?g)$/i.exec(name);
    if (!match) continue;
    const userId = Number.parseInt(match[1]!, 10);
    const mime = MIME_BY_EXT[match[2]!.toLowerCase()];
    if (!Number.isInteger(userId) || userId <= 0 || !mime) continue;

    try {
      const existing = await pool.query(
        "SELECT 1 FROM user_avatars WHERE user_id = $1",
        [userId],
      );
      if (existing.rows.length > 0) continue;

      // Only import a file whose user still points at the serving route:
      // that is the definitive signal it is the user's active uploaded
      // avatar, not a stale orphan left behind after they switched to an
      // external (Discord/Google) avatar or cleared it. Importing a stale
      // file would resurrect a deleted avatar or clobber an external one.
      const userRow = await pool.query<{ avatar_url: string | null }>(
        "SELECT avatar_url FROM users WHERE id = $1",
        [userId],
      );
      const currentUrl = userRow.rows[0]?.avatar_url;
      if (userRow.rows.length === 0) continue;
      if (!currentUrl || !currentUrl.startsWith("/api/v3/avatar/")) continue;

      const bytes = await readFile(path.join(legacyAvatarDir(), name));
      if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) continue;
      if (!magicOk(mime, bytes)) continue;

      await pool.query(
        `INSERT INTO user_avatars (user_id, image_data, content_type, updated_at)
           VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, bytes, mime],
      );
      await pool.query(
        "UPDATE users SET avatar_url = $1 WHERE id = $2",
        [`/api/v3/avatar/${userId}?v=${Date.now()}`, userId],
      );
      imported++;
    } catch (err) {
      console.error(
        `[avatar-migration] Failed to import ${name} (skipped):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return imported;
}
