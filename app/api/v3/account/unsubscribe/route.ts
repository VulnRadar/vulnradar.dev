import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { withErrorHandling } from "@/lib/api/api-utils";
import {
  DEFAULT_PREFERENCES,
  UNSUBSCRIBABLE_COLUMNS,
  isNotificationColumn,
  isSecurityColumn,
  type NotificationPrefs,
} from "@/lib/notifications/columns";

// UNSUBSCRIBABLE_COLUMNS is the shared declaration in
// lib/notifications/columns.ts. A hand-copied list here had drifted (missing
// email_posture_digest), so "unsubscribe from all" left the posture digest on,
// and a user could not turn it off.

function getToken(req: NextRequest): string | null {
  return new URL(req.url).searchParams.get("token");
}

// users.unsubscribe_token is a UUID column, so Postgres refuses to compare it
// with anything that is not shaped like one (22P02, "invalid input syntax for
// type uuid"). Left alone, a garbage token was a 500 and an error-log row per
// probe on a public, unauthenticated endpoint. It cannot match a row either
// way, so it is the same 404 an unknown token gets.
const TOKEN_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidToken(): NextResponse {
  return NextResponse.json({ error: "Invalid token." }, { status: 404 });
}

// Enough to recognise your own address and no more: the token travels in mail
// footers and forwarded messages, and the response used to hand whoever held
// it the full address. Done here rather than in the page, so the whole address
// never leaves the server. At most all but one character of the local part
// shows, so a two-letter mailbox is not printed in full either.
function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return "***";
  return `${email.slice(0, Math.min(2, at - 1))}***${email.slice(at)}`;
}

// GET: return current notification preferences for the unsubscribe token
export const GET = withErrorHandling(async (req: NextRequest) => {
  const token = getToken(req);
  if (!token) {
    return NextResponse.json({ error: "Token required." }, { status: 400 });
  }
  if (!TOKEN_SHAPE.test(token)) return invalidToken();

  const userRes = await pool.query<{ id: number; email: string }>(
    "SELECT id, email FROM users WHERE unsubscribe_token = $1",
    [token],
  );
  if (userRes.rows.length === 0) return invalidToken();
  const { id: userId, email } = userRes.rows[0];

  const prefRes = await pool.query(
    `SELECT ${UNSUBSCRIBABLE_COLUMNS.join(", ")} FROM notification_preferences WHERE user_id = $1`,
    [userId],
  );

  // Only the columns this token can change. Whether the sign-in warnings are
  // on is not something to tell a stranger holding a forwarded email.
  const stored: Partial<NotificationPrefs> = prefRes.rows[0] ?? {};
  const prefs = Object.fromEntries(
    UNSUBSCRIBABLE_COLUMNS.map((column) => [
      column,
      stored[column] ?? DEFAULT_PREFERENCES[column],
    ]),
  );

  return NextResponse.json({ email: redactEmail(email), prefs });
});

// POST: turn off one category, update several, or unsubscribe from all.
//
// Three callers, three shapes:
//   ?type=<column>        a mail client's one-click unsubscribe (RFC 8058),
//                         from the List-Unsubscribe header. It carries no JSON
//                         body, only "List-Unsubscribe=One-Click", and it
//                         turns off the one category the message belonged to.
//   ?action=unsubscribe_all  the explicit button on /unsubscribe.
//   {prefs: {...}}        the switches on /unsubscribe.
//
// The header used to point at unsubscribe_all, so pressing Gmail's
// "Unsubscribe" on a scan report also switched off the sign-in, password and
// two-factor warnings. A mail client's button must never mean "everything".
export const POST = withErrorHandling(async (req: NextRequest) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const action = url.searchParams.get("action");
  const type = url.searchParams.get("type");

  if (!token) {
    return NextResponse.json({ error: "Token required." }, { status: 400 });
  }
  if (!TOKEN_SHAPE.test(token)) return invalidToken();

  const userRes = await pool.query<{ id: number }>(
    "SELECT id FROM users WHERE unsubscribe_token = $1",
    [token],
  );
  if (userRes.rows.length === 0) return invalidToken();
  const userId = userRes.rows[0].id;

  if (type !== null) {
    // No message carries a link to a security column (they have no token at
    // all), so a request naming one was built by hand, and the warnings that
    // catch a takeover are not something a bodyless POST should be able to
    // switch off. They stay editable on Profile > Notifications.
    if (!isNotificationColumn(type) || isSecurityColumn(type)) {
      return NextResponse.json(
        { error: "That is not an email category you can unsubscribe from." },
        { status: 400 },
      );
    }
    // `type` has just been checked against the known column names, which is
    // the only reason it can be named in the statement.
    await pool.query(
      `INSERT INTO notification_preferences (user_id, ${type}, updated_at)
       VALUES ($1, false, NOW())
       ON CONFLICT (user_id) DO UPDATE SET ${type} = false, updated_at = NOW()`,
      [userId],
    );
    return NextResponse.json({ success: true, type });
  }

  if (action === "unsubscribe_all") {
    // The security columns are not named at all, so this neither turns one
    // off nor flips back on one the owner chose to turn off while signed in.
    const colList = UNSUBSCRIBABLE_COLUMNS.join(", ");
    const allFalse = UNSUBSCRIBABLE_COLUMNS.map(() => "false").join(", ");
    const setClause = UNSUBSCRIBABLE_COLUMNS.map((c) => `${c} = false`).join(
      ", ",
    );

    await pool.query(
      `INSERT INTO notification_preferences (user_id, ${colList}, updated_at)
       VALUES ($1, ${allFalse}, NOW())
       ON CONFLICT (user_id) DO UPDATE SET ${setClause}, updated_at = NOW()`,
      [userId],
    );

    return NextResponse.json({
      success: true,
      prefs: Object.fromEntries(
        UNSUBSCRIBABLE_COLUMNS.map((column) => [column, false]),
      ),
    });
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
  for (const col of UNSUBSCRIBABLE_COLUMNS) {
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
});
