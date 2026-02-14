import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/db"

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  if (!token || token.length !== 64) {
    return new NextResponse(makeBadgeSvg("invalid", "Invalid Link", "#6b7280"), {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" },
    })
  }

  const result = await pool.query(
    `SELECT sh.url, sh.summary, sh.findings_count, sh.scanned_at
     FROM scan_history sh
     WHERE sh.share_token = $1`,
    [token],
  )

  if (result.rows.length === 0) {
    return new NextResponse(makeBadgeSvg("expired", "Link Expired", "#6b7280"), {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" },
    })
  }

  const row = result.rows[0]
  const summary = typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary
  const critical = summary?.critical || 0
  const high = summary?.high || 0

  let rating: string
  let color: string

  if (critical > 0 || high >= 2) {
    rating = "Unsafe"
    color = "#ef4444"
  } else if (high === 1 || (summary?.medium || 0) >= 3) {
    rating = "Caution"
    color = "#eab308"
  } else {
    rating = "Safe"
    color = "#22c55e"
  }

  const scanDate = new Date(row.scanned_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

  const svg = makeBadgeSvg(rating.toLowerCase(), `${rating} - ${scanDate}`, color)

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  })
}

function makeBadgeSvg(status: string, rightText: string, color: string): string {
  const leftText = "Secured by VulnRadar"
  const leftWidth = leftText.length * 6.5 + 20
  const rightWidth = rightText.length * 6.2 + 20
  const totalWidth = leftWidth + rightWidth

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
</svg>`
}
