import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit"
import { validateApiKey } from "@/lib/api/api-keys"
import { APP_NAME, BEARER_PREFIX } from "@/lib/config/constants"
import { safeFetch } from "@/lib/scanner/safe-fetch"

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
  // Allow either session-based auth or API key (Bearer)
  let userId: number | null = null
  let isApiKeyAuth = false

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
          { error: "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API." },
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
    return NextResponse.json({ error: "Rate limit reached. Please wait before trying again." }, { status: 429 })
  }

  const { url } = await request.json()
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }

  let startUrl: URL
  try {
    startUrl = new URL(url)
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  if (startUrl.protocol !== "http:" && startUrl.protocol !== "https:") {
    return NextResponse.json({ error: "Only http and https URLs are allowed" }, { status: 400 })
  }

  const normalizedStart = startUrl.href
  const origin = startUrl.origin
  const visited = new Set<string>([normalizedStart])
  const queue = [normalizedStart]
  const found: string[] = [normalizedStart]

  const skipExtensions = /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|mjs|cjs|woff2?|ttf|eot|otf|pdf|zip|tar|gz|mp4|mp3|wav|ogg|webm|avif|map|xml|rss|atom|json|wasm|txt)$/i
  const skipPathSegments = /(\/_next\/|\/static\/|\/assets\/|\/api\/|\/favicon|\/robots\.txt|\/sitemap|\/manifest|\/sw\.js|\/workbox)/i

  function isCleanUrl(href: string): boolean {
    if (/[%\[\]{}|\\^`<>]/.test(href) && /%5[bBdD]|%5[eE]|%7[bBdD]|%3[eE]|%3[cC]/.test(href)) return false
    if (href.startsWith("data:")) return false
    if (!href || href === "#" || href.startsWith("#")) return false
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:") || href.startsWith("vbscript:")) return false
    return true
  }

  const entryHostname = new URL(origin).hostname

  while (queue.length > 0 && found.length < MAX_PAGES) {
    const currentUrl = queue.shift()!
    try {
      // Validate URL before fetch to prevent SSRF
      if (!currentUrl.startsWith("http://") && !currentUrl.startsWith("https://")) {
        continue
      }
      
      let currentUrlObj: URL
      try {
        currentUrlObj = new URL(currentUrl)
      } catch {
        continue
      }
      
      // Only allow http and https protocols
      if (currentUrlObj.protocol !== "http:" && currentUrlObj.protocol !== "https:") {
        continue
      }
      
      // Must match the entry hostname
      if (currentUrlObj.hostname !== entryHostname) {
        continue
      }
      
      // Use safeFetch which validates the URL internally to prevent SSRF
      // Pass entryHostname as the only allowed hostname to prevent redirect-based SSRF
      const res = await safeFetch(currentUrlObj.href, {
        method: "GET",
        headers: { "User-Agent": `${APP_NAME}/1.0 (Crawler)` },
        redirect: "follow",
        signal: AbortSignal.timeout(CRAWL_TIMEOUT),
      }, [entryHostname])

      // Only allow redirects that stay on the exact same hostname
      const redirectedUrl = new URL(res.url)
      if (redirectedUrl.hostname !== entryHostname) continue

      // Use the actual (post-redirect) URL as base for resolving relative links
      const actualUrl = res.url

      // If redirected to a different path on the same host, track it
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
        try { resolved = new URL(href, actualUrl) } catch { continue }

        // Must be exact same hostname (no subdomains)
        if (resolved.hostname !== entryHostname) continue

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
