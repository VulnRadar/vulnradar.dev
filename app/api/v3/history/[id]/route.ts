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
  getTeamResourceAccess,
  getAssignableTeamIds,
} from "@/lib/auth/team-resource-access";
import { resolveScanRow } from "@/lib/history/resolve-scan";
import { attachRemediation } from "@/lib/scanner/remediation-store";
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
      return NextResponse.json(
        { error: `Rate limit exceeded. Resets at ${rateLimit.resetsAt}` },
        { status: 429 },
      );
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
    const ownedFindings = await attachRemediation(
      authedUserId,
      scan.url,
      (scan.findings || []) as Vulnerability[],
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
      tags,
      ...meta,
    });
  }

  // Team access is scoped to the scan's OWN team_id, not "any shared team".
  // A private personal scan (team_id null) is owner-only even between
  // teammates -- getTeamResourceAccess returns canRead:false for it. The prior
  // "do these two users share any team" self-join leaked a teammate's private
  // personal scans (org-isolation bug, same rule PATCH/DELETE already enforce).
  const access = await getTeamResourceAccess(
    authedUserId,
    scan.user_id,
    scan.team_id,
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
      return NextResponse.json(
        { error: `Rate limit exceeded. Resets at ${rateLimit.resetsAt}` },
        { status: 429 },
      );
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
  const { notes, isPublic, teamId } = body;

  const hasNotes = notes !== undefined;
  const hasIsPublic = isPublic !== undefined;
  const hasTeamId = teamId !== undefined;

  if (!hasNotes && !hasIsPublic && !hasTeamId) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (hasNotes && typeof notes !== "string") {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
  }
  if (hasIsPublic && typeof isPublic !== "boolean") {
    return NextResponse.json({ error: "Invalid isPublic" }, { status: 400 });
  }
  if (hasTeamId && teamId !== null && !Number.isInteger(teamId)) {
    return NextResponse.json({ error: "Invalid teamId" }, { status: 400 });
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
  const access = await getTeamResourceAccess(
    authedUserId,
    scan.user_id,
    scan.team_id,
  );
  if (!access.canRead) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  // team_id (org isolation, AUDIT-010 #273): only the scan's own owner may
  // change which team it's assigned to -- a team member with write access
  // to a team-assigned scan can still edit its notes/visibility, but
  // re-pointing it at a different team is an ownership decision, not a
  // collaboration one.
  if (hasTeamId && authedUserId !== scan.user_id) {
    return NextResponse.json(
      { error: "Only the scan's owner can change its team assignment." },
      { status: 403 },
    );
  }
  if (hasTeamId && teamId !== null) {
    const assignable = await getAssignableTeamIds(authedUserId);
    if (!assignable.includes(teamId)) {
      return NextResponse.json(
        { error: "You cannot assign scans to that team." },
        { status: 400 },
      );
    }
  }

  if ((hasNotes || hasIsPublic) && !access.canWrite) {
    return NextResponse.json(
      { error: "You do not have permission to modify this scan." },
      { status: 403 },
    );
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
  if (hasTeamId) {
    setClauses.push(`team_id = $${values.length + 1}`);
    values.push(teamId);
  }
  values.push(scan.id);

  const result = await pool.query(
    `UPDATE scan_history SET ${setClauses.join(", ")}
     WHERE id = $${values.length}
     RETURNING id, notes, is_public, team_id`,
    values,
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

  return NextResponse.json({
    notes: result.rows[0].notes,
    isPublic: result.rows[0].is_public,
    teamId: result.rows[0].team_id,
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
      return NextResponse.json(
        { error: `Rate limit exceeded. Resets at ${rateLimit.resetsAt}` },
        { status: 429 },
      );
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

  const access = await getTeamResourceAccess(
    authedUserId,
    scan.user_id,
    scan.team_id,
  );
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
