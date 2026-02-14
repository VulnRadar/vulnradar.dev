import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

const COMMON_SUBDOMAINS = [
  "www", "mail", "api", "app", "dev", "staging", "admin", "cdn",
  "blog", "shop", "store", "docs", "help", "support", "portal",
  "m", "mobile", "test", "beta", "demo", "web", "ns1", "ns2",
  "ftp", "vpn", "remote", "secure", "auth", "login", "dashboard",
  "status", "monitor", "git", "gitlab", "jenkins", "ci", "media",
]

interface DiscoveredSubdomain {
  subdomain: string
  url: string
  reachable: boolean
  statusCode?: number
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rl = await checkRateLimit({
    key: `discover:${session.userId}`,
    ...RATE_LIMITS.scan,
  })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Please wait before discovering again." },
      { status: 429 },
    )
  }

  const body = await request.json()
  const { url } = body

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }

  let domain: string
  try {
    const parsed = new URL(url)
    domain = parsed.hostname
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  // Strip www. to get the root domain
  const rootDomain = domain.replace(/^www\./, "")

  // Method 1: Certificate Transparency logs via crt.sh
  const ctSubdomains = await fetchCrtSh(rootDomain)

  // Method 2: Check common subdomain prefixes
  const commonResults = await checkCommonSubdomains(rootDomain)

  // Merge results, deduplicate
  const allSubdomains = new Map<string, DiscoveredSubdomain>()

  for (const sub of commonResults) {
    allSubdomains.set(sub.subdomain, sub)
  }

  for (const sub of ctSubdomains) {
    if (!allSubdomains.has(sub.subdomain)) {
      allSubdomains.set(sub.subdomain, sub)
    }
  }

  const results = Array.from(allSubdomains.values()).sort((a, b) => {
    if (a.reachable !== b.reachable) return a.reachable ? -1 : 1
    return a.subdomain.localeCompare(b.subdomain)
  })

  return NextResponse.json({
    domain: rootDomain,
    total: results.length,
    reachable: results.filter((r) => r.reachable).length,
    subdomains: results,
  })
}

async function fetchCrtSh(domain: string): Promise<DiscoveredSubdomain[]> {
  try {
    const res = await fetch(
      `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`,
      { signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) return []

    const data = await res.json()
    const names = new Set<string>()

    for (const entry of data) {
      const commonName = entry.common_name || ""
      const nameValue = entry.name_value || ""

      for (const name of [commonName, ...nameValue.split("\n")]) {
        const clean = name.trim().toLowerCase().replace(/^\*\./, "")
        if (clean.endsWith(`.${domain}`) || clean === domain) {
          names.add(clean)
        }
      }
    }

    // Check reachability for CT subdomains (limited to first 20)
    const subdomains = Array.from(names).slice(0, 20)
    const results = await Promise.allSettled(
      subdomains.map(async (sub): Promise<DiscoveredSubdomain> => {
        try {
          const r = await fetch(`https://${sub}`, {
            method: "HEAD",
            redirect: "follow",
            signal: AbortSignal.timeout(5000),
          })
          return { subdomain: sub, url: `https://${sub}`, reachable: true, statusCode: r.status }
        } catch {
          return { subdomain: sub, url: `https://${sub}`, reachable: false }
        }
      }),
    )

    return results
      .filter((r): r is PromiseFulfilledResult<DiscoveredSubdomain> => r.status === "fulfilled")
      .map((r) => r.value)
  } catch {
    return []
  }
}

async function checkCommonSubdomains(domain: string): Promise<DiscoveredSubdomain[]> {
  const results = await Promise.allSettled(
    COMMON_SUBDOMAINS.map(async (prefix): Promise<DiscoveredSubdomain> => {
      const sub = `${prefix}.${domain}`
      try {
        const r = await fetch(`https://${sub}`, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(4000),
        })
        return { subdomain: sub, url: `https://${sub}`, reachable: true, statusCode: r.status }
      } catch {
        return { subdomain: sub, url: `https://${sub}`, reachable: false }
      }
    }),
  )

  return results
    .filter((r): r is PromiseFulfilledResult<DiscoveredSubdomain> => r.status === "fulfilled")
    .map((r) => r.value)
}
