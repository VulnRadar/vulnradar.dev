import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import pool from "@/lib/database/db";
import { withErrorHandling } from "@/lib/api/api-utils";
import { getCachedSubdomainSnapshot } from "@/lib/scanner/subdomain-cache";

export const GET = withErrorHandling(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ token: string }> },
  ) => {
    const { token } = await params;

    if (!token || token.length !== 64) {
      return NextResponse.json(
        { error: "Invalid share link" },
        { status: 400 },
      );
    }

    // Look up by SHA-256 hash so the plaintext token is never compared
    // directly in the DB (AUDIT-004#secrets-01). The hash is stored in
    // the generated column share_token_hash (added in migration 3.1.0).
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // An expired link (share_expires_at in the past) is excluded from the
    // lookup entirely, the same as a revoked one -- never even fetched, let
    // alone returned, so there's no path where an expired link's findings
    // briefly reach the response.
    const result = await pool.query(
      `SELECT sh.url, sh.summary, sh.findings, sh.findings_count, sh.duration, sh.scanned_at, sh.response_headers, sh.notes, sh.user_id, sh.result_meta, sh.authenticated, u.name as scanned_by, u.avatar_url as scanned_by_avatar, u.role as scanned_by_role
     FROM scan_history sh
     JOIN users u ON sh.user_id = u.id
     WHERE sh.share_token_hash = $1
       AND (sh.share_expires_at IS NULL OR sh.share_expires_at > NOW())`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Shared scan not found or link has been revoked" },
        { status: 404 },
      );
    }

    const row = result.rows[0];
    // checksRun, dangerScore, engineConfidence, incomplete and (for crawl
    // scans) crawl all live in here -- same source app/api/v3/history/[id]/route.ts
    // reads it from, kept in parity so a shared scan shows the same detail
    // an owner sees on their own history/dashboard pages.
    const meta = row.result_meta || {};

    // Get user badges and any already-cached subdomain-discovery snapshot
    // for this scan's host in parallel -- independent reads. The cache
    // lookup is read-only and never triggers a new discovery job: an
    // anonymous viewer of a shared link has no session or API key to
    // authenticate POST /api/v3/scan/discover with, and it isn't their
    // scan to spend rate-limit budget on (see
    // components/scanner/subdomain-discovery.tsx's readOnly mode).
    const [badgesResult, subdomainCache] = await Promise.all([
      pool.query(
        `SELECT b.id, b.name, b.display_name, b.icon, b.color, b.priority
       FROM user_badges ub JOIN badges b ON ub.badge_id = b.id
       WHERE ub.user_id = $1 ORDER BY b.priority DESC`,
        [row.user_id],
      ),
      getCachedSubdomainSnapshot(row.url),
    ]);

    return NextResponse.json({
      url: row.url,
      scannedAt: row.scanned_at,
      duration: row.duration,
      summary: row.summary,
      findings: row.findings || [],
      responseHeaders: row.response_headers || undefined,
      notes: row.notes || "",
      authenticated: row.authenticated || false,
      scannedBy: row.scanned_by || "Anonymous",
      scannedByAvatar: row.scanned_by_avatar || null,
      scannedByRole: row.scanned_by_role || "user",
      scannedByBadges: badgesResult.rows,
      subdomainCache,
      ...meta,
    });
  },
);
