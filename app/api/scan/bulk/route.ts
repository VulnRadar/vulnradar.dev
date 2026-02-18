import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { allChecks } from "@/lib/scanner/checks"
import { runAsyncChecks } from "@/lib/scanner/async-checks"
import pool from "@/lib/db"
import { ERROR_MESSAGES, APP_NAME, SEVERITY_LEVELS } from "@/lib/constants"
import type { Vulnerability, Severity } from "@/lib/scanner/types"

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
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

async function runSingleScan(url: string, userId: number) {
  const startTime = Date.now()

  let response: Response
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

  const responseBody = await safeReadBody(response, MAX_BODY_SIZE)
  const headers = response.headers
  const capturedHeaders: Record<string, string> = {}
  headers.forEach((v, k) => { capturedHeaders[k] = v })

  // Sync checks
  const bodyForChecks = responseBody.length > 1_000_000 ? responseBody.slice(0, 1_000_000) : responseBody
  const syncFindings: Vulnerability[] = []
  for (const check of allChecks) {
    try {
      const r = check(url, headers, bodyForChecks)
      if (r) syncFindings.push(r)
    } catch { /* skip */ }
  }

  // Async checks
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
    const insertResult = await pool.query(
      `INSERT INTO scan_history (user_id, url, summary, findings, findings_count, duration, scanned_at, source, response_headers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [userId, url, JSON.stringify(summary), JSON.stringify(findings), summary.total, duration, new Date().toISOString(), "web", JSON.stringify(capturedHeaders)],
    )
    scanHistoryId = insertResult.rows[0]?.id || null
  } catch { /* non-fatal */ }

  return { url, success: true, scanHistoryId, summary, findings_count: summary.total, duration }
}

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

  const validUrls: string[] = []
  for (const u of urls) {
    try {
      const parsed = new URL(u)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") validUrls.push(u)
    } catch { /* skip */ }
  }

  if (validUrls.length === 0) {
    return NextResponse.json({ error: "No valid URLs provided." }, { status: 400 })
  }

  // Run scans sequentially to avoid overwhelming resources
  const results: Array<{ url: string; success: boolean; scanHistoryId?: number | null; error?: string; summary?: any; findings_count?: number; duration?: number }> = []

  for (const scanUrl of validUrls) {
    const scanResult = await runSingleScan(scanUrl, session.userId)
    results.push(scanResult)
  }

  return NextResponse.json({
    total: validUrls.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  })
}
