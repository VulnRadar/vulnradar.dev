import { NextRequest, NextResponse } from "next/server"
import { allChecks } from "@/lib/scanner/checks"
import { runAsyncChecks } from "@/lib/scanner/async-checks"
import { getSession } from "@/lib/auth"
import { validateApiKey, checkRateLimit, recordUsage } from "@/lib/api-keys"
import { checkRateLimit as checkGlobalRL, RATE_LIMITS } from "@/lib/rate-limit"
import pool from "@/lib/db"
import type { ScanResult, Severity, Vulnerability } from "@/lib/scanner/types"
import { APP_NAME, BEARER_PREFIX, SEVERITY_LEVELS } from "@/lib/constants"

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

const MAX_BODY_SIZE = 2 * 1024 * 1024 // 2 MB max response body

function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Safely read response body with a size limit to prevent OOM crashes.
 * Reads in chunks and stops if the limit is exceeded.
 */
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
        // Decode the partial chunk up to the limit
        const overshoot = totalBytes - maxBytes
        const trimmed = value.slice(0, value.byteLength - overshoot)
        if (trimmed.byteLength > 0) {
          chunks.push(decoder.decode(trimmed, { stream: false }))
        }
        break
      }

      chunks.push(decoder.decode(value, { stream: true }))
    }
  } catch {
    // Stream error -- return what we have so far
  } finally {
    try { reader.cancel() } catch { /* ignore */ }
  }

  return chunks.join("")
}

export async function POST(request: NextRequest) {
  try {
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

      // Check rate limit
      const rateLimit = await checkRateLimit(keyData.keyId, keyData.dailyLimit)

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

      // Rate limit web scans by user
      const rl = await checkGlobalRL({ key: `scan:${session.userId}`, ...RATE_LIMITS.scan })
      if (!rl.allowed) {
        return NextResponse.json(
          { error: `Scan rate limit reached. Please wait before scanning again.` },
          { status: 429 },
        )
      }
    }

    const body = await request.json()
    const { url } = body

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "URL is required" },
        { status: 400 }
      )
    }

    if (!isValidUrl(url)) {
      return NextResponse.json(
        { error: "Invalid URL. Must start with http:// or https://" },
        { status: 400 }
      )
    }

    const startTime = Date.now()

    // Fetch the target URL
    let response: Response
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": `${APP_NAME}/1.0 (Security Scanner)`,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : "Unknown error"
      return NextResponse.json(
        {
          error: `Could not reach the target URL: ${message}. The site may be down, blocking automated requests, or not publicly accessible.`,
        },
        { status: 422 }
      )
    }

    const responseBody = await safeReadBody(response, MAX_BODY_SIZE)
    const headers = response.headers

    // Capture response headers as a plain object for evidence
    const capturedHeaders: Record<string, string> = {}
    headers.forEach((value, key) => {
      capturedHeaders[key] = value
    })

    // Run synchronous checks + async checks (DNS, TLS, live-fetch) in parallel
    // Limit body for sync checks to 1MB to prevent regex catastrophic backtracking
    const bodyForChecks = responseBody.length > 1_000_000 ? responseBody.slice(0, 1_000_000) : responseBody
    const syncFindings: Vulnerability[] = []
    for (const check of allChecks) {
      try {
        const result = check(url, headers, bodyForChecks)
        if (result) {
          syncFindings.push(result)
        }
      } catch {
        // Skip failed checks silently
      }
    }

    let asyncFindings: Vulnerability[] = []
    try {
      // Wrap async checks in a 20s timeout so they don't hang the entire request
      const asyncPromise = runAsyncChecks(url)
      const timeoutPromise = new Promise<Vulnerability[]>((resolve) => setTimeout(() => resolve([]), 20000))
      asyncFindings = await Promise.race([asyncPromise, timeoutPromise])
    } catch {
      // Non-fatal: don't fail the scan if async checks error
    }

    const findings = [...syncFindings, ...asyncFindings]

    // Sort findings by severity
    findings.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
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

    const result: ScanResult = {
      url,
      scannedAt: new Date().toISOString(),
      duration,
      findings,
      summary,
      responseHeaders: capturedHeaders,
    }

    // Save to scan history
    let scanHistoryId: number | null = null
    if (authedUserId) {
      try {
        const source = isApiKeyAuth ? "api" : "web"
        const insertResult = await pool.query(
          `INSERT INTO scan_history (user_id, url, summary, findings, findings_count, duration, scanned_at, source, response_headers)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [authedUserId, url, JSON.stringify(summary), JSON.stringify(findings), summary.total, duration, result.scannedAt, source, JSON.stringify(capturedHeaders)],
        )
        scanHistoryId = insertResult.rows[0]?.id || null
      } catch {
        // Non-fatal: don't fail the scan if history save fails
      }
    }

    // Fire webhooks for all scans (non-blocking)
    if (authedUserId) {
      pool.query("SELECT url, type FROM webhooks WHERE user_id = $1 AND active = true", [authedUserId])
        .then(({ rows }) => {
          for (const { url: webhookUrl, type: webhookType } of rows) {
            let body: string
            const scanData = { url, summary, findings_count: summary.total, duration, scanned_at: result.scannedAt }

            if (webhookType === "discord") {
              // Discord embed format
              const severityColor = summary.critical > 0 ? 0xef4444 : summary.high > 0 ? 0xf97316 : summary.medium > 0 ? 0xeab308 : 0x22c55e
              body = JSON.stringify({
                embeds: [{
                  title: `${APP_NAME} Scan Complete`,
                  description: `Scan finished for **${url}**`,
                  color: severityColor,
                  fields: [
                    { name: "Critical", value: String(summary.critical), inline: true },
                    { name: "High", value: String(summary.high), inline: true },
                    { name: "Medium", value: String(summary.medium), inline: true },
                    { name: "Low", value: String(summary.low), inline: true },
                    { name: "Info", value: String(summary.info), inline: true },
                    { name: "Total Issues", value: String(summary.total), inline: true },
                    { name: "Duration", value: `${(duration / 1000).toFixed(1)}s`, inline: true },
                  ],
                  footer: { text: `${APP_NAME} Security Scanner` },
                  timestamp: result.scannedAt,
                }],
              })
            } else if (webhookType === "slack") {
              // Slack Block Kit format
              body = JSON.stringify({
                blocks: [
                  { type: "header", text: { type: "plain_text", text: `${APP_NAME} Scan Complete` } },
                  { type: "section", text: { type: "mrkdwn", text: `*URL:* ${url}` } },
                  { type: "section", fields: [
                    { type: "mrkdwn", text: `*Critical:* ${summary.critical}` },
                    { type: "mrkdwn", text: `*High:* ${summary.high}` },
                    { type: "mrkdwn", text: `*Medium:* ${summary.medium}` },
                    { type: "mrkdwn", text: `*Low:* ${summary.low}` },
                    { type: "mrkdwn", text: `*Total:* ${summary.total}` },
                    { type: "mrkdwn", text: `*Duration:* ${(duration / 1000).toFixed(1)}s` },
                  ]},
                  { type: "context", elements: [{ type: "mrkdwn", text: "Sent by VulnRadar Security Scanner" }] },
                ],
              })
            } else {
              // Generic JSON
              body = JSON.stringify({ event: "scan.completed", data: scanData })
            }

            fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json", "User-Agent": `${APP_NAME}-Webhook/1.0` },
              body,
              signal: AbortSignal.timeout(10000),
            }).catch(() => {})
          }
        })
        .catch(() => {})
    }

    const responseData = { ...result, scanHistoryId }

    // Record API key usage and add rate limit headers
    if (isApiKeyAuth && apiKeyId) {
      await recordUsage(apiKeyId)
      const rateLimit = await checkRateLimit(apiKeyId, 50)
      return NextResponse.json(responseData, {
        headers: {
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
          "X-RateLimit-Reset": rateLimit.resetsAt,
        },
      })
    }

    return NextResponse.json(responseData)
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred during the scan." },
      { status: 500 }
    )
  }
}
