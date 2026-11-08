import { beforeEach, expect, it, vi } from "vitest";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * "Never leave an account with no way to sign in", against real row locks.
 *
 * The guard is a WHERE clause on the UPDATE, and it only works because Postgres
 * re-evaluates that clause against the committed row when the statement was
 * waiting on the row lock. A faked pool says nothing about that: it answers
 * both disconnects with whatever the test scripted.
 *
 * Google's route and Discord's each count the other as the remaining identity,
 * so two concurrent disconnects on an account with only those two can each pass
 * a SELECT-based check and leave it with nothing.
 */

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: () => mockGetSession() };
});
// The disconnect notice is not what is under test, and has no SMTP here.
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => undefined),
}));

const { DELETE: disconnectDiscord } =
  await import("@/app/api/v3/account/discord/route");
const { DELETE: disconnectOauth } =
  await import("@/app/api/v3/account/oauth/[provider]/route");

const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

/** An OAuth-only account with Google and Discord and nothing else. */
async function seedGoogleAndDiscord(opts: { password?: boolean } = {}) {
  const user = await createUser();
  const discordId = unique("d").slice(-60);
  const googleId = unique("g").slice(-60);
  await pool.query(
    `UPDATE users SET discord_id = $1, google_id = $2,
       password_hash = CASE WHEN $3::boolean THEN password_hash ELSE NULL END
     WHERE id = $4`,
    [discordId, googleId, opts.password ?? false, user.id],
  );
  await pool.query(
    `INSERT INTO discord_connections (user_id, discord_id, discord_username, access_token, refresh_token)
     VALUES ($1, $2, 'someone', 'not-a-ciphertext', 'not-a-ciphertext')`,
    [user.id, discordId],
  );
  return user;
}

async function identities(userId: number) {
  const { rows } = await pool.query<{
    google_id: string | null;
    discord_id: string | null;
    connections: number;
  }>(
    `SELECT google_id, discord_id,
       (SELECT COUNT(*)::int FROM discord_connections WHERE user_id = u.id) AS connections
     FROM users u WHERE id = $1`,
    [userId],
  );
  return rows[0];
}

const googleContext = { params: Promise.resolve({ provider: "google" }) };
const googleRequest = new Request(
  "http://localhost/api/v3/account/oauth/google",
  { method: "DELETE" },
);

describeIntegration("disconnecting Discord", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("refuses the last identity and keeps the connection row", async () => {
    const user = await createUser();
    const discordId = unique("d").slice(-60);
    await pool.query(
      "UPDATE users SET discord_id = $1, password_hash = NULL WHERE id = $2",
      [discordId, user.id],
    );
    await pool.query(
      `INSERT INTO discord_connections (user_id, discord_id, discord_username, access_token)
       VALUES ($1, $2, 'someone', 'not-a-ciphertext')`,
      [user.id, discordId],
    );
    mockGetSession.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await disconnectDiscord();

    expect(res.status).toBe(400);
    const after = await identities(user.id);
    expect(after.discord_id).toBe(discordId);
    expect(after.connections).toBe(1);
  });

  it("clears both the identity and the row when another way in remains", async () => {
    const user = await seedGoogleAndDiscord();
    mockGetSession.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await disconnectDiscord();

    expect(res.status).toBe(200);
    const after = await identities(user.id);
    expect(after.discord_id).toBeNull();
    expect(after.google_id).not.toBeNull();
    expect(after.connections).toBe(0);
  });

  it("concurrent Google and Discord disconnects leave at least one identity", async () => {
    for (let round = 0; round < 10; round++) {
      const user = await seedGoogleAndDiscord();
      mockGetSession.mockResolvedValue({ userId: user.id, email: user.email });

      const [discord, google] = await Promise.all([
        disconnectDiscord(),
        disconnectOauth(googleRequest, googleContext),
      ]);

      const after = await identities(user.id);
      expect(Boolean(after.discord_id) || Boolean(after.google_id)).toBe(true);
      expect([discord.status, google.status].sort()).toEqual([200, 400]);
      // The row and the identity move together: a refused Discord disconnect
      // keeps its row, a successful one removes it.
      expect(after.connections).toBe(after.discord_id ? 1 : 0);
    }
  });
});
