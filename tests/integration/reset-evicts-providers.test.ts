import { it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * A password reset evicts linked sign-in providers, against the real schema.
 *
 * The unit tier sees the statements, and a faked pool answers a SET naming a
 * column that does not exist exactly as it answers a correct one. The reset
 * clears ten columns on `users` and a row in discord_connections inside the
 * transaction that sets the password, so a wrong name here would turn every
 * password reset into a 500.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === "user-agent" ? "integration" : null,
  }),
}));

// A fresh address per request keeps the per-IP reset bucket from filling up.
let ipCounter = 0;
vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return {
    ...actual,
    getClientIp: async () => {
      ipCounter += 1;
      return `198.51.100.${(ipCounter % 250) + 1}`;
    },
  };
});

vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return { ...actual, sendEmail: async () => {} };
});

const { issueResetLinkToken } = await import("@/lib/auth/password-reset-token");
const { saveGithubConnection } =
  await import("@/lib/github/github-connections");
const { POST: resetPassword } =
  await import("@/app/api/v3/auth/reset-password/route");

const NEW_PASSWORD = "Kestrel-Vellum-Orbit-73%";

interface Identities {
  google_id: string | null;
  google_email: string | null;
  github_id: string | null;
  github_login: string | null;
  discord_id: string | null;
  discord_username: string | null;
}

async function linkEverything(userId: number, authProvider: string) {
  await pool.query(
    `UPDATE users SET auth_provider = $2,
       google_id = $3, google_email = 'g@example.test', google_name = 'G',
       google_avatar_url = 'https://example.test/g.png',
       github_id = $4, github_email = 'h@example.test', github_name = 'H',
       github_avatar_url = 'https://example.test/h.png', github_login = 'h',
       discord_id = $5, discord_email = 'd@example.test',
       discord_username = 'd', discord_avatar_url = 'https://example.test/d.png'
     WHERE id = $1`,
    [
      userId,
      authProvider,
      unique("google").slice(-60),
      unique("github").slice(-60),
      unique("discord").slice(-60),
    ],
  );
  await pool.query(
    `INSERT INTO discord_connections
       (user_id, discord_id, discord_username, access_token, refresh_token, token_expires_at)
     VALUES ($1, $2, 'd', 'enc-access', 'enc-refresh', NOW() + INTERVAL '1 day')`,
    [userId, unique("connection").slice(-60)],
  );
}

async function resetWithLink(userId: number) {
  const token = await issueResetLinkToken(userId);
  return resetPassword(
    new NextRequest("http://localhost/api/v3/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password: NEW_PASSWORD }),
    }),
  );
}

async function identities(userId: number): Promise<Identities> {
  const { rows } = await pool.query<Identities>(
    `SELECT google_id, google_email, github_id, github_login, discord_id, discord_username
       FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0];
}

async function discordConnections(userId: number): Promise<number> {
  const { rows } = await pool.query(
    "SELECT 1 FROM discord_connections WHERE user_id = $1",
    [userId],
  );
  return rows.length;
}

describeIntegration("a password reset evicts linked sign-in providers", () => {
  it("clears every identity on a password account and drops the Discord connection", async () => {
    const user = await createUser();
    await linkEverything(user.id, "password");

    expect((await resetWithLink(user.id)).status).toBe(200);

    expect(await identities(user.id)).toEqual({
      google_id: null,
      google_email: null,
      github_id: null,
      github_login: null,
      discord_id: null,
      discord_username: null,
    });
    expect(await discordConnections(user.id)).toBe(0);
  });

  it("keeps the identity that created the account", async () => {
    const user = await createUser();
    await linkEverything(user.id, "google");
    const before = await identities(user.id);

    expect((await resetWithLink(user.id)).status).toBe(200);

    const after = await identities(user.id);
    expect(after.google_id).toBe(before.google_id);
    expect(after.google_email).toBe(before.google_email);
    expect(after.github_id).toBeNull();
    expect(after.discord_id).toBeNull();
    expect(await discordConnections(user.id)).toBe(0);
  });
});

describeIntegration("granting repo access from a second account", () => {
  it("is the unique violation the GitHub callback turns into already_linked", async () => {
    const [first, second] = await Promise.all([createUser(), createUser()]);
    const githubUserId = Math.floor(Math.random() * 1_000_000_000) + 1;
    const grant = {
      githubUserId,
      githubUsername: "octocat",
      accessToken: "token",
      scopes: "repo",
    };

    await saveGithubConnection({ userId: first.id, ...grant });

    await expect(
      saveGithubConnection({ userId: second.id, ...grant }),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
