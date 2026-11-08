import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getTeamResourceAccess } from "@/lib/auth/team-resource-access";

/**
 * GET /api/v3/webhooks/[id]/deliveries: the attempt log for one webhook.
 *
 * lib/webhooks/delivery.ts has written a row per attempt since it shipped,
 * and its index on (webhook_id, attempted_at DESC) was shaped for exactly
 * this read, but nothing ever SELECTed the table: a user whose webhook was
 * failing had no way to see why, despite the answer being recorded
 * (AUDIT-011#drift-25).
 *
 * Read access follows the same rule as the webhook list: the owner, or any
 * co-member of the team the webhook is assigned to. http_status is null on
 * a network error or an SSRF block, in which case response_snippet carries
 * the error text; neither ever contains the request payload. response_snippet
 * is withheld from anyone who cannot edit the webhook.
 */
const MAX_DELIVERIES = 50;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid webhook id" }, { status: 400 });
  }

  const existing = await pool.query<{
    user_id: number;
    team_id: number | null;
  }>("SELECT user_id, team_id FROM webhooks WHERE id = $1", [id]);
  const webhook = existing.rows[0];
  if (!webhook) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  const access = await getTeamResourceAccess(
    session.userId,
    webhook.user_id,
    webhook.team_id,
  );
  if (!access.canRead) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  const result = await pool.query(
    `SELECT id, event_type, http_status, response_snippet, attempted_at
       FROM webhook_deliveries
      WHERE webhook_id = $1
      ORDER BY attempted_at DESC
      LIMIT $2`,
    [id, MAX_DELIVERIES],
  );

  // A teammate who cannot edit the webhook gets its host and not its URL, and
  // a receiver's error page can echo the path it was called on ("Cannot POST
  // /hook-secret"), which on a generic receiver may be the whole credential.
  const deliveries = access.canWrite
    ? result.rows
    : result.rows.map((row) => ({ ...row, response_snippet: null }));

  return NextResponse.json({ deliveries });
}
