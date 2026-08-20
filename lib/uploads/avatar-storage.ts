/**
 * Database-backed avatar storage.
 *
 * There is one image-storage mechanism in this app: Postgres. Scan
 * screenshots already live in scan_screenshots (image_data BYTEA); an
 * uploaded profile avatar lives the same way in user_avatars, one row per
 * user, and is served back through GET /api/v3/avatar/[userId]. Nothing is
 * written to the local filesystem, so this behaves identically on every
 * deployment target (self-hosted Docker and serverless alike) with no
 * fallback path to reason about.
 *
 * Scope: only locally-uploaded avatars (a validated PNG/JPEG that arrived
 * as a `data:image/...;base64,...` URL -- see lib/uploads/avatar.ts) are
 * stored here. External OAuth avatars (cdn.discordapp.com, Google, GitHub)
 * are plain URLs kept as-is in users.avatar_url; they are not ours to
 * store and never touch this table.
 */

import { Buffer } from "node:buffer";
import pool from "@/lib/database/db";

/**
 * Whether uploaded avatars can be durably stored. Always true now that
 * avatars live in Postgres, which is available on every deployment target.
 * Kept as an export so existing call sites keep compiling; callers no
 * longer need to branch on it (the database path is always taken).
 */
export function isLocalAvatarStorageAvailable(): boolean {
  return true;
}

/**
 * Upsert validated image bytes for `userId` (one row per user, so a
 * re-upload -- even one that changes format, PNG to JPEG -- overwrites in
 * place and never orphans anything).
 *
 * Returns the URL to store in users.avatar_url: a same-origin path the
 * GET /api/v3/avatar/[userId] route resolves back to these bytes, with a
 * cache-busting `v` query param (the write timestamp) so a re-upload at
 * the same path doesn't keep showing a browser-cached old image.
 */
export async function saveAvatarFile(
  userId: number,
  mime: "image/png" | "image/jpeg",
  bytes: Buffer,
): Promise<string> {
  await pool.query(
    `INSERT INTO user_avatars (user_id, image_data, content_type, updated_at)
       VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET image_data = EXCLUDED.image_data,
           content_type = EXCLUDED.content_type,
           updated_at = NOW()`,
    [userId, bytes, mime],
  );
  return `/api/v3/avatar/${userId}?v=${Date.now()}`;
}

/**
 * Read a user's stored avatar bytes and content type, or null when they
 * have no uploaded avatar. Mirrors readScanScreenshot's BYTEA read in
 * lib/scanner/page-screenshot.ts.
 */
export async function readAvatarFile(
  userId: number,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const res = await pool.query<{
    image_data: Buffer;
    content_type: string | null;
  }>(`SELECT image_data, content_type FROM user_avatars WHERE user_id = $1`, [
    userId,
  ]);
  const row = res.rows[0];
  if (!row?.image_data) return null;
  return {
    bytes: row.image_data,
    mime: row.content_type || "image/png",
  };
}

/** Remove a user's stored avatar row, if any. */
export async function deleteAvatarFiles(userId: number): Promise<void> {
  await pool.query("DELETE FROM user_avatars WHERE user_id = $1", [userId]);
}

/**
 * Best-effort avatar cleanup: never throws. Use this at every write site
 * that replaces or clears avatar_url (a re-upload, a Discord avatar sync,
 * an admin "clear avatar" action, an account deletion) so a stored avatar
 * row is never left behind. Kept under the historical "IfLocal" name so
 * callers keep compiling; it is now the same database delete as
 * deleteAvatarFiles, just guarded so it can never surface an error.
 */
export async function deleteAvatarFilesIfLocal(userId: number): Promise<void> {
  try {
    await deleteAvatarFiles(userId);
  } catch (err) {
    console.error("[avatar-storage] Failed to delete avatar row(s):", err);
  }
}
