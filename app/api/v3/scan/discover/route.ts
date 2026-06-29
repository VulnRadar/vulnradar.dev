import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validateApiKey } from "@/lib/api/api-keys";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import dns from "dns/promises";
import pool from "@/lib/database/db";
import { safeFetch, validateScanTarget } from "@/lib/scanner/safe-fetch";
import { SCANNING } from "@/lib/config/constants";

// Subdomain Cache - 4 hour TTL using database for persistence across instances

const CACHE_TTL_HOURS = 4;

interface CacheResult {
  subdomains: DiscoveredSubdomain[];
  cachedAt: string;
  expiresAt: string;
}

async function getCachedSubdomains(
  domain: string,
): Promise<CacheResult | null> {
  try {
    const result = await pool.query(
      `SELECT subdomains, cached_at, 
              cached_at + INTERVAL '${CACHE_TTL_HOURS} hours' as expires_at
       FROM subdomain_cache 
       WHERE domain = $1 AND cached_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'`,
      [domain],
    );
    if (result.rows[0]?.subdomains) {
      return {
        subdomains: result.rows[0].subdomains as DiscoveredSubdomain[],
        cachedAt: result.rows[0].cached_at,
        expiresAt: result.rows[0].expires_at,
      };
    }
  } catch (err) {
    console.error("[Discover] getCachedSubdomains error:", err);
  }
  return null;
}

async function cacheSubdomains(
  domain: string,
  subdomains: DiscoveredSubdomain[],
) {
  try {
    await pool.query(
      `INSERT INTO subdomain_cache (domain, subdomains, cached_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (domain) DO UPDATE SET subdomains = $2::jsonb, cached_at = NOW()`,
      [domain, JSON.stringify(subdomains)],
    );
  } catch (err) {
    console.error("[Discover] cacheSubdomains error:", err);
  }
}

// 150+ common subdomain prefixes, all resolved via parallel DNS (no sequential overhead)
const BRUTE_FORCE_PREFIXES = [
  // Core infrastructure
  "www",
  "www2",
  "www3",
  "mail",
  "mail2",
  "smtp",
  "imap",
  "pop",
  "pop3",
  "mx",
  "email",
  "webmail",
  "api",
  "api2",
  "api-v2",
  "app",
  "app2",
  "web",
  "web1",
  "web2",
  "ftp",
  "sftp",
  "ssh",
  // Environments
  "dev",
  "dev2",
  "staging",
  "stage",
  "test",
  "testing",
  "qa",
  "uat",
  "sandbox",
  "beta",
  "alpha",
  "demo",
  "preview",
  "canary",
  "preprod",
  "prod",
  "live",
  // Admin & management
  "admin",
  "admin2",
  "administrator",
  "panel",
  "cpanel",
  "whm",
  "webmin",
  "manage",
  "manager",
  "console",
  "portal",
  "dashboard",
  "backoffice",
  "cms",
  // CDN & assets
  "cdn",
  "cdn2",
  "assets",
  "static",
  "media",
  "images",
  "img",
  "files",
  "upload",
  "downloads",
  "dl",
  "s3",
  "storage",
  "cache",
  "edge",
  // Services
  "blog",
  "shop",
  "store",
  "forum",
  "community",
  "wiki",
  "docs",
  "documentation",
  "help",
  "support",
  "kb",
  "faq",
  "status",
  "health",
  "monitor",
  "monitoring",
  "metrics",
  "analytics",
  // Auth & security
  "auth",
  "login",
  "sso",
  "oauth",
  "id",
  "identity",
  "accounts",
  "account",
  "secure",
  "vpn",
  "gateway",
  "proxy",
  "waf",
  // Networking
  "ns1",
  "ns2",
  "ns3",
  "ns4",
  "dns",
  "dns1",
  "dns2",
  "m",
  "mobile",
  // Collaboration
  "chat",
  "slack",
  "meet",
  "conference",
  "video",
  "voip",
  "sip",
  "pbx",
  // DevOps & CI/CD
  "git",
  "gitlab",
  "github",
  "svn",
  "repo",
  "jenkins",
  "ci",
  "cd",
  "build",
  "deploy",
  "release",
  "docker",
  "k8s",
  "registry",
  // Monitoring & logging
  "grafana",
  "kibana",
  "elastic",
  "prometheus",
  "nagios",
  "zabbix",
  "sentry",
  "logs",
  "log",
  // Databases
  "db",
  "db2",
  "database",
  "mysql",
  "postgres",
  "mongo",
  "redis",
  "sql",
  // Messaging
  "rabbitmq",
  "kafka",
  "mq",
  "queue",
  // Regional
  "us",
  "eu",
  "ap",
  // Business
  "crm",
  "erp",
  "hr",
  "billing",
  "pay",
  "payment",
  "checkout",
  "search",
  "report",
  "reports",
  "internal",
  "intranet",
  "extranet",
  "corp",
  "news",
  "press",
  "events",
  "calendar",
  "jobs",
  "careers",
  "partners",
  "affiliate",
  "feedback",
  "forms",
  "contact",
  "remote",
  "office",
  "workspace",
  "backup",
  "bak",
  "dr",
  "old",
  "new",
  "legacy",
  "v1",
  "v2",
];

interface DiscoveredSubdomain {
  subdomain: string;
  url: string;
  reachable: boolean;
  statusCode?: number;
  sources: string[];
}

const DOUBLE_TLDS = [
  "co.uk",
  "co.jp",
  "com.au",
  "com.br",
  "co.nz",
  "co.za",
  "org.uk",
  "net.au",
  "ac.uk",
  "gov.uk",
  "co.in",
  "co.kr",
  "com.mx",
  "com.ar",
  "com.cn",
  "com.tw",
  "co.il",
  "co.th",
];

function extractRootDomain(hostname: string): string {
  const stripped = hostname.replace(/^www\./, "");
  const parts = stripped.split(".");
  const lastTwo = parts.slice(-2).join(".");
  if (DOUBLE_TLDS.includes(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  } else if (parts.length >= 2) {
    return parts.slice(-2).join(".");
  }
  return stripped;
}

export async function POST(request: NextRequest) {
  try {
    let userId: number | null = null;
    let _isApiKeyAuth = false;

    // Try session auth first
    const session = await getSession();
    if (session) {
      userId = session.userId;
    } else {
      // Try API key auth
      const authHeader = request.headers.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const apiKey = authHeader.slice(7);
        const keyData = await validateApiKey(apiKey);
        if (!keyData) {
          return NextResponse.json(
            { error: "Invalid or revoked API key." },
            { status: 401 },
          );
        }

        // Check if user needs to accept updated terms
        if (keyData.needsTermsAcceptance) {
          return NextResponse.json(
            {
              error:
                "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.",
            },
            { status: 403 },
          );
        }

        userId = keyData.userId;
      } else {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const rl = await checkRateLimit({
      key: `discover:${userId}`,
      ...RATE_LIMITS.scan,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit reached. Please wait before discovering again." },
        { status: 429 },
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }
    const { url } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }
    // scanner: per-URL length cap shared with scan/route.ts.
    if (url.length > SCANNING.MAX_URL_LENGTH) {
      return NextResponse.json(
        {
          error: `URL exceeds maximum length of ${SCANNING.MAX_URL_LENGTH} characters.`,
        },
        { status: 400 },
      );
    }

    let domain: string;
    try {
      const parsed = new URL(url);
      domain = parsed.hostname;
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // ssrf: run the full SSRF guard against the user-supplied URL
    // BEFORE any external DNS or third-party-API lookup. Without
    // this, an attacker can submit `http://localhost/` or any
    // RFC1918 / link-local / cloud-metadata hostname and the
    // handler fires ~140 prefix DNS lookups plus crt.sh /
    // hackertarget / subdomain.center / rapiddns queries against
    // the operator's network. validateScanTarget rejects private /
    // loopback / link-local / metadata targets.
    const scanSafety = await validateScanTarget(url);
    if (!scanSafety.safe) {
      return NextResponse.json(
        {
          error: scanSafety.reason || "URL blocked for security reasons",
        },
        { status: 400 },
      );
    }

    const rootDomain = extractRootDomain(domain);

    // Check if force refresh is requested
    const forceRefresh = body.forceRefresh === true;

    // Check cache first (4 hour TTL) unless force refresh
    if (!forceRefresh) {
      const cached = await getCachedSubdomains(rootDomain);
      if (cached) {
        return NextResponse.json({
          domain: rootDomain,
          subdomains: cached.subdomains,
          total: cached.subdomains.length,
          reachable: cached.subdomains.filter((s) => s.reachable).length,
          cached: true,
          cachedAt: cached.cachedAt,
          expiresAt: cached.expiresAt,
        });
      }
    }

    // Run all passive data sources in parallel
    const [
      ctResults,
      hackerTargetResults,
      subdomainCenterResults,
      rapidDnsResults,
    ] = await Promise.all([
      fetchCrtSh(rootDomain),
      fetchHackerTarget(rootDomain),
      fetchSubdomainCenter(rootDomain),
      fetchRapidDns(rootDomain),
    ]);

    // Collect all passive subdomains with their sources
    const passiveMap = new Map<string, string[]>();

    function addPassive(subs: string[], source: string) {
      for (const s of subs) {
        const clean = s.toLowerCase().trim();
        if (!clean || !clean.endsWith(`.${rootDomain}`)) continue;
        if (clean.includes("*") || clean.includes(" ") || clean.includes("@"))
          continue;
        const existing = passiveMap.get(clean);
        if (existing) {
          if (!existing.includes(source)) existing.push(source);
        } else {
          passiveMap.set(clean, [source]);
        }
      }
    }

    addPassive(ctResults, "crt.sh");
    addPassive(hackerTargetResults, "hackertarget");
    addPassive(subdomainCenterResults, "subdomain.center");
    addPassive(rapidDnsResults, "rapiddns");

    // Brute-force DNS: check 30 common prefixes in parallel (fast, DNS-only)
    const bruteResults = await batchDnsResolve(
      BRUTE_FORCE_PREFIXES.map((p) => `${p}.${rootDomain}`),
    );
    for (const sub of bruteResults) {
      if (!passiveMap.has(sub)) {
        passiveMap.set(sub, ["brute-force"]);
      } else {
        const existing = passiveMap.get(sub)!;
        if (!existing.includes("brute-force")) existing.push("brute-force");
      }
    }

    // DNS resolution check: filter dead entries before HTTP checks (cap at 1000)
    const passiveEntries = Array.from(passiveMap.entries()).slice(0, 1000);
    const dnsResolved = await batchDnsResolve(
      passiveEntries.map(([sub]) => sub),
    );

    // Only HTTP-check subdomains with DNS records
    const passiveWithDns = passiveEntries.filter(([sub]) =>
      dnsResolved.has(sub),
    );
    const reachability = await batchHttpCheck(
      passiveWithDns.map(([sub]) => sub),
      25, // concurrency
    );

    // Build results
    const results: DiscoveredSubdomain[] = passiveEntries.map(
      ([sub, sources]) => {
        const hasDns = dnsResolved.has(sub);
        const httpResult = reachability.get(sub);
        return {
          subdomain: sub,
          url: `https://${sub}`,
          reachable: hasDns && !!httpResult?.reachable,
          statusCode: httpResult?.statusCode,
          sources,
        };
      },
    );

    results.sort((a, b) => {
      if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
      return a.subdomain.localeCompare(b.subdomain);
    });

    // Cache results for 4 hours (fire and forget - don't block response)
    cacheSubdomains(rootDomain, results).catch(() => {});

    return NextResponse.json({
      domain: rootDomain,
      total: results.length,
      reachable: results.filter((r) => r.reachable).length,
      subdomains: results,
      cached: false,
      sources: {
        "crt.sh": ctResults.length,
        hackertarget: hackerTargetResults.length,
        "subdomain.center": subdomainCenterResults.length,
        rapiddns: rapidDnsResults.length,
        "brute-force": bruteResults.size,
      },
    });
  } catch (err) {
    console.error("[Discover] Subdomain discovery error:", err);
    return NextResponse.json(
      { error: "Subdomain discovery failed" },
      { status: 500 },
    );
  }
}

// ─── Data Sources ──────────────────────────────────────────

async function fetchCrtSh(domain: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`,
      {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; VulnRadar/1.0)",
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) return [];

    const data = await res.json();
    const names = new Set<string>();

    for (const entry of data) {
      const commonName = entry.common_name || "";
      const nameValue = entry.name_value || "";

      for (const name of [commonName, ...nameValue.split("\n")]) {
        const clean = name.trim().toLowerCase().replace(/^\*\./, "");
        if (clean.endsWith(`.${domain}`) || clean === domain) {
          names.add(clean);
        }
      }
    }

    return Array.from(names);
  } catch {
    return [];
  }
}

async function fetchHackerTarget(domain: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(domain)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; VulnRadar/1.0)" },
      },
    );
    if (!res.ok) return [];

    const text = await res.text();
    if (text.startsWith("error") || text.includes("API count exceeded"))
      return [];

    const names: string[] = [];
    for (const line of text.split("\n")) {
      const host = line.split(",")[0]?.trim().toLowerCase();
      if (host && host.endsWith(`.${domain}`)) {
        names.push(host);
      }
    }
    return names;
  } catch {
    return [];
  }
}

async function fetchSubdomainCenter(domain: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.subdomain.center/?domain=${encodeURIComponent(domain)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; VulnRadar/1.0)" },
      },
    );
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .map((s: string) => s.trim().toLowerCase().replace(/^\*\./, ""))
      .filter((s: string) => s.endsWith(`.${domain}`));
  } catch {
    return [];
  }
}

async function fetchRapidDns(domain: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://rapiddns.io/subdomain/${encodeURIComponent(domain)}?full=1`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; VulnRadar/1.0)" },
      },
    );
    if (!res.ok) return [];

    const html = await res.text();
    // Properly escape all regex special characters in domain
    const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`([a-z0-9._-]+\\.${escapedDomain})`, "gi");
    const matches = html.match(regex) || [];
    const names = new Set<string>();
    for (const m of matches) {
      const clean = m.toLowerCase().trim();
      if (clean.endsWith(`.${domain}`)) {
        names.add(clean);
      }
    }
    return Array.from(names);
  } catch {
    return [];
  }
}

// ─── DNS Resolution ────────────────────────────────────────

async function batchDnsResolve(subdomains: string[]): Promise<Set<string>> {
  const resolved = new Set<string>();
  const BATCH_SIZE = 50;

  for (let i = 0; i < subdomains.length; i += BATCH_SIZE) {
    const batch = subdomains.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (sub) => {
        try {
          const addresses = await dns.resolve4(sub);
          if (addresses.length > 0) return sub;
        } catch {
          try {
            const addresses = await dns.resolve6(sub);
            if (addresses.length > 0) return sub;
          } catch {
            /* no DNS */
          }
        }
        return null;
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) resolved.add(r.value);
    }
  }

  return resolved;
}

// ─── HTTP Reachability ─────────────────────────────────────

async function batchHttpCheck(
  subdomains: string[],
  concurrency: number,
): Promise<Map<string, { reachable: boolean; statusCode?: number }>> {
  const results = new Map<
    string,
    { reachable: boolean; statusCode?: number }
  >();

  for (let i = 0; i < subdomains.length; i += concurrency) {
    const batch = subdomains.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (sub) => {
        // SSRF guard: every candidate hostname must clear
        // validateScanTarget before we connect. The old plain `fetch`
        // happily followed redirects to private IPs (127.0.0.1,
        // 169.254.169.254, etc.) and resolved DNS to whatever the
        // attacker-controlled NS said.
        const url = `https://${sub}`;
        const safety = await validateScanTarget(url);
        if (!safety.safe) {
          return { sub, reachable: false };
        }
        try {
          const r = await safeFetch(
            url,
            {
              method: "HEAD",
              signal: AbortSignal.timeout(4000),
            },
            [sub],
          );
          return { sub, reachable: true, statusCode: r.status };
        } catch {
          try {
            const r = await safeFetch(
              `http://${sub}`,
              {
                method: "HEAD",
                signal: AbortSignal.timeout(3000),
              },
              [sub],
            );
            return { sub, reachable: true, statusCode: r.status };
          } catch {
            return { sub, reachable: false };
          }
        }
      }),
    );

    for (const r of settled) {
      if (r.status === "fulfilled") {
        results.set(r.value.sub, {
          reachable: r.value.reachable,
          statusCode: r.value.statusCode,
        });
      }
    }
  }

  return results;
}
