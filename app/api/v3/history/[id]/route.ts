import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES, BEARER_PREFIX } from "@/lib/config/constants";
import {
  validateApiKey,
  checkRateLimit as checkApiKeyRateLimit,
  recordUsage,
} from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import {
  getScanResourceAccess,
  getScanTeamAccess,
  getScanTeamIds,
  parseTeamIdsInput,
  authorizeScanTeamChange,
  setScanTeams,
} from "@/lib/teams/scan-teams";
import { rateLimitedResponse } from "@/lib/api/rate-limit-response";
import { resolveScanRow } from "@/lib/history/resolve-scan";
import {
  attachRemediation,
  attachFalsePositiveVerdicts,
} from "@/lib/scanner/remediation-store";
import type { Vulnerability } from "@/lib/scanner/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth: check API key first (Bearer token), then fall back to session cookie
  const authHeader = request.headers.get("authorization");
  let authedUserId: number | null = null;
  let apiKeyId: number | null = null;
  let keyData: Awaited<ReturnType<typeof validateApiKey>> = null;

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(7);
    keyData = await validateApiKey(token);

    if (!keyData) {
      return NextResponse.json(
        { error: "Invalid or revoked API key." },
        { status: 401 },
      );
    }
    if (keyData.needsTermsAcceptance) {
      return NextResponse.json(
        {
          error:
            "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.",
        },
        { status: 403 },
      );
    }

    // scoping: reading a scan requires scan:read.
    if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_READ)) {
      return NextResponse.json(
        { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_READ) },
        { status: 403 },
      );
    }

    // Check API key rate limit
    const rateLimit = await checkApiKeyRateLimit(
      keyData.keyId,
      keyData.dailyLimit,
    );
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit);
    }

    apiKeyId = keyData.keyId;
    authedUserId = keyData.userId;
  } else {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.UNAUTHORIZED },
        { status: 401 },
      );
    }
    authedUserId = session.userId;
  }

  if (!authedUserId) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const { id } = await params;

  // Resolve the opaque public_id (or a legacy numeric id) to the scan row.
  const scan = await resolveScanRow(id);
  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }
  // checksRun, dangerScore, engineConfidence, incomplete and (for crawl
  // scans) crawl all live in here -- see lib/scanner/scan-jobs.ts's
  // finalizeScanSuccess, the same place app/api/v3/scan/status/[id]/route.ts
  // reads it from for the just-completed results view.
  const meta = scan.result_meta || {};

  // Tags (auto and user, see lib/tags/auto-tags.ts and
  // app/api/v3/scan/tags/route.ts) belong to the scan's owner, not
  // necessarily the requester -- a teammate viewing this scan below still
  // sees the owner's tags, same as they see the owner's notes.
  const tagsResult = await pool.query(
    `SELECT tag, source FROM scan_tags WHERE scan_id = $1 AND user_id = $2 ORDER BY source, tag`,
    [scan.id, scan.user_id],
  );
  const tags = tagsResult.rows;

  // Every team this scan is shared with. A scan used to carry at most one
  // (scan_history.team_id); the set now lives in scan_history_teams, with the
  // column kept in sync as the primary. Read once here so both the owner and
  // the team-member branch below can report it and the team-member branch can
  // decide access from it.
  const scanTeamIds = await getScanTeamIds(scan.id);

  // Allow if it's the user's own scan
  if (scan.user_id === authedUserId) {
    // Record API key usage
    if (apiKeyId) {
      await recordUsage(apiKeyId);
    }

    // Cross-rescan remediation: attach the owner's current per-finding
    // status (fixed / accepted_risk / ...) by stable finding_id, so a
    // finding they marked on an earlier scan of this target shows the same
    // status here. Owner-only -- deliberately NOT done in the team-member
    // branch below, since remediation tracking is private to its owner.
    const ownedFindings = await attachFalsePositiveVerdicts(
      authedUserId,
      await attachRemediation(
        authedUserId,
        scan.url,
        (scan.findings || []) as Vulnerability[],
      ),
    );

    return NextResponse.json({
      // Internal numeric id: the opaque public_id addresses this route, but
      // per-finding feedback (POST /api/v3/scan/feedback) keys its ownership
      // check and score-recompute on the numeric primary key, so an owner
      // viewing this scan needs it to mark a finding a false positive.
      id: scan.id,
      url: scan.url,
      scannedAt: scan.scanned_at,
      duration: scan.duration,
      summary: scan.summary,
      findings: ownedFindings,
      responseHeaders: scan.response_headers || undefined,
      notes: scan.notes || "",
      userId: scan.user_id,
      authenticated: scan.authenticated || false,
      isPublic: scan.is_public !== false,
      // Which teams this scan is shared with. PATCH has always accepted a
      // team assignment but nothing ever reported the current value back, so
      // the scan actions menu had no way to show an existing assignment: it
      // opened its team picker with nothing selected on a scan that was
      // already shared. teamId is the primary team, kept for API clients
      // written against the single-team contract; teamIds is the real set.
      teamId: scanTeamIds[0] ?? null,
      teamIds: scanTeamIds,
      tags,
      ...meta,
    });
  }

  // Team access is scoped to the teams this scan is actually shared with, not
  // "any team the two users happen to share". A private personal scan (no
  // teams) is owner-only even between teammates -- getScanResourceAccess
  // returns canRead:false for it. The prior "do these two users share any
  // team" self-join leaked a teammate's private personal scans (org-isolation
  // bug, same rule PATCH/DELETE already enforce).
  const access = await getScanTeamAccess(
    authedUserId,
    scan.user_id,
    scanTeamIds,
  );

  if (access.canRead) {
    // Record API key usage
    if (apiKeyId) {
      await recordUsage(apiKeyId);
    }

    // Team-scoped read: allow access but don't show delete option
    return NextResponse.json({
      id: scan.id,
      url: scan.url,
      scannedAt: scan.scanned_at,
      duration: scan.duration,
      summary: scan.summary,
      findings: scan.findings || [],
      responseHeaders: scan.response_headers || undefined,
      notes: scan.notes || "",
      userId: scan.user_id,
      authenticated: scan.authenticated || false,
      isPublic: scan.is_public !== false,
      teamId: scanTeamIds[0] ?? null,
      teamIds: scanTeamIds,
      tags,
      ...meta,
    });
  }

  // Not authorized to view this scan
  return NextResponse.json({ error: "Scan not found" }, { status: 404 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth: check API key first (Bearer token), then fall back to session cookie
  const authHeader = request.headers.get("authorization");
  let authedUserId: number | null = null;
  let apiKeyId: number | null = null;
  let keyData: Awaited<ReturnType<typeof validateApiKey>> = null;

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(7);
    keyData = await validateApiKey(token);

    if (!keyData) {
      return NextResponse.json(
        { error: "Invalid or revoked API key." },
        { status: 401 },
      );
    }
    if (keyData.needsTermsAcceptance) {
      return NextResponse.json(
        {
          error:
            "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.",
        },
        { status: 403 },
      );
    }

    // scoping: editing a scan's notes/visibility is a mutation, not a
    // destructive delete -- requires scan:write.
    if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_WRITE)) {
      return NextResponse.json(
        { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_WRITE) },
        { status: 403 },
      );
    }

    // Check API key rate limit
    const rateLimit = await checkApiKeyRateLimit(
      keyData.keyId,
      keyData.dailyLimit,
    );
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit);
    }

    apiKeyId = keyData.keyId;
    authedUserId = keyData.userId;
  } else {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.UNAUTHORIZED },
        { status: 401 },
      );
    }
    authedUserId = session.userId;
  }

  if (!authedUserId) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const { id } = await params;
  const body = await request.json();
  const { notes, isPublic } = body;

  const hasNotes = notes !== undefined;
  const hasIsPublic = isPublic !== undefined;

  // Team assignment. `teamIds: number[]` is a full replacement set; the
  // original `teamId: number | null` is still accepted and means the same as
  // a one- or zero-element array, since this is a public API route and
  // clients written against the single-team contract must keep working.
  const parsedTeams = parseTeamIdsInput(body);
  if (!parsedTeams.ok) {
    return NextResponse.json({ error: parsedTeams.error }, { status: 400 });
  }
  const hasTeams = parsedTeams.provided;

  if (!hasNotes && !hasIsPublic && !hasTeams) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (hasNotes && typeof notes !== "string") {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
  }
  if (hasIsPublic && typeof isPublic !== "boolean") {
    return NextResponse.json({ error: "Invalid isPublic" }, { status: 400 });
  }

  const scan = await resolveScanRow(id);
  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  // anti-enumeration: a caller with no relationship to this scan at all
  // (not the owner, not a co-member of its team) gets the same 404 as a
  // truly nonexistent id -- matches this route's GET/DELETE and every
  // other per-resource route in this codebase, so a stranger can never
  // use the 403-vs-404 split to learn a scan id is real. Only once
  // canRead is true (they already know it exists, e.g. via GET) does a
  // write-permission failure become an informative 403.
  const access = await getScanResourceAccess(authedUserId, scan);
  if (!access.canRead) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  // Team sharing (org isolation, AUDIT-010 #273): only the scan's own owner
  // may change which teams it is shared with -- a team member with write
  // access to a shared scan can still edit its notes/visibility, but
  // re-pointing it at a different team is an ownership decision, not a
  // collaboration one.
  if (hasTeams && authedUserId !== scan.user_id) {
    return NextResponse.json(
      { error: "Only the scan's owner can change its team assignment." },
      { status: 403 },
    );
  }
  let currentTeamIds: number[] = [];
  if (hasTeams) {
    currentTeamIds = await getScanTeamIds(scan.id);
    // Both directions are gated. Because teamIds is a replacement set,
    // omitting a team is how you remove it, so checking only the additions
    // would let a caller drop a team they do not manage just by leaving it
    // out of the array.
    const allowed = await authorizeScanTeamChange(
      authedUserId,
      currentTeamIds,
      parsedTeams.teamIds,
    );
    if (!allowed.ok) {
      return NextResponse.json({ error: allowed.error }, { status: 400 });
    }
  }

  if ((hasNotes || hasIsPublic) && !access.canWrite) {
    return NextResponse.json(
      { error: "You do not have permission to modify this scan." },
      { status: 403 },
    );
  }

  // The team set is not a scan_history column any more, so it is written
  // separately (setScanTeams rewrites scan_history_teams and re-points the
  // primary-team column in one statement). Done before the column UPDATE so a
  // teams-only PATCH still has something to report back below.
  if (hasTeams) {
    await setScanTeams(scan.id, parsedTeams.teamIds);
  }

  // Built dynamically so a notes-only or isPublic-only PATCH (the toggle
  // in components/scanner/scan-actions-menu.tsx never sends notes)
  // doesn't have to send the field it isn't changing. Access was already
  // decided above, so the WHERE clause only needs the id.
  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (hasNotes) {
    setClauses.push(`notes = $${values.length + 1}`);
    values.push(notes.slice(0, 2000));
  }
  if (hasIsPublic) {
    setClauses.push(`is_public = $${values.length + 1}`);
    values.push(isPublic);
  }

  // A teams-only PATCH leaves nothing for the column UPDATE to set, and
  // `SET ` with an empty clause list is a syntax error rather than a no-op,
  // so the row is read back instead of written.
  const result = setClauses.length
    ? await pool.query(
        `UPDATE scan_history SET ${setClauses.join(", ")}
     WHERE id = $${values.length + 1}
     RETURNING id, notes, is_public, team_id`,
        [...values, scan.id],
      )
    : await pool.query(
        `SELECT id, notes, is_public, team_id FROM scan_history WHERE id = $1`,
        [scan.id],
      );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  // A scan just turned private: if it was still the source of the current
  // host_reputation row for its host, that row must stop reflecting it.
  // Deleting rather than re-deriving "the next most recent public scan"
  // (which would need a new query) leaves the public /host/[hostname] page
  // showing "not scanned yet" until the next public scan of that host
  // repopulates it. Scoped by source_scan_id, not host, so this never
  // touches a different scan's reputation row -- and it's a no-op if this
  // scan wasn't the current source (already superseded, or never public).
  if (hasIsPublic && isPublic === false) {
    await pool.query(`DELETE FROM host_reputation WHERE source_scan_id = $1`, [
      scan.id,
    ]);
  }

  // Record API key usage
  if (apiKeyId) {
    await recordUsage(apiKeyId);
  }

  // teamIds is reported whether or not this PATCH changed it, so a client
  // never has to work out whether an absent field means "unchanged" or
  // "shared with nobody". A PATCH that did change it already knows the
  // answer without going back to the database.
  const responseTeamIds = hasTeams
    ? parsedTeams.teamIds
    : await getScanTeamIds(scan.id);

  return NextResponse.json({
    notes: result.rows[0].notes,
    isPublic: result.rows[0].is_public,
    // teamId stays in the response for clients written against the
    // single-team contract: it is the primary team, the first of teamIds.
    teamId: result.rows[0].team_id ?? null,
    teamIds: responseTeamIds,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth: check API key first (Bearer token), then fall back to session cookie
  const authHeader = request.headers.get("authorization");
  let authedUserId: number | null = null;
  let apiKeyId: number | null = null;
  let keyData: Awaited<ReturnType<typeof validateApiKey>> = null;

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(7);
    keyData = await validateApiKey(token);

    if (!keyData) {
      return NextResponse.json(
        { error: "Invalid or revoked API key." },
        { status: 401 },
      );
    }
    if (keyData.needsTermsAcceptance) {
      return NextResponse.json(
        {
          error:
            "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.",
        },
        { status: 403 },
      );
    }

    // scoping: deleting an individual scan is destructive -- requires
    // scan:delete, deliberately excluded from a newly created key's default
    // scopes.
    if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_DELETE)) {
      return NextResponse.json(
        { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_DELETE) },
        { status: 403 },
      );
    }

    // Check API key rate limit
    const rateLimit = await checkApiKeyRateLimit(
      keyData.keyId,
      keyData.dailyLimit,
    );
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit);
    }

    apiKeyId = keyData.keyId;
    authedUserId = keyData.userId;
  } else {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.UNAUTHORIZED },
        { status: 401 },
      );
    }
    authedUserId = session.userId;
  }

  if (!authedUserId) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const { id } = await params;

  const scan = await resolveScanRow(id);
  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  const access = await getScanResourceAccess(authedUserId, scan);
  // anti-enumeration: see the matching comment in PATCH above -- no
  // relationship at all reads as "not found," same as a nonexistent id.
  if (!access.canRead) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }
  if (!access.canWrite) {
    return NextResponse.json(
      { error: "You do not have permission to delete this scan." },
      { status: 403 },
    );
  }

  // Purge the public reputation cache this scan populated BEFORE deleting the
  // scan row -- otherwise the cascade nulls host_reputation.source_scan_id and
  // orphans the findings copy, which keeps serving on the unauthenticated /host
  // and reputation endpoints. Mirrors the private-toggle purge above.
  await pool.query(`DELETE FROM host_reputation WHERE source_scan_id = $1`, [
    scan.id,
  ]);

  const result = await pool.query(
    `DELETE FROM scan_history WHERE id = $1 RETURNING id`,
    [scan.id],
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  // Record API key usage
  if (apiKeyId) {
    await recordUsage(apiKeyId);
  }

  return NextResponse.json({ success: true });
}
