import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { allChecks } from "@/lib/scanner/checks"
import type { ScanResult, Severity, Vulnerability } from "@/lib/scanner/types"
import { APP_NAME, DEMO_SCAN_LIMIT, DEMO_SCAN_WINDOW, DEMO_SCAN_COOKIE_NAME, SEVERITY_LEVELS } from "@/lib/constants"

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    // Cookie-based rate limiting
    const cookieStore = await cookies()
    const demoCookie = cookieStore.get(DEMO_SCAN_COOKIE_NAME)

    let scanCount = 0
    let windowStart = Date.now()

    if (demoCookie) {
      try {
        const data = JSON.parse(demoCookie.value)
        const elapsed = (Date.now() - data.windowStart) / 1000
        if (elapsed < DEMO_SCAN_WINDOW) {
          scanCount = data.count
          windowStart = data.windowStart
        }
        // If window expired, reset
      } catch {
        // Invalid cookie, reset
      }
    }

    if (scanCount >= DEMO_SCAN_LIMIT) {
      const elapsed = (Date.now() - windowStart) / 1000
      const remaining = Math.ceil(DEMO_SCAN_WINDOW - elapsed)
      const minutes = Math.ceil(remaining / 60)
      return NextResponse.json(
        { error: `Demo limit reached (${DEMO_SCAN_LIMIT} scans per 15 minutes). Try again in ~${minutes} minute${minutes !== 1 ? "s" : ""}.` },
        { status: 429 },
      )
    }

    const body = await request.json()
    const { url } = body

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 })
    }

    if (!isValidUrl(url)) {
      return NextResponse.json({ error: "Invalid URL." }, { status: 400 })
    }

    const startTime = Date.now()

    let response: Response
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": `${APP_NAME}/1.0 (Security Scanner - Demo)` },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Unknown error"
      return NextResponse.json(
        { error: `Could not reach the target URL: ${message}.` },
        { status: 422 },
      )
    }

    const responseBody = await response.text()
    const headers = response.headers

    // Capture response headers as a plain object for evidence
    const capturedHeaders: Record<string, string> = {}
    headers.forEach((value, key) => {
      capturedHeaders[key] = value
    })

    const findings: Vulnerability[] = []
    for (const check of allChecks) {
      try {
        const result = check(url, headers, responseBody)
        if (result) findings.push(result)
      } catch {
        // Skip failed checks
      }
    }

    findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

    const duration = Date.now() - startTime
    const summary = {
      critical: findings.filter((f) => f.severity === SEVERITY_LEVELS.CRITICAL).length,
      high: findings.filter((f) => f.severity === SEVERITY_LEVELS.HIGH).length,
      medium: findings.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM).length,
      low: findings.filter((f) => f.severity === SEVERITY_LEVELS.LOW).length,
      info: findings.filter((f) => f.severity === SEVERITY_LEVELS.INFO).length,
      total: findings.length,
    }

    const result: ScanResult = {
      url,
      scannedAt: new Date().toISOString(),
      duration,
      findings,
      summary,
      responseHeaders: capturedHeaders,
    }

    // Update the cookie
    const newCount = scanCount + 1
    const cookieValue = JSON.stringify({ count: newCount, windowStart })
    const res = NextResponse.json(result)
    res.cookies.set(DEMO_SCAN_COOKIE_NAME, cookieValue, {
      maxAge: DEMO_SCAN_WINDOW,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    })

    return res
  } catch {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 })
  }
}
