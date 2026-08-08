/**
 * Route-level tests for GET/PATCH/DELETE /api/v3/account/discord. The
 * database boundary is mocked; session-gating and request-parsing run for
 * real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

// Mocked at this module boundary: the real fs behavior of
// deleteAvatarFilesIfLocal has its own dedicated suite
// (tests/lib/uploads/avatar-storage.test.ts). This suite only needs to
// prove the Discord avatar sync calls it before overwriting avatar_url.
const mockDeleteAvatarFilesIfLocal = vi.fn();
vi.mock("@/lib/uploads/avatar-storage", () => ({
  deleteAvatarFilesIfLocal: (...args: unknown[]) =>
    mockDeleteAvatarFilesIfLocal(...args),
}));

const { GET, PATCH, DELETE } =
  await import("@/app/api/v3/account/discord/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 3 });
  mockDeleteAvatarFilesIfLocal.mockReset();
  mockDeleteAvatarFilesIfLocal.mockResolvedValue(undefined);
});

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/account/discord", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v3/account/discord", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("reports not connected when there is no row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ connected: false });
  });

  it("returns the connection details when connected", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          discord_id: "123",
          discord_username: "vulnbot",
          discord_avatar: "abc",
          guild_joined: true,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.connected).toBe(true);
    expect(json.discordUsername).toBe("vulnbot");
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/v3/account/discord", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ syncAvatar: true }));
    expect(res.status).toBe(401);
  });

  it("rejects an invalid JSON body", async () => {
    const req = new Request("http://localhost/api/v3/account/discord", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("no-ops when neither syncAvatar nor syncName is requested", async () => {
    const res = await PATCH(patchRequest({}));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, updated: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no Discord connection to sync from", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(patchRequest({ syncAvatar: true }));
    expect(res.status).toBe(404);
  });

  it("syncs avatar and name from the connected Discord account", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          discord_id: "123",
          discord_username: "vulnbot",
          discord_avatar: "abc",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE users
    const res = await PATCH(patchRequest({ syncAvatar: true, syncName: true }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.updated.sort()).toEqual(["avatar", "name"]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockDeleteAvatarFilesIfLocal).toHaveBeenCalledWith(3);
  });

  it("skips the avatar update field when the account has no avatar set", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          discord_id: "123",
          discord_username: "vulnbot",
          discord_avatar: null,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(patchRequest({ syncAvatar: true, syncName: true }));
    const json = await res.json();
    expect(json.updated).toEqual(["name"]);
    // No avatar was synced, so there's nothing to clean up.
    expect(mockDeleteAvatarFilesIfLocal).not.toHaveBeenCalled();
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await PATCH(patchRequest({ syncAvatar: true }));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/v3/account/discord", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("returns 404 when there is nothing to disconnect", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await DELETE();
    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("disconnects the Discord account and clears discord_id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] }); // find connection
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE discord_connections
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE users
    const res = await DELETE();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await DELETE();
    expect(res.status).toBe(500);
  });
});
