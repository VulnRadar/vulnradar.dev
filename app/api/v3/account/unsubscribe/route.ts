import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";

// email_security is always forced true — cannot be disabled
const ALWAYS_ON = new Set(["email_security"]);

const ALL_COLUMNS = [
  "email_security",
  "email_new_login",
  "email_password_change",
  "email_2fa_change",
  "email_session_revoked",
  "email_scan_complete",
  "email_critical_findings",
  "email_regression_alert",
  "email_schedules",
  "email_api_keys",
  "email_api_limit_warning",
  "email_webhooks",
  "email_webhook_failure",
  "email_data_requests",
  "email_account_deletion",
  "email_team_invite",
  "email_team_changes",
  "email_product_updates",
  "email_tips_guides",
] as const;

type PrefKey = (typeof ALL_COLUMNS)[number];
type EmailPrefs = Record<PrefKey, boolean>;

const DEFAULT_PREFS: EmailPrefs = Object.fromEntries(
  ALL_COLUMNS.map((c) => [c, true]),
) as EmailPrefs;

function getToken(req: NextRequest): string | null {
  return new URL(req.url).searchParams.get("token");
}

// GET: return current notification preferences for the unsubscribe token
export async function GET(req: NextRequest) {
  const token = getToken(req);
  if (!token) {
    return NextResponse.json({ error: "Token required." }, { status: 400 });
  }

  const userRes = await pool.query<{ id: number; email: string }>(
    "SELECT id, email FROM users WHERE unsubscribe_token = $1",
    [token],
  );
  if (userRes.rows.length === 0) {
    return NextResponse.json({ error: "Invalid token." }, { status: 404 });
  }
  const { id: userId, email } = userRes.rows[0];

  const prefRes = await pool.query(
    `SELECT ${ALL_COLUMNS.join(", ")} FROM notification_preferences WHERE user_id = $1`,
    [userId],
  );

  const prefs: EmailPrefs =
    prefRes.rows.length > 0
      ? { ...DEFAULT_PREFS, ...prefRes.rows[0] }
      : { ...DEFAULT_PREFS };

  // Always enforce security alerts on
  prefs.email_security = true;

  return NextResponse.json({ email, prefs });
}

// POST: update preferences or unsubscribe from all
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const action = url.searchParams.get("action");

  if (!token) {
    return NextResponse.json({ error: "Token required." }, { status: 400 });
  }

  const userRes = await pool.query<{ id: number }>(
    "SELECT id FROM users WHERE unsubscribe_token = $1",
    [token],
  );
  if (userRes.rows.length === 0) {
    return NextResponse.json({ error: "Invalid token." }, { status: 404 });
  }
  const userId = userRes.rows[0].id;

  if (action === "unsubscribe_all") {
    const allOff = Object.fromEntries(
      ALL_COLUMNS.map((c) => [c, ALWAYS_ON.has(c)]),
    ) as EmailPrefs;

    const colList = ALL_COLUMNS.join(", ");
    const vals = ALL_COLUMNS.map((c) => allOff[c]);
    const placeholders = ALL_COLUMNS.map((_, i) => `$${i + 2}`).join(", ");
    const setClause = ALL_COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(", ");

    await pool.query(
      `INSERT INTO notification_preferences (user_id, ${colList}, updated_at)
       VALUES ($1, ${placeholders}, NOW())
       ON CONFLICT (user_id) DO UPDATE SET ${setClause}, updated_at = NOW()`,
      [userId, ...vals],
    );

    return NextResponse.json({ success: true, prefs: allOff });
  }

  // Selective update
  let body: { prefs?: Partial<Record<string, boolean>> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const incoming = body.prefs || {};
  const updates: Record<string, boolean> = {};
  for (const col of ALL_COLUMNS) {
    if (ALWAYS_ON.has(col)) continue;
    if (col in incoming && typeof incoming[col] === "boolean") {
      updates[col] = incoming[col];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid preferences provided." },
      { status: 400 },
    );
  }

  const cols = Object.keys(updates);
  const vals = Object.values(updates);
  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  const insertCols = ["user_id", ...cols].join(", ");
  const insertVals = cols.map((_, i) => `$${i + 2}`).join(", ");

  await pool.query(
    `INSERT INTO notification_preferences (${insertCols}, updated_at)
     VALUES ($1, ${insertVals}, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ${setClause}, updated_at = NOW()`,
    [userId, ...vals],
  );

  return NextResponse.json({ success: true });
}
