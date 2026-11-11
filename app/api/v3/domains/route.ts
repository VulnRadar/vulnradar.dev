import { NextRequest, NextResponse } from "next/server";
import { readJsonObject, withErrorHandling } from "@/lib/api/api-utils";
import { parseIdParam } from "@/lib/api/path-id";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  getAssignableTeamIds,
  getTeamResourceAccess,
} from "@/lib/auth/team-resource-access";
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
export const GET = withErrorHandling(async () => {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  // user_id rides along because this list mixes the caller's own domains with
  // ones a teammate verified and shared, and PATCH /domains/[id] is scoped to
  // the owner (`WHERE id = $2 AND user_id = $3`, 404 for anyone else). The
  // client needs to know which rows it may offer a team control on.
  //
  // A teammate's row is listed only while its owner is still on that team,
  // the same rule getTeamResourceAccess and lib/domains/scope.ts apply: a
  // domain somebody shared before they left is no longer the team's.
  const result = await pool.query<{
    domain: string;
    user_id: number;
    team_id: number | null;
    status: string;
  }>(
    `SELECT id, domain, user_id, team_id, status, verification_method,
            created_at, verified_at, last_checked_at, last_check_error
     FROM domains
     WHERE user_id = $1
        OR (team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
            AND EXISTS (SELECT 1 FROM team_members o
                         WHERE o.team_id = domains.team_id
                           AND o.user_id = domains.user_id))
     ORDER BY created_at DESC`,
    [session.userId],
  );

  // usableForScanning: whether this row would let the caller run an active
  // probe or a port sweep, answered by the rule lib/domains/scope.ts enforces
  // (isUrlOwnedByUser). Being able to SEE a teammate's row is not that: a
  // viewer or a manager reads every team row but cannot scan under the team,
  // and the scan form, which counted every verified row, promised them a port
  // sweep that then 403'd the whole scan
  // (gap-domain-verification-active-gating-6).
  const featureOn = Boolean(await getSetting("FEATURE_DOMAIN_VERIFICATION"));
  const assignable = featureOn
    ? new Set(await getAssignableTeamIds(session.userId))
    : new Set<number>();
  return NextResponse.json({
    domains: result.rows.map((row) => ({
      ...row,
      verificationRecordName: verificationRecordName(row.domain),
      usableForScanning:
        featureOn &&
        row.status === "verified" &&
        (row.user_id === session.userId ||
          (row.team_id !== null && assignable.has(row.team_id))),
    })),
  });
});

/**
 * POST /api/v3/domains — add a new domain, pending verification. Does not
 * require ownership proof to ADD a row (that's exactly what verification
 * is for) -- only a verified row's domain/subdomain match ever grants
 * anything (see lib/domains/scope.ts). Adding an already-verified-by-
 * someone-else domain is harmless: the new row starts pending with its own
 * distinct token, and can only reach 'verified' if THIS caller can
 * actually publish that token in DNS.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
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

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data.domain;
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
    `SELECT id, domain, user_id, team_id, status, verification_method, created_at,
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
     RETURNING id, domain, user_id, team_id, status, verification_method, created_at,
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
});

/**
 * DELETE /api/v3/domains?id=123
 *
 * Owner-only, like PATCH /domains/[id]. This used to accept anyone the team
 * write rule let through, so any teammate with manage_scans could destroy a
 * domain somebody else had proven they own, which costs that person a new DNS
 * record and a wait to put back, although only they may decide which team it
 * is shared with (gap-domain-verification-active-gating-7). A team admin who
 * wants it out of the team un-shares it instead (PATCH /domains/[id] with
 * teamId null), which keeps the proof.
 */
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const rawId = request.nextUrl.searchParams.get("id");
  if (!rawId) {
    return NextResponse.json(
      { error: "Domain id is required." },
      { status: 400 },
    );
  }
  const id = parseIdParam(rawId);
  if (id === null) {
    return NextResponse.json({ error: "Invalid domain id." }, { status: 400 });
  }

  const existing = await pool.query(
    `SELECT user_id, team_id FROM domains WHERE id = $1`,
    [id],
  );
  const row = existing.rows[0];
  if (!row) {
    return NextResponse.json({ error: "Domain not found." }, { status: 404 });
  }

  if (row.user_id !== session.userId) {
    // A teammate who can see the row is told why; anyone else learns nothing
    // about whether the id exists.
    const access = await getTeamResourceAccess(
      session.userId,
      row.user_id,
      row.team_id,
    );
    return NextResponse.json(
      access.canRead
        ? {
            error:
              "Only the person who verified this domain can remove it. A team owner or admin can stop sharing it with the team instead.",
          }
        : { error: "Domain not found." },
      { status: access.canRead ? 403 : 404 },
    );
  }

  // Scoped to the owner in the statement too, so the answer above cannot go
  // stale between the read and the write.
  await pool.query(`DELETE FROM domains WHERE id = $1 AND user_id = $2`, [
    id,
    session.userId,
  ]);
  return NextResponse.json({ success: true });
});
