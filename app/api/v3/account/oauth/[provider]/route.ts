// Google/GitHub account-linking status + disconnect (Connections tab).
//
// Discord has its own dedicated app/api/v3/account/discord/route.ts --
// intentionally not reused here, same reason app/api/v3/auth/oauth/
// [provider]/ doesn't reuse app/api/v3/auth/discord/: Discord's connection
// also stores OAuth tokens (guild-join, future avatar sync) in a separate
// discord_connections table, while Google/GitHub linking only ever writes
// the four *_id/*_email/*_name/*_avatar_url columns straight onto `users`
// (see instrumentation.ts) because nothing here ever calls the provider's
// API again after the initial link.
//
// Also unrelated to app/api/v3/account/github/ (repo-read access for code
// scanning) -- that is a separate feature this route never touches.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { OAUTH_PROVIDERS } from "@/lib/auth/oauth-providers";

type LinkableProvider = "google" | "github";

function isLinkableProvider(value: string): value is LinkableProvider {
  return value === "google" || value === "github";
}

// GET /api/v3/account/oauth/[provider] - connection status
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isLinkableProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await pool.query(
      provider === "google"
        ? `SELECT google_id AS id, google_email AS email, google_name AS name, google_avatar_url AS avatar_url FROM users WHERE id = $1`
        : `SELECT github_id AS id, github_email AS email, github_name AS name, github_avatar_url AS avatar_url FROM users WHERE id = $1`,
      [session.userId],
    );
    const row = result.rows[0];
    if (!row?.id) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
      id: row.id,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatar_url,
    });
  } catch (error) {
    console.error(`[${provider}] connection check error:`, error);
    return NextResponse.json(
      {
        error: `Failed to check ${OAUTH_PROVIDERS[provider].label} connection.`,
      },
      { status: 500 },
    );
  }
}

// DELETE /api/v3/account/oauth/[provider] - disconnect
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isLinkableProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await pool.query(
      `SELECT google_id, github_id, discord_id, (password_hash IS NOT NULL) AS has_password
         FROM users WHERE id = $1`,
      [session.userId],
    );
    const row = result.rows[0];
    if (!row) {
      return NextResponse.json(
        { error: "Account not found." },
        { status: 404 },
      );
    }

    const currentlyConnected =
      provider === "google" ? row.google_id : row.github_id;
    if (!currentlyConnected) {
      return NextResponse.json(
        { error: `No ${OAUTH_PROVIDERS[provider].label} connection found.` },
        { status: 404 },
      );
    }

    // Never let a user disconnect their only way in. A password counts,
    // and so does any OTHER connected identity (the other of
    // google_id/github_id, or Discord -- Discord's own login path signs a
    // user in purely by discord_id, no password required, see
    // app/api/v3/auth/discord/callback/route.ts's "login" branch). Mirrors
    // the reasoning already established for password_hash being nullable
    // (lib/auth/oauth-providers.ts, app/api/v3/auth/update/route.ts's
    // re-auth gate): never leave an account with zero ways to sign back in.
    const hasAnotherAuthMethod =
      row.has_password ||
      (provider === "google"
        ? Boolean(row.github_id)
        : Boolean(row.google_id)) ||
      Boolean(row.discord_id);

    if (!hasAnotherAuthMethod) {
      return NextResponse.json(
        {
          error: `${OAUTH_PROVIDERS[provider].label} is your only way to sign in. Set a password or connect another account first.`,
        },
        { status: 400 },
      );
    }

    if (provider === "google") {
      await pool.query(
        `UPDATE users SET google_id = NULL, google_email = NULL, google_name = NULL, google_avatar_url = NULL WHERE id = $1`,
        [session.userId],
      );
    } else {
      await pool.query(
        `UPDATE users SET github_id = NULL, github_email = NULL, github_name = NULL, github_avatar_url = NULL, github_login = NULL WHERE id = $1`,
        [session.userId],
      );
    }

    return NextResponse.json({
      success: true,
      message: `${OAUTH_PROVIDERS[provider].label} account disconnected`,
    });
  } catch (error) {
    console.error(`[${provider}] disconnect error:`, error);
    return NextResponse.json(
      {
        error: `Failed to disconnect ${OAUTH_PROVIDERS[provider].label} account.`,
      },
      { status: 500 },
    );
  }
}
