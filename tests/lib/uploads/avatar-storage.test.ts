import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * lib/uploads/avatar-storage.ts writes real files to disk (per this
 * repo's "mock at the network/database boundary, not below it" rule —
 * tests/README.md — there is no DB or network boundary here at all, so
 * nothing is mocked). Every test points AVATAR_STORAGE_DIR at a fresh
 * temp directory so nothing touches the real repo's data/avatars/, and
 * that directory is removed again in afterEach/afterAll.
 */

let tmpDirs: string[] = [];
const originalStorageDir = process.env.AVATAR_STORAGE_DIR;
const originalVercel = process.env.VERCEL;

function freshTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vulnradar-avatar-test-"));
  tmpDirs.push(dir);
  process.env.AVATAR_STORAGE_DIR = dir;
  return dir;
}

beforeEach(() => {
  delete process.env.VERCEL;
});

afterEach(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

afterAll(() => {
  if (originalStorageDir === undefined) delete process.env.AVATAR_STORAGE_DIR;
  else process.env.AVATAR_STORAGE_DIR = originalStorageDir;
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

const {
  isLocalAvatarStorageAvailable,
  getAvatarStorageDir,
  saveAvatarFile,
  deleteAvatarFiles,
  deleteAvatarFilesIfLocal,
  readAvatarFile,
} = await import("@/lib/uploads/avatar-storage");

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 4, 5, 6]);

describe("isLocalAvatarStorageAvailable", () => {
  it("is true when VERCEL is unset", () => {
    delete process.env.VERCEL;
    expect(isLocalAvatarStorageAvailable()).toBe(true);
  });

  it("is false when VERCEL is set", () => {
    process.env.VERCEL = "1";
    expect(isLocalAvatarStorageAvailable()).toBe(false);
    delete process.env.VERCEL;
  });
});

describe("getAvatarStorageDir", () => {
  it("honors AVATAR_STORAGE_DIR when set", () => {
    const dir = freshTmpDir();
    expect(getAvatarStorageDir()).toBe(dir);
  });
});

describe("saveAvatarFile / readAvatarFile", () => {
  it("writes the file to disk and returns a cache-busting avatar URL", async () => {
    freshTmpDir();
    const url = await saveAvatarFile(42, "image/png", PNG_BYTES);

    expect(url).toMatch(/^\/api\/v3\/avatar\/42\?v=\d+$/);

    const filePath = join(getAvatarStorageDir(), "42.png");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath)).toEqual(PNG_BYTES);
  });

  it("round-trips through readAvatarFile", async () => {
    freshTmpDir();
    await saveAvatarFile(7, "image/jpeg", JPEG_BYTES);

    const file = await readAvatarFile(7);
    expect(file).not.toBeNull();
    expect(file?.mime).toBe("image/jpeg");
    expect(file?.bytes).toEqual(JPEG_BYTES);
  });

  it("returns null for a user with no stored avatar", async () => {
    freshTmpDir();
    const file = await readAvatarFile(999);
    expect(file).toBeNull();
  });

  it("removes the old file when a re-upload changes format (no orphaned file)", async () => {
    freshTmpDir();
    await saveAvatarFile(5, "image/jpeg", JPEG_BYTES);
    expect(existsSync(join(getAvatarStorageDir(), "5.jpg"))).toBe(true);

    await saveAvatarFile(5, "image/png", PNG_BYTES);

    expect(existsSync(join(getAvatarStorageDir(), "5.jpg"))).toBe(false);
    expect(existsSync(join(getAvatarStorageDir(), "5.png"))).toBe(true);
    const file = await readAvatarFile(5);
    expect(file?.mime).toBe("image/png");
  });

  it("creates the storage directory if it doesn't exist yet", async () => {
    const parent = mkdtempSync(join(tmpdir(), "vulnradar-avatar-test-"));
    tmpDirs.push(parent);
    process.env.AVATAR_STORAGE_DIR = join(parent, "nested", "avatars");

    await saveAvatarFile(1, "image/png", PNG_BYTES);
    expect(existsSync(join(getAvatarStorageDir(), "1.png"))).toBe(true);
  });
});

describe("deleteAvatarFiles", () => {
  it("removes a stored avatar file", async () => {
    freshTmpDir();
    await saveAvatarFile(3, "image/png", PNG_BYTES);
    await deleteAvatarFiles(3);
    expect(await readAvatarFile(3)).toBeNull();
  });

  it("is a no-op (does not throw) when no file exists", async () => {
    freshTmpDir();
    await expect(deleteAvatarFiles(12345)).resolves.toBeUndefined();
  });
});

describe("deleteAvatarFilesIfLocal", () => {
  it("deletes the file when local storage is available", async () => {
    freshTmpDir();
    await saveAvatarFile(9, "image/png", PNG_BYTES);
    await deleteAvatarFilesIfLocal(9);
    expect(await readAvatarFile(9)).toBeNull();
  });

  it("does nothing on a deployment with no local storage (VERCEL set)", async () => {
    freshTmpDir();
    await saveAvatarFile(9, "image/png", PNG_BYTES);
    process.env.VERCEL = "1";

    await deleteAvatarFilesIfLocal(9);

    delete process.env.VERCEL;
    // The file is still there -- deleteAvatarFilesIfLocal skipped the fs
    // call entirely rather than deleting it.
    expect(await readAvatarFile(9)).not.toBeNull();
  });

  it("never throws even when there is nothing to delete", async () => {
    freshTmpDir();
    await expect(deleteAvatarFilesIfLocal(12345)).resolves.toBeUndefined();
  });
});
