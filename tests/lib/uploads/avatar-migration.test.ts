import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * lib/uploads/avatar-migration.ts's base64 boot backfill converts legacy
 * `data:image/...;base64,...` values in users.avatar_url into user_avatars
 * BYTEA rows. Per this repo's "mock at the database boundary" rule
 * (tests/README.md), the pg pool is mocked with two in-memory stores (a
 * users avatar_url map and a user_avatars row map) that emulate the SELECT
 * scan, the EXISTS guard, the ON CONFLICT DO NOTHING upsert, and the
 * avatar_url normalize the backfill issues. The insert+normalize now run in a
 * pool.connect() transaction (BEGIN/COMMIT), so the mock also exposes connect()
 * returning a client whose query routes to the same store (BEGIN/COMMIT/ROLLBACK
 * fall through to the default empty result). The real validateAvatarDataUrl
 * (magic bytes + 5 MiB cap + SVG rejection) runs unmocked.
 */

type Avatar = { image_data: Buffer; content_type: string };
const users = new Map<number, string | null>();
const avatars = new Map<number, Avatar>();

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();

  if (s.startsWith("SELECT id, avatar_url FROM users")) {
    const rows = [...users.entries()]
      .filter(
        ([, url]) =>
          typeof url === "string" &&
          (url.startsWith("data:image/png;base64,") ||
            url.startsWith("data:image/jpeg;base64,")),
      )
      .map(([id, avatar_url]) => ({ id, avatar_url }));
    return { rows };
  }
  if (s.startsWith("SELECT 1 FROM user_avatars WHERE user_id")) {
    const [userId] = params as [number];
    return { rows: avatars.has(userId) ? [{ column: 1 }] : [] };
  }
  if (s.startsWith("INSERT INTO user_avatars")) {
    const [userId, bytes, mime] = params as [number, Buffer, string];
    // ON CONFLICT (user_id) DO NOTHING: only insert when absent.
    if (!avatars.has(userId)) {
      avatars.set(userId, { image_data: bytes, content_type: mime });
    }
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET avatar_url = $1 WHERE id = $2")) {
    const [url, userId] = params as [string, number];
    users.set(userId, url);
    return { rows: [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
    connect: async () => ({
      query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
      release: () => {},
    }),
  },
}));

const { migrateBase64AvatarsToDatabase } =
  await import("@/lib/uploads/avatar-migration");

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 4, 5, 6]);
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
const JPEG_DATA_URL = `data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}`;
// Declares PNG but the decoded bytes are not a PNG (magic-byte mismatch).
const BAD_MAGIC_DATA_URL = `data:image/png;base64,${Buffer.from("not a png").toString("base64")}`;

beforeEach(() => {
  users.clear();
  avatars.clear();
  mockQuery.mockClear();
});

describe("migrateBase64AvatarsToDatabase", () => {
  it("converts a base64 avatar_url into a user_avatars row and normalizes the url", async () => {
    users.set(7, PNG_DATA_URL);

    const n = await migrateBase64AvatarsToDatabase();

    expect(n).toBe(1);
    expect(avatars.get(7)?.image_data).toEqual(PNG_BYTES);
    expect(avatars.get(7)?.content_type).toBe("image/png");
    expect(users.get(7)).toMatch(/^\/api\/v3\/avatar\/7\?v=\d+$/);
  });

  it("converts multiple rows (png and jpeg) in one pass", async () => {
    users.set(1, PNG_DATA_URL);
    users.set(2, JPEG_DATA_URL);

    const n = await migrateBase64AvatarsToDatabase();

    expect(n).toBe(2);
    expect(avatars.get(1)?.content_type).toBe("image/png");
    expect(avatars.get(2)?.content_type).toBe("image/jpeg");
    expect(avatars.get(2)?.image_data).toEqual(JPEG_BYTES);
  });

  it("skips a user that already has a user_avatars row (idempotent)", async () => {
    const sentinel: Avatar = {
      image_data: Buffer.from([9, 9, 9]),
      content_type: "image/png",
    };
    avatars.set(10, sentinel);
    users.set(10, PNG_DATA_URL);

    const n = await migrateBase64AvatarsToDatabase();

    expect(n).toBe(0);
    // The existing row is untouched and the url is not re-normalized.
    expect(avatars.get(10)).toBe(sentinel);
    expect(users.get(10)).toBe(PNG_DATA_URL);
  });

  it("is a no-op on a second run (converted rows no longer match)", async () => {
    users.set(5, PNG_DATA_URL);

    expect(await migrateBase64AvatarsToDatabase()).toBe(1);
    const storedBytes = avatars.get(5)?.image_data;

    // Second run: the url is now /api/v3/avatar/5?v=... and no longer matches
    // the data:image scan, so nothing happens.
    expect(await migrateBase64AvatarsToDatabase()).toBe(0);
    expect(avatars.get(5)?.image_data).toBe(storedBytes);
  });

  it("skips a malformed data URL without throwing", async () => {
    users.set(11, BAD_MAGIC_DATA_URL);

    const n = await migrateBase64AvatarsToDatabase();

    expect(n).toBe(0);
    expect(avatars.has(11)).toBe(false);
    // The row is left exactly as it was.
    expect(users.get(11)).toBe(BAD_MAGIC_DATA_URL);
  });

  it("never touches external OAuth avatar URLs (they are not selected)", async () => {
    users.set(12, "https://cdn.discordapp.com/avatars/123/abc.png");

    const n = await migrateBase64AvatarsToDatabase();

    expect(n).toBe(0);
    expect(avatars.has(12)).toBe(false);
    expect(users.get(12)).toBe(
      "https://cdn.discordapp.com/avatars/123/abc.png",
    );
  });

  it("never throws when the scan query fails (best-effort, must not block boot)", async () => {
    mockQuery.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    await expect(migrateBase64AvatarsToDatabase()).resolves.toBe(0);
  });
});
