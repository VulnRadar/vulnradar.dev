import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { allChecks } from "@/lib/scanner/checks"
import { runAsyncChecks } from "@/lib/scanner/async-checks"
import pool from "@/lib/db"
import { APP_NAME, SEVERITY_LEVELS } from "@/lib/constants"
import type { Vulnerability, Severity, ScanResult } from "@/lib/scanner/types"

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
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return false
    return true
  }

  while (queue.length > 0 && found.length < MAX_PAGES) {
    const url = queue.shift()!
    try {
      const res = await fetch(url, {
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

async function scanSingleUrl(url: string): Promise<{
  url: string
  findings: Vulnerability[]
  summary: Record<string, number>
  duration: number
  responseHeaders: Record<string, string>
}> {
  const startTime = Date.now()

  let response: Response
  try {
    response = await fetch(url, {
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

  const bodyForChecks = responseBody.length > 1_000_000 ? responseBody.slice(0, 1_000_000) : responseBody
  const syncFindings: Vulnerability[] = []
  for (const check of allChecks) {
    try {
      const r = check(url, headers, bodyForChecks)
      if (r) syncFindings.push(r)
    } catch { /* skip */ }
  }

  let asyncFindings: Vulnerability[] = []
  try {
    asyncFindings = await Promise.race([
      runAsyncChecks(url),
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
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rl = await checkRateLimit({ key: `crawl:${session.userId}`, ...RATE_LIMITS.scan })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Crawl rate limit reached. Please wait before scanning again." }, { status: 429 })
  }

  const body = await request.json()
  const url: string = body.url
  const selectedUrls: string[] | undefined = body.urls

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }

  try { new URL(url) } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
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

  // Scan each page
  const pageResults: Array<{
    url: string
    findings: Vulnerability[]
    summary: Record<string, number>
    duration: number
    responseHeaders: Record<string, string>
  }> = []

  for (const pageUrl of pages) {
    const result = await scanSingleUrl(pageUrl)
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
  const { DEFAULT_SCAN_NOTE } = await import("@/lib/constants")
  const pageHistoryIds: Record<string, number> = {}
  for (const pr of pageResults) {
    try {
      const insertResult = await pool.query(
        `INSERT INTO scan_history (user_id, url, summary, findings, findings_count, duration, scanned_at, source, response_headers, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [session.userId, pr.url, JSON.stringify(pr.summary), JSON.stringify(pr.findings), pr.summary.total, pr.duration, scannedAt, "deep-crawl", JSON.stringify(pr.responseHeaders), DEFAULT_SCAN_NOTE],
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

  return NextResponse.json({
    ...scanResult,
    scanHistoryId,
    crawl: {
      pagesDiscovered: pages.length,
      pagesScanned: pageResults.length,
      pages: pageResults.map((p) => ({
        url: p.url,
        scanHistoryId: pageHistoryIds[p.url] || null,
        findings: p.findings,
        findings_count: p.summary.total,
        summary: p.summary,
        duration: p.duration,
      })),
    },
  })
}
