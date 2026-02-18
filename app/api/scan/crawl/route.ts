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

  const skipExtensions = /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf|eot|pdf|zip|mp4|mp3|wav)$/i

  while (queue.length > 0 && found.length < MAX_PAGES) {
    const url = queue.shift()!
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": `${APP_NAME}/1.0 (Crawler)` },
        redirect: "follow",
        signal: AbortSignal.timeout(CRAWL_TIMEOUT),
      })

      // If redirected to a different origin, skip
      if (new URL(res.url).origin !== origin) continue

      const contentType = res.headers.get("content-type") || ""
      if (!contentType.includes("text/html")) continue

      const body = await safeReadBody(res, MAX_BODY_SIZE)

      // Extract href values from <a> tags
      const hrefRegex = /href=["']([^"'#]+?)["']/gi
      let match: RegExpExecArray | null
      while ((match = hrefRegex.exec(body)) !== null) {
        let href = match[1].trim()

        // Skip non-HTTP links
        if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue
        if (skipExtensions.test(href)) continue

        // Resolve relative URLs
        let resolved: URL
        try {
          resolved = new URL(href, url)
        } catch {
          continue
        }

        // Must be same origin
        if (resolved.origin !== origin) continue

        // Normalize: remove hash, keep pathname + search
        const normalized = resolved.origin + resolved.pathname + resolved.search

        if (!visited.has(normalized) && found.length < MAX_PAGES) {
          visited.add(normalized)
          found.push(normalized)
          queue.push(normalized)
        }
      }
    } catch {
      // Timeout or network error -- skip this page
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

  const { url } = await request.json()
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }

  try {
    new URL(url)
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  const startTime = Date.now()

  // Phase 1: Discover internal links
  const pages = await discoverInternalLinks(url)

  // Phase 2: Scan each page
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

  const scanResult: ScanResult = {
    url,
    scannedAt: new Date().toISOString(),
    duration: totalDuration,
    findings: allFindings,
    summary: mergedSummary,
    responseHeaders: mainHeaders,
  }

  // Save to history
  let scanHistoryId: number | null = null
  try {
    const insertResult = await pool.query(
      `INSERT INTO scan_history (user_id, url, summary, findings, findings_count, duration, scanned_at, source, response_headers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [session.userId, url, JSON.stringify(mergedSummary), JSON.stringify(allFindings), mergedSummary.total, totalDuration, scanResult.scannedAt, "web", JSON.stringify(mainHeaders)],
    )
    scanHistoryId = insertResult.rows[0]?.id || null
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ...scanResult,
    scanHistoryId,
    crawl: {
      pagesDiscovered: pages.length,
      pagesScanned: pageResults.length,
      pages: pageResults.map((p) => ({
        url: p.url,
        findings: p.findings,
        findings_count: p.summary.total,
        summary: p.summary,
        duration: p.duration,
      })),
    },
  })
}
