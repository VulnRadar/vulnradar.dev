import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import dns from "dns/promises"

// ~150 common subdomain prefixes
const COMMON_SUBDOMAINS = [
  // Core infrastructure
  "www", "mail", "smtp", "imap", "pop", "pop3", "mx", "email", "webmail",
  "api", "app", "web", "ftp", "sftp", "ssh",
  // Development & environments
  "dev", "staging", "stage", "test", "testing", "qa", "uat", "sandbox",
  "beta", "alpha", "demo", "preview", "canary", "pre-prod", "preprod",
  "prod", "production", "live",
  // Admin & management
  "admin", "administrator", "panel", "cpanel", "whm", "webmin", "manage",
  "manager", "console", "portal", "dashboard", "backoffice", "cms",
  // Cloud & CDN
  "cdn", "assets", "static", "media", "images", "img", "files", "upload",
  "downloads", "dl", "s3", "storage", "cache", "edge",
  // Services & apps
  "blog", "shop", "store", "forum", "community", "wiki", "docs",
  "documentation", "help", "support", "kb", "faq", "status", "health",
  "monitor", "monitoring", "metrics", "analytics",
  // Auth & security
  "auth", "login", "sso", "oauth", "id", "identity", "accounts", "account",
  "secure", "vpn", "gateway", "proxy", "waf",
  // Networking
  "ns1", "ns2", "ns3", "ns4", "dns", "dns1", "dns2",
  "m", "mobile", "wap",
  // Collaboration & comms
  "chat", "slack", "teams", "meet", "conference", "video", "voip",
  "sip", "pbx", "call",
  // DevOps & CI/CD
  "git", "gitlab", "github", "bitbucket", "svn", "repo",
  "jenkins", "ci", "cd", "build", "deploy", "release",
  "docker", "k8s", "kubernetes", "registry", "harbor",
  // Monitoring & logging
  "grafana", "kibana", "elastic", "elasticsearch", "logstash",
  "prometheus", "nagios", "zabbix", "splunk", "sentry", "newrelic",
  "datadog", "pagerduty", "logs", "log",
  // Databases
  "db", "database", "mysql", "postgres", "postgresql", "mongo", "mongodb",
  "redis", "memcached", "sql", "mssql", "oracle",
  // Messaging & queues
  "rabbitmq", "kafka", "mq", "queue", "amqp", "nats",
  // Regional
  "us", "eu", "ap", "us-east", "us-west", "eu-west",
  // Misc services
  "crm", "erp", "hr", "finance", "billing", "pay", "payment", "payments",
  "checkout", "cart", "orders", "booking", "reserve",
  "search", "solr", "sphinx",
  "report", "reports", "reporting",
  "internal", "intranet", "extranet", "corp", "corporate",
  "news", "press", "events", "calendar",
  "jobs", "careers", "talent",
  "partners", "affiliate", "reseller", "vendor",
  "feedback", "survey", "forms", "contact",
  "remote", "workspace", "office",
  "backup", "bak", "dr", "failover",
  "www2", "www3", "web1", "web2", "app1", "app2",
  "api2", "api-v2", "v2", "v1", "old", "new", "legacy",
]

interface DiscoveredSubdomain {
  subdomain: string
  url: string
  reachable: boolean
  statusCode?: number
  sources: string[]
}

const DOUBLE_TLDS = [
  "co.uk", "co.jp", "com.au", "com.br", "co.nz", "co.za",
  "org.uk", "net.au", "ac.uk", "gov.uk", "co.in", "co.kr",
  "com.mx", "com.ar", "com.cn", "com.tw", "co.il", "co.th",
]

function extractRootDomain(hostname: string): string {
  const stripped = hostname.replace(/^www\./, "")
  const parts = stripped.split(".")
  const lastTwo = parts.slice(-2).join(".")
  if (DOUBLE_TLDS.includes(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".")
  } else if (parts.length >= 2) {
    return parts.slice(-2).join(".")
  }
  return stripped
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

  const rootDomain = extractRootDomain(domain)

  // Run all data sources in parallel
  const [ctResults, hackerTargetResults, subdomainCenterResults, rapidDnsResults] =
    await Promise.all([
      fetchCrtSh(rootDomain),
      fetchHackerTarget(rootDomain),
      fetchSubdomainCenter(rootDomain),
      fetchRapidDns(rootDomain),
    ])

  // Collect all passive subdomains with their sources
  const passiveMap = new Map<string, string[]>()

  function addPassive(subs: string[], source: string) {
    for (const s of subs) {
      const clean = s.toLowerCase().trim()
      if (!clean || !clean.endsWith(`.${rootDomain}`)) continue
      // Filter out wildcards and invalid entries
      if (clean.includes("*") || clean.includes(" ") || clean.includes("@")) continue
      const existing = passiveMap.get(clean)
      if (existing) {
        if (!existing.includes(source)) existing.push(source)
      } else {
        passiveMap.set(clean, [source])
      }
    }
  }

  addPassive(ctResults, "crt.sh")
  addPassive(hackerTargetResults, "hackertarget")
  addPassive(subdomainCenterResults, "subdomain.center")
  addPassive(rapidDnsResults, "rapiddns")

  // DNS resolution check for passive subdomains (filter dead entries before HTTP checks)
  const passiveEntries = Array.from(passiveMap.entries()).slice(0, 100) // cap at 100
  const dnsResolved = await batchDnsResolve(passiveEntries.map(([sub]) => sub))

  // Only HTTP-check subdomains that have DNS records
  const passiveWithDns = passiveEntries.filter(([sub]) => dnsResolved.has(sub))

  // Check reachability for DNS-resolved passive subdomains
  const passiveReachability = await batchHttpCheck(
    passiveWithDns.map(([sub]) => sub),
    20, // concurrency limit
  )

  // Build passive results
  const passiveResults: DiscoveredSubdomain[] = passiveEntries.map(([sub, sources]) => {
    const hasDns = dnsResolved.has(sub)
    const httpResult = passiveReachability.get(sub)
    return {
      subdomain: sub,
      url: `https://${sub}`,
      reachable: hasDns && !!httpResult?.reachable,
      statusCode: httpResult?.statusCode,
      sources,
    }
  })

  // Common prefix brute-force (also DNS-check first, then HTTP-check)
  const commonSubdomains = COMMON_SUBDOMAINS.map((p) => `${p}.${rootDomain}`)
    .filter((sub) => !passiveMap.has(sub)) // skip already found

  const commonDnsResolved = await batchDnsResolve(commonSubdomains)
  const commonWithDns = commonSubdomains.filter((sub) => commonDnsResolved.has(sub))
  const commonReachability = await batchHttpCheck(commonWithDns, 30)

  const commonResults: DiscoveredSubdomain[] = commonWithDns.map((sub) => {
    const httpResult = commonReachability.get(sub)
    return {
      subdomain: sub,
      url: `https://${sub}`,
      reachable: !!httpResult?.reachable,
      statusCode: httpResult?.statusCode,
      sources: ["brute-force"],
    }
  })

  // Merge & deduplicate
  const allSubdomains = new Map<string, DiscoveredSubdomain>()

  for (const sub of passiveResults) {
    allSubdomains.set(sub.subdomain, sub)
  }

  for (const sub of commonResults) {
    const existing = allSubdomains.get(sub.subdomain)
    if (existing) {
      if (!existing.sources.includes("brute-force")) {
        existing.sources.push("brute-force")
      }
      if (sub.reachable && !existing.reachable) {
        existing.reachable = true
        existing.statusCode = sub.statusCode
      }
    } else {
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
    sources: {
      "crt.sh": ctResults.length,
      hackertarget: hackerTargetResults.length,
      "subdomain.center": subdomainCenterResults.length,
      rapiddns: rapidDnsResults.length,
      "brute-force": commonResults.length,
    },
  })
}

// ─── Data Sources ──────────────────────────────────────────

async function fetchCrtSh(domain: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`,
      { signal: AbortSignal.timeout(15000) },
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

    return Array.from(names)
  } catch {
    return []
  }
}

async function fetchHackerTarget(domain: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(domain)}`,
      { signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) return []

    const text = await res.text()
    if (text.startsWith("error") || text.includes("API count exceeded")) return []

    const names: string[] = []
    for (const line of text.split("\n")) {
      const host = line.split(",")[0]?.trim().toLowerCase()
      if (host && host.endsWith(`.${domain}`)) {
        names.push(host)
      }
    }
    return names
  } catch {
    return []
  }
}

async function fetchSubdomainCenter(domain: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.subdomain.center/?domain=${encodeURIComponent(domain)}`,
      { signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) return []

    const data = await res.json()
    if (!Array.isArray(data)) return []

    return data
      .map((s: string) => s.trim().toLowerCase().replace(/^\*\./, ""))
      .filter((s: string) => s.endsWith(`.${domain}`))
  } catch {
    return []
  }
}

async function fetchRapidDns(domain: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://rapiddns.io/subdomain/${encodeURIComponent(domain)}?full=1`,
      { signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) return []

    const html = await res.text()
    // Parse subdomain entries from the HTML table
    const regex = new RegExp(`([a-z0-9._-]+\\.${domain.replace(/\./g, "\\.")})`, "gi")
    const matches = html.match(regex) || []
    const names = new Set<string>()
    for (const m of matches) {
      const clean = m.toLowerCase().trim()
      if (clean.endsWith(`.${domain}`)) {
        names.add(clean)
      }
    }
    return Array.from(names)
  } catch {
    return []
  }
}

// ─── DNS Resolution ────────────────────────────────────────

async function batchDnsResolve(subdomains: string[]): Promise<Set<string>> {
  const resolved = new Set<string>()
  const BATCH_SIZE = 50

  for (let i = 0; i < subdomains.length; i += BATCH_SIZE) {
    const batch = subdomains.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async (sub) => {
        try {
          const addresses = await dns.resolve4(sub)
          if (addresses.length > 0) return sub
        } catch {
          // Try AAAA (IPv6) as fallback
          try {
            const addresses = await dns.resolve6(sub)
            if (addresses.length > 0) return sub
          } catch {
            // No DNS record
          }
        }
        return null
      }),
    )

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        resolved.add(r.value)
      }
    }
  }

  return resolved
}

// ─── HTTP Reachability ─────────────────────────────────────

async function batchHttpCheck(
  subdomains: string[],
  concurrency: number,
): Promise<Map<string, { reachable: boolean; statusCode?: number }>> {
  const results = new Map<string, { reachable: boolean; statusCode?: number }>()

  for (let i = 0; i < subdomains.length; i += concurrency) {
    const batch = subdomains.slice(i, i + concurrency)
    const settled = await Promise.allSettled(
      batch.map(async (sub) => {
        try {
          const r = await fetch(`https://${sub}`, {
            method: "HEAD",
            redirect: "follow",
            signal: AbortSignal.timeout(5000),
          })
          return { sub, reachable: true, statusCode: r.status }
        } catch {
          // Try HTTP as fallback
          try {
            const r = await fetch(`http://${sub}`, {
              method: "HEAD",
              redirect: "follow",
              signal: AbortSignal.timeout(4000),
            })
            return { sub, reachable: true, statusCode: r.status }
          } catch {
            return { sub, reachable: false }
          }
        }
      }),
    )

    for (const r of settled) {
      if (r.status === "fulfilled") {
        results.set(r.value.sub, {
          reachable: r.value.reachable,
          statusCode: r.value.statusCode,
        })
      }
    }
  }

  return results
}
