import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Route-level tests for GET /api/v3/avatar/[userId]. The route itself
 * never touches the database — it reads straight off disk via
 * lib/uploads/avatar-storage.ts, so per this repo's "mock at the
 * network/database boundary, not below it" rule, the real filesystem
 * code runs against a temp AVATAR_STORAGE_DIR for the duration of the
 * suite. @/lib/database/db is still mocked here only because
 * lib/api/api-utils.ts (used for ApiResponse/withErrorHandling)
 * transitively imports it, and that module throws at import time when
 * DATABASE_URL isn't set in the test environment.
 */

vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [] })) },
}));

let tmpDirs: string[] = [];
const originalStorageDir = process.env.AVATAR_STORAGE_DIR;

function freshTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vulnradar-avatar-route-test-"));
  tmpDirs.push(dir);
  process.env.AVATAR_STORAGE_DIR = dir;
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

afterAll(() => {
  if (originalStorageDir === undefined) delete process.env.AVATAR_STORAGE_DIR;
  else process.env.AVATAR_STORAGE_DIR = originalStorageDir;
});

const { saveAvatarFile } = await import("@/lib/uploads/avatar-storage");
const { GET } = await import("@/app/api/v3/avatar/[userId]/route");

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9,
]);

function makeParams(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

describe("GET /api/v3/avatar/[userId]", () => {
  beforeEach(() => {
    freshTmpDir();
  });

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

  it("returns 404 when the user has no stored avatar file", async () => {
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
