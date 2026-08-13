import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import pool from "@/lib/database/db";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { APP_NAME } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!token || token.length !== 64) {
    return new NextResponse(
      makeBadgeSvg("invalid", "Invalid Link", "#6b7280"),
      {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-cache",
        },
      },
    );
  }

  // Look up by SHA-256 hash so the plaintext token is never compared
  // directly in the DB (AUDIT-004#secrets-01). Excludes an expired link
  // the same way app/api/v3/shared/[token]/route.ts does -- without this,
  // the badge image would keep rendering current findings for a link the
  // owner intentionally let lapse, defeating the point of expiry.
  const tokenHash = createHash("sha256").update(token).digest("hex");

  let result = await pool.query(
    `SELECT sh.url, sh.summary, sh.findings, sh.scanned_at
     FROM scan_history sh
     WHERE sh.share_token_hash = $1
       AND (sh.share_expires_at IS NULL OR sh.share_expires_at > NOW())`,
    [tokenHash],
  );

  // Not a per-scan snapshot token -- try the auto-updating host_badges
  // token instead. Unlike the lookup above (pinned to one scan_history
  // row forever), this always resolves to whichever scan of that
  // (user_id, url) ran most recently BY DATE, not the best-ever result,
  // so the same embedded badge keeps reflecting reality without the owner
  // ever having to regenerate or swap the embed code.
  if (result.rows.length === 0) {
    result = await pool.query(
      `SELECT sh.url, sh.summary, sh.findings, sh.scanned_at
       FROM host_badges hb
       JOIN scan_history sh
         ON sh.user_id = hb.user_id AND sh.url = hb.url
       WHERE hb.badge_token_hash = $1
         AND hb.revoked_at IS NULL
         AND sh.status = 'completed'
       ORDER BY sh.scanned_at DESC
       LIMIT 1`,
      [tokenHash],
    );
  }

  if (result.rows.length === 0) {
    return new NextResponse(
      makeBadgeSvg("expired", "Link Expired", "#6b7280"),
      {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-cache",
        },
      },
    );
  }

  const row = result.rows[0];
  const findings =
    typeof row.findings === "string"
      ? JSON.parse(row.findings)
      : row.findings || [];

  const safetyRating = getSafetyRating(findings);

  const ratingConfig = {
    safe: { label: "Safe", color: "#22c55e" },
    caution: { label: "Caution", color: "#eab308" },
    unsafe: { label: "Unsafe", color: "#ef4444" },
  };

  const { label: rating, color } = ratingConfig[safetyRating];

  const scanDate = new Date(row.scanned_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const svg = makeBadgeSvg(
    rating.toLowerCase(),
    `${rating} - ${scanDate}`,
    color,
  );

  const cacheMaxAge = await getSetting("BADGE_CACHE_MAX_AGE_SECONDS");
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": `public, max-age=${cacheMaxAge}, s-maxage=${cacheMaxAge}`,
    },
  });
}

function makeBadgeSvg(
  status: string,
  rightText: string,
  color: string,
): string {
  const leftText = `Secured by ${APP_NAME}`;
  const leftWidth = leftText.length * 6.5 + 20;
  const rightWidth = rightText.length * 6.2 + 20;
  const totalWidth = leftWidth + rightWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="24" role="img" aria-label="${escapeXml(leftText)}: ${escapeXml(rightText)}">
  <title>${escapeXml(leftText)}: ${escapeXml(rightText)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".15"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="24" rx="6" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="24" fill="#1a1a2e"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="24" fill="${color}"/>
    <rect width="${totalWidth}" height="24" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${leftWidth / 2}" y="16" fill="#fff">${escapeXml(leftText)}</text>
    <text x="${leftWidth + rightWidth / 2}" y="16" fill="#fff" font-weight="bold">${escapeXml(rightText)}</text>
  </g>
</svg>`;
}
