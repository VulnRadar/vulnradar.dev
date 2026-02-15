/**
 * Async security checks that require network I/O (DNS, TLS, live-fetch).
 * These run in parallel during a scan alongside the synchronous body/header checks.
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

// ── DNS Security Checks ──────────────────────────────────────────────────────

async function checkDNSSecurity(domain: string): Promise<Vulnerability[]> {
  const findings: Vulnerability[] = []

  // SPF Check
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
          "SPF is a DNS TXT record that specifies which mail servers are authorized to send email on behalf of your domain. Email receivers check SPF to verify the sender.",
          [
            "Add a TXT record to your DNS with your SPF policy.",
            "Start with: v=spf1 include:_spf.google.com ~all (adjust for your mail provider).",
            "Use -all (hard fail) for strict enforcement or ~all (soft fail) to start.",
          ],
          [
            {
              label: "DNS TXT Record",
              language: "dns",
              code: 'v=spf1 include:_spf.google.com include:sendgrid.net -all',
            },
          ],
        ),
      )
    } else {
      // Check for weak SPF
      if (spf.includes("+all")) {
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
    }

    // DMARC Check
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
            "DMARC builds on SPF and DKIM to provide email authentication. It tells receivers what to do with unauthenticated emails and where to send reports.",
            [
              "Add a TXT record at _dmarc.yourdomain.com.",
              "Start with p=none to monitor, then move to p=quarantine or p=reject.",
              "Include a rua= tag to receive aggregate reports.",
            ],
            [
              {
                label: "DNS TXT Record",
                language: "dns",
                code: 'v=DMARC1; p=reject; rua=mailto:dmarc-reports@yourdomain.com; adkim=s; aspf=s',
              },
            ],
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
            "A DMARC policy of 'none' is useful for initial monitoring but should be upgraded to 'quarantine' or 'reject' once you've verified legitimate mail flows.",
            ["Upgrade to p=quarantine (send to spam) or p=reject (block entirely).", "Review DMARC reports first to ensure legitimate emails aren't affected."],
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
          "DMARC builds on SPF and DKIM to provide email authentication. It tells receivers what to do with unauthenticated emails and where to send reports.",
          [
            "Add a TXT record at _dmarc.yourdomain.com.",
            "Start with p=none to monitor, then move to p=quarantine or p=reject.",
          ],
        ),
      )
    }

    // DKIM Check (check common selectors)
    const selectors = ["default", "google", "selector1", "selector2", "k1", "s1", "dkim", "mail"]
    let dkimFound = false
    for (const sel of selectors) {
      try {
        const dkimRecords = await dns.resolveTxt(`${sel}._domainkey.${domain}`)
        const dkimFlat = dkimRecords.map((r) => r.join(""))
        if (dkimFlat.some((r) => r.includes("v=DKIM1") || r.includes("p="))) {
          dkimFound = true
          break
        }
      } catch {
        // Selector not found, try next
      }
    }
    if (!dkimFound) {
      findings.push(
        makeVuln(
          "No DKIM Records Found",
          "low",
          "configuration",
          "No DKIM (DomainKeys Identified Mail) records were found for common selectors.",
          `Checked selectors: ${selectors.join(", ")} at _domainkey.${domain}`,
          "Without DKIM, email receivers cannot verify that messages were actually sent by your mail servers and weren't tampered with.",
          "DKIM adds a digital signature to outgoing emails. Receivers verify this signature using a public key published in DNS. Note: DKIM selectors vary by provider, so this check may miss custom selectors.",
          [
            "Configure DKIM signing in your email provider (Google Workspace, Microsoft 365, etc.).",
            "Publish the DKIM public key as a TXT record at selector._domainkey.yourdomain.com.",
          ],
        ),
      )
    }
  } catch {
    // DNS resolution failed entirely -- domain may not have TXT records
  }

  // DNSSEC Check
  try {
    // Check for DNSKEY records which indicate DNSSEC is enabled
    await dns.resolve(domain, "DNSKEY" as any)
    // If we get here, DNSSEC records exist
  } catch {
    findings.push(
      makeVuln(
        "DNSSEC Not Enabled",
        "info",
        "configuration",
        "DNSSEC does not appear to be enabled for this domain.",
        `No DNSKEY records found for ${domain}.`,
        "Without DNSSEC, DNS responses can be spoofed (DNS cache poisoning), redirecting users to malicious servers.",
        "DNSSEC adds cryptographic signatures to DNS records, allowing resolvers to verify that responses haven't been tampered with. It's typically configured through your domain registrar.",
        [
          "Enable DNSSEC through your domain registrar.",
          "Most registrars (Cloudflare, Google Domains, Namecheap) support one-click DNSSEC activation.",
          "Verify with: dig +dnssec yourdomain.com",
        ],
      ),
    )
  }

  return findings
}

// ── TLS Certificate Checks ───────────────────────────────────────────────────

function checkTLSCert(hostname: string, port: number = 443): Promise<Vulnerability[]> {
  return new Promise((resolve) => {
    const findings: Vulnerability[] = []
    const timeout = setTimeout(() => resolve(findings), 8000)

    try {
      const socket = tls.connect(
        {
          host: hostname,
          port,
          servername: hostname,
          rejectUnauthorized: false, // We want to inspect even invalid certs
          timeout: 7000,
        },
        () => {
          try {
            const cert = socket.getPeerCertificate()
            const authorized = socket.authorized
            const protocol = socket.getProtocol()

            // Check if cert is self-signed or untrusted
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
                    "Browsers will show security warnings, and users may be trained to click through them, making them vulnerable to real MITM attacks.",
                    "Self-signed certificates are not issued by a trusted Certificate Authority (CA). While they encrypt traffic, they don't verify the server's identity.",
                    [
                      "Obtain a certificate from a trusted CA (Let's Encrypt is free).",
                      "Use automated cert management (certbot, Caddy, or your hosting provider).",
                    ],
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
                    "Some browsers and clients may not trust this certificate because the full chain to a root CA cannot be verified.",
                    "TLS certificates form a chain of trust from your certificate through intermediates to a root CA. If intermediates are missing, some clients can't verify the chain.",
                    [
                      "Ensure your server sends the full certificate chain (leaf + intermediates).",
                      "Use SSL Labs (ssllabs.com/ssltest) to verify your chain.",
                    ],
                  ),
                )
              }
            }

            // Check cert expiry
            if (cert && cert.valid_to) {
              const expiryDate = new Date(cert.valid_to)
              const now = new Date()
              const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

              if (daysUntilExpiry < 0) {
                findings.push(
                  makeVuln(
                    "Expired TLS Certificate",
                    "critical",
                    "ssl",
                    "The TLS certificate has expired.",
                    `Certificate expired on ${cert.valid_to} (${Math.abs(daysUntilExpiry)} days ago).`,
                    "Browsers will block access to the site with a full-page security warning. Users cannot proceed without explicitly bypassing the warning.",
                    "An expired certificate means the identity of the server can no longer be verified. Browsers treat this as a critical security issue.",
                    ["Renew the certificate immediately.", "Set up automatic renewal with Let's Encrypt / certbot."],
                  ),
                )
              } else if (daysUntilExpiry <= 14) {
                findings.push(
                  makeVuln(
                    "TLS Certificate Expiring Soon",
                    "high",
                    "ssl",
                    "The TLS certificate will expire within 14 days.",
                    `Certificate expires on ${cert.valid_to} (${daysUntilExpiry} days remaining).`,
                    "If the certificate expires, browsers will show security warnings and block access to your site.",
                    "TLS certificates have a finite validity period. Renewing before expiry prevents downtime and security warnings.",
                    ["Renew the certificate before it expires.", "Enable auto-renewal if available."],
                  ),
                )
              } else if (daysUntilExpiry <= 30) {
                findings.push(
                  makeVuln(
                    "TLS Certificate Expiring Within 30 Days",
                    "medium",
                    "ssl",
                    "The TLS certificate will expire within 30 days.",
                    `Certificate expires on ${cert.valid_to} (${daysUntilExpiry} days remaining).`,
                    "Plan to renew soon to avoid any disruption.",
                    "Most CAs recommend renewing at least 30 days before expiry to allow time for any issues.",
                    ["Schedule certificate renewal.", "Consider automating renewals with Let's Encrypt."],
                  ),
                )
              }
            }

            // Check for weak protocol
            if (protocol) {
              const weakProtocols = ["TLSv1", "TLSv1.1", "SSLv3"]
              if (weakProtocols.includes(protocol)) {
                findings.push(
                  makeVuln(
                    "Weak TLS Protocol Version",
                    "high",
                    "ssl",
                    `The server negotiated ${protocol}, which is considered insecure.`,
                    `Negotiated protocol: ${protocol}`,
                    "Older TLS versions have known vulnerabilities (POODLE, BEAST, etc.) that allow attackers to decrypt traffic.",
                    "TLS 1.0 and 1.1 are deprecated by all major browsers. Only TLS 1.2 and 1.3 should be supported.",
                    [
                      "Disable TLS 1.0 and TLS 1.1 on your server.",
                      "Ensure TLS 1.2 and TLS 1.3 are enabled.",
                      "Update your server configuration to use modern cipher suites.",
                    ],
                    [
                      {
                        label: "Nginx",
                        language: "nginx",
                        code: "ssl_protocols TLSv1.2 TLSv1.3;\nssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;",
                      },
                    ],
                  ),
                )
              }
            }
          } catch {
            // Cert inspection failed
          }

          socket.destroy()
          clearTimeout(timeout)
          resolve(findings)
        },
      )

      socket.on("error", () => {
        clearTimeout(timeout)
        resolve(findings)
      })

      socket.on("timeout", () => {
        socket.destroy()
        clearTimeout(timeout)
        resolve(findings)
      })
    } catch {
      clearTimeout(timeout)
      resolve(findings)
    }
  })
}

// ── Live Fetch Checks (robots.txt, security.txt) ─────────────────────────────

async function checkLiveFetch(url: string): Promise<Vulnerability[]> {
  const findings: Vulnerability[] = []
  let origin: string
  try {
    const parsed = new URL(url)
    origin = parsed.origin
  } catch {
    return findings
  }

  // Fetch robots.txt
  try {
    const robotsRes = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "VulnRadar/1.0 (Security Scanner)" },
    })
    if (robotsRes.ok) {
      const robotsBody = await robotsRes.text()
      // Only process if it looks like a real robots.txt (not an HTML error page)
      if (robotsBody.includes("User-agent") || robotsBody.includes("Disallow") || robotsBody.includes("Allow")) {
        const sensitivePatterns = [
          /Disallow:\s*(\/admin\b[^\n]*)/gi,
          /Disallow:\s*(\/backup\b[^\n]*)/gi,
          /Disallow:\s*(\/config\b[^\n]*)/gi,
          /Disallow:\s*(\/database\b[^\n]*)/gi,
          /Disallow:\s*(\/private\b[^\n]*)/gi,
          /Disallow:\s*(\/secret\b[^\n]*)/gi,
          /Disallow:\s*(\/\.env\b[^\n]*)/gi,
          /Disallow:\s*(\/\.git\b[^\n]*)/gi,
          /Disallow:\s*(\/wp-admin\b[^\n]*)/gi,
          /Disallow:\s*(\/cgi-bin\b[^\n]*)/gi,
          /Disallow:\s*(\/tmp\b[^\n]*)/gi,
          /Disallow:\s*(\/internal\b[^\n]*)/gi,
          /Disallow:\s*(\/api\/internal\b[^\n]*)/gi,
          /Disallow:\s*(\/debug\b[^\n]*)/gi,
          /Disallow:\s*(\/staging\b[^\n]*)/gi,
          /Disallow:\s*(\/test\b[^\n]*)/gi,
        ]
        const found: string[] = []
        for (const p of sensitivePatterns) {
          const matches = [...robotsBody.matchAll(p)]
          for (const m of matches) {
            found.push(m[0].trim())
          }
        }

        if (found.length > 0) {
          findings.push(
            makeVuln(
              "Sensitive Paths Exposed in robots.txt",
              "medium",
              "information-disclosure",
              "The robots.txt file reveals sensitive directory paths that attackers can use for reconnaissance.",
              `Fetched ${origin}/robots.txt -- found ${found.length} sensitive path(s):\n${found.slice(0, 8).join("\n")}${found.length > 8 ? `\n...and ${found.length - 8} more` : ""}`,
              "While robots.txt is meant to guide search engine crawlers, attackers use it as a roadmap to find admin panels, configuration files, and other sensitive resources.",
              "robots.txt is publicly readable by design. Listing sensitive paths in Disallow rules tells attackers exactly where to look. Security should not depend on hiding URLs.",
              [
                "Remove references to sensitive paths from robots.txt.",
                "Protect sensitive endpoints with authentication instead of relying on obscurity.",
                "Use a Web Application Firewall (WAF) to restrict access to admin paths.",
              ],
            ),
          )
        }

        // Check for overly permissive wildcard
        if (/User-agent:\s*\*[\s\S]*?Allow:\s*\/\s*$/m.test(robotsBody) && !/Disallow/i.test(robotsBody)) {
          // Completely open -- not necessarily a finding, just informational
        }
      }
    }
  } catch {
    // robots.txt fetch failed, skip
  }

  // Fetch security.txt
  try {
    let secTxtRes = await fetch(`${origin}/.well-known/security.txt`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "VulnRadar/1.0 (Security Scanner)" },
    })
    // Fall back to /security.txt
    if (!secTxtRes.ok) {
      secTxtRes = await fetch(`${origin}/security.txt`, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "VulnRadar/1.0 (Security Scanner)" },
      })
    }

    if (secTxtRes.ok) {
      const secBody = await secTxtRes.text()
      // Validate it looks like a real security.txt
      if (secBody.includes("Contact:") || secBody.includes("contact:")) {
        // Check for expiry
        const expiresMatch = secBody.match(/Expires:\s*(.+)/i)
        if (expiresMatch) {
          const expiryDate = new Date(expiresMatch[1].trim())
          if (!isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
            findings.push(
              makeVuln(
                "Expired security.txt",
                "low",
                "configuration",
                "The security.txt file has an expired Expires field.",
                `Expires: ${expiresMatch[1].trim()} (expired)`,
                "An expired security.txt may indicate it's no longer maintained, reducing trust from security researchers trying to report vulnerabilities.",
                "RFC 9116 requires security.txt to include an Expires field. Keeping it current signals that the organization actively handles security reports.",
                ["Update the Expires field in your security.txt to a future date."],
              ),
            )
          }
        }
      } else {
        // Response was OK but doesn't look like security.txt
        findings.push(
          makeVuln(
            "Missing security.txt",
            "info",
            "configuration",
            "No valid security.txt file was found at /.well-known/security.txt.",
            `Fetched ${origin}/.well-known/security.txt but response does not contain Contact: field.`,
            "Security researchers who find vulnerabilities may not know how to responsibly report them to your organization.",
            "security.txt (RFC 9116) is a standard that helps security researchers find the right contact for responsible disclosure. It should be placed at /.well-known/security.txt.",
            [
              "Create a security.txt file at /.well-known/security.txt.",
              "Include at minimum: Contact, Expires, and optionally Policy and Preferred-Languages.",
            ],
            [
              {
                label: "security.txt",
                language: "text",
                code: "Contact: mailto:security@yourdomain.com\nExpires: 2026-12-31T23:59:59z\nPreferred-Languages: en\nPolicy: https://yourdomain.com/security-policy",
              },
            ],
          ),
        )
      }
    } else {
      findings.push(
        makeVuln(
          "Missing security.txt",
          "info",
          "configuration",
          "No security.txt file was found at /.well-known/security.txt or /security.txt.",
          `Attempted to fetch ${origin}/.well-known/security.txt and ${origin}/security.txt -- both returned non-200 status.`,
          "Security researchers who find vulnerabilities may not know how to responsibly report them to your organization.",
          "security.txt (RFC 9116) is a standard that helps security researchers find the right contact for responsible disclosure.",
          [
            "Create a security.txt file at /.well-known/security.txt.",
            "Include at minimum: Contact, Expires.",
          ],
          [
            {
              label: "security.txt",
              language: "text",
              code: "Contact: mailto:security@yourdomain.com\nExpires: 2026-12-31T23:59:59z\nPreferred-Languages: en",
            },
          ],
        ),
      )
    }
  } catch {
    // security.txt fetch failed, skip
  }

  return findings
}

// ── Main runner ──────────────────────────────────────────────────────────────

export async function runAsyncChecks(url: string): Promise<Vulnerability[]> {
  let hostname: string
  let isHTTPS: boolean
  try {
    const parsed = new URL(url)
    hostname = parsed.hostname
    isHTTPS = parsed.protocol === "https:"
  } catch {
    return []
  }

  // Run all async checks in parallel
  const results = await Promise.allSettled([
    checkDNSSecurity(hostname),
    isHTTPS ? checkTLSCert(hostname) : Promise.resolve([]),
    checkLiveFetch(url),
  ])

  const findings: Vulnerability[] = []
  for (const r of results) {
    if (r.status === "fulfilled") {
      findings.push(...r.value)
    }
  }

  return findings
}
