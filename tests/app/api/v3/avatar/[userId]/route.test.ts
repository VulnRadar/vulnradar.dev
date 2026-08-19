import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for GET /api/v3/avatar/[userId]. The route reads the
 * avatar bytes from the user_avatars table via lib/uploads/avatar-storage.ts,
 * so per this repo's "mock at the database boundary" rule (tests/README.md)
 * the pg pool is mocked with a small in-memory store keyed by user_id. That
 * same @/lib/database/db mock also covers the transitive import in
 * lib/api/api-utils.ts (used for ApiResponse/withErrorHandling), which
 * otherwise throws at import time when DATABASE_URL isn't set.
 */

type Row = { image_data: Buffer; content_type: string };
const store = new Map<number, Row>();

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("INSERT INTO user_avatars")) {
    const [userId, bytes, mime] = params as [number, Buffer, string];
    store.set(userId, { image_data: bytes, content_type: mime });
    return { rows: [] };
  }
  if (s.startsWith("SELECT image_data, content_type FROM user_avatars")) {
    const [userId] = params as [number];
    const row = store.get(userId);
    return { rows: row ? [row] : [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { saveAvatarFile } = await import("@/lib/uploads/avatar-storage");
const { GET } = await import("@/app/api/v3/avatar/[userId]/route");

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9,
]);

function makeParams(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

beforeEach(() => {
  store.clear();
  mockQuery.mockClear();
});

describe("GET /api/v3/avatar/[userId]", () => {
  it("serves a stored avatar with the right content type and bytes", async () => {
    await saveAvatarFile(11, "image/png", PNG_BYTES);

    const res = await GET(
      new NextRequest("http://localhost/api/v3/avatar/11"),
      makeParams("11"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(PNG_BYTES);
  });

  it("returns 404 when the user has no stored avatar", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/v3/avatar/999"),
      makeParams("999"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-numeric userId (path-traversal-shaped input rejected)", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/v3/avatar/.."),
      makeParams(".."),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-canonical numeric form", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/v3/avatar/007"),
      makeParams("007"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a negative or zero userId", async () => {
    const resNeg = await GET(
      new NextRequest("http://localhost/api/v3/avatar/-1"),
      makeParams("-1"),
    );
    expect(resNeg.status).toBe(404);

    const resZero = await GET(
      new NextRequest("http://localhost/api/v3/avatar/0"),
      makeParams("0"),
    );
    expect(resZero.status).toBe(404);
  });
});
