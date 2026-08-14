import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";

/**
 * Create (or return the already-issued) auto-updating badge token for one
 * of the caller's own scans' URL. Idempotent by (user_id, url): calling
 * this twice for the same URL returns the SAME token, so the embed code a
 * user pastes into their README/site never needs to change again -- the
 * image route always resolves it against whichever scan of that URL ran
 * most recently, by date (see app/api/v3/badge/[token]/route.ts).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const scanId = Number((body as Record<string, unknown>)?.scanId);
  if (!Number.isInteger(scanId) || scanId <= 0) {
    return NextResponse.json({ error: "Invalid scanId" }, { status: 400 });
  }

  const scanRes = await pool.query<{ url: string }>(
    `SELECT url FROM scan_history WHERE id = $1 AND user_id = $2`,
    [scanId, session.userId],
  );
  if (scanRes.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }
  const { url } = scanRes.rows[0];

  const existing = await pool.query<{ badge_token: string }>(
    `SELECT badge_token FROM host_badges
     WHERE user_id = $1 AND url = $2 AND revoked_at IS NULL`,
    [session.userId, url],
  );
  if (existing.rows.length > 0) {
    return NextResponse.json({ token: existing.rows[0].badge_token, url });
  }

  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO host_badges (user_id, url, badge_token)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, url) DO UPDATE SET
       badge_token = EXCLUDED.badge_token,
       revoked_at = NULL,
       created_at = NOW()`,
    [session.userId, url, token],
  );

  return NextResponse.json({ token, url });
}

// PATCH to toggle a badge's scope. 'user' (the default) only ever resolves
// to the badge owner's own scans of that URL; 'global' resolves to whichever
// completed scan of that URL is newest, by anyone -- see the JOIN in
// app/api/v3/badge/[token]/route.ts and app/api/v3/shared/[token]/route.ts.
// Owner-toggleable at any time so someone who turns it on can turn it back
// off without regenerating the token or touching their embed code.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const url = String((body as Record<string, unknown>)?.url ?? "");
  const scope = (body as Record<string, unknown>)?.scope;
  if (!url) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (scope !== "user" && scope !== "global") {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }

  const result = await pool.query<{ scope: string }>(
    `UPDATE host_badges SET scope = $1
     WHERE user_id = $2 AND url = $3 AND revoked_at IS NULL
     RETURNING scope`,
    [scope, session.userId, url],
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Badge not found" }, { status: 404 });
  }

  return NextResponse.json({ scope: result.rows[0].scope });
}

// DELETE to revoke an auto-updating badge (stops the token from resolving;
// does not touch the underlying scan history).
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const scanId = Number(url.searchParams.get("scanId"));
  if (!Number.isInteger(scanId) || scanId <= 0) {
    return NextResponse.json({ error: "Invalid scanId" }, { status: 400 });
  }

  const scanRes = await pool.query<{ url: string }>(
    `SELECT url FROM scan_history WHERE id = $1 AND user_id = $2`,
    [scanId, session.userId],
  );
  if (scanRes.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  await pool.query(
    `UPDATE host_badges SET revoked_at = NOW()
     WHERE user_id = $1 AND url = $2`,
    [session.userId, scanRes.rows[0].url],
  );

  return NextResponse.json({ success: true });
}
