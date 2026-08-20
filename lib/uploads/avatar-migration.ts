/**
 * One-time boot backfill of legacy avatars into the user_avatars table.
 *
 * Uploaded avatars now live in Postgres (see lib/uploads/avatar-storage.ts),
 * served by GET /api/v3/avatar/[userId]. Two older storage shapes are
 * migrated here, both idempotently and best-effort at boot so a fresh
 * `docker compose up` (or a serverless cold start) heals itself with no
 * separate command:
 *
 *   - migrateBase64AvatarsToDatabase(): the old serverless fallback stored
 *     an uploaded avatar as a base64 `data:image/...` URL directly in
 *     users.avatar_url. This decodes+validates each one and moves the bytes
 *     into user_avatars. Pure database -- no filesystem -- so it works on
 *     production, which has no data/avatars directory at all.
 *   - migrateAvatarFilesToDatabase(): older self-hosted Docker builds stored
 *     an uploaded avatar as a file at data/avatars/<id>.(png|jpg). This reads
 *     any such files and writes their bytes into user_avatars.
 *
 * Both then normalize users.avatar_url to /api/v3/avatar/<id>?v=<ts>. Safe to
 * run on every boot: a user that already has a user_avatars row is skipped, a
 * single bad/oversized/undecodable/unreadable row is logged and skipped, and
 * neither ever throws (a failed backfill must never block startup). External
 * OAuth avatar URLs (cdn.discordapp.com, Google, GitHub) are left exactly as
 * they are -- they are not ours to move.
 */

import { Buffer } from "node:buffer";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pool from "@/lib/database/db";
import { validateAvatarDataUrl } from "@/lib/uploads/avatar";

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
 * Insert a user's avatar bytes and normalize their avatar_url to the serving
 * route, atomically. Both backfills call this: doing the INSERT and the
 * avatar_url UPDATE as two separate statements risked a state where the INSERT
 * committed but the UPDATE failed on a transient error -- every later boot then
 * short-circuits on the now-existing user_avatars row, leaving avatar_url stuck
 * as the old base64/file URL forever. Wrapping both in one transaction makes it
 * all-or-nothing, so a failed row simply retries cleanly on the next boot.
 * Follows the pool.connect() + BEGIN/COMMIT/ROLLBACK pattern used in
 * lib/database/cleanup.ts (no shared transaction helper exists).
 */
async function insertAvatarAndNormalizeUrl(
  userId: number,
  bytes: Buffer,
  mime: "image/png" | "image/jpeg",
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO user_avatars (user_id, image_data, content_type, updated_at)
         VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, bytes, mime],
    );
    await client.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [
      `/api/v3/avatar/${userId}?v=${Date.now()}`,
      userId,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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

      await insertAvatarAndNormalizeUrl(userId, bytes, mime);
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

/**
 * Convert every legacy base64 `data:image/(png|jpeg);base64,...` avatar_url
 * (the old serverless-fallback storage shape) into a user_avatars row, then
 * normalize that avatar_url to the serving route. Pure database, no
 * filesystem. Returns the number converted. Never throws.
 *
 * Idempotent: a user that already has a user_avatars row is skipped, and a
 * converted row's avatar_url no longer matches the data:image filter, so a
 * re-run finds it zero times. Best-effort: a single row whose data URL fails
 * validation (wrong magic bytes, over the 5 MiB cap, undecodable) is logged
 * and skipped -- one bad row never aborts the backfill or blocks boot.
 */
export async function migrateBase64AvatarsToDatabase(): Promise<number> {
  let rows: { id: number; avatar_url: string | null }[];
  try {
    const res = await pool.query<{ id: number; avatar_url: string | null }>(
      `SELECT id, avatar_url FROM users
       WHERE avatar_url LIKE 'data:image/png;base64,%'
          OR avatar_url LIKE 'data:image/jpeg;base64,%'`,
    );
    rows = res.rows;
  } catch (err) {
    console.error(
      "[avatar-migration] Could not scan for base64 avatars:",
      err instanceof Error ? err.message : err,
    );
    return 0;
  }

  let converted = 0;
  for (const row of rows) {
    if (!row.avatar_url) continue;
    try {
      const existing = await pool.query(
        "SELECT 1 FROM user_avatars WHERE user_id = $1",
        [row.id],
      );
      if (existing.rows.length > 0) continue;

      // Reuse the exact upload-time validation (MIME allowlist, magic
      // bytes, 5 MiB cap, SVG rejection) so the backfill never stores
      // anything the app itself would have rejected.
      const result = validateAvatarDataUrl(row.avatar_url);
      if (!result.valid) {
        console.error(
          `[avatar-migration] Skipped base64 avatar for user ${row.id}: ${result.reason}`,
        );
        continue;
      }

      await insertAvatarAndNormalizeUrl(row.id, result.bytes, result.mime);
      converted++;
    } catch (err) {
      console.error(
        `[avatar-migration] Failed to convert base64 avatar for user ${row.id} (skipped):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return converted;
}
