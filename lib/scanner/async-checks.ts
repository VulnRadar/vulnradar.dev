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

import * as dns from "dns/promises";
import * as tls from "tls";
import { isIP } from "net";
import type { Vulnerability, Category, ScanProgressHook } from "./types";
import {
  isPrivateHostname,
  validateScanTarget,
  safeFetch,
} from "@/lib/scanner/safe-fetch";
import { extractRootDomain } from "@/lib/scanner/root-domain";
import { APP_NAME, APP_URL } from "@/lib/config/constants";

/**
 * Race a DNS lookup against a hard deadline.
 *
 * `dns.resolveTxt` has no built-in timeout: against an unresponsive
 * resolver it can hang for the underlying c-ares retry chain, which is tens
 * of seconds and sometimes longer. Every other DNS sub-check in this file
 * already races its lookup this way; checkSPF and checkDMARC previously did
 * not, which meant a single slow domain could stall `checkDNSSecurity` well
 * past the 15s the scan route allots the whole async layer, discarding
 * every async finding rather than just the slow one.
 */
function withDnsTimeout<T>(promise: Promise<T>, ms = 4000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("dns timeout")), ms),
    ),
  ]);
}

function fnvHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

// Deterministic ID: same title + same URL → same ID across scans.
// Title is a constant string per check, so this is stable.
function generateId(title: string, url: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `async-${slug}--${fnvHash(url)}`;
}

function makeVuln(
  url: string,
  title: string,
  severity: "critical" | "high" | "medium" | "low" | "info",
  category: Category,
  description: string,
  evidence: string,
  riskImpact: string,
  explanation: string,
  fixSteps: string[],
  codeExamples: { label: string; language: string; code: string }[] = [],
  confidence = 90,
): Vulnerability {
  return {
    id: generateId(title, url),
    title,
    severity,
    category,
    description,
    evidence,
    riskImpact,
    explanation,
    fixSteps,
    codeExamples,
    references: [],
    confidence,
    detectionMethod: "Async network probe",
  };
}

// ── Individual DNS sub-checks (run in parallel) ─────────────────────────────

export async function checkSPF(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const findings: Vulnerability[] = [];
  try {
    const txtRecords = await withDnsTimeout(dns.resolveTxt(domain));
    const flat = txtRecords.map((r) => r.join(""));
    const spf = flat.find((r) => r.startsWith("v=spf1"));
    if (!spf) {
      findings.push(
        makeVuln(
          url,
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
          [
            {
              label: "DNS TXT Record",
              language: "dns",
              code: "v=spf1 include:_spf.google.com include:sendgrid.net -all",
            },
          ],
        ),
      );
    } else if (spf.includes("+all")) {
      findings.push(
        makeVuln(
          url,
          "Weak SPF Record (+all)",
          "high",
          "configuration",
          "SPF record uses +all which allows any server to send email as your domain.",
          `SPF record: ${spf}`,
          "The +all mechanism effectively disables SPF protection, allowing anyone to spoof emails from your domain.",
          "SPF with +all means 'allow all senders' which defeats the purpose of having SPF at all.",
          [
            "Change +all to -all (hard fail) or ~all (soft fail).",
            "Audit which mail servers need to be in your SPF record.",
          ],
        ),
      );
    } else if (spf.includes("~all") && !spf.includes("-all")) {
      findings.push(
        makeVuln(
          url,
          "SPF Record Uses Soft Fail (~all)",
          "low",
          "configuration",
          "SPF record uses ~all (soft fail). Unauthorized senders are flagged but mail is still delivered.",
          `SPF record: ${spf}`,
          "Soft fail allows unauthorized email to reach recipients — receivers may still deliver spoofed messages.",
          "~all is a reasonable starting point, but upgrading to -all (hard fail) fully blocks unauthorized senders.",
          [
            "Once you have verified all legitimate mail sources are in your SPF record, change ~all to -all.",
            "Review DMARC aggregate reports (rua=) to identify any unauthorized senders before switching.",
          ],
          [
            {
              label: "DNS TXT Record",
              language: "dns",
              code: "v=spf1 include:_spf.google.com include:sendgrid.net -all",
            },
          ],
          75,
        ),
      );
    }
    if (spf && /\bptr\b/.test(spf)) {
      findings.push(
        makeVuln(
          url,
          "SPF Uses Deprecated ptr: Mechanism",
          "low",
          "configuration",
          "The SPF record uses the deprecated ptr: mechanism. RFC 7208 §5.5 says this SHOULD NOT be published.",
          `SPF record: ${spf}`,
          "ptr: triggers expensive reverse DNS lookups that can timeout or fail, causing SPF temperror and mail delivery issues.",
          "RFC 7208 explicitly deprecates ptr: because it is slow, unreliable, and counts against the 10-lookup limit.",
          [
            "Replace ptr: with explicit ip4:, ip6:, a:, or include: mechanisms.",
            "Audit all senders and add their IPs or SPF include references directly.",
          ],
        ),
      );
    }
  } catch {
    /* DNS failed */
  }
  return findings;
}

/**
 * Looks up _dmarc.<hostname> and returns the v=DMARC1 record, or null if
 * genuinely absent (ENODATA/ENOTFOUND/ENOENT). Rethrows on a transient DNS
 * error (timeout, SERVFAIL) so the caller can skip rather than
 * false-positive "missing".
 */
async function lookupDmarcTxt(hostname: string): Promise<string | null> {
  const records = await withDnsTimeout(dns.resolveTxt(`_dmarc.${hostname}`));
  const flat = records.map((r) => r.join(""));
  return flat.find((r) => r.startsWith("v=DMARC1")) ?? null;
}

export async function checkDMARC(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const findings: Vulnerability[] = [];
  let dmarc: string | null;
  try {
    dmarc = await lookupDmarcTxt(domain);
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: string }).code
        : "";
    if (code !== "ENODATA" && code !== "ENOTFOUND" && code !== "ENOENT") {
      return findings; // transient DNS error — don't false-positive
    }
    dmarc = null;
  }

  if (!dmarc) {
    // RFC 7489: a subdomain with no DMARC record of its own is still
    // covered by its organizational domain's policy -- that's the whole
    // reason DMARC defines an "organizational domain" at all. Real mail
    // receivers apply this, so flagging a covered subdomain as "missing"
    // is a false positive. The organizational domain's own scan is where
    // its policy strength (none/quarantine/reject) actually gets
    // evaluated, not here.
    const orgDomain = extractRootDomain(domain);
    if (orgDomain !== domain) {
      try {
        const orgRecord = await lookupDmarcTxt(orgDomain);
        if (orgRecord) return findings; // inherited and covered
      } catch {
        // Org-domain lookup failed too — fall through and report missing
        // for the exact domain, same as before this fallback existed.
      }
    }
    findings.push(
      makeVuln(
        url,
        "Missing DMARC Record",
        "medium",
        "configuration",
        "No DMARC (Domain-based Message Authentication) record was found.",
        `No TXT record at _dmarc.${domain} starting with 'v=DMARC1', and no organizational-domain policy to inherit from either.`,
        "Without DMARC, there is no policy telling email receivers how to handle messages that fail SPF/DKIM checks.",
        "DMARC builds on SPF and DKIM to provide email authentication.",
        [
          "Add a TXT record at _dmarc.yourdomain.com.",
          "Start with p=none to monitor, then move to p=quarantine or p=reject.",
          "Include a rua= tag to receive aggregate reports.",
        ],
        [
          {
            label: "DNS TXT Record",
            language: "dns",
            code: "v=DMARC1; p=reject; rua=mailto:dmarc-reports@yourdomain.com; adkim=s; aspf=s",
          },
        ],
      ),
    );
    return findings;
  }

  if (dmarc.includes("p=none")) {
    findings.push(
      makeVuln(
        url,
        "DMARC Policy Set to None",
        "low",
        "configuration",
        "DMARC record exists but policy is set to 'none', meaning failed emails are still delivered.",
        `DMARC record: ${dmarc}`,
        "With p=none, DMARC only monitors but does not prevent spoofed emails from being delivered.",
        "A DMARC policy of 'none' is useful for initial monitoring but should be upgraded to 'quarantine' or 'reject'.",
        [
          "Upgrade to p=quarantine (send to spam) or p=reject (block entirely).",
          "Review DMARC reports first.",
        ],
      ),
    );
  } else if (dmarc.includes("p=quarantine")) {
    findings.push(
      makeVuln(
        url,
        "DMARC Policy Set to Quarantine",
        "info",
        "configuration",
        "DMARC is set to quarantine: spoofed emails go to spam but are not fully blocked.",
        `DMARC record: ${dmarc}`,
        "Quarantined emails still reach recipients in their spam folder. p=reject fully blocks spoofed mail.",
        "p=quarantine is a good intermediate step, but p=reject provides the strongest protection.",
        [
          "Upgrade to p=reject once you have confirmed all legitimate email passes DMARC checks.",
          "Review DMARC aggregate reports (rua=) for any false positives before switching to reject.",
        ],
      ),
    );
  }

  // Check for missing aggregate (rua) and forensic (ruf) report endpoints
  if (dmarc && !dmarc.includes("rua=")) {
    findings.push(
      makeVuln(
        url,
        "DMARC Missing Aggregate Report Address (rua)",
        "info",
        "configuration",
        "DMARC record has no rua= tag. You will not receive aggregate reports about email authentication failures.",
        `DMARC record: ${dmarc}`,
        "Without rua=, you cannot detect SPF/DKIM failures or unauthorized senders using your domain.",
        "DMARC aggregate reports (rua) provide daily summaries of authentication results across all mail flows.",
        [
          "Add a rua= tag pointing to an email address or reporting service.",
          "Example: rua=mailto:dmarc-reports@yourdomain.com",
        ],
        [
          {
            label: "DNS TXT Record",
            language: "dns",
            code: "v=DMARC1; p=reject; rua=mailto:dmarc-reports@yourdomain.com; adkim=s; aspf=s",
          },
        ],
        80,
      ),
    );
  }
  if (dmarc) {
    const pctMatch = dmarc.match(/\bpct=(\d+)/);
    if (pctMatch) {
      const pctValue = parseInt(pctMatch[1], 10);
      if (pctValue < 100) {
        findings.push(
          makeVuln(
            url,
            "DMARC pct= Below 100",
            "low",
            "configuration",
            `DMARC pct=${pctValue} — only ${pctValue}% of non-compliant mail is subject to the DMARC policy.`,
            `pct=${pctValue} — only ${pctValue}% of non-compliant mail is subject to DMARC policy`,
            "Spoofed messages that fail DMARC have a chance of being delivered, bypassing DMARC protection.",
            "pct= is a gradual rollout mechanism. Set it to 100 once all legitimate mail passes authentication.",
            [
              "Review DMARC aggregate reports (rua=) to ensure all legitimate mail passes authentication.",
              "Increment pct= toward 100 as you fix any failing legitimate mail sources.",
              "Set pct=100 once confident no legitimate mail is failing.",
            ],
          ),
        );
      }
    }
  }

  return findings;
}

export async function checkDKIM(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  // Probe every selector in parallel -- one DKIM_QUERY_TIMEOUT_MS window
  // bounds the whole batch regardless of list length, so a longer list
  // costs latency-nothing (still one round-trip), only a few more sockets.
  // Generic/self-hosted selectors first, then one block per email
  // provider's own documented, fixed selector name(s). Providers that
  // instead mint a random or account-specific selector per tenant
  // (Amazon SES, Postmark, Mailgun's default, HubSpot) can't be enumerated
  // by a fixed list like this one -- a domain on one of those is expected
  // to still report "no DKIM found" here even with real DKIM configured,
  // same documented caveat this finding's own copy already carries.
  const selectors = [
    // Generic / self-hosted (cPanel, Postfix+OpenDKIM, most default guides).
    "default",
    "dkim",
    "mail",
    "smtp",
    "mx",
    "dk",
    "email",
    // Google Workspace.
    "google",
    // Microsoft 365: always publishes BOTH selector1 and selector2 as
    // CNAMEs (one active, one held for key rotation) -- checking only the
    // first missed a real, working DKIM setup on a tenant whose active key
    // happened to be under selector2.
    "selector1",
    "selector2",
    // ProtonMail's own selector names for its custom-domain DKIM
    // delegation (CNAME to <selector>.domainkey.<hash>.domains.proton.ch).
    // None of the generic selectors above ever match a ProtonMail-hosted
    // domain, so this check reported "No DKIM Records Found" on a domain
    // that had working DKIM the whole time, confirmed via a real
    // production scan of a domain whose MX records point at ProtonMail.
    "protonmail",
    "protonmail2",
    "protonmail3",
    // Fastmail.
    "fm1",
    "fm2",
    "fm3",
    // Zoho Mail.
    "zoho",
    "zmail",
    // Mailchimp (marketing sends) and Mandrill/Mailchimp Transactional,
    // which rotate through k1-k3 for key rotation the same way Microsoft
    // 365 rotates selector1/selector2.
    "k1",
    "k2",
    "k3",
    "mandrill",
    // SendGrid (both direct and whitelabel domains use s1/s2).
    "s1",
    "s2",
    // Klaviyo.
    "dkim1",
    "dkim2",
  ];

  const DKIM_QUERY_TIMEOUT_MS = 3000;

  async function probeDKIMSelector(
    sel: string,
  ): Promise<{ found: boolean; selector: string }> {
    const dkimHost = `${sel}._domainkey.${domain}`;
    try {
      const records = await Promise.race([
        dns.resolveTxt(dkimHost),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), DKIM_QUERY_TIMEOUT_MS),
        ),
      ]);
      const flat = records.map((r) => r.join(""));
      if (flat.some((r) => r.includes("v=DKIM1") || r.includes("p="))) {
        return { found: true, selector: sel };
      }
    } catch {
      /* no TXT record or timeout */
    }
    try {
      const cnames = await Promise.race([
        dns.resolveCname(dkimHost),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), DKIM_QUERY_TIMEOUT_MS),
        ),
      ]);
      if (cnames.length > 0) return { found: true, selector: sel };
    } catch {
      /* no CNAME or timeout */
    }
    return { found: false, selector: sel };
  }

  const results = await Promise.allSettled(selectors.map(probeDKIMSelector));
  const hit = results.find((r) => r.status === "fulfilled" && r.value.found) as
    PromiseFulfilledResult<{ found: boolean; selector: string }> | undefined;

  if (!hit) {
    return [
      makeVuln(
        url,
        "No DKIM Records Found",
        "low",
        "configuration",
        "No DKIM (DomainKeys Identified Mail) records were found for common selectors.",
        `Checked selectors: ${selectors.join(", ")} at _domainkey.${domain}. None returned a v=DKIM1 TXT record or CNAME delegation.`,
        "Without DKIM, email receivers cannot verify that messages were actually sent by your mail servers.",
        "DKIM adds a digital signature to outgoing emails. Note: DKIM selectors vary by provider — custom selectors are not checked here.",
        [
          "Configure DKIM signing in your email provider (Google Workspace, Microsoft 365, etc.).",
          "Publish the DKIM public key as a TXT record at selector._domainkey.yourdomain.com.",
        ],
      ),
    ];
  }
  return [];
}

export async function checkDNSSEC(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  // Query Google and Cloudflare DoH in parallel for the AD (Authenticated Data) flag
  const [googleResult, cloudflareResult] = await Promise.allSettled([
    fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A&do=1`,
      { signal: AbortSignal.timeout(4000) },
    )
      .then((r) => r.json())
      .then((d) => d.AD === true),
    fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A&do=true`,
      {
        signal: AbortSignal.timeout(4000),
        headers: { Accept: "application/dns-json" },
      },
    )
      .then((r) => r.json())
      .then((d) => d.AD === true),
  ]);

  const googleOK = googleResult.status === "fulfilled";
  const cloudflareOK = cloudflareResult.status === "fulfilled";

  // If both DoH resolvers failed (network error, timeout), we cannot determine
  // DNSSEC status. Skip rather than false-positive every site.
  if (!googleOK && !cloudflareOK) return [];

  const enabled =
    (googleOK && googleResult.value) ||
    (cloudflareOK && cloudflareResult.value);

  if (!enabled) {
    return [
      makeVuln(
        url,
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
    ];
  }
  return [];
}

/**
 * Returns true if hostname has a non-empty CAA record set, false if it
 * genuinely has none (ENODATA/ENOTFOUND/ENOENT), or null on a transient
 * DNS error the caller should not treat as a real answer either way.
 */
async function hasCaaRecords(hostname: string): Promise<boolean | null> {
  try {
    const records = await Promise.race([
      dns.resolveCaa(hostname),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 4000),
      ),
    ]);
    return records.length > 0;
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: string }).code
        : ((err as Error).message ?? "");
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "ENOENT") {
      return false;
    }
    return null; // timeout or network error — caller should not false-positive
  }
}

export async function checkCAA(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const exact = await hasCaaRecords(domain);
  if (exact === null) return []; // transient error — don't false-positive
  if (exact) return [];

  // RFC 8659: CA issuance validation walks up from the exact hostname to
  // the organizational domain looking for a CAA record set, so a parent
  // domain's record already protects subdomains that don't have their own.
  // Checking only the exact hostname reports those subdomains as
  // vulnerable when they're actually covered by real CA-enforced behavior.
  const orgDomain = extractRootDomain(domain);
  if (orgDomain !== domain) {
    const orgHasCaa = await hasCaaRecords(orgDomain);
    if (orgHasCaa) return []; // inherited and covered
  }

  return [
    makeVuln(
      url,
      "CAA Record Missing",
      "medium",
      "configuration",
      "No CAA (Certification Authority Authorization) DNS record exists. Any CA can issue a certificate for this domain.",
      `No CAA record found for ${domain}${orgDomain !== domain ? ` or its organizational domain ${orgDomain}` : ""}. Without CAA, rogue or compromised CAs can issue certificates for your domain.`,
      "Without a CAA record, any publicly trusted CA can issue a certificate for your domain, enabling MITM attacks via certificate misissuance.",
      "CAA records (RFC 8659) restrict which CAs are allowed to issue certificates. All CAs are now required to honor CAA before issuance.",
      [
        "Add a CAA record listing your CA(s) in your DNS zone.",
        'Example: 0 issue "letsencrypt.org"',
        "Add an iodef address to receive violation reports.",
        "Verify with: dig +short CAA yourdomain.com",
      ],
      [
        {
          label: "DNS zone file",
          language: "dns",
          code: 'example.com. IN CAA 0 issue "letsencrypt.org"\nexample.com. IN CAA 0 issuewild "letsencrypt.org"\nexample.com. IN CAA 0 iodef "mailto:security@example.com"',
        },
      ],
      85,
    ),
  ];
}

export async function checkNSCount(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  try {
    const records = await Promise.race([
      dns.resolveNs(domain),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 4000),
      ),
    ]);
    if (records.length >= 2) return [];
    if (records.length === 0) return [];
    return [
      makeVuln(
        url,
        "Single Authoritative Nameserver",
        "high",
        "configuration",
        "Only one authoritative nameserver was found. RFC 1035 requires at least two for redundancy.",
        `Only 1 NS record found for ${domain}: ${records[0]}. A single NS is a single point of failure.`,
        "If the single nameserver goes offline, the entire domain becomes unreachable. A DDoS on one server takes your domain down.",
        "DNS relies on redundant nameservers across different networks. Having only one NS creates a single point of failure.",
        [
          "Add a second NS record on a different subnet or provider.",
          "Consider a managed DNS provider (Cloudflare, Route 53) which provides multiple distributed nameservers automatically.",
        ],
        [],
        88,
      ),
    ];
  } catch {
    return []; // DNS failure — don't false-positive
  }
}

async function checkMTASTS(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const missingVuln = () =>
    makeVuln(
      url,
      "MTA-STS Record Missing",
      "info",
      "email",
      `No MTA-STS record found at _mta-sts.${domain}. Without MTA-STS, SMTP connections to this domain may be downgraded.`,
      `No TXT record with v=STSv1 found at _mta-sts.${domain}.`,
      "Without MTA-STS, inbound SMTP sessions can be downgraded from STARTTLS to plaintext by a network attacker.",
      "MTA-STS tells sending mail servers to require TLS and refuse to deliver if TLS cannot be established.",
      [
        `Publish a TXT record at _mta-sts.${domain} with v=STSv1; id=<timestamp>.`,
        `Serve the policy at https://mta-sts.${domain}/.well-known/mta-sts.txt with mode: enforce.`,
      ],
    );
  try {
    const records = await Promise.race([
      dns.resolveTxt(`_mta-sts.${domain}`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const flat = records.map((r) => r.join(""));
    const stsRecord = flat.find((r) => r.includes("v=STSv1"));
    if (!stsRecord) return [missingVuln()];
    const modeMatch = stsRecord.match(/\bmode=(\w+)/);
    const mode = modeMatch?.[1]?.toLowerCase();
    if (mode === "none" || mode === "testing") {
      return [
        makeVuln(
          url,
          "MTA-STS Mode Not Enforcing",
          "medium",
          "email",
          `MTA-STS configured but not enforcing: mode=${mode}. Set mode=enforce to prevent SMTP downgrade attacks.`,
          `_mta-sts.${domain} record: ${stsRecord}`,
          "Attackers can downgrade inbound SMTP sessions from STARTTLS to plaintext. mode=none/testing provides no enforcement.",
          "Only mode=enforce causes sending servers to abort delivery if TLS cannot be established.",
          [
            "Change mode: testing or mode: none to mode: enforce in your mta-sts.txt policy file.",
            "Update the id= value in the _mta-sts DNS record to force cache invalidation.",
          ],
        ),
      ];
    }
    return [];
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: string }).code
        : ((err as Error).message ?? "");
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "ENOENT") {
      return [missingVuln()];
    }
    return [];
  }
}

async function checkTLSRPT(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const missingVuln = () =>
    makeVuln(
      url,
      "TLS-RPT Record Missing",
      "info",
      "email",
      `No TLS-RPT record at _smtp._tls.${domain}. TLS-RPT (RFC 8460) enables SMTP TLS failure reporting.`,
      `No TXT record with v=TLSRPTv1 found at _smtp._tls.${domain}.`,
      "Without TLS-RPT, STARTTLS downgrade attacks and certificate validation errors go undetected.",
      "TLS-RPT sends daily aggregate reports about SMTP TLS negotiation failures to a specified reporting address.",
      [
        `Publish a TXT record at _smtp._tls.${domain} with v=TLSRPTv1; rua=mailto:tls-reports@${domain}.`,
      ],
    );
  try {
    const records = await Promise.race([
      dns.resolveTxt(`_smtp._tls.${domain}`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const flat = records.map((r) => r.join(""));
    const tlsRptRecord = flat.find((r) => r.includes("v=TLSRPTv1"));
    if (!tlsRptRecord) return [missingVuln()];
    if (!tlsRptRecord.includes("rua=")) {
      return [
        makeVuln(
          url,
          "TLS-RPT Record Missing rua= Reporting URI",
          "low",
          "email",
          `TLS-RPT record exists at _smtp._tls.${domain} but has no rua= reporting URI.`,
          `_smtp._tls.${domain} record: ${tlsRptRecord}`,
          "Without rua=, TLS-RPT reports cannot be delivered. You have no visibility into SMTP TLS failures.",
          "The rua= tag specifies where TLS-RPT reports are sent. Without it the record has no effect.",
          [
            `Add rua=mailto:tls-reports@${domain} to the _smtp._tls.${domain} TXT record.`,
          ],
        ),
      ];
    }
    return [];
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: string }).code
        : ((err as Error).message ?? "");
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "ENOENT") {
      return [missingVuln()];
    }
    return [];
  }
}

/**
 * RFC 7505 null MX: a single MX record whose exchange is the root name
 * ("."), which formally declares "this domain accepts no mail at all."
 * Used to suppress DKIM/MTA-STS/TLS-RPT findings in checkDNSSecurity below
 * -- all three protect a real inbound/outbound mail flow, which a
 * null-MX domain has explicitly opted out of by design, not by oversight.
 */
async function hasNullMX(domain: string): Promise<boolean> {
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 4000),
      ),
    ]);
    return records.length === 1 && /^\.?$/.test(records[0].exchange.trim());
  } catch {
    return false;
  }
}

export async function checkMX(
  domain: string,
  url: string,
  hasSPF: boolean,
): Promise<Vulnerability[]> {
  // Only report missing MX when SPF exists — that indicates the domain is
  // configured for email. Domains intentionally not using email skip this.
  if (!hasSPF) return [];
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 4000),
      ),
    ]);
    if (records.length > 0) return [];
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: string }).code
        : "";
    if (code !== "ENODATA" && code !== "ENOTFOUND" && code !== "ENOENT") {
      return []; // timeout or network error — don't false-positive
    }
  }
  return [
    makeVuln(
      url,
      "MX Record Missing",
      "medium",
      "configuration",
      "No MX record exists for this domain, but SPF is configured — suggesting email sending without mail reception.",
      `No MX record found for ${domain}. Domain has SPF configured but cannot receive email.`,
      "Without MX records, inbound mail bounces. Receiving servers may also treat outbound mail with higher spam scores.",
      "MX records direct incoming email to your mail servers. Their absence means the domain cannot receive email responses.",
      [
        "Add an MX record pointing to your mail server with the appropriate priority.",
        "If this domain intentionally does not receive email, add: v=spf1 -all (null MX is also recommended).",
        "Verify with: dig +short MX yourdomain.com",
      ],
      [
        {
          label: "DNS zone file",
          language: "dns",
          code: "example.com. IN MX 10 mail.example.com.",
        },
      ],
      80,
    ),
  ];
}

// ── Dangling CNAME Detection ─────────────────────────────────────────────────

const TAKEOVER_PLATFORMS: Array<[RegExp, string]> = [
  [/\.github\.io$/i, "GitHub Pages"],
  [/\.herokuapp\.com$/i, "Heroku"],
  [/\.netlify\.app$/i, "Netlify"],
  [/\.vercel\.app$/i, "Vercel"],
  [/\.s3\.amazonaws\.com$/i, "AWS S3"],
  [/\.cloudfront\.net$/i, "AWS CloudFront"],
  [/\.azurewebsites\.net$/i, "Azure Web Apps"],
  [/\.blob\.core\.windows\.net$/i, "Azure Blob Storage"],
  [/\.shopify\.com$/i, "Shopify"],
  [/\.fastly\.net$/i, "Fastly"],
  [/\.squarespace\.com$/i, "Squarespace"],
  [/\.wix\.com$/i, "Wix"],
  [/\.webflow\.io$/i, "Webflow"],
  [/\.surge\.sh$/i, "Surge.sh"],
  [/\.ghost\.io$/i, "Ghost"],
  [/\.readme\.io$/i, "ReadMe"],
  [/\.cargo\.site$/i, "Cargo"],
  [/\.strikingly\.com$/i, "Strikingly"],
];

async function checkDanglingCNAME(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  try {
    let cnames: string[];
    try {
      cnames = await withDnsTimeout(dns.resolveCname(domain));
    } catch {
      return []; // No CNAME record — not applicable
    }
    if (!cnames.length) return [];
    const cnameTarget = cnames[0];

    try {
      await withDnsTimeout(dns.resolve4(cnameTarget));
      return []; // CNAME target resolves — not dangling
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!["ENOTFOUND", "ENODATA", "ESERVFAIL"].includes(code)) return [];

      const platform = TAKEOVER_PLATFORMS.find(([re]) => re.test(cnameTarget));
      if (platform) {
        return [
          makeVuln(
            url,
            "Potential Subdomain Takeover via Dangling CNAME",
            "high",
            "dns",
            `${domain} has a CNAME record pointing to ${cnameTarget} (${platform[1]}), which does not resolve. An attacker may be able to claim this target and serve content on your subdomain.`,
            `${domain} CNAME → ${cnameTarget} (NXDOMAIN). Platform: ${platform[1]}. This subdomain may be claimable.`,
            "An attacker who claims the dangling target can serve arbitrary content under your domain, enabling phishing, session cookie theft, and CSP bypass.",
            "Dangling CNAME subdomain takeover occurs when a DNS CNAME points to an external service that is no longer claimed.",
            [
              `Remove the CNAME record for ${domain} if the service is no longer in use.`,
              `If the service should still be active, reclaim the ${platform[1]} resource and verify it resolves correctly.`,
              "Audit all DNS CNAME records periodically and remove stale entries.",
            ],
            [],
            95,
          ),
        ];
      }
      return [
        makeVuln(
          url,
          "Dangling CNAME Record",
          "medium",
          "dns",
          `${domain} has a CNAME record pointing to ${cnameTarget}, which does not resolve to any IP address.`,
          `${domain} CNAME → ${cnameTarget} (NXDOMAIN). Target does not resolve.`,
          "A dangling CNAME may allow subdomain takeover if the target can be registered by a third party.",
          "CNAME records that point to non-existent hostnames indicate stale DNS configuration.",
          [
            `Remove or update the CNAME record for ${domain}.`,
            "Verify all DNS CNAME targets resolve correctly.",
            "Audit DNS records quarterly and remove any pointing to decommissioned services.",
          ],
          [],
          90,
        ),
      ];
    }
  } catch {
    return [];
  }
}

// ── DNS Security (orchestrator: runs all sub-checks in parallel) ───────────

export async function checkDNSSecurity(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  // Run SPF first (its result gates the MX check)
  const [
    spfResult,
    dmarcResult,
    dkimResult,
    dnssecResult,
    caaResult,
    nsResult,
    mtaStsResult,
    tlsRptResult,
    cnameResult,
    nullMxResult,
  ] = await Promise.allSettled([
    checkSPF(domain, url),
    checkDMARC(domain, url),
    checkDKIM(domain, url),
    checkDNSSEC(domain, url),
    checkCAA(domain, url),
    checkNSCount(domain, url),
    checkMTASTS(domain, url),
    checkTLSRPT(domain, url),
    checkDanglingCNAME(domain, url),
    hasNullMX(domain),
  ]);

  const isNullMx = nullMxResult.status === "fulfilled" && nullMxResult.value;

  const findings: Vulnerability[] = [];
  for (const r of [
    spfResult,
    dmarcResult,
    dnssecResult,
    caaResult,
    nsResult,
    cnameResult,
  ]) {
    if (r.status === "fulfilled") findings.push(...r.value);
  }
  // Skip on a null-MX domain: these all protect a real mail flow (DKIM
  // signs outbound, MTA-STS/TLS-RPT secure inbound SMTP TLS) that a
  // domain declaring "no mail at all" has deliberately opted out of.
  if (!isNullMx) {
    for (const r of [dkimResult, mtaStsResult, tlsRptResult]) {
      if (r.status === "fulfilled") findings.push(...r.value);
    }
  }

  // MX check needs SPF result to gate on (avoid flagging non-email domains)
  const hasSPF =
    spfResult.status === "fulfilled" && spfResult.value.length === 0;
  const mxResult = await checkMX(domain, url, hasSPF);
  findings.push(...mxResult);

  return findings;
}

// ── TLS Certificate Checks ───────────────────────────────────────────────────

export function checkTLSCert(
  hostname: string,
  url: string,
  port: number = 443,
  emitCategory: Category = "ssl",
): Promise<Vulnerability[]> {
  return new Promise((resolve) => {
    const findings: Vulnerability[] = [];
    let socket: tls.TLSSocket | null = null;

    // Outer safety net: if the TLS handshake never completes, resolve and
    // destroy the socket so we don't leak a file descriptor per scan.
    const timeout = setTimeout(() => {
      socket?.destroy();
      resolve(findings);
    }, 5000);

    try {
      socket = tls.connect(
        {
          host: hostname,
          port,
          servername: hostname,
          // rejectUnauthorized: false lets the secureConnect callback always
          // fire so we can inspect the full cert (valid_to, bits, subject) even
          // for self-signed or expired certificates. We validate manually below.
          // codeql[js/disabling-certificate-validation]
          rejectUnauthorized: false,
          timeout: 4500,
        },
        () => {
          try {
            const cert = socket!.getPeerCertificate();
            const authorized = socket!.authorized;
            const protocol = socket!.getProtocol();

            if (!authorized) {
              const authError = socket!.authorizationError;
              const authCode = String(
                (authError as NodeJS.ErrnoException | null)?.code ??
                  authError?.message ??
                  "",
              );

              if (authCode === "CERT_HAS_EXPIRED") {
                const expiredOn = cert?.valid_to ?? "unknown";
                const daysAgo = cert?.valid_to
                  ? Math.floor(
                      (Date.now() - new Date(cert.valid_to).getTime()) /
                        (1000 * 60 * 60 * 24),
                    )
                  : null;
                findings.push(
                  makeVuln(
                    url,
                    "Expired TLS Certificate",
                    "critical",
                    emitCategory,
                    "The TLS certificate has expired.",
                    `Certificate expired on ${expiredOn}${daysAgo !== null ? ` (${daysAgo} days ago)` : ""}.${cert?.subject?.CN ? ` Subject: ${cert.subject.CN}.` : ""}`,
                    "Browsers will block access with a full-page security warning.",
                    "An expired certificate means the server's identity can no longer be verified.",
                    [
                      "Renew the certificate immediately.",
                      "Set up automatic renewal with Let's Encrypt / certbot.",
                    ],
                    [],
                    94,
                  ),
                );
              } else if (
                authCode === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
                authCode === "SELF_SIGNED_CERT_IN_CHAIN"
              ) {
                const issuerCN = cert?.issuer?.CN ?? "";
                const subjectCN = cert?.subject?.CN ?? "";
                findings.push(
                  makeVuln(
                    url,
                    "Self-Signed TLS Certificate",
                    "high",
                    emitCategory,
                    "The server uses a self-signed TLS certificate that is not trusted by browsers.",
                    `Certificate not issued by a trusted CA. Subject: ${subjectCN || "(unknown)"}. Issuer: ${issuerCN || "(self)"}.`,
                    "Browsers will show security warnings, making users vulnerable to real MITM attacks.",
                    "Self-signed certificates are not issued by a trusted CA. While they encrypt traffic, they don't verify the server's identity.",
                    [
                      "Obtain a certificate from a trusted CA (Let's Encrypt is free).",
                      "Use automated cert management (certbot, Caddy, or your hosting provider).",
                    ],
                    [],
                    94,
                  ),
                );
              } else if (authCode === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
                findings.push(
                  makeVuln(
                    url,
                    "Incomplete TLS Certificate Chain",
                    "medium",
                    emitCategory,
                    "The TLS certificate chain is incomplete. Intermediate certificates may be missing.",
                    `Certificate authorization error: ${authCode}. The leaf certificate could not be chained to a trusted root.`,
                    "Some clients may not trust this certificate because the full chain to a root CA cannot be verified.",
                    "TLS certificates form a chain of trust. If intermediates are missing, some clients can't verify the chain.",
                    [
                      "Ensure your server sends the full certificate chain (leaf + intermediates).",
                      "Use SSL Labs (ssllabs.com/ssltest) to verify your chain.",
                    ],
                    [],
                    94,
                  ),
                );
              }
            }

            // Certificate expiry checks (only for validly-authorized certs;
            // already reported above for CERT_HAS_EXPIRED)
            if (authorized && cert && cert.valid_to) {
              const expiryDate = new Date(cert.valid_to);
              const daysUntilExpiry = Math.floor(
                (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
              );

              if (daysUntilExpiry <= 14) {
                findings.push(
                  makeVuln(
                    url,
                    "TLS Certificate Expiring Soon",
                    "high",
                    emitCategory,
                    "The TLS certificate will expire within 14 days.",
                    `Certificate expires on ${cert.valid_to} (${daysUntilExpiry} days remaining).${cert.subject?.CN ? ` Subject: ${cert.subject.CN}.` : ""}`,
                    "If the certificate expires, browsers will show security warnings and block access.",
                    "TLS certificates have a finite validity period. Renewing before expiry prevents downtime.",
                    [
                      "Renew the certificate before it expires.",
                      "Enable auto-renewal if available.",
                    ],
                    [],
                    94,
                  ),
                );
              } else if (daysUntilExpiry <= 30) {
                findings.push(
                  makeVuln(
                    url,
                    "TLS Certificate Expiring Within 30 Days",
                    "medium",
                    emitCategory,
                    "The TLS certificate will expire within 30 days.",
                    `Certificate expires on ${cert.valid_to} (${daysUntilExpiry} days remaining).`,
                    "Plan to renew soon to avoid any disruption.",
                    "Most CAs recommend renewing at least 30 days before expiry.",
                    [
                      "Schedule certificate renewal.",
                      "Consider automating renewals with Let's Encrypt.",
                    ],
                    [],
                    94,
                  ),
                );
              }
            }

            // RSA key size check — cert.bits is the public key size in bits,
            // but that means something different for an EC key: a 256-bit
            // ECDSA P-256 key (Cloudflare's own default, among many others)
            // is not a weak RSA key, it is the modern, secure choice
            // (~equivalent to RSA 3072). Node only populates asn1Curve /
            // nistCurve on the peer certificate for EC keys, so use that to
            // tell the two apart rather than assuming every certificate is
            // RSA and flagging every EC cert as critically weak.
            if (cert && typeof (cert as { bits?: number }).bits === "number") {
              const certWithCurve = cert as {
                bits: number;
                asn1Curve?: string;
                nistCurve?: string;
              };
              const bits = certWithCurve.bits;
              const isEcKey = Boolean(
                certWithCurve.asn1Curve || certWithCurve.nistCurve,
              );
              if (!isEcKey && bits < 2048) {
                findings.push(
                  makeVuln(
                    url,
                    "Weak TLS Certificate Key Size",
                    "high",
                    emitCategory,
                    `TLS certificate uses a ${bits}-bit RSA key, below the 2048-bit minimum recommended by NIST.`,
                    `Certificate public key size: ${bits} bits. Keys below 2048 bits are practically factorable with modern compute.`,
                    "RSA keys smaller than 2048 bits can be factored offline, allowing session decryption and impersonation.",
                    "NIST SP 800-131A requires RSA keys of at least 2048 bits. Keys below this are considered weak by browsers and CAs.",
                    [
                      "Reissue the certificate with RSA 2048 or 3072 bits.",
                      "Consider switching to ECDSA P-256 (equivalent security to RSA 3072, smaller key).",
                    ],
                    [
                      {
                        label: "Generate RSA 3072 CSR",
                        language: "bash",
                        code: "openssl req -newkey rsa:3072 -keyout server.key -out server.csr -nodes",
                      },
                    ],
                    94,
                  ),
                );
              }
            }

            if (protocol) {
              const weakProtocols = ["TLSv1", "TLSv1.1", "SSLv3"];
              if (weakProtocols.includes(protocol)) {
                findings.push(
                  makeVuln(
                    url,
                    "Weak TLS Protocol Version",
                    "high",
                    emitCategory,
                    `The server negotiated ${protocol}, which is considered insecure.`,
                    `Negotiated protocol: ${protocol}. TLS 1.0 and 1.1 are deprecated by RFC 8996.`,
                    "Older TLS versions have known vulnerabilities (POODLE, BEAST, etc.).",
                    "TLS 1.0 and 1.1 are deprecated. Only TLS 1.2 and 1.3 should be supported.",
                    [
                      "Disable TLS 1.0 and TLS 1.1.",
                      "Ensure TLS 1.2 and TLS 1.3 are enabled.",
                    ],
                    [
                      {
                        label: "Nginx",
                        language: "nginx",
                        code: "ssl_protocols TLSv1.2 TLSv1.3;\nssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;",
                      },
                    ],
                    94,
                  ),
                );
              } else if (protocol === "TLSv1.2") {
                // Server negotiated TLS 1.2 even though our client supports 1.3,
                // indicating the server does not support TLS 1.3.
                findings.push(
                  makeVuln(
                    url,
                    "TLS 1.3 Not Supported",
                    "info",
                    emitCategory,
                    "The server negotiated TLS 1.2 instead of TLS 1.3, suggesting TLS 1.3 is not enabled.",
                    `Negotiated protocol: ${protocol}. TLS 1.3 offers improved performance (0-RTT) and stronger security guarantees.`,
                    "TLS 1.2 is secure but lacks TLS 1.3 features: stronger key exchange, fewer round trips, and removal of legacy cipher suites.",
                    "TLS 1.3 eliminates weak cipher suites, reduces handshake latency, and provides forward secrecy for all connections.",
                    [
                      "Enable TLS 1.3 on your server.",
                      "TLS 1.2 can remain enabled alongside TLS 1.3 for backward compatibility.",
                    ],
                    [
                      {
                        label: "Nginx",
                        language: "nginx",
                        code: "ssl_protocols TLSv1.2 TLSv1.3;",
                      },
                    ],
                    82,
                  ),
                );
              }
            }
          } catch {
            /* cert inspection failed */
          }

          socket!.destroy();
          clearTimeout(timeout);
          resolve(findings);
        },
      );

      // With rejectUnauthorized: false, the error event only fires for actual
      // network/socket errors — not for cert validation failures (those are
      // handled in the secureConnect callback via socket.authorized).
      socket.on("error", () => {
        clearTimeout(timeout);
        resolve(findings);
      });
      socket.on("timeout", () => {
        socket!.destroy();
        clearTimeout(timeout);
        resolve(findings);
      });
    } catch {
      clearTimeout(timeout);
      resolve(findings);
    }
  });
}

// ── Live Fetch Checks (robots.txt, security.txt) ─────────────────────────────

const FETCH_OPTS = {
  signal: undefined as AbortSignal | undefined,
  // "error" prevents redirect-based SSRF: if a probe target redirects to a
  // private IP (e.g., 169.254.169.254), fetch throws rather than following.
  // The caller's try/catch (or Promise.allSettled) handles this gracefully.
  //
  // This blanket "error" also means ANY redirect — including a completely
  // benign apex-to-www redirect on the exact same site — makes the fetch
  // throw, which several callers below were treating as "not found". Checks
  // that only care about the final response body/status (robots.txt,
  // security.txt, the exposed-file probes) use fetchFollowingSameHostRedirect
  // below instead, which follows same-registered-domain redirects (apex <->
  // www) while still refusing to follow a redirect to a different host or a
  // private IP. Checks that need to inspect a raw 3xx response itself
  // (CORS/method probes, X-Forwarded-Host injection, GraphQL introspection)
  // still use FETCH_OPTS directly and keep this stricter "error" behavior.
  redirect: "error" as RequestRedirect,
  headers: {
    "User-Agent": `Mozilla/5.0 (compatible; ${APP_NAME}/1.0; +${APP_URL})`,
    Accept: "text/plain, text/*;q=0.9, */*;q=0.8",
  },
};

/**
 * Result of DNS-resolving and validating a scan target's origin once.
 * `safe` mirrors SafetyCheckResult.safe; `resolvedIp`, when present, is the
 * public IP validateScanTarget resolved for the origin's hostname at that
 * moment.
 */
interface PinnedTarget {
  safe: boolean;
  resolvedIp?: string;
}

/**
 * DNS-resolve and validate `originOrUrl`'s hostname exactly the way
 * checkActiveCORS / checkActiveHttpMethods / checkXForwardedHostInjection
 * above already do (validateScanTarget, not just the syntactic
 * isPrivateHostname check), returning the resolved IP so callers can pin it
 * into every subsequent request to that origin instead of re-resolving DNS
 * per request. Call this once per check invocation — not once per probe —
 * so a check that fires many probes at the same origin (checkExposedFiles'
 * ~23 requests, checkGraphQLIntrospection's up to 4) pays for exactly one
 * DNS lookup, the same "resolve once, pin, reuse" contract
 * lib/scanner/safe-fetch.ts's safeFetch applies to its own single request.
 */
async function validateAndPinOrigin(
  originOrUrl: string,
): Promise<PinnedTarget> {
  const safety = await validateScanTarget(originOrUrl);
  return { safe: safety.safe, resolvedIp: safety.resolvedIp };
}

/**
 * Rewrite `url` to target `pinned`'s DNS-resolved IP instead of its
 * hostname, mirroring the substitution lib/scanner/safe-fetch.ts's
 * safeFetch performs on the request it pins: HTTP requests go straight to
 * the resolved IP (with the real hostname preserved in a Host header) so a
 * DNS change between validateAndPinOrigin and this fetch can't matter.
 * HTTPS requests keep the original hostname unchanged — swapping it would
 * break TLS certificate/SNI validation — so for HTTPS the protection is the
 * DNS re-resolution happening immediately before the request, not IP
 * substitution, same limitation safeFetch itself documents.
 */
function applyPinnedTarget(
  url: string,
  pinned: PinnedTarget,
  init: RequestInit,
): { url: string; init: RequestInit } {
  if (!pinned.resolvedIp) return { url, init };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, init };
  }
  if (parsed.protocol !== "http:") return { url, init };

  const originalHostname = parsed.hostname;
  const originalPort = parsed.port;
  parsed.hostname =
    isIP(pinned.resolvedIp) === 6
      ? `[${pinned.resolvedIp}]`
      : pinned.resolvedIp;
  if (originalPort) parsed.port = originalPort;

  const headers = new Headers(init.headers);
  headers.set("Host", originalHostname);
  return { url: parsed.href, init: { ...init, headers } };
}

/**
 * Fetch a URL, following a redirect only when it stays on the same
 * registrable host or hops between the apex and its `www.` subdomain (e.g.
 * walmart.com <-> www.walmart.com) — the pattern behind the false "Missing
 * security.txt" finding on walmart.com: the apex redirects every path to
 * www, and the real file only lives at www.walmart.com/.well-known/
 * security.txt. Raw fetch with FETCH_OPTS's redirect: "error" throws on
 * that 301, which the caller's try/catch turned into "not found".
 *
 * The caller supplies `pinned`, the result of a single validateAndPinOrigin
 * call for the starting URL's origin (not re-resolved here, so multiple
 * probes to the same origin share one DNS lookup). Every redirect hop is
 * re-validated with validateAndPinOrigin — the same DNS-resolving guard the
 * starting origin was checked with, not the syntactic-only isPrivateHostname
 * this loop used before — and re-pinned before the next fetch, since a
 * redirect target (same host or the apex/www counterpart) can have been
 * rebound to a private/internal IP since the previous hop was validated. Any
 * other cross-host redirect, or a hop that fails re-validation, is left
 * unfollowed — the caller sees that 3xx response and treats it as "not
 * found", the same as it would have before this helper existed. Bounded to
 * a handful of hops so a redirect loop can't hang the check.
 *
 * Deliberately local to this file rather than reusing lib/scanner/
 * safe-fetch.ts's `safeFetch`: that function is also used (and mock-counted
 * in tests) for the single per-scan page fetch, and checkExposedFiles alone
 * makes ~23 probe requests per scan, so routing every probe through it would
 * multiply call counts other tests assert on without changing what's
 * actually being verified here.
 */
async function fetchFollowingSameHostRedirect(
  url: string,
  init: RequestInit,
  pinned: PinnedTarget,
  maxHops = 3,
): Promise<Response> {
  let currentUrl = url;
  let currentLogicalUrl = url;
  let currentPinned = pinned;

  for (let hop = 0; hop <= maxHops; hop++) {
    const { url: fetchUrl, init: fetchInit } = applyPinnedTarget(
      currentUrl,
      currentPinned,
      init,
    );
    const res = await fetch(fetchUrl, { ...fetchInit, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location || hop === maxHops) return res;

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentLogicalUrl);
    } catch {
      return res;
    }
    if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:")
      return res;

    const currentHostname = new URL(currentLogicalUrl).hostname.toLowerCase();
    const nextHostname = nextUrl.hostname.toLowerCase();
    const sameRegisteredHost =
      nextHostname === currentHostname ||
      nextHostname === `www.${currentHostname}` ||
      currentHostname === `www.${nextHostname}`;
    if (!sameRegisteredHost) return res;

    const nextPinned = await validateAndPinOrigin(nextUrl.href);
    if (!nextPinned.safe) return res;

    currentUrl = nextUrl.href;
    currentLogicalUrl = nextUrl.href;
    currentPinned = nextPinned;
  }
  /* istanbul ignore next -- unreachable: the loop above always returns by
   * the time hop === maxHops. */
  throw new Error("unreachable: redirect loop exited without returning");
}

// ── Active Sensitive File Probing ─────────────────────────────────────────────

async function checkExposedFiles(
  origin: string,
  url: string,
): Promise<Vulnerability[]> {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    if (isPrivateHostname(parsed.hostname)) return [];
  } catch {
    return [];
  }

  // isPrivateHostname above is a syntactic check on the hostname string only.
  // validateAndPinOrigin additionally resolves DNS (once, here) and rejects a
  // hostname that looked public when the scan started but has since been
  // rebound to an internal or cloud-metadata IP. The result is reused
  // (pinned) for every one of the ~23 probes below instead of re-resolving
  // DNS per probe.
  const pinned = await validateAndPinOrigin(origin);
  if (!pinned.safe) return [];

  const envPattern =
    /(?:DATABASE_URL|SECRET|API_KEY|PASSWORD|TOKEN|PRIVATE_KEY|ACCESS_KEY|AUTH_)\s*=/i;

  interface FileProbe {
    path: string;
    verify: (status: number, body: string, ct: string) => string | null;
    title: string;
    severity: "critical" | "high" | "medium" | "low";
    description: string;
    riskImpact: string;
    fixSteps: string[];
  }

  const probes: FileProbe[] = [
    {
      path: "/.git/config",
      verify: (status, body) => {
        if (status !== 200 || !/\[core\]/i.test(body)) return null;
        return body.slice(0, 400);
      },
      title: "Git Repository Config Exposed",
      severity: "critical",
      description:
        "The .git/config file is publicly accessible, exposing Git repository metadata, remote URLs (which may contain credentials), and branch names.",
      riskImpact:
        "Source code extraction possible by enumerating /.git/objects/. Credentials in remote URLs may be leaked.",
      fixSteps: [
        "Block access to /.git/ in your web server configuration.",
        "Nginx: `location ~ /\\.git { deny all; return 404; }`",
        "Apache: `RedirectMatch 404 /\\.git`",
        "Never deploy .git directories to production web roots.",
      ],
    },
    {
      path: "/.git/HEAD",
      verify: (status, body) => {
        if (status !== 200 || !/^ref:\s*refs\/heads\//m.test(body)) return null;
        return body.slice(0, 100).trim();
      },
      title: "Git HEAD File Exposed",
      severity: "high",
      description:
        "The .git/HEAD file is publicly accessible, confirming a Git repository is exposed in the web root.",
      riskImpact:
        "Source code extraction possible by enumerating /.git/objects/. Credentials in remote URLs may be leaked.",
      fixSteps: [
        "Block access to /.git/ in your web server configuration.",
        "Nginx: `location ~ /\\.git { deny all; return 404; }`",
        "Remove .git directories from the web root during deployment.",
      ],
    },
    {
      path: "/.env",
      verify: (status, body) => {
        if (status !== 200 || !envPattern.test(body)) return null;
        return body
          .slice(0, 500)
          .replace(/=([^\n]+)/g, "=[MASKED]")
          .slice(0, 300);
      },
      title: "Environment File Exposed",
      severity: "critical",
      description:
        "The .env file is publicly accessible. This file typically contains database credentials, API keys, and other application secrets.",
      riskImpact:
        "Full credential compromise: database passwords, API keys, and application secrets are exposed to any attacker.",
      fixSteps: [
        "Never store .env files in the web root.",
        "Configure your web server to deny access to dotfiles: `location ~ /\\. { deny all; }`",
        "Rotate all credentials found in the file immediately.",
        "Use environment variables injected at runtime instead of .env files in production.",
      ],
    },
    {
      path: "/.env.local",
      verify: (status, body) => {
        if (status !== 200 || !envPattern.test(body)) return null;
        return body
          .slice(0, 500)
          .replace(/=([^\n]+)/g, "=[MASKED]")
          .slice(0, 300);
      },
      title: "Environment File Exposed (.env.local)",
      severity: "critical",
      description:
        "The .env.local file is publicly accessible and contains application secrets.",
      riskImpact:
        "Full credential compromise: database passwords, API keys, and application secrets exposed.",
      fixSteps: [
        "Never store .env files in the web root.",
        "Configure your web server to deny access to dotfiles.",
        "Rotate all credentials found in the file immediately.",
      ],
    },
    {
      path: "/.htpasswd",
      verify: (status, body) => {
        if (status !== 200) return null;
        if (!/\$apr1\$|\{SHA\}|\$2y\$/.test(body)) return null;
        return "htpasswd entry detected. File contains password hashes. Values: [MASKED]";
      },
      title: "htpasswd File Exposed",
      severity: "critical",
      description:
        "The .htpasswd file is publicly accessible. This file contains hashed credentials used for HTTP Basic Authentication.",
      riskImpact:
        "Password hashes exposed. Offline cracking with hashcat or john is trivial for weak passwords.",
      fixSteps: [
        "Move .htpasswd outside the web root.",
        "Apache: `<Files .htpasswd> Require all denied </Files>`",
        "Rotate all credentials immediately.",
      ],
    },
    {
      path: "/phpinfo.php",
      verify: (status, body) => {
        if (status !== 200) return null;
        if (!/<title>phpinfo\(\)/i.test(body) || !body.includes("PHP Version"))
          return null;
        const m = body.match(/PHP Version\s+([\d.]+)/);
        return m
          ? `PHP Version ${m[1]} disclosed via phpinfo()`
          : "phpinfo() output exposed";
      },
      title: "phpinfo() Page Exposed",
      severity: "high",
      description:
        "A phpinfo() page is publicly accessible, revealing PHP configuration, enabled extensions, environment variables, and server paths.",
      riskImpact:
        "Server configuration, PHP settings, enabled extensions, and path disclosure visible to attackers. Environment variables including secrets may be shown.",
      fixSteps: [
        "Remove phpinfo.php, info.php, and test.php from production servers.",
        "Restrict access to these files with IP allowlisting if needed for debugging.",
        "Set `expose_php = Off` in php.ini.",
      ],
    },
    {
      path: "/info.php",
      verify: (status, body) => {
        if (status !== 200) return null;
        if (!/<title>phpinfo\(\)/i.test(body) || !body.includes("PHP Version"))
          return null;
        const m = body.match(/PHP Version\s+([\d.]+)/);
        return m
          ? `PHP Version ${m[1]} disclosed via info.php`
          : "phpinfo() output exposed";
      },
      title: "phpinfo() Page Exposed (info.php)",
      severity: "high",
      description:
        "A phpinfo() page (info.php) is publicly accessible, revealing PHP and server configuration details.",
      riskImpact:
        "Server configuration, PHP settings, and path disclosure visible to attackers.",
      fixSteps: [
        "Remove info.php from production servers.",
        "Restrict access with IP allowlisting if needed for debugging.",
        "Set `expose_php = Off` in php.ini.",
      ],
    },
    {
      path: "/docker-compose.yml",
      verify: (status, body, ct) => {
        if (status !== 200 || ct.includes("text/html")) return null;
        if (!/^services:/m.test(body)) return null;
        const services = (body.match(/^\s{0,2}(\w[\w-]+):/gm) ?? [])
          .map((s) => s.trim().replace(/:$/, ""))
          .filter((s) => s !== "services" && s.length < 40)
          .slice(0, 8);
        const hasEnv = /environment:|env_file:|\.env/i.test(body);
        return `docker-compose.yml confirmed. Services: ${services.join(", ") || "(none detected)"}${hasEnv ? ". Contains environment/secrets references (values masked)." : "."}`;
      },
      title: "Docker Compose File Exposed",
      severity: "medium",
      description:
        "The docker-compose.yml file is publicly accessible, revealing infrastructure topology, service names, port mappings, and environment variable names.",
      riskImpact:
        "Infrastructure topology, service names, port mappings, and environment variable names disclosed. May reveal internal hostnames and credentials.",
      fixSteps: [
        "Remove docker-compose.yml from the web root.",
        "Store infrastructure config files outside the document root.",
        "Use .dockerignore to exclude these files from deployments.",
      ],
    },
    {
      path: "/phpmyadmin/",
      verify: (status, body) => {
        if (status !== 200) return null;
        if (!/phpMyAdmin|phpmyadmin/i.test(body)) return null;
        if (!/<title>/i.test(body)) return null;
        const m = body.match(/<title>([^<]{1,80})<\/title>/i);
        return `phpMyAdmin interface accessible. Page title: "${m?.[1] ?? "phpMyAdmin"}"`;
      },
      title: "phpMyAdmin Admin Panel Exposed",
      severity: "high",
      description:
        "phpMyAdmin is accessible without authentication or with default credentials. This grants direct database administration access.",
      riskImpact:
        "Full database read/write/delete access. Can be used to dump all data, drop tables, or execute OS commands via SELECT INTO OUTFILE.",
      fixSteps: [
        "Restrict phpMyAdmin to trusted IP ranges only.",
        "Enable authentication with a strong password.",
        "Move phpMyAdmin to a non-default path.",
        "Disable phpMyAdmin entirely on production servers.",
      ],
    },
    {
      path: "/adminer.php",
      verify: (status, body) => {
        if (status !== 200) return null;
        if (!/Adminer|adminer/i.test(body)) return null;
        return "Adminer database management interface is accessible.";
      },
      title: "Adminer Database Admin Panel Exposed",
      severity: "high",
      description:
        "Adminer (formerly phpMinAdmin) database management tool is publicly accessible.",
      riskImpact:
        "Direct database administration access. Adminer supports MySQL, PostgreSQL, SQLite, MS SQL, Oracle, and more.",
      fixSteps: [
        "Remove adminer.php from the production web root.",
        "Restrict access to trusted IP addresses.",
        "Use authentication if Adminer is needed.",
      ],
    },
    {
      path: "/backup.sql",
      verify: (status, body) => {
        if (status !== 200) return null;
        if (
          !/CREATE TABLE|INSERT INTO|-- MySQL dump|-- PostgreSQL database dump/i.test(
            body,
          )
        )
          return null;
        const keywords = [
          "CREATE TABLE",
          "INSERT INTO",
          "-- MySQL dump",
          "-- PostgreSQL database dump",
        ].filter((k) => body.includes(k));
        return `SQL database dump confirmed at /backup.sql. Detected SQL keywords: ${keywords.join(", ")}. Raw content omitted to prevent credential exposure in scan results.`;
      },
      title: "Database Dump File Exposed",
      severity: "critical",
      description:
        "A SQL database dump file is publicly accessible at /backup.sql. This exposes the full database schema and data.",
      riskImpact:
        "Complete data breach: all database records, user credentials (even hashed), business logic, and application secrets are exposed.",
      fixSteps: [
        "Move database backup files outside the web root.",
        "Store backups in a non-public directory or cloud storage with access controls.",
        "Delete /backup.sql from the web root immediately.",
        "Review your backup process to ensure dumps are never written to the web root.",
      ],
    },
    {
      path: "/terraform.tfstate",
      verify: (status, body) => {
        if (status !== 200) return null;
        if (!/"terraform_version"|"format_version"/.test(body)) return null;
        try {
          const data = JSON.parse(body.slice(0, 16384)) as Record<
            string,
            unknown
          >;
          const version = data.terraform_version ?? "unknown";
          return `Terraform state file exposed. Terraform version: ${version}. Contains infrastructure configuration and may include secrets.`;
        } catch {
          return "Terraform state file exposed at /terraform.tfstate.";
        }
      },
      title: "Terraform State File Exposed",
      severity: "critical",
      description:
        "A Terraform state file is publicly accessible. Terraform state files contain the full infrastructure topology and often include plaintext secrets such as database passwords, API keys, and access credentials.",
      riskImpact:
        "Full infrastructure topology disclosure. Terraform state frequently contains plaintext secrets: database connection strings, cloud provider credentials, SSH keys, and API tokens.",
      fixSteps: [
        "Remove terraform.tfstate from the web root immediately.",
        "Store Terraform state remotely using Terraform Cloud, S3 with encryption, or another secure backend.",
        "Rotate all credentials found in the state file.",
        "Add *.tfstate and *.tfstate.backup to .gitignore and .dockerignore.",
      ],
    },
    {
      path: "/wp-json/wp/v2/users",
      verify: (status, body, ct) => {
        if (status !== 200) return null;
        if (!ct.includes("json") && !ct.includes("javascript")) return null;
        try {
          const data = JSON.parse(body) as unknown[];
          if (!Array.isArray(data) || data.length === 0) return null;
          const firstUser = data[0] as Record<string, unknown>;
          if (!firstUser.slug && !firstUser.name) return null;
          const usernames = data
            .slice(0, 5)
            .map(
              (u) =>
                (u as Record<string, unknown>).slug ??
                (u as Record<string, unknown>).name ??
                "unknown",
            )
            .filter(Boolean);
          return `WordPress REST API exposes ${data.length} user(s). Usernames/slugs: ${usernames.join(", ")}`;
        } catch {
          if (!/"slug"\s*:/.test(body)) return null;
          return "WordPress REST API users endpoint is accessible, exposing user account information.";
        }
      },
      title: "WordPress User Enumeration via REST API",
      severity: "medium",
      description:
        "The WordPress REST API exposes a list of user accounts including usernames and display names. This information can be used for credential stuffing and targeted phishing attacks.",
      riskImpact:
        "Username enumeration enables targeted brute-force attacks, credential stuffing, and social engineering. Combined with weak passwords, full account takeover is likely.",
      fixSteps: [
        "Disable the REST API for unauthenticated users if not needed: add `add_filter('rest_authentication_errors', ...)` to restrict access.",
        "Install a WordPress security plugin (e.g., Wordfence) that can restrict REST API access.",
        "Hide login usernames by setting author archives to 404.",
        "Ensure all user accounts use strong, unique passwords.",
      ],
    },
    {
      path: "/metrics",
      verify: (status, body, ct) => {
        if (status !== 200) return null;
        if (ct.includes("text/html")) return null;
        if (!body.includes("# HELP") || !body.includes("# TYPE")) return null;
        const metricNames: string[] = [];
        const re = /^# HELP (\S+)/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(body)) !== null && metricNames.length < 5) {
          metricNames.push(m[1]);
        }
        return `Prometheus metrics endpoint exposed. Sample metrics: ${metricNames.join(", ")}. ${body.split("\n").length} lines of telemetry data accessible.`;
      },
      title: "Prometheus Metrics Endpoint Exposed",
      severity: "medium",
      description:
        "A Prometheus metrics endpoint (/metrics) is publicly accessible. This endpoint exposes internal application metrics, resource usage, error rates, and may reveal internal service names and infrastructure details.",
      riskImpact:
        "Internal application telemetry, service names, database connection counts, error rates, and system resource usage disclosed. Attackers can identify high-value targets from metric names.",
      fixSteps: [
        "Restrict the /metrics endpoint to internal networks or Prometheus server IPs only.",
        "Add authentication to the metrics endpoint.",
        "In Kubernetes: use Network Policies to restrict metrics access.",
        "Consider a reverse proxy with basic authentication in front of the metrics endpoint.",
      ],
    },
    {
      path: "/.npmrc",
      verify: (status, body, ct) => {
        if (status !== 200) return null;
        if (ct.includes("text/html")) return null;
        // Registry-scoped auth lines in .npmrc look like
        // `//<host>/:_authToken=...`. Require a domain boundary
        // (path separator, colon, quote, whitespace, or end of string)
        // right after the host so a lookalike host embedded elsewhere in
        // the file (e.g. "//npm.pkg.github.com.attacker.example/") can't
        // be mistaken for the real GitHub Packages registry.
        const isGitHub = /\/\/npm\.pkg\.github\.com(?:[/:\s"']|$)/.test(body);
        if (
          !body.includes("//registry.npmjs.org/:_authToken") &&
          !body.includes("_authToken") &&
          !isGitHub
        )
          return null;
        const registry = isGitHub ? "GitHub Packages" : "npmjs.org";
        return `npm configuration file exposed with ${registry} registry auth token. Token value omitted from evidence.`;
      },
      title: "npm Configuration File Exposed (.npmrc)",
      severity: "critical",
      description:
        "The .npmrc file is publicly accessible and contains npm registry authentication tokens. These tokens can be used to publish malicious packages under the organization's npm account.",
      riskImpact:
        "An attacker with a valid npm auth token can publish packages to the registry under the organization's namespace, enabling supply chain attacks that affect all downstream users.",
      fixSteps: [
        "Remove .npmrc from the web root immediately.",
        "Revoke the exposed npm token at npmjs.com → Access Tokens.",
        "Use CI/CD environment variables (NPM_TOKEN) instead of .npmrc files.",
        "Add .npmrc to .gitignore and configure the web server to deny access to dotfiles.",
      ],
    },
    {
      path: "/.env.production",
      verify: (status, body, ct) => {
        if (status !== 200) return null;
        if (ct.includes("text/html")) return null;
        const sensitiveKeys =
          /DATABASE_URL|SECRET|API_KEY|PASSWORD|TOKEN|PRIVATE_KEY|ACCESS_KEY|STRIPE|AWS_/i;
        if (!sensitiveKeys.test(body)) return null;
        const keys = body.match(/^[A-Z0-9_]+=.+/gm) ?? [];
        const sensitiveFound = keys
          .filter((k) => sensitiveKeys.test(k))
          .slice(0, 5);
        return `Production environment file exposed. Sensitive variables: ${sensitiveFound.map((k) => k.split("=")[0]).join(", ")}`;
      },
      title: "Production Environment File Exposed (.env.production)",
      severity: "critical",
      description:
        "The .env.production file containing production credentials, API keys, and secrets is publicly accessible. This is among the most severe exposures possible in a web application.",
      riskImpact:
        "Full production credential exposure: database passwords, third-party API keys, session secrets, and payment processor keys. Immediate unauthorized access to all connected systems is likely.",
      fixSteps: [
        "Remove .env.production from the web root immediately.",
        "Rotate all credentials and API keys referenced in the file.",
        "Configure the web server to deny access to all dotfiles (files beginning with a period).",
        "Use a secrets manager (AWS Secrets Manager, HashiCorp Vault) instead of environment files.",
      ],
    },
    {
      path: "/web.config",
      verify: (status, body, ct) => {
        if (status !== 200) return null;
        if (
          !body.includes("<configuration>") &&
          !body.includes("<system.web>") &&
          !body.includes("<connectionStrings>")
        )
          return null;
        const hasSecrets =
          body.includes("connectionString") ||
          body.includes("password") ||
          body.includes("appSettings");
        return `IIS web.config exposed${hasSecrets ? " containing connection strings or application settings" : ""}. Server configuration and potentially credentials are readable.`;
      },
      title: "IIS web.config File Exposed",
      severity: "high",
      description:
        "The IIS web.config file is publicly accessible. This file may contain database connection strings, application settings, authentication configuration, and other sensitive server directives.",
      riskImpact:
        "Database credentials, API keys, encryption keys, and internal network topology may be exposed. Attackers can also learn about disabled security features to plan further attacks.",
      fixSteps: [
        "IIS should block direct requests to web.config by default — verify this handler is still registered.",
        "Check for misconfigured reverse proxy rules that may be bypassing IIS protections.",
        "Rotate any credentials found in the file.",
        "Move sensitive configuration to environment variables or Windows credential store.",
      ],
    },
    {
      path: "/debug.log",
      verify: (status, body, ct) => {
        if (status !== 200) return null;
        if (ct.includes("text/html")) return null;
        const logIndicators =
          /\[(ERROR|WARN|INFO|DEBUG|FATAL|EXCEPTION|Traceback|Stack trace)\]/i;
        const pathIndicators =
          /\/var\/www|\/home\/\w+|C:\\|\/app\/|node_modules|at Object\.|at Function\./;
        if (!logIndicators.test(body) && !pathIndicators.test(body))
          return null;
        const lines = body.split("\n").length;
        return `Debug log file exposed with ${lines} lines of application log data. May contain internal paths, stack traces, or sensitive request data.`;
      },
      title: "Debug Log File Publicly Accessible",
      severity: "medium",
      description:
        "A debug.log file is publicly accessible. Debug logs frequently contain internal file paths, stack traces, database query details, user data from requests, and application secrets logged during errors.",
      riskImpact:
        "Internal architecture disclosure, user data leakage, session tokens or credentials logged during errors, and detailed error information that helps attackers craft targeted exploits.",
      fixSteps: [
        "Remove or restrict access to all log files from the web root.",
        "Store logs outside the web-accessible directory.",
        "Configure the web server to deny requests to .log files.",
        "Review log levels — debug logging should never be enabled in production.",
      ],
    },
    {
      path: "/package-lock.json",
      verify: (status, body, ct) => {
        if (status !== 200) return null;
        if (ct.includes("text/html")) return null;
        if (
          !body.includes('"lockfileVersion"') &&
          !body.includes('"node_modules"') &&
          !body.includes('"packages"')
        )
          return null;
        const pkgMatch = body.match(/"name"\s*:\s*"([^"]+)"/);
        const versionMatch = body.match(/"lockfileVersion"\s*:\s*(\d+)/);
        return `npm lockfile exposed. Package name: ${pkgMatch?.[1] ?? "unknown"}, lockfile version: ${versionMatch?.[1] ?? "unknown"}. Full dependency tree with versions is readable.`;
      },
      title: "npm Lockfile Exposed (package-lock.json)",
      severity: "low",
      description:
        "The package-lock.json file is publicly accessible. This file reveals the complete dependency tree with exact version numbers, enabling attackers to identify vulnerable package versions in use.",
      riskImpact:
        "Attackers can identify exact versions of all dependencies and cross-reference against CVE databases to find applicable exploits without any guessing.",
      fixSteps: [
        "Remove package-lock.json from the web root.",
        "Ensure Node.js project files are not served as static assets.",
        "Configure the web server to deny access to JSON files in the root directory.",
      ],
    },
    {
      path: "/jenkins/",
      verify: (status, body, ct) => {
        if (status !== 200 && status !== 403) return null;
        if (!ct.includes("text/html")) return null;
        if (!body.includes("Jenkins") && !body.includes("hudson")) return null;
        const isOpen =
          status === 200 &&
          (body.includes("Dashboard") ||
            body.includes("New Item") ||
            body.includes("Build"));
        return isOpen
          ? "Jenkins CI panel is accessible without authentication. Full CI/CD pipeline access including job history, build logs, and environment variable injection."
          : "Jenkins login panel detected at /jenkins/. Exposed CI/CD panel is a high-value target.";
      },
      title: "Jenkins CI Panel Exposed",
      severity: "high",
      description:
        "A Jenkins continuous integration server panel is publicly accessible. Unauthenticated access allows attackers to enumerate jobs, read build logs (which may contain secrets), trigger builds, and execute arbitrary commands through the Groovy script console.",
      riskImpact:
        "Full CI/CD pipeline compromise: read environment secrets, inject malicious build steps, exfiltrate source code, and potentially pivot to production environments.",
      fixSteps: [
        "Restrict Jenkins access to internal networks or VPN only.",
        "Enable Jenkins security (Manage Jenkins → Configure Global Security).",
        "Disable the Groovy script console for non-admin users.",
        "Use a reverse proxy with authentication in front of Jenkins.",
      ],
    },
    {
      path: "/consul/",
      verify: (status, body, ct) => {
        if (status !== 200) return null;
        if (!ct.includes("text/html")) return null;
        if (!body.includes("Consul") && !body.includes("consul")) return null;
        return "HashiCorp Consul UI is publicly accessible. Service registry, health checks, and potentially KV store data are readable without authentication.";
      },
      title: "HashiCorp Consul UI Exposed",
      severity: "high",
      description:
        "The HashiCorp Consul service mesh UI is publicly accessible. Consul stores service discovery data, health check results, and key-value configuration that may include secrets.",
      riskImpact:
        "Full service registry disclosure (all microservices, their IPs and ports), KV store contents (often contains credentials and configuration), and the ability to deregister services causing outages.",
      fixSteps: [
        "Restrict Consul UI access to internal networks using ACLs or firewall rules.",
        "Enable Consul ACLs and require tokens for all API and UI access.",
        "Bind Consul to localhost or internal interface, not 0.0.0.0.",
        "Use a reverse proxy with authentication in front of the Consul UI.",
      ],
    },
    {
      path: "/minio/",
      verify: (status, body, ct) => {
        if (status !== 200 && status !== 403) return null;
        if (!ct.includes("text/html")) return null;
        if (!body.includes("MinIO") && !body.includes("minio")) return null;
        return `MinIO object storage console detected at /minio/. ${status === 200 ? "Console is accessible" : "Login panel exposed"}. S3-compatible storage system is reachable from the internet.`;
      },
      title: "MinIO Object Storage Console Exposed",
      severity: "high",
      description:
        "A MinIO object storage console is publicly accessible. MinIO is an S3-compatible storage system that may contain application data, backups, user uploads, and internal files.",
      riskImpact:
        "Unauthorized access to all stored objects including backups, user data, and application assets. MinIO access keys, if obtainable through the console, grant full storage access.",
      fixSteps: [
        "Restrict MinIO console access to internal networks.",
        "Configure MinIO access policies to deny public access by default.",
        "Enable TLS and strong authentication for the MinIO console.",
        "Consider using MinIO's built-in bucket policies to restrict access to specific objects.",
      ],
    },
    {
      path: "/rabbitmq/",
      verify: (status, body, ct) => {
        if (status !== 200 && status !== 401) return null;
        if (!ct.includes("text/html")) return null;
        if (!body.includes("RabbitMQ") && !body.includes("rabbitmq"))
          return null;
        const isOpen = status === 200 && body.includes("Overview");
        return isOpen
          ? "RabbitMQ management UI is accessible without authentication. Message queue contents, vhosts, and credentials may be exposed."
          : "RabbitMQ management interface login panel is publicly accessible. Default credentials (guest/guest) may grant full access.";
      },
      title: "RabbitMQ Management Interface Exposed",
      severity: "medium",
      description:
        "A RabbitMQ message broker management interface is publicly accessible. This interface can expose message queue contents, connection details, vhosts, and user credentials.",
      riskImpact:
        "Message queue inspection allows reading application events and potentially sensitive data in transit. Default credentials (guest/guest) are commonly left unchanged, granting full administrative access.",
      fixSteps: [
        "Restrict RabbitMQ management plugin access to internal networks.",
        "Change the default guest/guest credentials immediately.",
        "Disable the management plugin if not needed: rabbitmq-plugins disable rabbitmq_management.",
        "Use TLS for RabbitMQ connections and management interface.",
      ],
    },
  ];

  const results = await Promise.allSettled(
    probes.map(async (probe) => {
      const probeUrl = new URL(probe.path, origin).href;
      // A probe only cares about the final response, so an apex-to-www (or
      // other same-registered-domain) redirect should be followed rather
      // than treated as "not exposed".
      const res = await fetchFollowingSameHostRedirect(
        probeUrl,
        {
          headers: FETCH_OPTS.headers,
          signal: AbortSignal.timeout(5000),
        },
        pinned,
      );
      const body = (await res.text()).slice(0, 8192);
      const ct = res.headers.get("content-type") ?? "";
      const evidence = probe.verify(res.status, body, ct);
      if (!evidence) return null;
      return makeVuln(
        origin,
        probe.title,
        probe.severity,
        "information-disclosure",
        probe.description,
        `Fetched ${probeUrl}: HTTP ${res.status}\n${evidence}`,
        probe.riskImpact,
        probe.description,
        probe.fixSteps,
      );
    }),
  );

  const findings: Vulnerability[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) findings.push(r.value);
  }
  return findings;
}

// ── Active CORS Origin Reflection Test ───────────────────────────────────────

async function checkActiveCORS(url: string): Promise<Vulnerability[]> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    if (isPrivateHostname(parsed.hostname)) return [];
    // isPrivateHostname above is a syntactic check on the hostname string only.
    // validateScanTarget additionally resolves DNS, so a hostname that looked
    // public when the scan started but has since been rebound to an internal
    // or cloud-metadata IP is still rejected before this probe fires.
    const safety = await validateScanTarget(url);
    if (!safety.safe) return [];

    // .test TLD is IANA-reserved — never a real domain
    const testOrigin = "https://cors-probe.vulnradar.test";
    // Safe: validateScanTarget(url) was checked above (DNS-resolved, not just
    // a syntactic hostname check) on this exact url before it reaches fetch.
    // codeql[js/request-forgery]
    const res = await fetch(url, {
      ...FETCH_OPTS,
      signal: AbortSignal.timeout(5000),
      headers: {
        ...FETCH_OPTS.headers,
        Origin: testOrigin,
      },
    });

    const acao = res.headers.get("access-control-allow-origin") ?? "";
    // Only fire on exact reflection; wildcard is caught by passive cors-wildcard check
    if (acao !== testOrigin) return [];

    const acac = res.headers.get("access-control-allow-credentials") ?? "";
    const withCredentials = acac.toLowerCase() === "true";

    return [
      makeVuln(
        url,
        withCredentials
          ? "Arbitrary CORS Origin Reflection with Credentials"
          : "Arbitrary CORS Origin Reflection",
        withCredentials ? "critical" : "high",
        "headers",
        withCredentials
          ? "The server reflects any Origin header back in Access-Control-Allow-Origin and also sets Access-Control-Allow-Credentials: true. Any website can make authenticated cross-origin requests to this server."
          : "The server reflects any Origin header back in Access-Control-Allow-Origin, allowing any website to make cross-origin requests and read responses.",
        `Sent Origin: ${testOrigin}\nAccess-Control-Allow-Origin: ${acao}\nAccess-Control-Allow-Credentials: ${acac || "not set"}`,
        withCredentials
          ? "Any attacker-controlled website can send authenticated requests (with cookies/sessions) to this server and read the response, enabling account takeover and data exfiltration."
          : "Any attacker-controlled website can make cross-origin requests to this server and read the response, enabling data theft from authenticated endpoints.",
        "CORS origin reflection occurs when a server copies the request Origin header directly into Access-Control-Allow-Origin without validating it against an allowlist.",
        [
          "Maintain an explicit allowlist of trusted origins.",
          "Never reflect the request Origin header directly without validation.",
          "If credentials are needed, specify the exact origin(s) explicitly.",
          "Use a CORS library that validates origins against a configured allowlist.",
        ],
        [
          {
            label: "Secure CORS (Express.js)",
            language: "javascript",
            code: "const ALLOWED = new Set(['https://app.example.com']);\napp.use(cors({ origin: (o, cb) => cb(null, ALLOWED.has(o ?? '')) }));",
          },
        ],
        95,
      ),
    ];
  } catch {
    return [];
  }
}

// ── Active HTTP Method Probing ────────────────────────────────────────────────

async function checkActiveHttpMethods(
  origin: string,
): Promise<Vulnerability[]> {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    if (isPrivateHostname(parsed.hostname)) return [];
    // isPrivateHostname above is a syntactic check on the hostname string only.
    // validateScanTarget additionally resolves DNS, so a hostname that looked
    // public when the scan started but has since been rebound to an internal
    // or cloud-metadata IP is still rejected before either probe below fires.
    const safety = await validateScanTarget(origin);
    if (!safety.safe) return [];

    // Safe: validateScanTarget(origin) was checked above (DNS-resolved, not
    // just a syntactic hostname check) on this exact origin before it reaches
    // fetch.
    // codeql[js/request-forgery]
    const res = await fetch(origin, {
      method: "OPTIONS",
      ...FETCH_OPTS,
      signal: AbortSignal.timeout(5000),
    });

    const allow = res.headers.get("allow") ?? "";
    if (!allow) return [];

    const findings: Vulnerability[] = [];

    if (/\bTRACE\b|\bTRACK\b/i.test(allow)) {
      let confirmed = false;
      try {
        // Safe: same origin as the OPTIONS probe above, already checked
        // against validateScanTarget (DNS-resolved) earlier in this function.
        // codeql[js/request-forgery]
        const traceRes = await fetch(origin, {
          method: "TRACE",
          ...FETCH_OPTS,
          signal: AbortSignal.timeout(5000),
        });
        const traceBody = await traceRes.text();
        confirmed =
          traceRes.status === 200 &&
          /^TRACE\s|^User-Agent:|Via:/im.test(traceBody);
      } catch {
        // TRACE request blocked or failed — still report from Allow header
      }

      findings.push(
        makeVuln(
          origin,
          confirmed
            ? "HTTP TRACE Method Enabled"
            : "HTTP TRACE Advertised in Allow Header",
          confirmed ? "medium" : "low",
          "configuration",
          confirmed
            ? "The HTTP TRACE method is enabled. TRACE echoes the request back, enabling Cross-Site Tracing (XST) attacks that can bypass HttpOnly cookie restrictions in combination with XSS."
            : "The server's OPTIONS response includes TRACE in the Allow header, indicating TRACE may be enabled.",
          `OPTIONS ${origin} → Allow: ${allow}${confirmed ? "\nTRACE request confirmed: server echoed request headers." : ""}`,
          "Cross-Site Tracing (XST) can be used with XSS to steal HttpOnly cookies or bypass CSRF protections.",
          "HTTP TRACE is a debugging method that echoes the full request back to the client. Combined with XSS, it can expose HttpOnly cookies.",
          [
            "Disable TRACE in your web server configuration.",
            "Nginx: `if ($request_method = TRACE) { return 405; }`",
            "Apache: `TraceEnable Off` in httpd.conf.",
            "IIS: Use URLScan or Request Filtering to block TRACE.",
          ],
          [],
          confirmed ? 92 : 70,
        ),
      );
    }

    if (/\bCONNECT\b/i.test(allow)) {
      findings.push(
        makeVuln(
          origin,
          "HTTP CONNECT Method Exposed",
          "medium",
          "configuration",
          "The HTTP CONNECT method is advertised in the Allow header. CONNECT is used for proxy tunneling and should not be exposed on application servers.",
          `OPTIONS ${origin} → Allow: ${allow}`,
          "An exposed CONNECT method may allow attackers to use the server as a proxy to reach internal services or bypass network controls.",
          "HTTP CONNECT is intended for proxy tunneling. Application servers should not expose this method.",
          [
            "Disable the CONNECT method in your web server or WAF configuration.",
            "Restrict HTTP methods to only those required by your application.",
          ],
          [],
          80,
        ),
      );
    }

    return findings;
  } catch {
    return [];
  }
}

// ── X-Forwarded-Host Header Injection Test ───────────────────────────────────

async function checkXForwardedHostInjection(
  url: string,
): Promise<Vulnerability[]> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    if (isPrivateHostname(parsed.hostname)) return [];
    // isPrivateHostname above is a syntactic check on the hostname string only.
    // validateScanTarget additionally resolves DNS, so a hostname that looked
    // public when the scan started but has since been rebound to an internal
    // or cloud-metadata IP is still rejected before this probe fires.
    const safety = await validateScanTarget(url);
    if (!safety.safe) return [];

    const testHost = "vulnradar-host-probe.invalid";

    // Safe: validateScanTarget(url) was checked above (DNS-resolved, not just
    // a syntactic hostname check) on this exact url before it reaches fetch.
    // codeql[js/request-forgery]
    const res = await fetch(url, {
      ...FETCH_OPTS,
      headers: {
        ...FETCH_OPTS.headers,
        "X-Forwarded-Host": testHost,
      },
      signal: AbortSignal.timeout(5000),
    });

    const body = (await res.text()).slice(0, 8192);
    const locationHeader = res.headers.get("location") ?? "";

    if (!body.includes(testHost) && !locationHeader.includes(testHost)) {
      return [];
    }

    const foundIn: string[] = [];
    if (body.includes(testHost)) foundIn.push("response body");
    if (locationHeader.includes(testHost))
      foundIn.push(`Location header: ${locationHeader}`);

    return [
      makeVuln(
        url,
        "X-Forwarded-Host Header Injection",
        "high",
        "configuration",
        "The server reflects an attacker-controlled X-Forwarded-Host header value in its response. This enables password reset link poisoning and web cache poisoning attacks.",
        `Sent X-Forwarded-Host: ${testHost} → Found in: ${foundIn.join(", ")}`,
        "An attacker can send a request with X-Forwarded-Host pointing to their domain. If the application uses this header to construct password reset URLs, victims receive reset links pointing to the attacker's domain.",
        "Many web frameworks trust X-Forwarded-Host to determine the current host for URL generation. Without an allowlist, this becomes an attacker-controlled input that flows into emails, redirects, and cached responses.",
        [
          "Validate X-Forwarded-Host against an explicit allowlist of known domain names.",
          "Use a hardcoded APP_URL / BASE_URL environment variable for absolute URL construction instead of trusting forwarded headers.",
          "In Django: ensure ALLOWED_HOSTS is set and USE_X_FORWARDED_HOST is False unless needed.",
          "In Laravel: configure TrustedProxies with specific trusted proxy IPs.",
          "In Express: set `app.set('trust proxy', false)` or configure trusted proxy IPs explicitly.",
        ],
        [],
        85,
      ),
    ];
  } catch {
    return [];
  }
}

// ── GraphQL Introspection Test ────────────────────────────────────────────────

async function checkGraphQLIntrospection(
  origin: string,
  url: string,
): Promise<Vulnerability[]> {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    if (isPrivateHostname(parsed.hostname)) return [];

    // isPrivateHostname above is a syntactic check on the hostname string
    // only. validateAndPinOrigin additionally resolves DNS (once, reused
    // across all endpoint probes below) and rejects a hostname that has
    // since been rebound to an internal or cloud-metadata IP.
    const pinned = await validateAndPinOrigin(origin);
    if (!pinned.safe) return [];

    const endpoints = ["/graphql", "/api/graphql", "/graphql/v1", "/query"];
    const introspectionQuery = JSON.stringify({
      query: "{ __schema { types { name } } }",
    });

    for (const endpoint of endpoints) {
      let endpointUrl: string;
      try {
        endpointUrl = new URL(endpoint, origin).href;
      } catch {
        continue;
      }

      try {
        const { url: fetchUrl, init: fetchInit } = applyPinnedTarget(
          endpointUrl,
          pinned,
          {
            method: "POST",
            headers: {
              ...FETCH_OPTS.headers,
              "Content-Type": "application/json",
            },
            body: introspectionQuery,
            signal: AbortSignal.timeout(6000),
            redirect: "error",
          },
        );
        const res = await fetch(fetchUrl, fetchInit);

        if (!res.ok) continue;
        const ct = res.headers.get("content-type") ?? "";
        if (
          !ct.includes("application/json") &&
          !ct.includes("application/graphql")
        )
          continue;

        const body = (await res.text()).slice(0, 16384);
        if (!body.includes("__schema") || !body.includes("types")) continue;

        let typeCount = 0;
        try {
          const parsed = JSON.parse(body);
          typeCount = parsed?.data?.__schema?.types?.length ?? 0;
        } catch {
          // body contains the strings but isn't valid JSON — still worth flagging
        }

        const typeInfo =
          typeCount > 0
            ? `Introspection returned ${typeCount} types.`
            : "Introspection response contains __schema data.";

        return [
          makeVuln(
            url,
            "GraphQL Introspection Enabled",
            "medium",
            "information-disclosure",
            "The GraphQL API has introspection enabled in production. Introspection allows any client to query the full schema, including all types, fields, mutations, and relationships, providing a complete map of the API surface.",
            `POST ${endpointUrl} with introspection query returned schema data. ${typeInfo}`,
            "Attackers can enumerate the entire API schema to discover undocumented mutations, sensitive fields (user data, admin operations), and design targeted injection or business logic attacks.",
            "GraphQL introspection is a development tool that exposes the full schema structure. In production it gives attackers a complete blueprint of every query, mutation, and data type the API supports.",
            [
              "Disable introspection in production: most GraphQL servers support `introspection: false` in their configuration.",
              "In Apollo Server: `new ApolloServer({ introspection: process.env.NODE_ENV !== 'production' })`",
              "In Strawberry (Python): set `introspection=False` on the schema.",
              "If introspection is required for legitimate clients, restrict it to authenticated users only.",
              "Use query depth and complexity limits to mitigate abuse regardless of introspection setting.",
            ],
            [],
            70,
          ),
        ];
      } catch {
        continue;
      }
    }
  } catch {
    /* skip */
  }
  return [];
}

// ── Active Cloud Storage Bucket Listing Probe ───────────────────────────────
//
// The passive detectors (s3-bucket-exposed in checks/secrets-extended.ts,
// aws-s3-nosuchbucket-error in checks/information-disclosure.ts) only report
// that a bucket reference or an S3 XML error was seen in the page — they
// never find out whether the bucket itself is actually publicly listable.
// This check extends that capability: it discovers candidate bucket/
// container hostnames from the page, then makes a real follow-up request to
// each one's list-objects endpoint to see whether anonymous listing is
// enabled. That follow-up request is the reason this lives in the async
// layer rather than as a synchronous body-pattern check.

/**
 * Ceiling on how many distinct bucket hostnames get an active listing
 * probe per scan. A page can reference (or fabricate) far more bucket-
 * shaped URLs than any real site would use; without a cap, a malicious
 * page could make the scanner hammer an unbounded number of arbitrary
 * third-party storage hosts.
 */
const MAX_BUCKET_LISTING_PROBES = 5;

/** Per-request timeout for the page fetch and each bucket probe. Short
 * enough that one slow/hung endpoint can't stall the branch past
 * BRANCH_TIMEOUT_MS. */
const BUCKET_PROBE_TIMEOUT_MS = 5000;

type BucketProvider = "s3" | "gcs" | "azure";

const BUCKET_PROVIDER_LABEL: Record<BucketProvider, string> = {
  s3: "AWS S3",
  gcs: "Google Cloud Storage",
  azure: "Azure Blob Storage",
};

const BUCKET_PROVIDER_EXPLANATION: Record<BucketProvider, string> = {
  s3: "AWS S3 buckets can grant the s3:ListBucket permission to the public/AllUsers principal via a bucket ACL or bucket policy. When that grant is present, an unauthenticated GET to the bucket root returns an XML ListBucketResult enumerating every object's key, size, and last-modified date.",
  gcs: "Google Cloud Storage buckets can grant storage.objects.list (directly, or via a broader role like Storage Object Viewer) to allUsers through IAM. When that binding exists, the objects.list JSON API returns every object in the bucket to an unauthenticated caller.",
  azure:
    "Azure Blob Storage containers have a public access level setting. Setting it to 'Container' (rather than 'Blob' or 'Private') allows anonymous container listing (?restype=container&comp=list) in addition to anonymous reads of individual blobs.",
};

const BUCKET_PROVIDER_FIX_STEPS: Record<BucketProvider, string[]> = {
  s3: [
    "Enable S3 Block Public Access on the bucket, and at the account level, so public ACLs/policies stop taking effect.",
    "Remove any bucket policy or ACL grant that gives ListBucket to the public/AllUsers principal.",
    "If public read of specific objects is required, front the bucket with CloudFront using an origin access identity instead of making the bucket itself listable.",
    "Audit the bucket's contents for anything sensitive that was exposed while listing was public.",
  ],
  gcs: [
    "Remove the allUsers / allAuthenticatedUsers IAM binding that grants storage.objects.list (or a broader role such as Storage Object Viewer) on the bucket.",
    "Use uniform bucket-level access and grant IAM roles only to specific identities.",
    "If public read of specific objects is required, serve them through Cloud CDN rather than making the bucket itself listable.",
    "Audit the bucket's contents for anything sensitive that was exposed while listing was public.",
  ],
  azure: [
    "Set the container's public access level to 'Private' in Storage Account > Containers.",
    "If anonymous read of specific blobs is genuinely required, use the 'Blob' access level (not 'Container') — it allows reading a blob by its exact URL without allowing the container to be listed.",
    "Consider disabling anonymous blob access entirely at the storage account level (allowBlobPublicAccess: false).",
    "Audit the container's contents for anything sensitive that was exposed while listing was public.",
  ],
};

interface BucketCandidate {
  provider: BucketProvider;
  /** Bucket (or "account/container") name as referenced on the page. */
  name: string;
  /** Hostname the listing probe is actually sent to. */
  probeHost: string;
  /** Full URL of the provider's list-objects endpoint for this candidate. */
  probeUrl: string;
}

// Same reference shape the passive s3-bucket-exposed detector matches
// (checks/secrets-extended.ts), plus a capture group for the bucket name.
const S3_VHOST_RE = /https?:\/\/([\w.-]+)\.s3((?:\.[\w-]+)?)\.amazonaws\.com/gi;
const S3_PATH_RE =
  /https?:\/\/(s3(?:\.[\w-]+)?\.amazonaws\.com)\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?=[/"'\s?#]|$)/gi;
// S3's NoSuchBucket XML error (matched passively by aws-s3-nosuchbucket-error
// in checks/information-disclosure.ts) includes the bucket name in a
// <BucketName> tag, which that detector reports on but doesn't extract.
const S3_BUCKETNAME_TAG_RE = /<BucketName>([^<]+)<\/BucketName>/i;
const GCS_PATH_RE =
  /storage\.googleapis\.com\/([a-z0-9][a-z0-9_.-]{1,61}[a-z0-9])(?=[/"'\s?#]|$)/gi;
const AZURE_RE =
  /https?:\/\/([a-z0-9]+)\.blob\.core\.windows\.net\/([a-z0-9$][a-z0-9-]{1,61}[a-z0-9])/gi;

/**
 * Find candidate cloud storage buckets/containers referenced anywhere in
 * `body`, deduplicated by provider + probe target. Order of discovery is
 * preserved so the caller's cap keeps the first N distinct candidates
 * rather than an arbitrary subset.
 */
function extractBucketCandidates(body: string): BucketCandidate[] {
  const seen = new Map<string, BucketCandidate>();
  const add = (candidate: BucketCandidate) => {
    const key = `${candidate.provider}:${candidate.probeUrl.toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, candidate);
  };

  for (const m of body.matchAll(S3_VHOST_RE)) {
    const bucket = m[1];
    const region = m[2] || "";
    const host = `${bucket}.s3${region}.amazonaws.com`;
    add({
      provider: "s3",
      name: bucket,
      probeHost: host,
      probeUrl: `https://${host}/`,
    });
  }

  for (const m of body.matchAll(S3_PATH_RE)) {
    const host = m[1];
    const bucket = m[2];
    add({
      provider: "s3",
      name: bucket,
      probeHost: host,
      probeUrl: `https://${host}/${bucket}/`,
    });
  }

  const bucketNameMatch = body.match(S3_BUCKETNAME_TAG_RE);
  if (bucketNameMatch) {
    const bucket = bucketNameMatch[1].trim();
    if (/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(bucket)) {
      const host = `${bucket}.s3.amazonaws.com`;
      add({
        provider: "s3",
        name: bucket,
        probeHost: host,
        probeUrl: `https://${host}/`,
      });
    }
  }

  for (const m of body.matchAll(GCS_PATH_RE)) {
    const bucket = m[1];
    add({
      provider: "gcs",
      name: bucket,
      probeHost: "storage.googleapis.com",
      probeUrl: `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`,
    });
  }

  for (const m of body.matchAll(AZURE_RE)) {
    const account = m[1];
    const container = m[2];
    const host = `${account}.blob.core.windows.net`;
    add({
      provider: "azure",
      name: `${account}/${container}`,
      probeHost: host,
      probeUrl: `https://${host}/${container}?restype=container&comp=list`,
    });
  }

  return [...seen.values()];
}

interface BucketProbeOutcome {
  candidate: BucketCandidate;
  status: number;
  publiclyListable: boolean;
  snippet: string;
}

/**
 * GET a single candidate's list-objects endpoint and classify the response.
 * Routed through safeFetch (not raw fetch) so the request goes through the
 * same SSRF guard (DNS-resolved private-IP check, redirect re-validation)
 * as every other outbound request the scanner makes to a target it doesn't
 * control — the discovered hostname is third-party infrastructure, not the
 * site under scan.
 */
async function probeBucketCandidate(
  candidate: BucketCandidate,
): Promise<BucketProbeOutcome | null> {
  try {
    const res = await safeFetch(candidate.probeUrl, {
      method: "GET",
      headers: FETCH_OPTS.headers,
      signal: AbortSignal.timeout(BUCKET_PROBE_TIMEOUT_MS),
    });
    const text = (await res.text()).slice(0, 4096);
    let publiclyListable = false;
    if (res.status === 200) {
      if (candidate.provider === "s3") {
        publiclyListable = /<ListBucketResult[\s>]/i.test(text);
      } else if (candidate.provider === "gcs") {
        // GCS omits the "items" array entirely when a bucket is empty, so a
        // successful objects.list call is identified by its response
        // "kind" rather than requiring "items" to be present.
        publiclyListable = /"kind"\s*:\s*"storage#objects"/i.test(text);
      } else {
        publiclyListable = /<EnumerationResults[\s>]/i.test(text);
      }
    }
    return { candidate, status: res.status, publiclyListable, snippet: text };
  } catch {
    // Network error, timeout, or the SSRF guard rejecting the target —
    // inconclusive, not a finding.
    return null;
  }
}

/**
 * Discover bucket/container references on the page and actively probe
 * whether each one allows public listing. This is read-only (GET) and never
 * attempts to write, delete, or modify anything in a discovered bucket.
 *
 * The other checkLiveFetch sub-checks each fetch their own narrow target
 * (robots.txt, a handful of sensitive file paths, a GraphQL endpoint) — none
 * of them hold the homepage body, so this check fetches it independently
 * via safeFetch rather than threading the body through the whole async
 * pipeline for the sake of one check.
 */
export async function checkBucketListing(
  url: string,
): Promise<Vulnerability[]> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    if (isPrivateHostname(parsed.hostname)) return [];
  } catch {
    return [];
  }

  let body: string;
  try {
    const res = await safeFetch(url, {
      method: "GET",
      headers: FETCH_OPTS.headers,
      signal: AbortSignal.timeout(BUCKET_PROBE_TIMEOUT_MS + 1000),
    });
    body = (await res.text()).slice(0, 1_000_000);
  } catch {
    return [];
  }

  const candidates = extractBucketCandidates(body).slice(
    0,
    MAX_BUCKET_LISTING_PROBES,
  );
  if (candidates.length === 0) return [];

  const outcomes = await Promise.allSettled(
    candidates.map((c) => probeBucketCandidate(c)),
  );

  const findings: Vulnerability[] = [];
  for (const outcome of outcomes) {
    if (outcome.status !== "fulfilled" || !outcome.value) continue;
    const { candidate, status, publiclyListable, snippet } = outcome.value;
    if (!publiclyListable) continue;

    const providerLabel = BUCKET_PROVIDER_LABEL[candidate.provider];

    findings.push(
      makeVuln(
        url,
        `Publicly Listable ${providerLabel} Bucket`,
        "high",
        "information-disclosure",
        `A ${providerLabel} bucket referenced on this page (${candidate.probeHost}) allows anyone to list its full contents with no authentication. This is a misconfiguration of the bucket itself, which may belong to a third party (a CDN, analytics vendor, or embedded widget) rather than this site's own infrastructure.`,
        `GET ${candidate.probeUrl} -> HTTP ${status} with a public listing response.\n${snippet.slice(0, 300)}`,
        "Anyone can enumerate every object in the bucket, potentially exposing backups, internal documents, PII, or configuration files stored there. Because the bucket's owner may differ from the scanned site, identifying and notifying the actual owner may require separate research.",
        BUCKET_PROVIDER_EXPLANATION[candidate.provider],
        BUCKET_PROVIDER_FIX_STEPS[candidate.provider],
        [],
        90,
      ),
    );
  }
  return findings;
}

export async function checkRobotsTxt(origin: string): Promise<Vulnerability[]> {
  const findings: Vulnerability[] = [];
  try {
    // Validate origin to prevent SSRF
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return findings;
    if (isPrivateHostname(parsed.hostname)) return findings;

    // isPrivateHostname above is a syntactic check on the hostname string
    // only. validateAndPinOrigin additionally resolves DNS and rejects a
    // hostname that has since been rebound to an internal or
    // cloud-metadata IP.
    const pinned = await validateAndPinOrigin(origin);
    if (!pinned.safe) return findings;

    // Construct the full URL using URL constructor (not template literals)
    const robotsUrl = new URL("robots.txt", origin);

    // Follows same-registered-domain redirects (apex <-> www) instead of
    // throwing on any 3xx the way raw fetch + FETCH_OPTS's redirect: "error"
    // would, so an apex domain that redirects to www no longer gets
    // misreported as missing robots.txt.
    const res = await fetchFollowingSameHostRedirect(
      robotsUrl.href,
      {
        headers: FETCH_OPTS.headers,
        signal: AbortSignal.timeout(5000),
      },
      pinned,
    );
    if (!res.ok) return findings;

    const body = (await res.text()).slice(0, 65536);
    if (
      !body.includes("User-agent") &&
      !body.includes("Disallow") &&
      !body.includes("Allow")
    )
      return findings;

    // Single combined regex for all sensitive paths
    const sensitiveRegex =
      /Disallow:\s*(\/(?:admin|backup|config|database|private|secret|\.env|\.git|wp-admin|cgi-bin|tmp|internal|api\/internal|debug|staging|test)\b[^\n]*)/gi;
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = sensitiveRegex.exec(body)) !== null) {
      matches.push(match[0].trim());
    }
    // Dedupe: a robots.txt with more than one User-agent block (e.g. one
    // for "*" and another scoped to specific AI crawlers) legitimately
    // repeats the same Disallow line under each block -- that's valid
    // robots.txt syntax, not len(matches) actually-distinct paths. Without
    // this, a site disallowing the same one sensitive path under two
    // User-agent blocks got reported as "2 sensitive path(s)" listing the
    // identical line twice.
    const found = [...new Set(matches)];

    if (found.length > 0) {
      findings.push(
        makeVuln(
          origin,
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
      );
    }
  } catch {
    /* skip */
  }
  return findings;
}

export async function checkSecurityTxt(
  origin: string,
): Promise<Vulnerability[]> {
  // Validate origin to prevent SSRF
  let parsed: URL;
  try {
    parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    if (isPrivateHostname(parsed.hostname)) return [];
  } catch {
    return [];
  }

  // isPrivateHostname above is a syntactic check on the hostname string
  // only. validateAndPinOrigin additionally resolves DNS (once, reused for
  // both probes below) and rejects a hostname that has since been rebound
  // to an internal or cloud-metadata IP.
  const pinned = await validateAndPinOrigin(origin);
  if (!pinned.safe) return [];

  // Construct and validate full URLs
  let wellKnownUrl: string;
  let rootUrl: string;
  try {
    wellKnownUrl = new URL(".well-known/security.txt", origin).toString();
    rootUrl = new URL("security.txt", origin).toString();
  } catch {
    return [];
  }

  // Check both URLs in parallel, following a same-registered-domain redirect
  // (most commonly apex -> www, e.g. walmart.com -> www.walmart.com)
  // instead of making the fetch throw and getting misreported as "missing"
  // — raw fetch with FETCH_OPTS's redirect: "error" throws on ANY redirect,
  // even a completely benign one back to the same site.
  const [wellKnown, root] = await Promise.allSettled([
    fetchFollowingSameHostRedirect(
      wellKnownUrl,
      {
        headers: FETCH_OPTS.headers,
        signal: AbortSignal.timeout(5000),
      },
      pinned,
    ),
    fetchFollowingSameHostRedirect(
      rootUrl,
      {
        headers: FETCH_OPTS.headers,
        signal: AbortSignal.timeout(5000),
      },
      pinned,
    ),
  ]);

  const found =
    (wellKnown.status === "fulfilled" && wellKnown.value.ok) ||
    (root.status === "fulfilled" && root.value.ok);

  if (!found) {
    return [
      makeVuln(
        origin,
        "Missing security.txt",
        "info",
        "configuration",
        "No security.txt file was found at /.well-known/security.txt or /security.txt.",
        `Both ${wellKnownUrl} and ${rootUrl} returned non-200 status.`,
        "Security researchers who find vulnerabilities may not know how to responsibly report them.",
        "security.txt (RFC 9116) is a standard for responsible disclosure contact information.",
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
    ];
  }
  return [];
}

export async function checkLiveFetch(url: string): Promise<Vulnerability[]> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }

  // Only perform live HTTP(S) fetches for public targets
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return [];
  }

  const hostname = parsed.hostname;
  if (isPrivateHostname(hostname)) {
    // Avoid SSRF to private/internal addresses
    return [];
  }

  const origin = parsed.origin;

  const [
    robotsResult,
    securityResult,
    exposedFilesResult,
    corsResult,
    methodsResult,
    hostInjectionResult,
    graphqlResult,
    bucketListingResult,
  ] = await Promise.allSettled([
    checkRobotsTxt(origin),
    checkSecurityTxt(origin),
    checkExposedFiles(origin, url),
    checkActiveCORS(url),
    checkActiveHttpMethods(origin),
    checkXForwardedHostInjection(url),
    checkGraphQLIntrospection(origin, url),
    checkBucketListing(url),
  ]);

  const findings: Vulnerability[] = [];
  if (robotsResult.status === "fulfilled") findings.push(...robotsResult.value);
  if (securityResult.status === "fulfilled")
    findings.push(...securityResult.value);
  if (exposedFilesResult.status === "fulfilled")
    findings.push(...exposedFilesResult.value);
  if (corsResult.status === "fulfilled") findings.push(...corsResult.value);
  if (methodsResult.status === "fulfilled")
    findings.push(...methodsResult.value);
  if (hostInjectionResult.status === "fulfilled")
    findings.push(...hostInjectionResult.value);
  if (graphqlResult.status === "fulfilled")
    findings.push(...graphqlResult.value);
  if (bucketListingResult.status === "fulfilled")
    findings.push(...bucketListingResult.value);
  return findings;
}

// ── Main runner ──────────────────────────────────────────────────────────────

/** Ceiling for one top-level branch (DNS, TLS, or live-fetch) of the async layer. */
const BRANCH_TIMEOUT_MS = 12000;

const NO_FINDINGS: Vulnerability[] = [];

/**
 * Race a labeled branch against `BRANCH_TIMEOUT_MS` so one slow branch can
 * never block the others past the scan route's own 15s budget for the whole
 * async layer. Every individual DNS/TLS/HTTP call inside these branches
 * already has its own shorter timeout; this is the outer guarantee that
 * holds even if a future check forgets to add one.
 */
function boundedBranch(
  label: string,
  promise: Promise<Vulnerability[]>,
): Promise<{ label: string; findings: Vulnerability[]; timedOut: boolean }> {
  return Promise.race([
    promise.then((findings) => ({ label, findings, timedOut: false })),
    new Promise<{
      label: string;
      findings: Vulnerability[];
      timedOut: boolean;
    }>((resolve) =>
      setTimeout(
        () => resolve({ label, findings: NO_FINDINGS, timedOut: true }),
        BRANCH_TIMEOUT_MS,
      ),
    ),
  ]);
}

function buildBranches(
  url: string,
  categories?: string[] | null,
): { label: string; promise: Promise<Vulnerability[]> }[] {
  let hostname: string;
  let isHTTPS: boolean;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
    isHTTPS = parsed.protocol === "https:";
  } catch {
    return [];
  }

  const allowed = categories ? new Set(categories) : null;
  const runAll = !allowed;
  const branches: { label: string; promise: Promise<Vulnerability[]> }[] = [];

  // DNS checks map to "dns" category (SPF, DMARC, DKIM, DNSSEC)
  if (runAll || allowed!.has("dns")) {
    branches.push({ label: "dns", promise: checkDNSSecurity(hostname, url) });
  }

  // TLS checks map to "ssl" or "tls" category. The `ssl` category
  // groups the most common cert-validity findings (expiry, self-signed,
  // hostname mismatch). The `tls` category covers deeper protocol
  // analysis (cipher suites, protocol version, HSTS preload status).
  if ((runAll || allowed!.has("ssl") || allowed!.has("tls")) && isHTTPS) {
    const emitCategory: Category =
      allowed?.has("tls") && !allowed?.has("ssl") ? "tls" : "ssl";
    branches.push({
      label: "tls",
      promise: checkTLSCert(hostname, url, 443, emitCategory),
    });
  }

  // Live fetch checks (robots.txt → configuration/information-disclosure, security.txt → configuration)
  if (
    runAll ||
    allowed!.has("configuration") ||
    allowed!.has("information-disclosure")
  ) {
    branches.push({ label: "live-fetch", promise: checkLiveFetch(url) });
  }

  return branches;
}

export interface AsyncCheckResult {
  findings: Vulnerability[];
  /** Branch labels ("dns" | "tls" | "live-fetch") that hit the timeout ceiling. */
  incomplete: string[];
}

/**
 * The branch labels ("dns" | "tls" | "live-fetch") that
 * `runAsyncChecksDetailed` will actually execute for this URL and category
 * filter, without running any of the network work itself. A caller that
 * needs to size a progress denominator ahead of time (the scan route) uses
 * this instead of re-deriving `buildBranches`'s gating logic itself, so the
 * planned count can never drift from what actually runs.
 */
export function getPlannedAsyncBranches(
  url: string,
  categories?: string[] | null,
): string[] {
  return buildBranches(url, categories).map((b) => b.label);
}

/**
 * Run the DNS, TLS and live-fetch branches and report which, if any, did
 * not finish within their bound. Use this from a route that surfaces scan
 * completeness to the user; `runAsyncChecks` below is the same work without
 * that bookkeeping, kept for callers that only need the findings array.
 *
 * `onProgress`, when given, is called once per branch as it starts (right
 * before its promise is kicked off) and again when it settles — including
 * when it times out, since that genuinely is when the branch stopped
 * contributing. Branches run concurrently, not sequentially, so several
 * "start" events can fire back to back; that is an accurate report of what
 * this function actually does, not an approximation of it.
 */
export async function runAsyncChecksDetailed(
  url: string,
  categories?: string[] | null,
  onProgress?: ScanProgressHook,
): Promise<AsyncCheckResult> {
  const branches = buildBranches(url, categories);
  if (branches.length === 0) return { findings: [], incomplete: [] };

  const results = await Promise.allSettled(
    branches.map((b) => {
      onProgress?.(b.label, "start");
      return boundedBranch(b.label, b.promise).then((r) => {
        onProgress?.(b.label, "done");
        return r;
      });
    }),
  );

  const findings: Vulnerability[] = [];
  const incomplete: string[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    findings.push(...r.value.findings);
    if (r.value.timedOut) incomplete.push(r.value.label);
  }
  return { findings, incomplete };
}

export async function runAsyncChecks(
  url: string,
  categories?: string[] | null,
  onProgress?: ScanProgressHook,
): Promise<Vulnerability[]> {
  const { findings } = await runAsyncChecksDetailed(
    url,
    categories,
    onProgress,
  );
  return findings;
}
