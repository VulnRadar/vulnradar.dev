import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getTeamResourceAccess } from "@/lib/auth/team-resource-access";
import { checkDnsVerification } from "@/lib/domains/verification";

/**
 * POST /api/v3/domains/[id]/verify — checks DNS right now for this row's
 * verification_token and updates its status. Safe to call repeatedly
 * (rate-limited, not gated to one attempt) since a user fixing a typo'd
 * TXT record needs to retry without waiting.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  if (!(await getSetting("FEATURE_DOMAIN_VERIFICATION"))) {
    return NextResponse.json(
      { error: "Domain verification is disabled on this deployment." },
      { status: 403 },
    );
  }

  const id = Number((await params).id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid domain id." }, { status: 400 });
  }

  // Named so the cap the API docs quote is the cap the admin panel edits,
  // rather than a compiled number the docs can drift from (AUDIT-014#magic-08).
  const rl = await checkRateLimit({
    key: `domain-verify:${session.userId}`,
    ...RATE_LIMITS.domainVerify,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many verification attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  const existing = await pool.query<{
    user_id: number;
    team_id: number | null;
    domain: string;
    verification_token: string;
  }>(
    `SELECT user_id, team_id, domain, verification_token FROM domains WHERE id = $1`,
    [id],
  );
  const row = existing.rows[0];
  if (!row) {
    return NextResponse.json({ error: "Domain not found." }, { status: 404 });
  }

  const access = await getTeamResourceAccess(
    session.userId,
    row.user_id,
    row.team_id,
  );
  if (!access.canWrite) {
    return NextResponse.json(
      { error: "You don't have permission to verify this domain." },
      { status: access.canRead ? 403 : 404 },
    );
  }

  const result = await checkDnsVerification(row.domain, row.verification_token);

  // "reverify_failed", not "failed": domains_status_check allows exactly
  // ('pending','verified','reverify_failed'), so "failed" raised a 23514 check
  // violation on every failed verification. Nothing caught it, so the UPDATE
  // rolled back and last_check_error, the one field that tells the user which
  // DNS record is wrong, was never written. lib/domains/reverify-worker.ts has
  // always used the allowed value; this route was the outlier.
  const status = result.verified ? "verified" : "reverify_failed";
  await pool.query(
    `UPDATE domains
     SET status = $1::varchar,
         verified_at = CASE WHEN $1::varchar = 'verified' THEN NOW() ELSE verified_at END,
         last_checked_at = NOW(),
         last_check_error = $2
     WHERE id = $3`,
    [status, result.verified ? null : (result.error ?? null), id],
  );

  return NextResponse.json({
    verified: result.verified,
    status,
    error: result.verified ? undefined : result.error,
  });
}
