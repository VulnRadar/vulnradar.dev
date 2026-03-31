import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit"
import { canMakeRequest, incrementDailyCount, getRateLimitHeaders } from "@/lib/rate-limiting/daily-limits"
import { validateApiKey, checkRateLimit as checkApiKeyRateLimit, recordUsage } from "@/lib/api/api-keys"
import { allChecks } from "@/lib/scanner/checks"
import { runAsyncChecks } from "@/lib/scanner/async-checks"
import pool from "@/lib/database/db"
import { ERROR_MESSAGES, APP_NAME, SEVERITY_LEVELS, BEARER_PREFIX } from "@/lib/config/constants"
import type { Vulnerability, Severity } from "@/lib/scanner/types"
import { getProtocolFromUrl } from "@/lib/scanner/protocols"
import { runWebSocketChecks } from "@/lib/scanner/protocols/websocket"
import { runFtpChecks } from "@/lib/scanner/protocols/ftp"
import { validateScanTarget } from "@/lib/scanner/safe-fetch"
import { checkAccessRules } from "@/lib/scanner/access-rules"

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const SUPPORTED_PROTOCOLS = ["http:", "https:", "ws:", "wss:", "ftp:", "ftps:"]
const MAX_BODY_SIZE = 1 * 1024 * 1024

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
  } catch { /* return partial */ } finally {
    try { reader.cancel() } catch { /* ignore */ }
  }
  return chunks.join("")
}

function getProtocolType(url: string): "http" | "websocket" | "ftp" {
  const protocol = getProtocolFromUrl(url)
  if (protocol === "ws" || protocol === "wss") return "websocket"
  if (protocol === "ftp" || protocol === "ftps") return "ftp"
  return "http"
}

async function runSingleScan(url: string, userId: number, isApiKeyAuth: boolean) {
  const startTime = Date.now()
  
  // SSRF protection - validate target is not internal/private
  const safetyCheck = await validateScanTarget(url)
  if (!safetyCheck.safe) {
    return { url, success: false, error: safetyCheck.reason || "URL blocked for security reasons" }
  }

  // Check access rules (blacklist/whitelist)
  const accessCheck = await checkAccessRules(url)
  if (!accessCheck.allowed) {
    return { url, success: false, error: accessCheck.reason || "This URL has been blocked by access rules." }
  }
  
  const protocolType = getProtocolType(url)

  let response: Response | null = null
  let responseBody = ""
  let headers = new Headers()
  let capturedHeaders: Record<string, string> = {}
  const protocolSpecificFindings: Vulnerability[] = []

  // Handle different protocol types
  if (protocolType === "websocket") {
    // For WebSocket URLs, convert to HTTP(S) for initial check
    const httpUrl = url.replace(/^wss?:\/\//, (m) => m.startsWith("wss") ? "https://" : "http://")
    try {
      response = await fetch(httpUrl, {
        method: "GET",
        headers: { "User-Agent": `${APP_NAME}/1.0 (Security Scanner)` },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
      responseBody = await safeReadBody(response, MAX_BODY_SIZE)
      headers = response.headers
      headers.forEach((v, k) => { capturedHeaders[k] = v })
    } catch {
      // WebSocket endpoint may not respond to HTTP - that's ok
    }
    // Add WebSocket-specific security checks
    protocolSpecificFindings.push(...runWebSocketChecks(url, headers))
  } else if (protocolType === "ftp") {
    // FTP protocol checks - limited to protocol-level security
    protocolSpecificFindings.push(...runFtpChecks(url))
  } else {
    // Standard HTTP/HTTPS fetch
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": `${APP_NAME}/1.0 (Security Scanner)` },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error"
      return { url, success: false, error: `Could not reach: ${msg}` }
    }

    responseBody = await safeReadBody(response, MAX_BODY_SIZE)
    headers = response.headers
    headers.forEach((v, k) => { capturedHeaders[k] = v })
  }

  // Sync checks (only run on HTTP-like protocols)
  const bodyForChecks = responseBody.length > 1_000_000 ? responseBody.slice(0, 1_000_000) : responseBody
  const syncFindings: Vulnerability[] = []
  if (protocolType === "http" || protocolType === "websocket") {
    for (const check of allChecks) {
      try {
        const r = check(url, headers, bodyForChecks)
        if (r) syncFindings.push(r)
      } catch { /* skip */ }
    }
  }

  // Async checks (only run on HTTP)
  let asyncFindings: Vulnerability[] = []
  if (protocolType === "http") {
    try {
      asyncFindings = await Promise.race([
        runAsyncChecks(url),
        new Promise<Vulnerability[]>((resolve) => setTimeout(() => resolve([]), 15000)),
      ])
    } catch { /* non-fatal */ }
  }

  const findings = [...protocolSpecificFindings, ...syncFindings, ...asyncFindings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )

  const duration = Date.now() - startTime
  const summary = {
    critical: findings.filter((f) => f.severity === SEVERITY_LEVELS.CRITICAL).length,
    high: findings.filter((f) => f.severity === SEVERITY_LEVELS.HIGH).length,
    medium: findings.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM).length,
    low: findings.filter((f) => f.severity === SEVERITY_LEVELS.LOW).length,
    info: findings.filter((f) => f.severity === SEVERITY_LEVELS.INFO).length,
    total: findings.length,
  }

  // Save to history
  let scanHistoryId: number | null = null
  try {
    const { DEFAULT_SCAN_NOTE } = await import("@/lib/constants")
    const insertResult = await pool.query(
      `INSERT INTO scan_history (user_id, url, summary, findings, findings_count, duration, scanned_at, source, response_headers, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      // source must be either 'api' or 'web'
      [userId, url, JSON.stringify(summary), JSON.stringify(findings), summary.total, duration, new Date().toISOString(), isApiKeyAuth ? "api" : "web", JSON.stringify(capturedHeaders), DEFAULT_SCAN_NOTE],
    )
    scanHistoryId = insertResult.rows[0]?.id || null
  } catch (err) {
    console.error("[VulnRadar] Failed to save bulk scan history:", err instanceof Error ? err.message : err)
  }

  return { url, success: true, scanHistoryId, summary, findings_count: summary.total, duration }
}

export async function POST(request: NextRequest) {
  // Auth: check API key first (Bearer token), then fall back to session cookie
  const authHeader = request.headers.get("authorization")
  let apiKeyId: number | null = null
  let isApiKeyAuth = false
  let authedUserId: number | null = null

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(7)
    const keyData = await validateApiKey(token)

    if (!keyData) {
      return NextResponse.json(
        { error: "Invalid or revoked API key." },
        { status: 401 },
      )
    }

    // Check if user needs to accept updated terms
    if (keyData.needsTermsAcceptance) {
      return NextResponse.json(
        { error: "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API." },
        { status: 403 },
      )
    }

    // Check API key rate limit
    const rateLimit = await checkApiKeyRateLimit(keyData.keyId, keyData.dailyLimit)

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded. 50 requests per 24 hours.",
          limit: rateLimit.limit,
          used: rateLimit.used,
          remaining: rateLimit.remaining,
          resets_at: rateLimit.resetsAt,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(rateLimit.limit),
            "X-RateLimit-Remaining": String(rateLimit.remaining),
            "X-RateLimit-Reset": rateLimit.resetsAt,
            "Retry-After": String(
              Math.ceil(
                (new Date(rateLimit.resetsAt).getTime() - Date.now()) / 1000,
              ),
            ),
          },
        },
      )
    }

    apiKeyId = keyData.keyId
    isApiKeyAuth = true
    authedUserId = keyData.userId
  } else {
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized. Provide an API key via Authorization: Bearer <key> header, or sign in." },
        { status: 401 },
      )
    }
    authedUserId = session.userId

    const rl = await checkRateLimit({ key: `bulkscan:${session.userId}`, ...RATE_LIMITS.bulkScan })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Bulk scan rate limit reached. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429 },
      )
    }
  }

  const { urls } = await request.json()

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: "Provide an array of URLs." }, { status: 400 })
  }
  if (urls.length > 10) {
    return NextResponse.json({ error: "Maximum 10 URLs per bulk scan." }, { status: 400 })
  }

  const validUrls: string[] = []
  for (const u of urls) {
    try {
      const parsed = new URL(u)
      if (SUPPORTED_PROTOCOLS.includes(parsed.protocol)) validUrls.push(u)
    } catch { /* skip */ }
  }

  if (validUrls.length === 0) {
    return NextResponse.json({ error: "No valid URLs provided." }, { status: 400 })
  }

  // Check daily quota: each URL in the bulk scan counts as 1 scan (skip for API key auth)
  const quotaCheck = isApiKeyAuth
    ? { allowed: true, limit: -1, used: 0, remaining: validUrls.length, resetsAt: "" }
    : await canMakeRequest(authedUserId!)
  if (!quotaCheck.allowed) {
    return NextResponse.json(
      { error: "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset." },
      { status: 429, headers: getRateLimitHeaders(quotaCheck) },
    )
  }

  // How many URLs can we actually run given remaining quota?
  const remaining = quotaCheck.limit === -1 ? validUrls.length : Math.min(validUrls.length, quotaCheck.remaining)
  const urlsToScan = validUrls.slice(0, remaining)
  const skipped = validUrls.length - urlsToScan.length

  // Run scans sequentially to avoid overwhelming resources
  const results: Array<{ url: string; success: boolean; scanHistoryId?: number | null; error?: string; summary?: any; findings_count?: number; duration?: number }> = []

  for (const scanUrl of urlsToScan) {
    // Increment daily count before each scan (skip for API key auth)
    if (!isApiKeyAuth) {
      await incrementDailyCount(authedUserId!)
    }
    const scanResult = await runSingleScan(scanUrl, authedUserId!, isApiKeyAuth)
    results.push(scanResult)
  }

  // Add skipped URLs as quota-exceeded entries
  for (const scanUrl of validUrls.slice(remaining)) {
    results.push({ url: scanUrl, success: false, error: "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset." })
  }

  const responseData = {
    total: validUrls.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    skipped,
    results,
  }

  // Record API key usage and add rate limit headers
  if (isApiKeyAuth && apiKeyId) {
    await recordUsage(apiKeyId)
    const rateLimit = await checkApiKeyRateLimit(apiKeyId, keyData!.dailyLimit)
    return NextResponse.json(responseData, {
      headers: {
        "X-RateLimit-Limit": String(rateLimit.limit),
        "X-RateLimit-Remaining": String(rateLimit.remaining),
        "X-RateLimit-Reset": rateLimit.resetsAt,
      },
    })
  }

  const finalQuota = await canMakeRequest(authedUserId!)
  return NextResponse.json(responseData, { headers: getRateLimitHeaders(finalQuota) })
}
