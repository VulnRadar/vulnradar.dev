/**
 * Local-disk avatar file storage.
 *
 * Deployment note (read before changing the storage path):
 *
 * This app ships two officially documented deployment targets (see
 * app/docs/self-hosting and app/docs/setup): self-hosted Docker (a single
 * persistent Node process with a writable, persistent filesystem) and
 * Vercel (serverless — a read-only filesystem outside /tmp, /tmp itself is
 * wiped between invocations, and concurrent invocations don't share disk
 * at all). Writing avatar files to local disk only works on the first
 * target. isLocalAvatarStorageAvailable() detects the second (Vercel
 * always sets the VERCEL env var) so callers can fall back to the
 * pre-existing base64-data-URL-in-the-database behavior instead of
 * silently losing every uploaded avatar on the next cold start.
 *
 * On the Docker target, the storage directory defaults to
 * `<cwd>/data/avatars` — a sibling of `public/`, deliberately NOT inside
 * it. `public/` is copied into the runtime image at build time
 * (Dockerfile: `COPY --from=builder /app/public ./public`) and gets fully
 * replaced by that build-time snapshot on every image rebuild or
 * container recreation, so anything written under `public/` at runtime
 * would vanish the next time someone runs `docker compose pull && up -d`.
 * `data/avatars` is mounted as its own named Docker volume (see
 * docker-compose.yml's `avatar_data` volume) so it survives container
 * recreation the same way `postgres_data` already does. Override the
 * directory with the AVATAR_STORAGE_DIR env var if a self-hoster mounts
 * their volume somewhere else.
 */

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const EXT_BY_MIME: Record<"image/png" | "image/jpeg", string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
};

/** Vercel's serverless filesystem cannot durably hold uploaded files. */
export function isLocalAvatarStorageAvailable(): boolean {
  return !process.env.VERCEL;
}

export function getAvatarStorageDir(): string {
  return (
    process.env.AVATAR_STORAGE_DIR || path.join(process.cwd(), "data", "avatars")
  );
}

function filePathFor(userId: number, ext: string): string {
  return path.join(getAvatarStorageDir(), `${userId}.${ext}`);
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

/** Remove any stored avatar file(s) for a user, regardless of extension. */
export async function deleteAvatarFiles(userId: number): Promise<void> {
  await Promise.all(
    Object.values(EXT_BY_MIME).map((ext) => unlinkIfExists(filePathFor(userId, ext))),
  );
}

/**
 * Best-effort avatar-file cleanup: no-ops on a deployment with no local
 * storage (Vercel) and never throws. Use this at every write site that
 * replaces or clears avatar_url, so a re-upload, a Discord avatar sync, an
 * admin "clear avatar" action, or an account deletion never leaves an
 * orphaned file behind.
 */
export async function deleteAvatarFilesIfLocal(userId: number): Promise<void> {
  if (!isLocalAvatarStorageAvailable()) return;
  try {
    await deleteAvatarFiles(userId);
  } catch (err) {
    console.error("[avatar-storage] Failed to delete avatar file(s):", err);
  }
}

/**
 * Write validated image bytes to disk for `userId`, removing any
 * previously stored avatar first (so a re-upload that changes format,
 * e.g. PNG to JPEG, never leaves the old file orphaned).
 *
 * Returns the URL to store in users.avatar_url: a same-origin path the
 * new GET /api/v3/avatar/[userId] route resolves back to this file, with
 * a cache-busting `v` query param (the write timestamp) so a re-upload at
 * the same path doesn't keep showing a browser-cached old image.
 */
export async function saveAvatarFile(
  userId: number,
  mime: "image/png" | "image/jpeg",
  bytes: Buffer,
): Promise<string> {
  const dir = getAvatarStorageDir();
  await mkdir(dir, { recursive: true });
  await deleteAvatarFiles(userId);
  await writeFile(filePathFor(userId, EXT_BY_MIME[mime]), bytes);
  return `/api/v3/avatar/${userId}?v=${Date.now()}`;
}

/** Read the stored avatar file for a user, trying each known extension. */
export async function readAvatarFile(
  userId: number,
): Promise<{ bytes: Buffer; mime: string } | null> {
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    try {
      const bytes = await readFile(filePathFor(userId, ext));
      return { bytes, mime };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    }
  }
  return null;
}
