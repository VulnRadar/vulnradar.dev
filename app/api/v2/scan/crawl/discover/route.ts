import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit"
import { validateApiKey } from "@/lib/api/api-keys"
import { APP_NAME, BEARER_PREFIX } from "@/lib/config/constants"

// ─── helpers ────────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`
}

async function safeJson(res: Response): Promise<unknown> {
  try { return await res.json() } catch { return null }
}

async function checkReachability(
  url: string,
  controller: AbortController,
): Promise<{ reachable: boolean; statusCode?: number }> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      headers: { "User-Agent": `${APP_NAME}/1.0 (Scanner)` },
    })
    return { reachable: res.ok || (res.status >= 200 && res.status < 400), statusCode: res.status }
  } catch {
    return { reachable: false }
  }
}

// ─── route ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth: session or API key
  let userId: number | null = null

  const session = await getSession()
  if (session) {
    userId = session.userId
  } else {
    const authHeader = request.headers.get("authorization")
    if (authHeader?.startsWith(BEARER_PREFIX)) {
      const token = authHeader.slice(BEARER_PREFIX.length)
      const keyData = await validateApiKey(token)
      if (!keyData) {
        return NextResponse.json({ error: "Invalid or revoked API key." }, { status: 401 })
      }
      if (keyData.needsTermsAcceptance) {
        return NextResponse.json(
          { error: "Please accept our updated Terms of Service." },
          { status: 403 },
        )
      }
      userId = keyData.userId
    } else {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const rl = await checkRateLimit({ key: `crawl-discover:${userId}`, ...RATE_LIMITS.scan })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit reached." }, { status: 429 })
  }

  const body = await request.json()
  const { url, forceRefresh } = body as { url: string; forceRefresh?: boolean }

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }
  let parsedUrl: URL
  try { parsedUrl = new URL(url) } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  const domain = parsedUrl.hostname

  // ─── SSE stream ───────────────────────────────────────────────────────────
  const abortController = new AbortController()
  request.signal.addEventListener("abort", () => abortController.abort())

  const stream = new ReadableStream({
    async start(ctrl) {
      function send(type: string, payload: Record<string, unknown> = {}) {
        try { ctrl.enqueue(new TextEncoder().encode(sseEvent(type, payload))) } catch { /* closed */ }
      }

      const subdomainsMap = new Map<string, { sources: Set<string> }>()

      function addSubdomain(sub: string, source: string) {
        const clean = sub.toLowerCase().trim()
        if (!clean || clean === domain) return
        if (!clean.endsWith(`.${domain}`) && clean !== domain) return
        if (!subdomainsMap.has(clean)) {
          subdomainsMap.set(clean, { sources: new Set() })
        }
        subdomainsMap.get(clean)!.sources.add(source)
      }

      try {
        // ── Stage 1: crt.sh ─────────────────────── 0→20%
        send("progress", { stage: "crt.sh", message: "Querying Certificate Transparency logs (crt.sh)...", percent: 5 })
        try {
          const crtRes = await fetch(
            `https://crt.sh/?q=%.${domain}&output=json`,
            { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(10000)]) }
          )
          if (crtRes.ok) {
            const data = await safeJson(crtRes) as Array<{ name_value: string }> | null
            if (Array.isArray(data)) {
              for (const entry of data) {
                for (const name of entry.name_value.split("\n")) {
                  addSubdomain(name.replace(/^\*\./, ""), "crt.sh")
                }
              }
            }
          }
        } catch { /* continue */ }
        send("progress", { stage: "crt.sh", message: "Certificate Transparency logs complete.", percent: 20, found: subdomainsMap.size })

        // ── Stage 2: HackerTarget ────────────────── 20→35%
        send("progress", { stage: "hackertarget", message: "Querying HackerTarget passive DNS...", percent: 20 })
        try {
          const htRes = await fetch(
            `https://api.hackertarget.com/hostsearch/?q=${domain}`,
            { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(8000)]) }
          )
          if (htRes.ok) {
            const text = await htRes.text()
            if (!text.startsWith("error")) {
              for (const line of text.split("\n")) {
                const parts = line.split(",")
                if (parts[0]) addSubdomain(parts[0].trim(), "hackertarget")
              }
            }
          }
        } catch { /* continue */ }
        send("progress", { stage: "hackertarget", message: "HackerTarget lookup complete.", percent: 35, found: subdomainsMap.size })

        // ── Stage 3: RapidDNS ────────────────────── 35→50%
        send("progress", { stage: "rapiddns", message: "Scanning RapidDNS database...", percent: 35 })
        try {
          const rdRes = await fetch(
            `https://rapiddns.io/subdomain/${domain}?full=1&down=1`,
            {
              headers: { "User-Agent": `${APP_NAME}/1.0 (Scanner)` },
              signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(8000)])
            }
          )
          if (rdRes.ok) {
            const html = await rdRes.text()
            const regex = /([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/g
            let m: RegExpExecArray | null
            while ((m = regex.exec(html)) !== null) {
              addSubdomain(m[1], "rapiddns")
            }
          }
        } catch { /* continue */ }
        send("progress", { stage: "rapiddns", message: "RapidDNS scan complete.", percent: 50, found: subdomainsMap.size })

        // ── Stage 4: subdomain.center ────────────── 50→62%
        send("progress", { stage: "subdomain.center", message: "Querying subdomain.center...", percent: 50 })
        try {
          const scRes = await fetch(
            `https://api.subdomain.center/?domain=${domain}`,
            { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(8000)]) }
          )
          if (scRes.ok) {
            const data = await safeJson(scRes) as string[] | null
            if (Array.isArray(data)) {
              for (const sub of data) addSubdomain(sub, "subdomain.center")
            }
          }
        } catch { /* continue */ }
        send("progress", { stage: "subdomain.center", message: "subdomain.center lookup complete.", percent: 62, found: subdomainsMap.size })

        // ── Stage 5: Brute-force common prefixes ── 62→75%
        send("progress", { stage: "brute-force", message: "Testing common subdomain prefixes...", percent: 62 })
        const commonPrefixes = [
          "www","mail","ftp","smtp","pop","imap","api","app","dev","staging",
          "test","beta","alpha","admin","blog","shop","store","docs","help",
          "support","portal","dashboard","cdn","static","assets","media","img",
          "images","auth","login","sso","vpn","git","gitlab","github","jenkins",
          "ci","build","status","monitor","grafana","metrics","analytics","data",
          "db","mysql","postgres","redis","elastic","search","secure","ssl","mx",
          "mail1","mail2","smtp1","smtp2","ns1","ns2","ns3","cpanel","webmail",
        ]
        const batchSize = 10
        let bfProgress = 62
        for (let i = 0; i < commonPrefixes.length; i += batchSize) {
          if (abortController.signal.aborted) break
          const batch = commonPrefixes.slice(i, i + batchSize)
          await Promise.all(batch.map(async (prefix) => {
            const sub = `${prefix}.${domain}`
            try {
              const res = await fetch(`https://${sub}`, {
                method: "HEAD",
                signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(3000)]),
                headers: { "User-Agent": `${APP_NAME}/1.0 (Scanner)` },
              })
              if (res.status < 500) addSubdomain(sub, "brute-force")
            } catch { /* not reachable */ }
          }))
          bfProgress = 62 + Math.round(((i + batchSize) / commonPrefixes.length) * 13)
          send("progress", {
            stage: "brute-force",
            message: `Brute-force: testing prefixes ${i + 1}–${Math.min(i + batchSize, commonPrefixes.length)} of ${commonPrefixes.length}...`,
            percent: Math.min(bfProgress, 75),
            found: subdomainsMap.size,
          })
        }
        send("progress", { stage: "brute-force", message: "Brute-force complete.", percent: 75, found: subdomainsMap.size })

        // ── Stage 6: Reachability checks ─────────── 75→98%
        const allSubs = Array.from(subdomainsMap.entries())
        send("progress", {
          stage: "reachability",
          message: `Checking reachability of ${allSubs.length} subdomains...`,
          percent: 75,
          found: allSubs.length,
        })

        const results: Array<{
          subdomain: string
          url: string
          reachable: boolean
          statusCode?: number
          sources: string[]
        }> = []

        const REACHABILITY_BATCH = 8
        for (let i = 0; i < allSubs.length; i += REACHABILITY_BATCH) {
          if (abortController.signal.aborted) break
          const batch = allSubs.slice(i, i + REACHABILITY_BATCH)
          const batchResults = await Promise.all(batch.map(async ([sub, { sources }]) => {
            const { reachable, statusCode } = await checkReachability(`https://${sub}`, abortController)
            return { subdomain: sub, url: `https://${sub}`, reachable, statusCode, sources: Array.from(sources) }
          }))
          results.push(...batchResults)

          const rcPercent = 75 + Math.round(((i + REACHABILITY_BATCH) / Math.max(allSubs.length, 1)) * 23)
          send("progress", {
            stage: "reachability",
            message: `Checking reachability... (${Math.min(i + REACHABILITY_BATCH, allSubs.length)}/${allSubs.length})`,
            percent: Math.min(rcPercent, 98),
            found: allSubs.length,
          })
        }

        // ── Done ──────────────────────────────────── 100%
        const reachableCount = results.filter(r => r.reachable).length
        const sourceCount: Record<string, number> = {}
        for (const r of results) {
          for (const src of r.sources) {
            sourceCount[src] = (sourceCount[src] || 0) + 1
          }
        }

        send("done", {
          domain,
          total: results.length,
          reachable: reachableCount,
          subdomains: results.sort((a, b) => (b.reachable ? 1 : 0) - (a.reachable ? 1 : 0)),
          sources: sourceCount,
          percent: 100,
        })
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "Discovery failed" })
      } finally {
        ctrl.close()
      }
    },
    cancel() {
      abortController.abort()
    }
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
