import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import pool from "@/lib/database/db";
import { withErrorHandling } from "@/lib/api/api-utils";

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

    const result = await pool.query(
      `SELECT sh.url, sh.summary, sh.findings, sh.findings_count, sh.duration, sh.scanned_at, sh.response_headers, sh.notes, sh.user_id, u.name as scanned_by, u.avatar_url as scanned_by_avatar, u.role as scanned_by_role
     FROM scan_history sh
     JOIN users u ON sh.user_id = u.id
     WHERE sh.share_token_hash = $1`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Shared scan not found or link has been revoked" },
        { status: 404 },
      );
    }

    const row = result.rows[0];

    // Get user badges
    const badgesResult = await pool.query(
      `SELECT b.id, b.name, b.display_name, b.icon, b.color, b.priority
     FROM user_badges ub JOIN badges b ON ub.badge_id = b.id
     WHERE ub.user_id = $1 ORDER BY b.priority DESC`,
      [row.user_id],
    );

    return NextResponse.json({
      url: row.url,
      scannedAt: row.scanned_at,
      duration: row.duration,
      summary: row.summary,
      findings: row.findings || [],
      responseHeaders: row.response_headers || undefined,
      notes: row.notes || "",
      scannedBy: row.scanned_by || "Anonymous",
      scannedByAvatar: row.scanned_by_avatar || null,
      scannedByRole: row.scanned_by_role || "user",
      scannedByBadges: badgesResult.rows,
    });
  },
);
