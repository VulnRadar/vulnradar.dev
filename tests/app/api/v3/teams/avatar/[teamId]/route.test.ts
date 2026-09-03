import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for GET /api/v3/teams/avatar/[teamId].
 *
 * Shaped after tests/app/api/v3/avatar/[userId]/route.test.ts, because the
 * storage mechanism is deliberately the same one: bytes in Postgres, read back
 * through lib/uploads/team-avatar-storage.ts. The pool is mocked at the
 * database boundary with a small in-memory store, which also covers the
 * transitive import in lib/api/api-utils.ts.
 *
 * What is NOT the same, and is the point of most of these cases: a user avatar
 * route is public, and this one is not. A team is private, so this route needs
 * a session AND membership, and answers a non-member with 404 rather than 403
 * so team ids cannot be enumerated.
 */

type Row = { image_data: Buffer; content_type: string };
const store = new Map<number, Row>();
/** team_id -> member user ids. */
const members = new Map<number, number[]>();

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("INSERT INTO team_avatars")) {
    const [teamId, bytes, mime] = params as [number, Buffer, string];
    store.set(teamId, { image_data: bytes, content_type: mime });
    return { rows: [{ updated_at: new Date("2026-01-02T03:04:05Z") }] };
  }
  if (s.startsWith("SELECT image_data, content_type FROM team_avatars")) {
    const [teamId] = params as [number];
    const row = store.get(teamId);
    return { rows: row ? [row] : [] };
  }
  if (s.startsWith("SELECT 1 FROM team_members")) {
    const [teamId, userId] = params as [number, number];
    const list = members.get(teamId) ?? [];
    return { rows: list.includes(userId) ? [{ "?column?": 1 }] : [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { saveTeamAvatarFile } =
  await import("@/lib/uploads/team-avatar-storage");
const { GET } = await import("@/app/api/v3/teams/avatar/[teamId]/route");

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7,
]);

function makeParams(teamId: string) {
  return { params: Promise.resolve({ teamId }) };
}

function request(teamId: string) {
  return new NextRequest(`http://localhost/api/v3/teams/avatar/${teamId}`);
}

beforeEach(() => {
  store.clear();
  members.clear();
  mockQuery.mockClear();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
});

describe("GET /api/v3/teams/avatar/[teamId]", () => {
  it("serves a stored team avatar to a member", async () => {
    members.set(5, [42]);
    await saveTeamAvatarFile(5, "image/png", PNG_BYTES);

    const res = await GET(request("5"), makeParams("5"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(PNG_BYTES);
  });

  it("marks the response private, not public: it is scoped to one member", async () => {
    members.set(5, [42]);
    await saveTeamAvatarFile(5, "image/png", PNG_BYTES);

    const res = await GET(request("5"), makeParams("5"));

    const cacheControl = res.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("private");
    expect(cacheControl).not.toContain("public");
    // Still immutable: the URL carries a `v` stamp that changes on re-upload.
    expect(cacheControl).toContain("immutable");
  });

  it("requires a session", async () => {
    members.set(5, [42]);
    await saveTeamAvatarFile(5, "image/png", PNG_BYTES);
    mockGetSession.mockResolvedValue(null);

    const res = await GET(request("5"), makeParams("5"));

    expect(res.status).toBe(401);
  });

  it("does not serve a team's avatar to someone outside the team", async () => {
    members.set(5, [7]);
    await saveTeamAvatarFile(5, "image/png", PNG_BYTES);

    const res = await GET(request("5"), makeParams("5"));

    // 404, not 403: a stranger must not learn that team 5 exists.
    expect(res.status).toBe(404);
  });

  it("returns 404 when the team has no stored avatar", async () => {
    members.set(5, [42]);

    const res = await GET(request("5"), makeParams("5"));

    expect(res.status).toBe(404);
  });

  it.each([
    ["path-traversal shaped", ".."],
    ["non-canonical", "007"],
    ["zero", "0"],
    ["negative", "-1"],
  ])(
    "returns 404 for a %s teamId without touching the database",
    async (_label, teamId) => {
      const res = await GET(request(teamId), makeParams(teamId));

      expect(res.status).toBe(404);
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );
});
