/**
 * Async security checks that require network I/O (DNS, TLS, live-fetch).
 * These run in parallel during a scan alongside the synchronous body/header checks.
 *
 * v1.5.0 Optimizations:
 * - SPF, DMARC, DKIM, DNSSEC all run in parallel (was sequential)
 * - DKIM selectors checked via Promise.race with early-exit on first hit
 * - TLS timeout reduced from 8s to 5s
 * - Fetch timeouts reduced from 8s to 5s
 * - security.txt: both URLs checked in parallel
 * - DNSSEC DoH timeout reduced from 6s to 4s
 */

import * as dns from "dns/promises"
import * as tls from "tls"
import type { Vulnerability, Category } from "./types"

let idCounter = 0
function generateId(): string {
  return `vuln-async-${Date.now()}-${idCounter++}`
}

function makeVuln(
  title: string,
  severity: "critical" | "high" | "medium" | "low" | "info",
  category: Category,
  description: string,
  evidence: string,
  riskImpact: string,
  explanation: string,
  fixSteps: string[],
  codeExamples: { label: string; language: string; code: string }[] = [],
): Vulnerability {
  return {
    id: generateId(),
    title,
    severity,
    category,
    description,
    evidence,
    riskImpact,
    explanation,
    fixSteps,
    codeExamples,
  }
}

// ── Individual DNS sub-checks (run in parallel) ─────────────────────────────

async function checkSPF(domain: string): Promise<Vulnerability[]> {
  const findings: Vulnerability[] = []
  try {
    const txtRecords = await dns.resolveTxt(domain)
    const flat = txtRecords.map((r) => r.join(""))
    const spf = flat.find((r) => r.startsWith("v=spf1"))
    if (!spf) {
      findings.push(
        makeVuln(
          "Missing SPF Record",
          "medium",
          "configuration",
          "No SPF (Sender Policy Framework) DNS record was found for this domain.",
          `No TXT record starting with 'v=spf1' found for ${domain}.`,
          "Without SPF, attackers can send emails that appear to come from your domain (email spoofing/phishing).",
          "SPF is a DNS TXT record that specifies which mail servers are authorized to send email on behalf of your domain.",
          [
            "Add a TXT record to your DNS with your SPF policy.",
            "Start with: v=spf1 include:_spf.google.com ~all (adjust for your mail provider).",
            "Use -all (hard fail) for strict enforcement or ~all (soft fail) to start.",
          ],
          [{ label: "DNS TXT Record", language: "dns", code: 'v=spf1 include:_spf.google.com include:sendgrid.net -all' }],
        ),
      )
    } else if (spf.includes("+all")) {
      findings.push(
        makeVuln(
          "Weak SPF Record (+all)",
          "high",
          "configuration",
          "SPF record uses +all which allows any server to send email as your domain.",
          `SPF record: ${spf}`,
          "The +all mechanism effectively disables SPF protection, allowing anyone to spoof emails from your domain.",
          "SPF with +all means 'allow all senders' which defeats the purpose of having SPF at all.",
          ["Change +all to -all (hard fail) or ~all (soft fail).", "Audit which mail servers need to be in your SPF record."],
        ),
      )
    }
  } catch { /* DNS failed */ }
  return findings
}

async function checkDMARC(domain: string): Promise<Vulnerability[]> {
  const findings: Vulnerability[] = []
  try {
    const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`)
    const dmarcFlat = dmarcRecords.map((r) => r.join(""))
    const dmarc = dmarcFlat.find((r) => r.startsWith("v=DMARC1"))
    if (!dmarc) {
      findings.push(
        makeVuln(
          "Missing DMARC Record",
          "medium",
          "configuration",
          "No DMARC (Domain-based Message Authentication) record was found.",
          `No TXT record at _dmarc.${domain} starting with 'v=DMARC1'.`,
          "Without DMARC, there is no policy telling email receivers how to handle messages that fail SPF/DKIM checks.",
          "DMARC builds on SPF and DKIM to provide email authentication.",
          [
            "Add a TXT record at _dmarc.yourdomain.com.",
            "Start with p=none to monitor, then move to p=quarantine or p=reject.",
            "Include a rua= tag to receive aggregate reports.",
          ],
          [{ label: "DNS TXT Record", language: "dns", code: 'v=DMARC1; p=reject; rua=mailto:dmarc-reports@yourdomain.com; adkim=s; aspf=s' }],
        ),
      )
    } else if (dmarc.includes("p=none")) {
      findings.push(
        makeVuln(
          "DMARC Policy Set to None",
          "low",
          "configuration",
          "DMARC record exists but policy is set to 'none', meaning failed emails are still delivered.",
          `DMARC record: ${dmarc}`,
          "With p=none, DMARC only monitors but does not prevent spoofed emails from being delivered.",
          "A DMARC policy of 'none' is useful for initial monitoring but should be upgraded to 'quarantine' or 'reject'.",
          ["Upgrade to p=quarantine (send to spam) or p=reject (block entirely).", "Review DMARC reports first."],
        ),
      )
    }
  } catch {
    findings.push(
      makeVuln(
        "Missing DMARC Record",
        "medium",
        "configuration",
        "No DMARC (Domain-based Message Authentication) record was found.",
        `No TXT record found at _dmarc.${domain}.`,
        "Without DMARC, there is no policy telling email receivers how to handle messages that fail SPF/DKIM checks.",
        "DMARC builds on SPF and DKIM to provide email authentication.",
        ["Add a TXT record at _dmarc.yourdomain.com.", "Start with p=none to monitor, then move to p=quarantine or p=reject."],
      ),
    )
  }
  return findings
}

async function checkDKIM(domain: string): Promise<Vulnerability[]> {
  const selectors = ["default", "google", "selector1", "selector2", "k1", "s1", "dkim", "mail", "protonmail", "protonmail2", "protonmail3", "mxvault", "cm", "mandrill", "smtp", "zendesk1", "zendesk2", "em1", "em2", "s2"]

  // Race all selectors: resolve as soon as ANY one is found
  const found = await new Promise<boolean>((resolve) => {
    let pending = selectors.length
    let resolved = false

    for (const sel of selectors) {
      const dkimHost = `${sel}._domainkey.${domain}`

      // Check TXT then CNAME for each selector
      ;(async () => {
        try {
          const records = await dns.resolveTxt(dkimHost)
          const flat = records.map((r) => r.join(""))
          if (flat.some((r) => r.includes("v=DKIM1") || r.includes("p="))) {
            if (!resolved) { resolved = true; resolve(true) }
            return
          }
        } catch { /* no TXT */ }
        try {
          const cnames = await dns.resolveCname(dkimHost)
          if (cnames.length > 0) {
            if (!resolved) { resolved = true; resolve(true) }
            return
          }
        } catch { /* no CNAME */ }

        pending--
        if (pending === 0 && !resolved) { resolved = true; resolve(false) }
      })()
    }
  })

  if (!found) {
    return [
      makeVuln(
        "No DKIM Records Found",
        "low",
        "configuration",
        "No DKIM (DomainKeys Identified Mail) records were found for common selectors.",
        `Checked selectors: ${selectors.join(", ")} at _domainkey.${domain}`,
        "Without DKIM, email receivers cannot verify that messages were actually sent by your mail servers.",
        "DKIM adds a digital signature to outgoing emails. Note: DKIM selectors vary by provider, so this check may miss custom selectors.",
        [
          "Configure DKIM signing in your email provider (Google Workspace, Microsoft 365, etc.).",
          "Publish the DKIM public key as a TXT record at selector._domainkey.yourdomain.com.",
        ],
      ),
    ]
  }
  return []
}

async function checkDNSSEC(domain: string): Promise<Vulnerability[]> {
  // Query Google and Cloudflare DoH in parallel for the AD (Authenticated Data) flag
  const [googleAD, cloudflareAD] = await Promise.allSettled([
    fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A&do=1`, { signal: AbortSignal.timeout(4000) })
      .then((r) => r.json())
      .then((d) => d.AD === true),
    fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A&do=true`, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/dns-json" },
    })
      .then((r) => r.json())
      .then((d) => d.AD === true),
  ])

  const enabled =
    (googleAD.status === "fulfilled" && googleAD.value) ||
    (cloudflareAD.status === "fulfilled" && cloudflareAD.value)

  if (!enabled) {
    return [
      makeVuln(
        "DNSSEC Not Enabled",
        "info",
        "configuration",
        "DNSSEC does not appear to be enabled for this domain.",
        `DNSSEC validation (AD flag) not set for ${domain} via Google and Cloudflare DNS resolvers.`,
        "Without DNSSEC, DNS responses can be spoofed (DNS cache poisoning), redirecting users to malicious servers.",
        "DNSSEC adds cryptographic signatures to DNS records. It's typically configured through your domain registrar.",
        [
          "Enable DNSSEC through your domain registrar.",
          "Most registrars (Cloudflare, Google Domains, Namecheap) support one-click DNSSEC activation.",
          "Verify with: dig +dnssec yourdomain.com",
        ],
      ),
    ]
  }
  return []
}

// ── DNS Security (orchestrator: runs all sub-checks in parallel) ───────────

async function checkDNSSecurity(domain: string): Promise<Vulnerability[]> {
  const results = await Promise.allSettled([
    checkSPF(domain),
    checkDMARC(domain),
    checkDKIM(domain),
    checkDNSSEC(domain),
  ])

  const findings: Vulnerability[] = []
  for (const r of results) {
    if (r.status === "fulfilled") findings.push(...r.value)
  }
  return findings
}

// ── TLS Certificate Checks ───────────────────────────────────────────────────

function checkTLSCert(hostname: string, port: number = 443): Promise<Vulnerability[]> {
  return new Promise((resolve) => {
    const findings: Vulnerability[] = []
    const timeout = setTimeout(() => resolve(findings), 5000)

    try {
      const socket = tls.connect(
        {
          host: hostname,
          port,
          servername: hostname,
          rejectUnauthorized: false,
          timeout: 4500,
        },
        () => {
          try {
            const cert = socket.getPeerCertificate()
            const authorized = socket.authorized
            const protocol = socket.getProtocol()

            if (!authorized) {
              const authError = socket.authorizationError
              if (authError === "DEPTH_ZERO_SELF_SIGNED_CERT" || authError === "SELF_SIGNED_CERT_IN_CHAIN") {
                findings.push(
                  makeVuln(
                    "Self-Signed TLS Certificate",
                    "high",
                    "ssl",
                    "The server uses a self-signed TLS certificate that is not trusted by browsers.",
                    `Certificate authorization error: ${authError}`,
                    "Browsers will show security warnings, making users vulnerable to real MITM attacks.",
                    "Self-signed certificates are not issued by a trusted CA. While they encrypt traffic, they don't verify the server's identity.",
                    ["Obtain a certificate from a trusted CA (Let's Encrypt is free).", "Use automated cert management (certbot, Caddy, or your hosting provider)."],
                  ),
                )
              } else if (authError === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
                findings.push(
                  makeVuln(
                    "Incomplete TLS Certificate Chain",
                    "medium",
                    "ssl",
                    "The TLS certificate chain is incomplete. Intermediate certificates may be missing.",
                    `Certificate authorization error: ${authError}`,
                    "Some clients may not trust this certificate because the full chain to a root CA cannot be verified.",
                    "TLS certificates form a chain of trust. If intermediates are missing, some clients can't verify the chain.",
                    ["Ensure your server sends the full certificate chain (leaf + intermediates).", "Use SSL Labs (ssllabs.com/ssltest) to verify your chain."],
                  ),
                )
              }
            }

            if (cert && cert.valid_to) {
              const expiryDate = new Date(cert.valid_to)
              const daysUntilExpiry = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

              if (daysUntilExpiry < 0) {
                findings.push(
                  makeVuln(
                    "Expired TLS Certificate", "critical", "ssl",
                    "The TLS certificate has expired.",
                    `Certificate expired on ${cert.valid_to} (${Math.abs(daysUntilExpiry)} days ago).`,
                    "Browsers will block access with a full-page security warning.",
                    "An expired certificate means the server's identity can no longer be verified.",
                    ["Renew the certificate immediately.", "Set up automatic renewal with Let's Encrypt / certbot."],
                  ),
                )
              } else if (daysUntilExpiry <= 14) {
                findings.push(
                  makeVuln(
                    "TLS Certificate Expiring Soon", "high", "ssl",
                    "The TLS certificate will expire within 14 days.",
                    `Certificate expires on ${cert.valid_to} (${daysUntilExpiry} days remaining).`,
                    "If the certificate expires, browsers will show security warnings and block access.",
                    "TLS certificates have a finite validity period. Renewing before expiry prevents downtime.",
                    ["Renew the certificate before it expires.", "Enable auto-renewal if available."],
                  ),
                )
              } else if (daysUntilExpiry <= 30) {
                findings.push(
                  makeVuln(
                    "TLS Certificate Expiring Within 30 Days", "medium", "ssl",
                    "The TLS certificate will expire within 30 days.",
                    `Certificate expires on ${cert.valid_to} (${daysUntilExpiry} days remaining).`,
                    "Plan to renew soon to avoid any disruption.",
                    "Most CAs recommend renewing at least 30 days before expiry.",
                    ["Schedule certificate renewal.", "Consider automating renewals with Let's Encrypt."],
                  ),
                )
              }
            }

            if (protocol) {
              const weakProtocols = ["TLSv1", "TLSv1.1", "SSLv3"]
              if (weakProtocols.includes(protocol)) {
                findings.push(
                  makeVuln(
                    "Weak TLS Protocol Version", "high", "ssl",
                    `The server negotiated ${protocol}, which is considered insecure.`,
                    `Negotiated protocol: ${protocol}`,
                    "Older TLS versions have known vulnerabilities (POODLE, BEAST, etc.).",
                    "TLS 1.0 and 1.1 are deprecated. Only TLS 1.2 and 1.3 should be supported.",
                    ["Disable TLS 1.0 and TLS 1.1.", "Ensure TLS 1.2 and TLS 1.3 are enabled."],
                    [{ label: "Nginx", language: "nginx", code: "ssl_protocols TLSv1.2 TLSv1.3;\nssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;" }],
                  ),
                )
              }
            }
          } catch { /* cert inspection failed */ }

          socket.destroy()
          clearTimeout(timeout)
          resolve(findings)
        },
      )

      socket.on("error", () => { clearTimeout(timeout); resolve(findings) })
      socket.on("timeout", () => { socket.destroy(); clearTimeout(timeout); resolve(findings) })
    } catch {
      clearTimeout(timeout)
      resolve(findings)
    }
  })
}

// ── Live Fetch Checks (robots.txt, security.txt) ─────────────────────────────

const FETCH_OPTS = {
  signal: undefined as AbortSignal | undefined,
  redirect: "follow" as RequestRedirect,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; VulnRadar/1.0; +https://vulnradar.dev)",
    "Accept": "text/plain, text/*;q=0.9, */*;q=0.8",
  },
}

async function checkRobotsTxt(origin: string): Promise<Vulnerability[]> {
  const findings: Vulnerability[] = []
  try {
    const res = await fetch(`${origin}/robots.txt`, { ...FETCH_OPTS, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return findings

    const body = await res.text()
    if (!body.includes("User-agent") && !body.includes("Disallow") && !body.includes("Allow")) return findings

    // Single combined regex for all sensitive paths
    const sensitiveRegex = /Disallow:\s*(\/(?:admin|backup|config|database|private|secret|\.env|\.git|wp-admin|cgi-bin|tmp|internal|api\/internal|debug|staging|test)\b[^\n]*)/gi
    const found: string[] = []
    let match: RegExpExecArray | null
    while ((match = sensitiveRegex.exec(body)) !== null) {
      found.push(match[0].trim())
    }

    if (found.length > 0) {
      findings.push(
        makeVuln(
          "Sensitive Paths Exposed in robots.txt",
          "medium",
          "information-disclosure",
          "The robots.txt file reveals sensitive directory paths that attackers can use for reconnaissance.",
          `Fetched ${origin}/robots.txt, found ${found.length} sensitive path(s):\n${found.slice(0, 8).join("\n")}${found.length > 8 ? `\n...and ${found.length - 8} more` : ""}`,
          "Attackers use robots.txt as a roadmap to find admin panels, configuration files, and other sensitive resources.",
          "robots.txt is publicly readable by design. Security should not depend on hiding URLs.",
          [
            "Remove references to sensitive paths from robots.txt.",
            "Protect sensitive endpoints with authentication instead of relying on obscurity.",
          ],
        ),
      )
    }
  } catch { /* skip */ }
  return findings
}

async function checkSecurityTxt(origin: string): Promise<Vulnerability[]> {
  // Check both URLs in parallel
  const [wellKnown, root] = await Promise.allSettled([
    fetch(`${origin}/.well-known/security.txt`, { ...FETCH_OPTS, signal: AbortSignal.timeout(5000) }),
    fetch(`${origin}/security.txt`, { ...FETCH_OPTS, signal: AbortSignal.timeout(5000) }),
  ])

  const found =
    (wellKnown.status === "fulfilled" && wellKnown.value.ok) ||
    (root.status === "fulfilled" && root.value.ok)

  if (!found) {
    return [
      makeVuln(
        "Missing security.txt",
        "info",
        "configuration",
        "No security.txt file was found at /.well-known/security.txt or /security.txt.",
        `Both ${origin}/.well-known/security.txt and ${origin}/security.txt returned non-200 status.`,
        "Security researchers who find vulnerabilities may not know how to responsibly report them.",
        "security.txt (RFC 9116) is a standard for responsible disclosure contact information.",
        ["Create a security.txt file at /.well-known/security.txt.", "Include at minimum: Contact, Expires."],
        [{ label: "security.txt", language: "text", code: "Contact: mailto:security@yourdomain.com\nExpires: 2026-12-31T23:59:59z\nPreferred-Languages: en" }],
      ),
    ]
  }
  return []
}

async function checkLiveFetch(url: string): Promise<Vulnerability[]> {
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return []
  }

  // Run robots.txt and security.txt in parallel
  const [robotsResult, securityResult] = await Promise.allSettled([
    checkRobotsTxt(origin),
    checkSecurityTxt(origin),
  ])

  const findings: Vulnerability[] = []
  if (robotsResult.status === "fulfilled") findings.push(...robotsResult.value)
  if (securityResult.status === "fulfilled") findings.push(...securityResult.value)
  return findings
}

// ── Main runner ──────────────────────────────────────────────────────────────

export async function runAsyncChecks(url: string, categories?: string[] | null): Promise<Vulnerability[]> {
  let hostname: string
  let isHTTPS: boolean
  try {
    const parsed = new URL(url)
    hostname = parsed.hostname
    isHTTPS = parsed.protocol === "https:"
  } catch {
    return []
  }

  const allowed = categories ? new Set(categories) : null
  const runAll = !allowed

  // Build tasks based on selected categories
  const tasks: Promise<Vulnerability[]>[] = []

  // DNS checks map to "dns" category (SPF, DMARC, DKIM, DNSSEC)
  if (runAll || allowed!.has("dns")) {
    tasks.push(checkDNSSecurity(hostname))
  }

  // TLS checks map to "ssl" category
  if ((runAll || allowed!.has("ssl")) && isHTTPS) {
    tasks.push(checkTLSCert(hostname))
  }

  // Live fetch checks (robots.txt → configuration/information-disclosure, security.txt → configuration)
  if (runAll || allowed!.has("configuration") || allowed!.has("information-disclosure")) {
    tasks.push(checkLiveFetch(url))
  }

  if (tasks.length === 0) return []

  const results = await Promise.allSettled(tasks)
  const findings: Vulnerability[] = []
  for (const r of results) {
    if (r.status === "fulfilled") findings.push(...r.value)
  }
  return findings
}
