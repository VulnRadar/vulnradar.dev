import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * lib/uploads/avatar-storage.ts is database-backed: uploaded avatars live
 * in the user_avatars BYTEA table (served by GET /api/v3/avatar/[userId]),
 * the same single Postgres image-storage mechanism scan_screenshots uses.
 * Per this repo's "mock at the database boundary" rule (tests/README.md),
 * the pg pool is mocked with a small in-memory store keyed by user_id that
 * emulates the upsert / select / delete the storage layer issues.
 */

type Row = { image_data: Buffer; content_type: string };
const store = new Map<number, Row>();

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("INSERT INTO user_avatars")) {
    const [userId, bytes, mime] = params as [number, Buffer, string];
    store.set(userId, { image_data: bytes, content_type: mime });
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith("SELECT image_data, content_type FROM user_avatars")) {
    const [userId] = params as [number];
    const row = store.get(userId);
    return { rows: row ? [row] : [] };
  }
  if (s.startsWith("DELETE FROM user_avatars")) {
    const [userId] = params as [number];
    store.delete(userId);
    return { rows: [], rowCount: 1 };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const {
  isLocalAvatarStorageAvailable,
  saveAvatarFile,
  deleteAvatarFiles,
  deleteAvatarFilesIfLocal,
  readAvatarFile,
} = await import("@/lib/uploads/avatar-storage");

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 4, 5, 6]);

beforeEach(() => {
  store.clear();
  mockQuery.mockClear();
});

describe("isLocalAvatarStorageAvailable", () => {
  it("is always true now that avatars live in the database", () => {
    expect(isLocalAvatarStorageAvailable()).toBe(true);
  });
});

describe("saveAvatarFile / readAvatarFile", () => {
  it("upserts the bytes and returns a cache-busting avatar URL", async () => {
    const url = await saveAvatarFile(42, "image/png", PNG_BYTES);

    expect(url).toMatch(/^\/api\/v3\/avatar\/42\?v=\d+$/);
    expect(store.get(42)?.image_data).toEqual(PNG_BYTES);
    expect(store.get(42)?.content_type).toBe("image/png");
  });

  it("round-trips through readAvatarFile", async () => {
    await saveAvatarFile(7, "image/jpeg", JPEG_BYTES);

    const file = await readAvatarFile(7);
    expect(file).not.toBeNull();
    expect(file?.mime).toBe("image/jpeg");
    expect(file?.bytes).toEqual(JPEG_BYTES);
  });

  it("returns null for a user with no stored avatar", async () => {
    expect(await readAvatarFile(999)).toBeNull();
  });

  it("overwrites the single row when a re-upload changes format (no orphan)", async () => {
    await saveAvatarFile(5, "image/jpeg", JPEG_BYTES);
    await saveAvatarFile(5, "image/png", PNG_BYTES);

    const file = await readAvatarFile(5);
    expect(file?.mime).toBe("image/png");
    expect(file?.bytes).toEqual(PNG_BYTES);
    // One row per user: the JPEG did not linger alongside the PNG.
    expect(store.size).toBe(1);
  });
});

describe("deleteAvatarFiles", () => {
  it("removes a stored avatar row", async () => {
    await saveAvatarFile(3, "image/png", PNG_BYTES);
    await deleteAvatarFiles(3);
    expect(await readAvatarFile(3)).toBeNull();
  });

  it("is a no-op (does not throw) when no row exists", async () => {
    await expect(deleteAvatarFiles(12345)).resolves.toBeUndefined();
  });
});

describe("deleteAvatarFilesIfLocal", () => {
  it("deletes the stored avatar row", async () => {
    await saveAvatarFile(9, "image/png", PNG_BYTES);
    await deleteAvatarFilesIfLocal(9);
    expect(await readAvatarFile(9)).toBeNull();
  });

  it("never throws even when the delete query fails (best-effort)", async () => {
    mockQuery.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    await expect(deleteAvatarFilesIfLocal(1)).resolves.toBeUndefined();
  });

  it("never throws when there is nothing to delete", async () => {
    await expect(deleteAvatarFilesIfLocal(12345)).resolves.toBeUndefined();
  });
});
