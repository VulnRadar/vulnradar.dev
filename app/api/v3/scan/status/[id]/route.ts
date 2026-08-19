import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES, BEARER_PREFIX } from "@/lib/config/constants";
import { validateApiKey } from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
  type ApiKeyScope,
} from "@/lib/api/api-key-scopes";
import { requestCancel, finalizeScanFailure } from "@/lib/scanner/scan-jobs";
import type { ScanJobStatus, Vulnerability } from "@/lib/scanner/types";
import { attachRemediation } from "@/lib/scanner/remediation-store";

interface ScanHistoryRow {
  id: number;
  public_id: string | null;
  user_id: number;
  url: string;
  status: ScanJobStatus;
  current_category: string | null;
  categories_completed: number;
  categories_total: number;
  started_at: string | null;
  duration: number;
  scanned_at: string;
  summary: Record<string, number> | null;
  findings: unknown[] | null;
  response_headers: Record<string, string> | null;
  result_meta: Record<string, unknown> | null;
  error_message: string | null;
}

/**
 * Shared auth for both handlers below: API key (Bearer token) first, then
 * session cookie. Matches the check `app/api/v3/scan/route.ts` and
 * `app/api/v3/history/[id]/route.ts` already use.
 *
 * Deliberately does NOT run the API key through checkRateLimit: that
 * function both checks AND atomically consumes a unit of the daily quota
 * (see lib/api/api-keys.ts) -- correct for POST /scan and POST
 * /scan/crawl, which each represent one scan the user asked for, but
 * wrong here. A client polls this endpoint repeatedly (every few seconds,
 * for up to the crawl timeout) to watch ONE scan it already paid quota
 * for at start time; charging quota again on every poll could exhaust a
 * key's entire daily limit on status checks alone before a single deep
 * scan finishes. Checking in on a scan you already started should never
 * be blocked by the daily cap either way -- the scan keeps running
 * server-side regardless of whether the client can currently afford to
 * ask about it.
 */
async function authenticate(request: NextRequest): Promise<
  | {
      ok: true;
      userId: number;
      apiKeyId: number | null;
      // null for session auth (the account owner, unscoped); a concrete
      // array for API-key auth, checked by each handler against the scope
      // its own method needs.
      keyScopes: ApiKeyScope[] | null;
    }
  | { ok: false; response: NextResponse }
> {
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(7);
    const keyData = await validateApiKey(token);
    if (!keyData) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Invalid or revoked API key." },
          { status: 401 },
        ),
      };
    }
    if (keyData.needsTermsAcceptance) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error:
              "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.",
          },
          { status: 403 },
        ),
      };
    }
    return {
      ok: true,
      userId: keyData.userId,
      apiKeyId: keyData.keyId,
      keyScopes: keyData.scopes,
    };
  }

  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: ERROR_MESSAGES.UNAUTHORIZED },
        { status: 401 },
      ),
    };
  }
  return { ok: true, userId: session.userId, apiKeyId: null, keyScopes: null };
}

/** 403 (with a message naming the missing scope) if this is API-key auth
 * and the key lacks `required`; null (proceed) otherwise. */
function scopeCheck(
  keyScopes: ApiKeyScope[] | null,
  required: ApiKeyScope,
): NextResponse | null {
  if (keyScopes === null) return null; // session auth: not scope-limited
  if (hasApiKeyScope(keyScopes, required)) return null;
  return NextResponse.json(
    { error: apiKeyScopeErrorMessage(required) },
    { status: 403 },
  );
}

/** Fetch the scan row, scoped to its owner. Returns null if missing or not owned. */
async function getOwnedScan(
  id: string,
  userId: number,
): Promise<ScanHistoryRow | null> {
  const result = await pool.query<ScanHistoryRow>(
    `SELECT id, public_id, user_id, url, status, current_category,
            categories_completed, categories_total, started_at, duration,
            scanned_at, summary, findings, response_headers, result_meta,
            error_message
     FROM scan_history
     WHERE id = $1`,
    [id],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (row.user_id !== userId) return null;
  return row;
}

function elapsedMsFor(row: ScanHistoryRow): number {
  if (row.status === "completed" || row.status === "failed") {
    return row.duration ?? 0;
  }
  if (!row.started_at) return 0;
  return Math.max(0, Date.now() - new Date(row.started_at).getTime());
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  const scopeError = scopeCheck(auth.keyScopes, API_KEY_SCOPES.SCAN_READ);
  if (scopeError) return scopeError;

  const { id } = await params;
  const row = await getOwnedScan(id, auth.userId);
  if (!row) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  const responseBody: Record<string, unknown> = {
    status: row.status,
    currentCategory: row.current_category,
    categoriesCompleted: row.categories_completed,
    categoriesTotal: row.categories_total,
    elapsedMs: elapsedMsFor(row),
  };

  if (row.status === "completed") {
    const meta = row.result_meta ?? {};
    // Tags (lib/tags/auto-tags.ts's saveAutoTags, awaited by
    // finalizeScanSuccess before it flips status to 'completed') are only
    // worth a query once there's a result to attach them to -- not on every
    // poll tick while the scan is still pending/running.
    const tagsResult = await pool.query(
      "SELECT tag, source FROM scan_tags WHERE scan_id = $1 AND user_id = $2 ORDER BY source, tag",
      [row.id, row.user_id],
    );
    // Cross-rescan remediation: getOwnedScan already scoped this to the
    // owner, so attach their current per-finding status by stable
    // finding_id -- a finding marked "fixed" on an earlier scan of this
    // target shows as "fixed" on this freshly completed one too.
    const findingsWithRemediation = await attachRemediation(
      row.user_id,
      row.url,
      (row.findings ?? []) as Vulnerability[],
    );
    responseBody.result = {
      url: row.url,
      scannedAt: row.scanned_at,
      duration: row.duration,
      findings: findingsWithRemediation,
      summary: row.summary ?? {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
        total: 0,
      },
      responseHeaders: row.response_headers ?? undefined,
      scanHistoryId: row.id,
      // Opaque id for the URL (?scan=), so a finished scan shows the same
      // non-enumerable token as History rather than the sequential row id.
      // scanHistoryId stays numeric for the feedback route that needs it.
      scanPublicId: row.public_id,
      tags: tagsResult.rows,
      ...meta,
    };
  } else if (row.status === "failed") {
    responseBody.error = row.error_message ?? "The scan failed.";
  }

  return NextResponse.json(responseBody);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  // scoping: cancelling a running scan is scan-execution control, not a
  // read and not a destructive delete of stored history -- scan:write.
  const scopeError = scopeCheck(auth.keyScopes, API_KEY_SCOPES.SCAN_WRITE);
  if (scopeError) return scopeError;

  const { id } = await params;
  const row = await getOwnedScan(id, auth.userId);
  if (!row) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  if (row.status !== "pending" && row.status !== "running") {
    return NextResponse.json(
      { error: "This scan has already finished; there is nothing to cancel." },
      { status: 409 },
    );
  }

  // requestCancel flags the in-memory registry so the background job's
  // next progress event aborts on its own; finalizeScanFailure writes the
  // terminal state immediately rather than waiting for that to happen,
  // since the job may be mid-fetch and not due to check in for seconds.
  // Its own guard means this is a no-op if the scan reached a terminal
  // state in the moment between the SELECT above and this UPDATE.
  requestCancel(row.id);
  const applied = await finalizeScanFailure(row.id, "Cancelled");

  if (!applied) {
    return NextResponse.json(
      { error: "This scan finished just before it could be cancelled." },
      { status: 409 },
    );
  }

  return NextResponse.json({ status: "failed", cancelled: true });
}
