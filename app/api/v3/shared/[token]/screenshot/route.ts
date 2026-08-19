import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import pool from "@/lib/database/db";
import { readScanScreenshot } from "@/lib/scanner/page-screenshot";

/**
 * GET /api/v3/shared/[token]/screenshot
 *
 * Serves the opt-in page screenshot bytes for a scan reached through a share
 * link, so the shared report page (app/shared/[token]/page.tsx) can render
 * the screenshot right where it already renders that scan's findings.
 *
 * The token is resolved to a scan id exactly the way the shared DATA route
 * (app/api/v3/shared/[token]/route.ts) resolves it -- the per-scan snapshot
 * token first, then the auto-updating host_badges token (owner's own scans,
 * or a `global` badge pointing at a public scan). The screenshot is therefore
 * visible only where the token already exposes the scan's findings; there is
 * no additional exposure. A private-but-shared scan's screenshot loads here
 * (unlike the public /scan/screenshot route, which gates on is_public),
 * because holding the share token is already proof of access to this scan.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length !== 64) {
    return NextResponse.json({ error: "Invalid share link" }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  // Per-scan share token first (matches the data route's primary lookup:
  // an expired link is excluded, never served).
  let result = await pool.query<{ id: number }>(
    `SELECT sh.id
     FROM scan_history sh
     WHERE sh.share_token_hash = $1
       AND (sh.share_expires_at IS NULL OR sh.share_expires_at > NOW())
     LIMIT 1`,
    [tokenHash],
  );

  // Auto-updating host_badges token fallback, same gate as the data route:
  // the badge owner's own scans always match; a `global` badge additionally
  // resolves to another user's scan only when that scan is public.
  if (result.rows.length === 0) {
    result = await pool.query<{ id: number }>(
      `SELECT sh.id
       FROM host_badges hb
       JOIN scan_history sh ON sh.url = hb.url
         AND (sh.user_id = hb.user_id OR (hb.scope = 'global' AND sh.is_public = true))
       WHERE hb.badge_token_hash = $1
         AND hb.revoked_at IS NULL
         AND sh.status = 'completed'
       ORDER BY sh.scanned_at DESC
       LIMIT 1`,
      [tokenHash],
    );
  }

  const scanId = result.rows[0]?.id;
  if (!scanId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const shot = await readScanScreenshot(scanId);
  if (!shot) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(shot.data, {
    headers: {
      "Content-Type": shot.contentType,
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
