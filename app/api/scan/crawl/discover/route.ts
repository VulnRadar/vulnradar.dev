import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { APP_NAME } from "@/lib/constants"

const MAX_BODY_SIZE = 512 * 1024
const MAX_PAGES = 20
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
      if (totalBytes > maxBytes) break
      chunks.push(decoder.decode(value, { stream: true }))
    }
  } catch { /* return partial */ } finally {
    try { reader.cancel() } catch { /* ignore */ }
  }
  return chunks.join("")
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rl = await checkRateLimit({ key: `crawl-discover:${session.userId}`, ...RATE_LIMITS.scan })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit reached. Please wait before trying again." }, { status: 429 })
  }

  const { url } = await request.json()
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }

  try { new URL(url) } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  const origin = new URL(url).origin
  const visited = new Set<string>([url])
  const queue = [url]
  const found: string[] = [url]

  const skipExtensions = /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|mjs|cjs|woff2?|ttf|eot|otf|pdf|zip|tar|gz|mp4|mp3|wav|ogg|webm|avif|map|xml|rss|atom|json|wasm|txt)$/i
  const skipPathSegments = /(\/_next\/|\/static\/|\/assets\/|\/api\/|\/favicon|\/robots\.txt|\/sitemap|\/manifest|\/sw\.js|\/workbox)/i

  function isCleanUrl(href: string): boolean {
    if (/[%\[\]{}|\\^`<>]/.test(href) && /%5[bBdD]|%5[eE]|%7[bBdD]|%3[eE]|%3[cC]/.test(href)) return false
    if (href.startsWith("data:")) return false
    if (!href || href === "#" || href.startsWith("#")) return false
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return false
    return true
  }

  const baseDomain = new URL(origin).hostname.split(".").slice(-2).join(".")

  while (queue.length > 0 && found.length < MAX_PAGES) {
    const currentUrl = queue.shift()!
    try {
      const res = await fetch(currentUrl, {
        method: "GET",
        headers: { "User-Agent": `${APP_NAME}/1.0 (Crawler)` },
        redirect: "follow",
        signal: AbortSignal.timeout(CRAWL_TIMEOUT),
      })

      const redirectedUrl = new URL(res.url)
      const redirectDomain = redirectedUrl.hostname.split(".").slice(-2).join(".")
      if (redirectDomain !== baseDomain) continue

      const redirectNormalized = redirectedUrl.origin + redirectedUrl.pathname + redirectedUrl.search
      if (!visited.has(redirectNormalized)) {
        visited.add(redirectNormalized)
        if (!found.includes(redirectNormalized)) found.push(redirectNormalized)
      }

      const contentType = res.headers.get("content-type") || ""
      if (!contentType.includes("text/html")) continue

      const body = await safeReadBody(res, MAX_BODY_SIZE)

      const anchorRegex = /<a\s[^>]*href=["']([^"'#]+?)["']/gi
      let match: RegExpExecArray | null
      while ((match = anchorRegex.exec(body)) !== null) {
        const href = match[1].trim()
        if (!isCleanUrl(href)) continue
        if (skipExtensions.test(href)) continue

        let resolved: URL
        try { resolved = new URL(href, currentUrl) } catch { continue }

        const linkDomain = resolved.hostname.split(".").slice(-2).join(".")
        if (linkDomain !== baseDomain) continue

        const fullPath = resolved.pathname + resolved.search
        if (skipPathSegments.test(fullPath)) continue
        if (skipExtensions.test(resolved.pathname)) continue

        const normalized = resolved.origin + resolved.pathname + resolved.search
        if (!visited.has(normalized) && found.length < MAX_PAGES) {
          visited.add(normalized)
          found.push(normalized)
          queue.push(normalized)
        }
      }
    } catch { /* skip */ }
  }

  return NextResponse.json({ urls: found })
}
