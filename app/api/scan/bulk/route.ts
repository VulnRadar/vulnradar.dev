import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { ERROR_MESSAGES } from "@/lib/constants"

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })

  const rl = await checkRateLimit({ key: `bulkscan:${session.userId}`, ...RATE_LIMITS.bulkScan })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Bulk scan rate limit reached. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
      { status: 429 },
    )
  }

  const { urls } = await request.json()

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: "Provide an array of URLs." }, { status: 400 })
  }

  if (urls.length > 10) {
    return NextResponse.json({ error: "Maximum 10 URLs per bulk scan." }, { status: 400 })
  }

  // Validate all URLs first
  const validUrls: string[] = []
  for (const u of urls) {
    try {
      const parsed = new URL(u)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        validUrls.push(u)
      }
    } catch {
      // Skip invalid URLs
    }
  }

  if (validUrls.length === 0) {
    return NextResponse.json({ error: "No valid URLs provided." }, { status: 400 })
  }

  // Get the origin for internal scan API calls
  const origin = request.headers.get("origin") || request.nextUrl.origin

  // Run scans sequentially to avoid overwhelming the server
  const results: Array<{ url: string; success: boolean; scanHistoryId?: number; error?: string }> = []

  for (const scanUrl of validUrls) {
    try {
      const scanRes = await fetch(`${origin}/api/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: request.headers.get("cookie") || "",
        },
        body: JSON.stringify({ url: scanUrl }),
      })

      if (scanRes.ok) {
        const data = await scanRes.json()
        results.push({ url: scanUrl, success: true, scanHistoryId: data.scanHistoryId })
      } else {
        const err = await scanRes.json().catch(() => ({ error: "Scan failed" }))
        results.push({ url: scanUrl, success: false, error: err.error })
      }
    } catch {
      results.push({ url: scanUrl, success: false, error: "Request failed" })
    }
  }

  return NextResponse.json({
    total: validUrls.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  })
}
