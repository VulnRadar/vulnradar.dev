import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit"
import { canMakeRequest, incrementDailyCount, getRateLimitHeaders } from "@/lib/rate-limiting/daily-limits"
import { validateApiKey, checkRateLimit as checkApiKeyRateLimit, recordUsage } from "@/lib/api/api-keys"
import { allChecks, getFilteredChecks } from "@/lib/scanner/checks"
import { runAsyncChecks } from "@/lib/scanner/async-checks"
import pool from "@/lib/database/db"
import { APP_NAME, SEVERITY_LEVELS, BEARER_PREFIX } from "@/lib/config/constants"
import type { Vulnerability, Severity, ScanResult } from "@/lib/scanner/types"
import { checkAccessRules } from "@/lib/scanner/access-rules"

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const MAX_BODY_SIZE = 1 * 1024 * 1024
const MAX_PAGES = 15 // max pages to crawl
const CRAWL_TIMEOUT = 8000

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

/**
 * Crawl a page and extract same-origin internal links.
 * Skips external domains, anchors, mailto, tel, and asset files.
 */
async function discoverInternalLinks(startUrl: string): Promise<string[]> {
  const origin = new URL(startUrl).origin
  const visited = new Set<string>([startUrl])
  const queue = [startUrl]
  const found: string[] = [startUrl]

  const skipExtensions = /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|mjs|cjs|woff2?|ttf|eot|otf|pdf|zip|tar|gz|mp4|mp3|wav|ogg|webm|avif|map|xml|rss|atom|json|wasm|txt)$/i
  const skipPathSegments = /(\/_next\/|\/static\/|\/assets\/|\/api\/|\/favicon|\/robots\.txt|\/sitemap|\/manifest|\/sw\.js|\/workbox)/i

  function isCleanUrl(href: string): boolean {
    // Skip anything with encoded brackets, regex-like patterns, or non-printable chars
    if (/[%\[\]{}|\\^`<>]/.test(href) && /%5[bBdD]|%5[eE]|%7[bBdD]|%3[eE]|%3[cC]/.test(href)) return false
    // Skip data URIs
    if (href.startsWith("data:")) return false
    // Skip fragments-only and empty
    if (!href || href === "#" || href.startsWith("#")) return false
    // Skip non-HTTP
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:") || href.startsWith("vbscript:")) return false
    return true
  }

  while (queue.length > 0 && found.length < MAX_PAGES) {
    const url = queue.shift()!
    try {
      // Validate URL to prevent SSRF - check protocol and parse URL
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        continue
      }
      
      let urlObj: URL
      try {
        urlObj = new URL(url)
      } catch {
        continue
      }
      
      // Only allow http and https protocols
      if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
        continue
      }
      
      // Must match the origin hostname
      if (urlObj.hostname !== new URL(origin).hostname) {
        continue
      }
      
      // Use the validated URL object's href for the fetch
      const safeUrl = urlObj.href
      
      // Build fetch URL from validated components to ensure CodeQL recognizes safety
      const fetchProtocol = urlObj.protocol === "https:" ? "https:" : "http:"
      const fetchHost = urlObj.hostname
      const fetchPort = urlObj.port ? `:${urlObj.port}` : ""
      const fetchPath = urlObj.pathname || ""
      const fetchSearch = urlObj.search || ""
      const fetchUrl = `${fetchProtocol}//${fetchHost}${fetchPort}${fetchPath}${fetchSearch}`
      
      const res = await fetch(fetchUrl, {
        method: "GET",
        headers: { "User-Agent": `${APP_NAME}/1.0 (Crawler)` },
        redirect: "follow",
        signal: AbortSignal.timeout(CRAWL_TIMEOUT),
      })

      // Only allow redirects that stay on the exact same hostname
      const redirectedUrl = new URL(res.url)
      const entryHostname = new URL(origin).hostname
      if (redirectedUrl.hostname !== entryHostname) continue

      // Use the actual (post-redirect) URL as the base for resolving relative links
      const actualUrl = res.url

      // If redirected to a different path on the same host, track it (but avoid duplicating "/")
      const redirectNormalized = redirectedUrl.origin + redirectedUrl.pathname + redirectedUrl.search
      if (!visited.has(redirectNormalized)) {
        visited.add(redirectNormalized)
        if (!found.includes(redirectNormalized)) found.push(redirectNormalized)
      }

      const contentType = res.headers.get("content-type") || ""
      if (!contentType.includes("text/html")) continue

      const body = await safeReadBody(res, MAX_BODY_SIZE)

      // Extract href values from <a> tags only (not link/script/img tags)
      const anchorRegex = /<a\s[^>]*href=["']([^"'#]+?)["']/gi
      let match: RegExpExecArray | null
      while ((match = anchorRegex.exec(body)) !== null) {
        const href = match[1].trim()

        if (!isCleanUrl(href)) continue
        if (skipExtensions.test(href)) continue

        // Resolve relative URLs against the actual (post-redirect) URL
        let resolved: URL
        try {
          resolved = new URL(href, actualUrl)
        } catch {
          continue
        }

        // Must be exact same hostname (no subdomains)
        if (resolved.hostname !== entryHostname) continue

        // Skip asset/internal paths
        const fullPath = resolved.pathname + resolved.search
        if (skipPathSegments.test(fullPath)) continue
        if (skipExtensions.test(resolved.pathname)) continue

        // Normalize: remove hash, keep pathname + search
        const normalized = resolved.origin + resolved.pathname + resolved.search

        if (!visited.has(normalized) && found.length < MAX_PAGES) {
          visited.add(normalized)
          found.push(normalized)
          queue.push(normalized)
        }
      }
    } catch {
      // Timeout or network error: skip this page
    }
  }

  return found
}

async function scanSingleUrl(url: string, scanners?: string[] | null): Promise<{
  url: string
  findings: Vulnerability[]
  summary: Record<string, number>
  duration: number
  responseHeaders: Record<string, string>
}> {
  const startTime = Date.now()

  let response: Response
  try {
    // Validate URL to prevent SSRF
    const urlObj = new URL(url)
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      throw new Error("Invalid protocol")
    }
    
    // Use the validated URL object's href for the fetch
    const safeUrl = urlObj.href
    
    // Build fetch URL from validated components to ensure CodeQL recognizes safety
    const fetchProtocol = urlObj.protocol === "https:" ? "https:" : "http:"
    const fetchHost = urlObj.hostname
    const fetchPort = urlObj.port ? `:${urlObj.port}` : ""
    const fetchPath = urlObj.pathname || ""
    const fetchSearch = urlObj.search || ""
    const fetchUrl = `${fetchProtocol}//${fetchHost}${fetchPort}${fetchPath}${fetchSearch}`
    
    response = await fetch(fetchUrl, {
      method: "GET",
      headers: { "User-Agent": `${APP_NAME}/1.0 (Security Scanner)` },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    return { url, findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 }, duration: Date.now() - startTime, responseHeaders: {} }
  }

  const responseBody = await safeReadBody(response, MAX_BODY_SIZE)
  const headers = response.headers
  const capturedHeaders: Record<string, string> = {}
  headers.forEach((v, k) => { capturedHeaders[k] = v })

  const checks = scanners ? getFilteredChecks(scanners) : allChecks
  const bodyForChecks = responseBody.length > 1_000_000 ? responseBody.slice(0, 1_000_000) : responseBody
  const syncFindings: Vulnerability[] = []
  for (const check of checks) {
    try {
      const r = check(url, headers, bodyForChecks)
      if (r) syncFindings.push(r)
    } catch { /* skip */ }
  }

  let asyncFindings: Vulnerability[] = []
  try {
    asyncFindings = await Promise.race([
      runAsyncChecks(url, scanners),
      new Promise<Vulnerability[]>((resolve) => setTimeout(() => resolve([]), 15000)),
    ])
  } catch { /* non-fatal */ }

  const findings = [...syncFindings, ...asyncFindings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )

  const summary = {
    critical: findings.filter((f) => f.severity === SEVERITY_LEVELS.CRITICAL).length,
    high: findings.filter((f) => f.severity === SEVERITY_LEVELS.HIGH).length,
    medium: findings.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM).length,
    low: findings.filter((f) => f.severity === SEVERITY_LEVELS.LOW).length,
    info: findings.filter((f) => f.severity === SEVERITY_LEVELS.INFO).length,
    total: findings.length,
  }

  return { url, findings, summary, duration: Date.now() - startTime, responseHeaders: capturedHeaders }
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

    const rl = await checkRateLimit({ key: `crawl:${session.userId}`, ...RATE_LIMITS.scan })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Crawl rate limit reached. Please wait before scanning again." }, { status: 429 })
    }
  }

  const body = await request.json()
  const url: string = body.url
  const selectedUrls: string[] | undefined = body.urls
  const scanners: string[] | null = Array.isArray(body.scanners) && body.scanners.length > 0 ? body.scanners : null

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }

  try { new URL(url) } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  // Check access rules (blacklist/whitelist) for the main URL
  const accessCheck = await checkAccessRules(url)
  if (!accessCheck.allowed) {
    return NextResponse.json(
      { 
        error: "This target cannot be scanned.",
        details: "This domain or IP address has been restricted from scanning for security, privacy, or compliance reasons. Access controls are enforced to protect sensitive infrastructure and user data. If you believe this is an error, please contact support.",
        statusCode: "BLOCKED"
      },
      { status: 403 }
    )
  }

  const startTime = Date.now()

  // Use pre-selected URLs if provided, otherwise discover them
  let pages: string[]
  if (selectedUrls && Array.isArray(selectedUrls) && selectedUrls.length > 0) {
    // Validate all URLs
    pages = selectedUrls.filter(u => {
      try { new URL(u); return true } catch { return false }
    }).slice(0, MAX_PAGES)
  } else {
    pages = await discoverInternalLinks(url)
  }

  // Check daily quota: each page in the crawl counts as 1 scan (skip for API key auth - they use API rate limits)
  const quotaCheck = isApiKeyAuth 
    ? { allowed: true, limit: -1, used: 0, remaining: pages.length, resetsAt: "" } 
    : await canMakeRequest(authedUserId!)
  if (!quotaCheck.allowed) {
    return NextResponse.json(
      { error: "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset." },
      { status: 429, headers: getRateLimitHeaders(quotaCheck) },
    )
  }

  // Cap pages to remaining quota
  const maxPagesToScan = quotaCheck.limit === -1 ? pages.length : Math.min(pages.length, quotaCheck.remaining)
  const pagesToScan = pages.slice(0, maxPagesToScan)
  const skippedCount = pages.length - pagesToScan.length

  // Scan each page
  const pageResults: Array<{
    url: string
    findings: Vulnerability[]
    summary: Record<string, number>
    duration: number
    responseHeaders: Record<string, string>
  }> = []

  for (const pageUrl of pagesToScan) {
    // Increment daily count before each scan (skip for API key auth)
    if (!isApiKeyAuth) {
      await incrementDailyCount(authedUserId!)
    }
    const result = await scanSingleUrl(pageUrl, scanners)
    pageResults.push(result)
  }

  // Merge all findings, deduplicating by id
  const seenIds = new Set<string>()
  const allFindings: Vulnerability[] = []
  for (const pr of pageResults) {
    for (const f of pr.findings) {
      if (!seenIds.has(f.id)) {
        seenIds.add(f.id)
        allFindings.push(f)
      }
    }
  }
  allFindings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  const totalDuration = Date.now() - startTime
  const mergedSummary = {
    critical: allFindings.filter((f) => f.severity === SEVERITY_LEVELS.CRITICAL).length,
    high: allFindings.filter((f) => f.severity === SEVERITY_LEVELS.HIGH).length,
    medium: allFindings.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM).length,
    low: allFindings.filter((f) => f.severity === SEVERITY_LEVELS.LOW).length,
    info: allFindings.filter((f) => f.severity === SEVERITY_LEVELS.INFO).length,
    total: allFindings.length,
  }

  // Use first page's response headers as the main headers
  const mainHeaders = pageResults[0]?.responseHeaders || {}
  const scannedAt = new Date().toISOString()

  // Save EACH page as its own history entry (like bulk scan)
  const { DEFAULT_SCAN_NOTE } = await import("@/lib/config/constants")
  const pageHistoryIds: Record<string, number> = {}
  for (const pr of pageResults) {
    try {
      const insertResult = await pool.query(
        `INSERT INTO scan_history (user_id, url, summary, findings, findings_count, duration, scanned_at, source, response_headers, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        // source must be either 'api' or 'web'
        [authedUserId, pr.url, JSON.stringify(pr.summary), JSON.stringify(pr.findings), pr.summary.total, pr.duration, scannedAt, isApiKeyAuth ? "api" : "web", JSON.stringify(pr.responseHeaders), DEFAULT_SCAN_NOTE],
      )
      pageHistoryIds[pr.url] = insertResult.rows[0]?.id
    } catch (err) {
      console.error("[VulnRadar] Failed to save crawl history:", err instanceof Error ? err.message : err)
    }
  }

  // The "main" scan history ID is the first page (the root URL)
  const scanHistoryId = pageHistoryIds[pages[0]] || null

  const scanResult: ScanResult = {
    url,
    scannedAt,
    duration: totalDuration,
    findings: allFindings,
    summary: mergedSummary,
    responseHeaders: mainHeaders,
  }

  const responseData = {
    ...scanResult,
    scanHistoryId,
    crawl: {
      pagesDiscovered: pages.length,
      pagesScanned: pageResults.length,
      pagesSkipped: skippedCount,
      pages: pageResults.map((p) => ({
        url: p.url,
        scanHistoryId: pageHistoryIds[p.url] || null,
        findings: p.findings,
        findings_count: p.summary.total,
        summary: p.summary,
        duration: p.duration,
      })),
    },
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
