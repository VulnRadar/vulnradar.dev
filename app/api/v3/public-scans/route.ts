import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import {
  CONFIG_PAGINATION_DEFAULT_PAGE_SIZE,
  CONFIG_PAGINATION_MAX_PAGE_SIZE,
} from "@/lib/config/config-values";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import type { Vulnerability } from "@/lib/scanner/types";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp } from "@/lib/api/request-utils";

interface PublicScanRow {
  url: string;
  scanned_at: string;
  share_token: string;
  summary: Record<string, number> | null;
  findings: Vulnerability[] | null;
  findings_count: number;
  scanned_by: string | null;
  scanned_by_avatar: string | null;
  scanned_by_role: string | null;
  tags: { tag: string; source: "auto" | "user" }[];
}

/**
 * GET /api/v3/public-scans
 *
 * Unauthenticated, paginated, most-recent-first directory of scans someone
 * chose to list publicly (app/public-scans/page.tsx). A row appears here
 * only when its share is still live AND its own share_publicly_listed is
 * true -- see lib/scanner/share-privacy.ts's resolveSharePubliclyListed for
 * how that flag gets set, and this route's own WHERE clause below for the
 * exact "still live" definition (the same expiry condition GET
 * /api/v3/shared/[token] uses).
 *
 * Deliberately independent of scan_history.is_public / /host/[hostname]:
 * a scan can be public there and never listed here, or vice versa.
 *
 * Query params: page, limit (defaults/caps shared with every other
 * paginated route in this app, see lib/config/config-values.ts).
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  // Unauthenticated by design -- no session/API-key to fall back on, so
  // per-IP is the only throttle available in front of a paginated query
  // + per-row correlated subquery any anonymous visitor can hit.
  const ip = await getClientIp();
  const rateCheck = await checkRateLimit({
    key: `public-scans:${ip}`,
    ...RATE_LIMITS.publicScans,
  });
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(rateCheck.retryAfterSeconds) },
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const requestedLimit = parseInt(
    searchParams.get("limit") || String(CONFIG_PAGINATION_DEFAULT_PAGE_SIZE),
    10,
  );
  const limit = Math.min(
    CONFIG_PAGINATION_MAX_PAGE_SIZE,
    Math.max(1, requestedLimit || CONFIG_PAGINATION_DEFAULT_PAGE_SIZE),
  );
  const offset = (page - 1) * limit;

  const WHERE = `WHERE sh.share_token IS NOT NULL AND sh.share_publicly_listed = true
     AND (sh.share_expires_at IS NULL OR sh.share_expires_at > NOW())`;

  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM scan_history sh ${WHERE}`,
  );
  const total = parseInt(countRes.rows[0]?.count || "0", 10);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const rowsRes = await pool.query<PublicScanRow>(
    `SELECT sh.url, sh.scanned_at, sh.share_token, sh.summary, sh.findings, sh.findings_count,
            u.name as scanned_by, u.avatar_url as scanned_by_avatar, u.role as scanned_by_role,
            COALESCE(
              (SELECT json_agg(json_build_object('tag', st.tag, 'source', st.source) ORDER BY st.source, st.tag)
               FROM scan_tags st WHERE st.scan_id = sh.id),
              '[]'::json
            ) as tags
     FROM scan_history sh
     JOIN users u ON sh.user_id = u.id
     ${WHERE}
     ORDER BY sh.scanned_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  const scans = rowsRes.rows.map((row) => ({
    token: row.share_token,
    url: row.url,
    scannedAt: row.scanned_at,
    verdict: getSafetyRating(row.findings || []),
    summary: row.summary || {},
    findingsCount: row.findings_count,
    scannedBy: row.scanned_by || "Anonymous",
    scannedByAvatar: row.scanned_by_avatar || null,
    scannedByRole: row.scanned_by_role || "user",
    tags: row.tags || [],
  }));

  return ApiResponse.success({ scans, page, totalPages, total });
});
