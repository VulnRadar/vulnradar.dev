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

  // First, get the scan and its owner
  const scanResult = await pool.query(
    `SELECT id, url, summary, findings, findings_count, duration, scanned_at, user_id, response_headers, notes, result_meta, authenticated, is_public
     FROM scan_history
     WHERE id = $1`,
    [id],
  );

  if (scanResult.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  const scan = scanResult.rows[0];
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
    [id, scan.user_id],
  );
  const tags = tagsResult.rows;

  // Allow if it's the user's own scan
  if (scan.user_id === authedUserId) {
    // Record API key usage
    if (apiKeyId) {
      await recordUsage(apiKeyId);
    }

    return NextResponse.json({
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

  // Check if both users are members of the same team
  const teamCheck = await pool.query(
    `SELECT COUNT(*) as team_count
     FROM team_members tm1
     JOIN team_members tm2 ON tm1.team_id = tm2.team_id
     WHERE tm1.user_id = $1 AND tm2.user_id = $2`,
    [authedUserId, scan.user_id],
  );

  if (teamCheck.rows[0].team_count > 0) {
    // Record API key usage
    if (apiKeyId) {
      await recordUsage(apiKeyId);
    }

    // They're on the same team, allow access but don't show delete option
    return NextResponse.json({
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
  const { notes, isPublic } = body;

  const hasNotes = notes !== undefined;
  const hasIsPublic = isPublic !== undefined;

  if (!hasNotes && !hasIsPublic) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (hasNotes && typeof notes !== "string") {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
  }
  if (hasIsPublic && typeof isPublic !== "boolean") {
    return NextResponse.json({ error: "Invalid isPublic" }, { status: 400 });
  }

  // Only allow the scan owner to update. Built dynamically so a
  // notes-only or isPublic-only PATCH (the toggle in
  // components/scanner/scan-actions-menu.tsx never sends notes) doesn't
  // have to send the field it isn't changing.
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
  values.push(id, authedUserId);

  const result = await pool.query(
    `UPDATE scan_history SET ${setClauses.join(", ")}
     WHERE id = $${values.length - 1} AND user_id = $${values.length}
     RETURNING id, notes, is_public`,
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
      id,
    ]);
  }

  // Record API key usage
  if (apiKeyId) {
    await recordUsage(apiKeyId);
  }

  return NextResponse.json({
    notes: result.rows[0].notes,
    isPublic: result.rows[0].is_public,
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

  // Only allow the scan owner to delete
  const result = await pool.query(
    `DELETE FROM scan_history WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, authedUserId],
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
