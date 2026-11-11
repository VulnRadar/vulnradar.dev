/**
 * Route-level tests for GET/PATCH/DELETE /api/v3/account/discord. The
 * database boundary is mocked; session-gating and request-parsing run for
 * real.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: async () => ({ query: mockClientQuery, release: mockRelease }),
  },
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

const mockNotice = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications/profile-name-changed", () => ({
  noticeProfileNameChanged: mockNotice,
}));

vi.mock("@/lib/auth/crypto", () => ({
  decryptApiKey: (v: string) => `decrypted:${v}`,
}));

// The token refresh is mocked at this module boundary (its own behaviour is
// covered in tests/lib/discord/discord-utils.test.ts). The error class comes
// from the same mock so the route's `instanceof` check resolves against the
// class the test throws, and hoisted because vi.mock factories run before
// the module body.
const discordUtils = vi.hoisted(() => {
  class DiscordReauthRequiredError extends Error {
    constructor(message = "Discord authorization is no longer valid.") {
      super(message);
      this.name = "DiscordReauthRequiredError";
    }
  }
  return {
    DiscordReauthRequiredError,
    refreshDiscordAccessToken: vi.fn(),
  };
});
vi.mock("@/lib/discord/discord-utils", () => discordUtils);

const { GET, POST, PATCH, DELETE } =
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
  mockNotice.mockReset();
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_GUILD_ID;
  process.env.DISCORD_CLIENT_ID = "client-1";
  process.env.DISCORD_CLIENT_SECRET = "secret-1";
  mockClientQuery.mockReset();
  mockRelease.mockReset();
  mockFetch.mockReset();
  discordUtils.refreshDiscordAccessToken.mockReset();
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

  /**
   * Opening the Social tab used to PUT the member straight back into the
   * server, spending the refresh token to do it, so the only way to leave and
   * stay gone was to disconnect Discord entirely.
   */
  it("never joins from a GET: a 404 marks them out of the server and issues no PUT", async () => {
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
    mockFetch.mockResolvedValueOnce({ status: 404 }); // GET member
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE guild_joined

    const res = await GET();
    const json = await res.json();

    expect(json.guildJoined).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].method).toBeUndefined();
    expect(discordUtils.refreshDiscordAccessToken).not.toHaveBeenCalled();
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toContain("guild_joined = $1");
    expect(updateParams).toEqual([false, 3]);
  });

  it("does not move the connection's timestamp when only membership changed", async () => {
    // updated_at is what the page prints as "Connected" and what decides
    // whether the post-connect sync dialog may open.
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
    mockFetch.mockResolvedValueOnce({ status: 404 });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET();

    expect(mockQuery.mock.calls[1][0]).not.toContain("updated_at");
  });

  it("logs nothing to stdout on a server with no bot configured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
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

    await GET();

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("says whether the connection was made just now, from the server's clock", async () => {
    const row = {
      discord_id: "123",
      discord_username: "vulnbot",
      discord_avatar: "abc",
      guild_joined: false,
      access_token: "enc-token",
    };
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...row, updated_at: new Date(Date.now() - 60_000) }],
    });
    const fresh = await (await GET()).json();
    expect(fresh.justConnected).toBe(true);
    expect(fresh.avatarUrl).toBe(
      "https://cdn.discordapp.com/avatars/123/abc.png?size=256",
    );

    mockQuery.mockResolvedValueOnce({
      rows: [{ ...row, updated_at: new Date(Date.now() - 3_600_000) }],
    });
    const stale = await (await GET()).json();
    expect(stale.justConnected).toBe(false);
  });

  it("says whether this server can add anyone to the guild", async () => {
    const row = {
      discord_id: "123",
      discord_username: "vulnbot",
      discord_avatar: "abc",
      guild_joined: true,
      updated_at: "2026-01-01T00:00:00.000Z",
      access_token: "enc-token",
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });
    expect((await (await GET()).json()).canJoin).toBe(false);

    process.env.DISCORD_BOT_TOKEN = "bot-token";
    process.env.DISCORD_GUILD_ID = "guild-1";
    mockQuery.mockResolvedValueOnce({ rows: [row] });
    mockFetch.mockResolvedValueOnce({ status: 200 });
    expect((await (await GET()).json()).canJoin).toBe(true);
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

/**
 * Discord expires an access token after 7 days, so the auto-join worked only
 * for accounts connected within the last week and then failed silently
 * forever, leaving everyone else permanently shown as "not in server". The
 * refresh token was stored and encrypted the whole time and never spent.
 */
describe("POST /api/v3/account/discord", () => {
  function row(overrides: Record<string, unknown> = {}) {
    return {
      rows: [
        {
          discord_id: "123",
          guild_joined: false,
          access_token: "enc-token",
          token_expires_at: null,
          ...overrides,
        },
      ],
    };
  }

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
  });

  it("is refused during an impersonation, and touches nothing at Discord", async () => {
    mockGetSession.mockResolvedValue({ userId: 3, impersonatedBy: 1 });
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    process.env.DISCORD_GUILD_ID = "guild-1";
    const res = await POST();
    expect(res.status).toBe(403);
    expect((await res.json()).impersonationBlocked).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 404 with no connection", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    process.env.DISCORD_GUILD_ID = "guild-1";
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await POST()).status).toBe(404);
  });

  it("says so when this server has no bot to add anyone with", async () => {
    mockQuery.mockResolvedValueOnce(row());
    expect((await POST()).status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("joins on request and records it", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    process.env.DISCORD_GUILD_ID = "guild-1";
    mockQuery.mockResolvedValueOnce(row());
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ guildJoined: true, reauthRequired: false });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://discord.com/api/guilds/guild-1/members/123");
    expect(options.method).toBe("PUT");
    expect(JSON.parse(options.body)).toEqual({
      access_token: "decrypted:enc-token",
    });
    expect(mockQuery.mock.calls[1][1]).toEqual([true, 3]);
  });
});

describe("POST /api/v3/account/discord: expired access tokens", () => {
  function connectedRow(overrides: Record<string, unknown> = {}) {
    return {
      rows: [
        {
          discord_id: "123",
          discord_username: "vulnbot",
          discord_avatar: "abc",
          guild_joined: false,
          updated_at: "2026-01-01T00:00:00.000Z",
          access_token: "enc-token",
          token_expires_at: null,
          ...overrides,
        },
      ],
    };
  }

  /** Discord's answer when the user token in the join body is stale. */
  function tokenRejected() {
    return {
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ message: "401: Unauthorized" }),
    };
  }

  beforeEach(() => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    process.env.DISCORD_GUILD_ID = "guild-1";
  });

  it("refreshes once and retries the join when the stored token is rejected", async () => {
    mockQuery.mockResolvedValueOnce(connectedRow());
    mockFetch.mockResolvedValueOnce(tokenRejected()); // PUT join, stale token
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 }); // PUT retry
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE guild_joined
    discordUtils.refreshDiscordAccessToken.mockResolvedValue("fresh-access");

    const res = await POST();
    const json = await res.json();

    expect(json.guildJoined).toBe(true);
    expect(json.reauthRequired).toBe(false);
    expect(discordUtils.refreshDiscordAccessToken).toHaveBeenCalledTimes(1);
    expect(discordUtils.refreshDiscordAccessToken).toHaveBeenCalledWith(3);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // The retry carries the NEW token, not the one Discord just refused.
    const [, retryOptions] = mockFetch.mock.calls[1];
    expect(JSON.parse(retryOptions.body)).toEqual({
      access_token: "fresh-access",
    });
  });

  it("retries exactly once: a second rejection is a failure, not another refresh", async () => {
    mockQuery.mockResolvedValueOnce(connectedRow());
    mockFetch.mockResolvedValueOnce(tokenRejected());
    mockFetch.mockResolvedValueOnce(tokenRejected());
    discordUtils.refreshDiscordAccessToken.mockResolvedValue("fresh-access");

    const res = await POST();
    const json = await res.json();

    expect(json.guildJoined).toBe(false);
    expect(discordUtils.refreshDiscordAccessToken).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2); // two PUTs, no more
  });

  it("refreshes up front when the stored token has already expired", async () => {
    mockQuery.mockResolvedValueOnce(
      connectedRow({ token_expires_at: new Date("2020-01-01T00:00:00.000Z") }),
    );
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    discordUtils.refreshDiscordAccessToken.mockResolvedValue("fresh-access");

    const res = await POST();
    const json = await res.json();

    expect(json.guildJoined).toBe(true);
    expect(discordUtils.refreshDiscordAccessToken).toHaveBeenCalledTimes(1);
    // No wasted PUT with a token already known to be dead.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, joinOptions] = mockFetch.mock.calls[0];
    expect(JSON.parse(joinOptions.body)).toEqual({
      access_token: "fresh-access",
    });
  });

  it("surfaces a revoked authorization instead of a silent not-in-server", async () => {
    mockQuery.mockResolvedValueOnce(connectedRow());
    mockFetch.mockResolvedValueOnce(tokenRejected());
    discordUtils.refreshDiscordAccessToken.mockRejectedValue(
      new discordUtils.DiscordReauthRequiredError(),
    );

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.guildJoined).toBe(false);
    // The whole point: the user is told the link is dead rather than being
    // left staring at "Not in server" that will never resolve itself.
    expect(json.reauthRequired).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1); // no retry after a dead refresh
  });

  it("does not spend a refresh on a failure that is not about the token", async () => {
    mockQuery.mockResolvedValueOnce(connectedRow());
    // 403: the bot lacks Create Instant Invite on the guild. Refreshing the
    // user's token cannot fix that, so it must not be attempted.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Missing Permissions",
    });

    const res = await POST();
    const json = await res.json();

    expect(json.guildJoined).toBe(false);
    expect(res.status).toBe(502);
    expect(json.reauthRequired).toBe(false);
    expect(discordUtils.refreshDiscordAccessToken).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/v3/account/discord", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ syncAvatar: true }));
    expect(res.status).toBe(401);
  });

  // Owner decision D23: the sync rewrites the account's name and avatar from
  // a linked identity, which an impersonation session must not do on the
  // account holder's behalf, the same rule linking follows.
  it("is refused during an impersonation and writes nothing", async () => {
    mockGetSession.mockResolvedValue({ userId: 7, impersonatedBy: 1 });
    const res = await PATCH(patchRequest({ syncAvatar: true, syncName: true }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.impersonationBlocked).toBe(true);
    expect(json.error).toMatch(/admin/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("still syncs for the account holder's own session", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { discord_id: "99", discord_username: "Holder", discord_avatar: null },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(patchRequest({ syncName: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toEqual(["name"]);
    expect(
      mockQuery.mock.calls.some((c) => /UPDATE users SET/.test(String(c[0]))),
    ).toBe(true);
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

  // The dialog used to save through PATCH /auth/update, which mails the owner
  // about a name change. Moving the save here must not lose that.
  it("tells the owner when a sync changes the name", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          discord_id: "123",
          discord_username: "  vulnbot ",
          discord_avatar: null,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PATCH(patchRequest({ syncName: true }));

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][1]).toEqual(["vulnbot", 3]);
    expect(mockNotice).toHaveBeenCalledWith({ userId: 3 }, "vulnbot");
  });

  it("sends no name notice for an avatar-only sync", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          discord_id: "123",
          discord_username: "vulnbot",
          discord_avatar: "abc",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await PATCH(patchRequest({ syncAvatar: true }));

    expect(mockNotice).not.toHaveBeenCalled();
  });

  it("treats a JSON null body as nothing asked for, not a server error", async () => {
    const res = await PATCH(patchRequest(null));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, updated: [] });
    expect(mockQuery).not.toHaveBeenCalled();
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
  /** The transaction, answered by statement. */
  function transaction(opts: { cleared?: number; failOn?: string } = {}) {
    const { cleared = 1, failOn } = opts;
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (failOn && sql.includes(failOn)) throw new Error("db down");
      if (sql.startsWith("UPDATE users")) {
        return { rowCount: cleared, rows: cleared ? [{ id: 3 }] : [] };
      }
      if (sql.startsWith("DELETE FROM discord_connections")) {
        return {
          rowCount: 1,
          rows: [{ access_token: "enc-a", refresh_token: "enc-r" }],
        };
      }
      return { rowCount: 0, rows: [] };
    });
  }

  function statements(): string[] {
    return mockClientQuery.mock.calls.map(([sql]) => String(sql));
  }

  function revokeCalls() {
    return mockFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/oauth2/token/revoke"),
    );
  }

  beforeEach(() => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

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

  it("is refused during an impersonation", async () => {
    mockGetSession.mockResolvedValue({ userId: 3, impersonatedBy: 1 });
    const res = await DELETE();
    expect(res.status).toBe(403);
    expect((await res.json()).impersonationBlocked).toBe(true);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("clears the identity and the row in one transaction, guarded in the WHERE", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });
    transaction();

    const res = await DELETE();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    const sql = statements();
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toContain("discord_id = NULL");
    expect(sql[1]).toContain(
      "password_hash IS NOT NULL OR google_id IS NOT NULL OR github_id IS NOT NULL",
    );
    expect(sql[2]).toContain("DELETE FROM discord_connections");
    expect(sql[3]).toBe("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("refuses the last way to sign in, with the same sentence as Google and GitHub", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });
    transaction({ cleared: 0 });

    const res = await DELETE();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(
      "Discord is your only way to sign in. Set a password or connect another account first.",
    );
    const sql = statements();
    expect(sql.some((q) => q.includes("DELETE FROM"))).toBe(false);
    expect(sql).toContain("ROLLBACK");
    expect(sql).not.toContain("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
    // The connection stays, so its tokens have to keep working.
    expect(revokeCalls()).toHaveLength(0);
  });

  it("revokes both tokens at Discord, once each, with the decrypted values", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });
    transaction();

    await DELETE();

    const calls = revokeCalls();
    expect(calls).toHaveLength(2);
    const bodies = calls.map(([, init]) =>
      new URLSearchParams(String(init.body)).get("token"),
    );
    expect(bodies.sort()).toEqual(["decrypted:enc-a", "decrypted:enc-r"]);
    for (const [, init] of calls) {
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
      );
    }
  });

  it("still disconnects when Discord cannot be reached", async () => {
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });
    transaction();
    mockFetch.mockReset();
    mockFetch.mockRejectedValue(new Error("network down"));

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("rolls back and revokes nothing when the transaction fails", async () => {
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });
    transaction({ failOn: "DELETE FROM discord_connections" });

    const res = await DELETE();

    expect(res.status).toBe(500);
    expect(statements()).toContain("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(revokeCalls()).toHaveLength(0);
    quiet.mockRestore();
  });

  it("returns 500 on a database error", async () => {
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await DELETE();
    expect(res.status).toBe(500);
    quiet.mockRestore();
  });
});
