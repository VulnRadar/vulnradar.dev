import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/db"
import { checkRateLimit, getClientIP } from "@/lib/rate-limit"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
) {
  // Rate limit: 30 requests per minute per IP
  const ip = await getClientIP()
  const rl = await checkRateLimit({ key: `status:${ip}`, maxRequests: 30, windowSeconds: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 })
  }

  const { domain } = await params
  const decodedDomain = decodeURIComponent(domain).toLowerCase().trim()

  // Validate domain format
  if (!decodedDomain || decodedDomain.length > 253 || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(decodedDomain)) {
    return NextResponse.json({ error: "Invalid domain" }, { status: 400 })
  }

  // Get the most recent shared scans for this domain (public data only -- must have share_token)
  // This ensures only scans the user chose to make public are visible
  const result = await pool.query(
    `SELECT 
       id,
       url,
       summary,
       findings_count,
       duration,
       scanned_at
     FROM scan_history
     WHERE share_token IS NOT NULL
       AND (
         url LIKE $1
         OR url LIKE $2
         OR url LIKE $3
         OR url LIKE $4
       )
     ORDER BY scanned_at DESC
     LIMIT 20`,
    [
      `https://${decodedDomain}%`,
      `http://${decodedDomain}%`,
      `https://www.${decodedDomain}%`,
      `http://www.${decodedDomain}%`,
    ],
  )

  const scans = result.rows.map((row) => ({
    id: row.id,
    url: row.url,
    summary: row.summary,
    findingsCount: row.findings_count,
    duration: row.duration,
    scannedAt: row.scanned_at,
  }))

  return NextResponse.json({
    domain: decodedDomain,
    scans,
    totalScans: scans.length,
  })
}
