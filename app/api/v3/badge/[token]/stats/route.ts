import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import pool from "@/lib/database/db";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { getSetting } from "@/lib/config/runtime-config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!token || token.length !== 64) {
    return NextResponse.json({ error: "Invalid share token" }, { status: 400 });
  }

  // Look up by SHA-256 hash, same as every sibling badge/share route --
  // this one used to compare the plaintext token directly, the one route
  // in this family that never got the AUDIT-004#secrets-01 treatment
  // (AUDIT-010#security-04).
  const tokenHash = createHash("sha256").update(token).digest("hex");

  // Excludes an expired link the same way app/api/v3/shared/[token]/route.ts
  // and app/api/v3/badge/[token]/route.ts do -- otherwise this sibling
  // endpoint would keep serving stats for a link the owner let lapse.
  let result = await pool.query(
    `SELECT sh.url, sh.findings, sh.findings_count, sh.scanned_at
     FROM scan_history sh
     WHERE sh.share_token_hash = $1
       AND (sh.share_expires_at IS NULL OR sh.share_expires_at > NOW())`,
    [tokenHash],
  );

  // Not a per-scan snapshot token -- try the auto-updating host_badges
  // token, same fallback (and the same sh.is_public gate on a foreign
  // scan under 'global' scope) as app/api/v3/badge/[token]/route.ts and
  // app/api/v3/shared/[token]/route.ts. This used to 404 unconditionally
  // for a host_badges token (AUDIT-010#security-04).
  if (result.rows.length === 0) {
    result = await pool.query(
      `SELECT sh.url, sh.findings, sh.findings_count, sh.scanned_at
       FROM host_badges hb
       JOIN scan_history sh
         ON sh.url = hb.url
         AND (sh.user_id = hb.user_id OR (hb.scope = 'global' AND sh.is_public = true))
       WHERE hb.badge_token_hash = $1
         AND hb.revoked_at IS NULL
         AND sh.status = 'completed'
       ORDER BY sh.scanned_at DESC
       LIMIT 1`,
      [tokenHash],
    );
  }

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = result.rows[0];
  const findings =
    typeof row.findings === "string"
      ? JSON.parse(row.findings)
      : row.findings || [];
  const safetyRating = getSafetyRating(findings);

  const origin = request.nextUrl.origin;
  const cacheMaxAge = await getSetting("BADGE_CACHE_MAX_AGE_SECONDS");

  return NextResponse.json(
    {
      safetyRating,
      issuesCount: row.findings_count,
      lastScanned: row.scanned_at,
      url: row.url,
      shareUrl: `${origin}/shared/${token}`,
      badgeUrl: `${origin}/api/v3/badge/${token}`,
    },
    {
      headers: {
        "Cache-Control": `public, max-age=${cacheMaxAge}`,
      },
    },
  );
}
