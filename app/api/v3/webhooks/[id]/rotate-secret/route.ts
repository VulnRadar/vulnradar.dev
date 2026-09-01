import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { encryptWebhookSecret } from "@/lib/webhooks/secret";

/**
 * POST /api/v3/webhooks/[id]/rotate-secret: issue a new HMAC signing
 * secret for an existing webhook, in place, same row and same id.
 *
 * Before this existed, webhooks.secret was returned once at creation
 * (app/api/v3/webhooks/route.ts) and no UPDATE could ever set it, so a
 * leaked signing secret could only be dealt with by deleting the webhook
 * and creating a new one -- which changes the id and breaks the consumer's
 * configuration for what should be a credential swap (AUDIT-011#drift-26).
 * This mirrors the API key rotate flow: new secret, shown once, never
 * selected by GET.
 *
 * Owner-only, not merely team-write. A team member with write access can
 * edit or pause a webhook (see PATCH in the sibling route), but rotating
 * the secret invalidates every signature the consumer is verifying, which
 * is the same ownership-level decision as re-homing the webhook to another
 * team.
 */
export async function POST(
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

  const secret = randomBytes(32).toString("hex");

  // Scoped to user_id in the statement itself: there is no read-only
  // variant of this action, so a caller who is not the owner gets the same
  // 404 they would get for an id that does not exist.
  //
  // The column stores ciphertext (AUDIT-009#webhook-01); the plaintext is
  // attached to the response below rather than read back through RETURNING,
  // which would hand the caller the ciphertext instead of the new secret.
  const result = await pool.query(
    `UPDATE webhooks SET secret = $1
      WHERE id = $2 AND user_id = $3
      RETURNING id, url, name, type, active, created_at`,
    [encryptWebhookSecret(secret), id, session.userId],
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  return NextResponse.json({ ...result.rows[0], secret });
}
