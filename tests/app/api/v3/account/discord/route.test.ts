/**
 * Route-level tests for GET/PATCH/DELETE /api/v3/account/discord. The
 * database boundary is mocked; session-gating and request-parsing run for
 * real.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

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

vi.mock("@/lib/auth/crypto", () => ({
  decryptApiKey: (v: string) => `decrypted:${v}`,
}));

const { GET, PATCH, DELETE } =
  await import("@/app/api/v3/account/discord/route");

// Real DISCORD_BOT_TOKEN/DISCORD_GUILD_ID values (if this developer's own
// .env.local has them) must never leak into the test process -- the live
// guild-membership check would otherwise fire a real network request to
// Discord's API. Every GET test either clears both (skipping the live
// check entirely) or sets them alongside a mocked fetch.
const originalBotToken = process.env.DISCORD_BOT_TOKEN;
const originalGuildId = process.env.DISCORD_GUILD_ID;
const mockFetch = vi.fn();

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 3 });
  mockDeleteAvatarFilesIfLocal.mockReset();
  mockDeleteAvatarFilesIfLocal.mockResolvedValue(undefined);
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_GUILD_ID;
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterAll(() => {
  if (originalBotToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
  else process.env.DISCORD_BOT_TOKEN = originalBotToken;
  if (originalGuildId === undefined) delete process.env.DISCORD_GUILD_ID;
  else process.env.DISCORD_GUILD_ID = originalGuildId;
  vi.unstubAllGlobals();
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

  it("trusts the stored guild_joined value when the bot isn't configured", async () => {
    // DISCORD_BOT_TOKEN/DISCORD_GUILD_ID cleared by beforeEach.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          discord_id: "123",
          discord_username: "vulnbot",
          discord_avatar: "abc",
          guild_joined: false,
          updated_at: "2026-01-01T00:00:00.000Z",
          access_token: "enc-token",
        },
      ],
    });
    const res = await GET();
    const json = await res.json();
    expect(json.guildJoined).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1); // no UPDATE, nothing changed
  });

  it("self-heals a stale guild_joined=false when the bot confirms real membership", async () => {
    // Regression test: guild_joined was only ever set once, at connect
    // time, so someone who joined the server afterward (or whose original
    // join attempt failed for a since-resolved reason) stayed marked "not
    // in server" forever with no way to re-check short of disconnecting
    // and reconnecting their whole Discord account.
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    process.env.DISCORD_GUILD_ID = "guild-1";
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          discord_id: "123",
          discord_username: "vulnbot",
          discord_avatar: "abc",
          guild_joined: false,
          updated_at: "2026-01-01T00:00:00.000Z",
          access_token: "enc-token",
        },
      ],
    });
    mockFetch.mockResolvedValueOnce({ status: 200 }); // GET member -> already in guild
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE guild_joined

    const res = await GET();
    const json = await res.json();
    expect(json.guildJoined).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://discord.com/api/guilds/guild-1/members/123",
      expect.objectContaining({
        headers: { Authorization: "Bot bot-token" },
      }),
    );
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toContain("guild_joined = $1");
    expect(updateParams).toEqual([true, 3]);
  });

  it("opportunistically re-attempts the join when the bot confirms they're still not a member", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    process.env.DISCORD_GUILD_ID = "guild-1";
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          discord_id: "123",
          discord_username: "vulnbot",
          discord_avatar: "abc",
          guild_joined: false,
          updated_at: "2026-01-01T00:00:00.000Z",
          access_token: "enc-token",
        },
      ],
    });
    mockFetch.mockResolvedValueOnce({ status: 404 }); // GET member -> not in guild
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 }); // PUT join -> succeeded
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE guild_joined

    const res = await GET();
    const json = await res.json();
    expect(json.guildJoined).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [, joinOptions] = mockFetch.mock.calls[1];
    expect(joinOptions.method).toBe("PUT");
    expect(JSON.parse(joinOptions.body)).toEqual({
      access_token: "decrypted:enc-token",
    });
  });

  it("falls back to the stored value without throwing when the live check errors", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    process.env.DISCORD_GUILD_ID = "guild-1";
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          discord_id: "123",
          discord_username: "vulnbot",
          discord_avatar: "abc",
          guild_joined: true,
          updated_at: "2026-01-01T00:00:00.000Z",
          access_token: "enc-token",
        },
      ],
    });
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.guildJoined).toBe(true); // unchanged, from the stored row
    expect(mockQuery).toHaveBeenCalledTimes(1); // no UPDATE attempted
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
