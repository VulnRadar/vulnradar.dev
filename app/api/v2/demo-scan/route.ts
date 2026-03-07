import { NextRequest, NextResponse } from "next/server"
import { allChecks } from "@/lib/scanner/checks"
import { runAsyncChecks } from "@/lib/scanner/async-checks"
import type { ScanResult, Severity, Vulnerability } from "@/lib/scanner/types"
import { APP_NAME, DEMO_SCAN_LIMIT, DEMO_SCAN_WINDOW, SEVERITY_LEVELS } from "@/lib/constants"
import { checkRateLimit } from "@/lib/rate-limit"
import { getClientIp } from "@/lib/request-utils"

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

const MAX_BODY_SIZE = 1 * 1024 * 1024 // 1 MB

function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

async function safeReadBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder("utf-8", { fatal: false })
  const chunks: string[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        const overshoot = totalBytes - maxBytes
        const trimmed = value.slice(0, value.byteLength - overshoot)
        if (trimmed.byteLength > 0) chunks.push(decoder.decode(trimmed, { stream: false }))
        break
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
  } catch { /* return what we have */ } finally {
    try { reader.cancel() } catch { /* ignore */ }
  }
  return chunks.join("")
}

export async function POST(request: NextRequest) {
  try {
    // IP-based rate limiting via database
    const ip = await getClientIp()
    const rateLimitKey = `demo_scan:${ip}`
    const rateCheck = await checkRateLimit({
      key: rateLimitKey,
      maxAttempts: DEMO_SCAN_LIMIT,
      windowSeconds: DEMO_SCAN_WINDOW,
    })

    if (!rateCheck.allowed) {
      const hours = Math.ceil(rateCheck.retryAfterSeconds / 3600)
      return NextResponse.json(
        {
          error: `Demo limit reached (${DEMO_SCAN_LIMIT} scans per 12 hours). Try again in ~${hours} hour${hours !== 1 ? "s" : ""}, or create a free account for unlimited scans.`,
          remaining: 0,
          limit: DEMO_SCAN_LIMIT,
        },
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

    const responseBody = await safeReadBody(response, MAX_BODY_SIZE)
    const headers = response.headers

    // Capture response headers as a plain object for evidence
    const capturedHeaders: Record<string, string> = {}
    headers.forEach((value, key) => {
      capturedHeaders[key] = value
    })

    const bodyForChecks = responseBody.length > 1_000_000 ? responseBody.slice(0, 1_000_000) : responseBody
    const syncFindings: Vulnerability[] = []
    for (const check of allChecks) {
      try {
        const result = check(url, headers, bodyForChecks)
        if (result) syncFindings.push(result)
      } catch {
        // Skip failed checks
      }
    }

    let asyncFindings: Vulnerability[] = []
    try {
      const asyncPromise = runAsyncChecks(url)
      const timeoutPromise = new Promise<Vulnerability[]>((resolve) => setTimeout(() => resolve([]), 15000))
      asyncFindings = await Promise.race([asyncPromise, timeoutPromise])
    } catch {
      // Non-fatal
    }

    const findings = [...syncFindings, ...asyncFindings]
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

    return NextResponse.json({
      ...result,
      remaining: rateCheck.remaining,
      limit: DEMO_SCAN_LIMIT,
    })
  } catch {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 })
  }
}
