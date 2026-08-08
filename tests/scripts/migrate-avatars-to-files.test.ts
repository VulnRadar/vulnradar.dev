import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeDataUrlAvatar,
  runAvatarMigration,
  writeAvatarFile,
} from "../../scripts/migrate-avatars-to-files.mjs";

/**
 * scripts/migrate-avatars-to-files.mjs takes a pg-Pool-shaped object as
 * its first argument (dependency injection), so runAvatarMigration is
 * tested against a fake pool, per this repo's "mock at the database
 * boundary, not below it" rule (tests/README.md). writeAvatarFile itself
 * is exercised against a real temp directory (no DB or network boundary
 * involved there at all).
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from([...PNG_MAGIC, 1, 2, 3]).toString("base64")}`;
const JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 4, 5]).toString("base64")}`;

function buildMockPool(rows: Array<{ id: number; avatar_url: string }>) {
  const updates: unknown[][] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT id, avatar_url FROM users")) {
      return { rows };
    }
    if (sql.startsWith("UPDATE users SET avatar_url")) {
      updates.push(params ?? []);
      return { rows: [] };
    }
    throw new Error(`Unexpected query in test mock: ${sql}`);
  });
  return { query, updates };
}

describe("decodeDataUrlAvatar", () => {
  it("decodes a valid PNG data URL", () => {
    const result = decodeDataUrlAvatar(PNG_DATA_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mime).toBe("image/png");
      expect(result.bytes.length).toBeGreaterThan(0);
    }
  });

  it("decodes a valid JPEG data URL", () => {
    const result = decodeDataUrlAvatar(JPEG_DATA_URL);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mime).toBe("image/jpeg");
  });

  it("rejects a non-data-URL value", () => {
    const result = decodeDataUrlAvatar(
      "https://cdn.discordapp.com/avatars/1/abc.png",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a data URL whose bytes don't match the declared signature", () => {
    const badUrl = `data:image/png;base64,${Buffer.from("not a png").toString("base64")}`;
    const result = decodeDataUrlAvatar(badUrl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/signature/);
  });

  it("rejects null/undefined without throwing", () => {
    expect(decodeDataUrlAvatar(undefined as unknown as string).ok).toBe(false);
  });
});

describe("runAvatarMigration: dry run (default)", () => {
  it("reports eligible rows without calling saveAvatarFile or issuing an UPDATE", async () => {
    const pool = buildMockPool([
      { id: 1, avatar_url: PNG_DATA_URL },
      { id: 2, avatar_url: JPEG_DATA_URL },
    ]);
    const saveAvatarFile = vi.fn();

    const result = await runAvatarMigration(pool, {
      apply: false,
      saveAvatarFile,
    });

    expect(result.dryRun).toBe(true);
    expect(
      result.migrated.map((m: { userId: number }) => m.userId).sort(),
    ).toEqual([1, 2]);
    expect(result.skipped).toEqual([]);
    expect(saveAvatarFile).not.toHaveBeenCalled();
    expect(pool.updates).toEqual([]);
  });

  it("skips rows whose data URL fails validation, without throwing", async () => {
    const pool = buildMockPool([
      { id: 3, avatar_url: "data:image/png;base64,bm90IGEgcG5n" }, // "not a png"
    ]);
    const saveAvatarFile = vi.fn();

    const result = await runAvatarMigration(pool, {
      apply: false,
      saveAvatarFile,
    });

    expect(result.migrated).toEqual([]);
    expect(result.skipped).toEqual([
      { userId: 3, reason: "bytes do not match declared signature" },
    ]);
  });

  it("is a true no-op when there are zero eligible rows (idempotency after a full migration)", async () => {
    const pool = buildMockPool([]);
    const saveAvatarFile = vi.fn();

    const result = await runAvatarMigration(pool, {
      apply: false,
      saveAvatarFile,
    });

    expect(result.migrated).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe("runAvatarMigration: apply mode", () => {
  it("writes the file before updating the row, and stores the returned URL", async () => {
    const pool = buildMockPool([{ id: 4, avatar_url: PNG_DATA_URL }]);
    const calls: string[] = [];
    const saveAvatarFile = vi.fn(async (userId: number) => {
      calls.push(`save:${userId}`);
      return `/api/v3/avatar/${userId}?v=123`;
    });

    const result = await runAvatarMigration(pool, {
      apply: true,
      saveAvatarFile,
    });

    expect(result.dryRun).toBe(false);
    expect(saveAvatarFile).toHaveBeenCalledTimes(1);
    expect(pool.updates).toEqual([["/api/v3/avatar/4?v=123", 4]]);
    expect(result.migrated[0]).toMatchObject({
      userId: 4,
      newUrl: "/api/v3/avatar/4?v=123",
    });
  });

  it("never calls the UPDATE for a row that fails validation", async () => {
    const pool = buildMockPool([
      { id: 5, avatar_url: "data:image/png;base64,bm90IGEgcG5n" },
    ]);
    const saveAvatarFile = vi.fn();

    const result = await runAvatarMigration(pool, {
      apply: true,
      saveAvatarFile,
    });

    expect(saveAvatarFile).not.toHaveBeenCalled();
    expect(pool.updates).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it("leaves the row untouched (safe to retry) if the file write throws", async () => {
    const pool = buildMockPool([{ id: 6, avatar_url: PNG_DATA_URL }]);
    const saveAvatarFile = vi.fn(async () => {
      throw new Error("disk full");
    });

    await expect(
      runAvatarMigration(pool, { apply: true, saveAvatarFile }),
    ).rejects.toThrow("disk full");
    expect(pool.updates).toEqual([]);
  });
});

describe("writeAvatarFile (real filesystem)", () => {
  let tmpDirs: string[] = [];
  const originalDir = process.env.AVATAR_STORAGE_DIR;

  afterEach(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
    tmpDirs = [];
    if (originalDir === undefined) delete process.env.AVATAR_STORAGE_DIR;
    else process.env.AVATAR_STORAGE_DIR = originalDir;
  });

  it("writes real bytes to disk under AVATAR_STORAGE_DIR", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vulnradar-migrate-avatars-test-"));
    tmpDirs.push(dir);
    process.env.AVATAR_STORAGE_DIR = dir;

    const bytes = Buffer.from([...PNG_MAGIC, 9, 9]);
    const url = await writeAvatarFile(77, "image/png", bytes);

    expect(url).toMatch(/^\/api\/v3\/avatar\/77\?v=\d+$/);
    const filePath = join(dir, "77.png");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath)).toEqual(bytes);
  });

  it("removes the other extension's file so a format switch never orphans a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vulnradar-migrate-avatars-test-"));
    tmpDirs.push(dir);
    process.env.AVATAR_STORAGE_DIR = dir;

    await writeAvatarFile(88, "image/jpeg", Buffer.from([0xff, 0xd8, 0xff]));
    expect(existsSync(join(dir, "88.jpg"))).toBe(true);

    await writeAvatarFile(88, "image/png", Buffer.from(PNG_MAGIC));
    expect(existsSync(join(dir, "88.jpg"))).toBe(false);
    expect(existsSync(join(dir, "88.png"))).toBe(true);
  });
});
