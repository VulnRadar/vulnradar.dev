import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";

const DEFAULT_PREFS = {
  security: true,
  account_changes: true,
  api_webhooks: true,
  teams: true,
  general: true,
};

type EmailPrefs = typeof DEFAULT_PREFS;

// Categories that users may NOT disable — security alerts must always be sent.
const NON_DISABLEABLE: Set<keyof EmailPrefs> = new Set(["security"]);

function getToken(req: NextRequest): string | null {
  return new URL(req.url).searchParams.get("token");
}

// GET: return current pref state for the unsubscribe token (no PII in response)
export async function GET(req: NextRequest) {
  const token = getToken(req);
  if (!token) {
    return NextResponse.json({ error: "Token required." }, { status: 400 });
  }
  const result = await pool.query(
    `SELECT email_prefs FROM users WHERE unsubscribe_token = $1`,
    [token],
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Invalid token." }, { status: 404 });
  }
  const row = result.rows[0] as { email_prefs: EmailPrefs | null };
  const prefs: EmailPrefs = { ...DEFAULT_PREFS, ...(row.email_prefs || {}) };
  // Always report security as true regardless of stored value — it cannot be disabled.
  prefs.security = true;
  return NextResponse.json({ prefs });
}

// POST: update prefs or unsubscribe from non-security categories
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const action = url.searchParams.get("action");

  if (!token) {
    return NextResponse.json({ error: "Token required." }, { status: 400 });
  }

  const existing = await pool.query(
    `SELECT id, email_prefs FROM users WHERE unsubscribe_token = $1`,
    [token],
  );
  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Invalid token." }, { status: 404 });
  }
  const row = existing.rows[0] as {
    id: number;
    email_prefs: EmailPrefs | null;
  };
  const currentPrefs: EmailPrefs = {
    ...DEFAULT_PREFS,
    ...(row.email_prefs || {}),
  };

  if (action === "unsubscribe_all") {
    // Security notifications cannot be disabled.
    const allOff: EmailPrefs = {
      security: true,
      account_changes: false,
      api_webhooks: false,
      teams: false,
      general: false,
    };
    await pool.query(`UPDATE users SET email_prefs = $1::jsonb WHERE id = $2`, [
      JSON.stringify(allOff),
      row.id,
    ]);
    return NextResponse.json({ success: true, prefs: allOff });
  }

  let body: { prefs?: Partial<EmailPrefs> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const incoming = body.prefs || {};
  const merged: EmailPrefs = {
    // security is always true — non-disableable
    security: true,
    account_changes:
      typeof incoming.account_changes === "boolean"
        ? incoming.account_changes
        : currentPrefs.account_changes,
    api_webhooks:
      typeof incoming.api_webhooks === "boolean"
        ? incoming.api_webhooks
        : currentPrefs.api_webhooks,
    teams:
      typeof incoming.teams === "boolean" ? incoming.teams : currentPrefs.teams,
    general:
      typeof incoming.general === "boolean"
        ? incoming.general
        : currentPrefs.general,
  };

  // Double-check no non-disableable category slipped through
  for (const key of NON_DISABLEABLE) {
    merged[key] = true;
  }

  await pool.query(`UPDATE users SET email_prefs = $1::jsonb WHERE id = $2`, [
    JSON.stringify(merged),
    row.id,
  ]);

  return NextResponse.json({ success: true, prefs: merged });
}
