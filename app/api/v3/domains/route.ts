import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getTeamResourceAccess } from "@/lib/auth/team-resource-access";
import {
  normalizeDomainInput,
  generateVerificationToken,
  verificationRecordName,
  verificationRecordValue,
} from "@/lib/domains/verification";

/**
 * GET /api/v3/domains — the caller's own domains plus any assigned to a
 * team they belong to. Same "team co-membership alone is enough for read
 * access" reasoning as GET /api/v3/webhooks.
 */
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const result = await pool.query(
    `SELECT id, domain, team_id, status, verification_method,
            created_at, verified_at, last_checked_at, last_check_error
     FROM domains
     WHERE user_id = $1
        OR team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
     ORDER BY created_at DESC`,
    [session.userId],
  );
  return NextResponse.json({
    domains: result.rows.map((row) => ({
      ...row,
      verificationRecordName: verificationRecordName(row.domain),
    })),
  });
}

/**
 * POST /api/v3/domains — add a new domain, pending verification. Does not
 * require ownership proof to ADD a row (that's exactly what verification
 * is for) -- only a verified row's domain/subdomain match ever grants
 * anything (see lib/domains/scope.ts). Adding an already-verified-by-
 * someone-else domain is harmless: the new row starts pending with its own
 * distinct token, and can only reach 'verified' if THIS caller can
 * actually publish that token in DNS.
 */
export async function POST(request: NextRequest) {
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

  // Named so the cap the API docs quote is the cap the admin panel edits,
  // rather than a compiled number the docs can drift from (AUDIT-014#magic-08).
  const rl = await checkRateLimit({
    key: `domain-add:${session.userId}`,
    ...RATE_LIMITS.domainAdd,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many domains added recently. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const input = body?.domain;
  if (!input || typeof input !== "string") {
    return NextResponse.json({ error: "Domain is required." }, { status: 400 });
  }

  const normalized = normalizeDomainInput(input);
  if (!normalized.ok || !normalized.domain) {
    return NextResponse.json(
      { error: normalized.error || "Not a valid domain." },
      { status: 400 },
    );
  }

  // casing: all three POST branches now hand back the SAME resource shape
  // GET returns, snake_case, straight off the row. They used to disagree
  // three ways -- GET spread the row, this branch returned neither casing,
  // and the create branch below returned `createdAt` -- which is why the
  // client had to hand-translate the POST response into a GET-shaped row and
  // invent the fields POST never sent (AUDIT-013#dup-09). `createdAt` is
  // kept alongside for one release so the existing optimistic insert keeps
  // working while it moves over.
  const existing = await pool.query(
    `SELECT id, domain, team_id, status, verification_method, created_at,
            verified_at, last_checked_at, last_check_error, verification_token
     FROM domains WHERE user_id = $1 AND domain = $2`,
    [session.userId, normalized.domain],
  );
  if (existing.rows.length > 0) {
    const { verification_token: existingToken, ...row } = existing.rows[0];
    return NextResponse.json(
      {
        ...row,
        createdAt: row.created_at,
        verificationRecordName: verificationRecordName(normalized.domain),
        verificationRecordValue: verificationRecordValue(existingToken),
        alreadyExists: true,
      },
      { status: 200 },
    );
  }

  const token = generateVerificationToken();
  const result = await pool.query(
    `INSERT INTO domains (user_id, domain, status, verification_token)
     VALUES ($1, $2, 'pending', $3)
     RETURNING id, domain, team_id, status, verification_method, created_at,
               verified_at, last_checked_at, last_check_error`,
    [session.userId, normalized.domain, token],
  );
  const row = result.rows[0];

  return NextResponse.json(
    {
      ...row,
      createdAt: row.created_at,
      verificationRecordName: verificationRecordName(row.domain),
      verificationRecordValue: verificationRecordValue(token),
    },
    { status: 201 },
  );
}

/** DELETE /api/v3/domains?id=123 */
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json(
      { error: "Domain id is required." },
      {
        status: 400,
      },
    );
  }

  const existing = await pool.query(
    `SELECT user_id, team_id FROM domains WHERE id = $1`,
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
      { error: "You don't have permission to remove this domain." },
      { status: access.canRead ? 403 : 404 },
    );
  }

  await pool.query(`DELETE FROM domains WHERE id = $1`, [id]);
  return NextResponse.json({ success: true });
}
