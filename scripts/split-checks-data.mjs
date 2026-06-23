// One-off split script. Run with: node scripts/split-checks-data.mjs
// Reads the monolithic lib/scanner/checks-data.json and writes one
// per-category JSON file under lib/scanner/checks-data/.
//
// Re-distributes checks into the new 12-category taxonomy:
//   headers, ssl, tls, content, cookies, configuration,
//   information-disclosure, dns, email, api, code, secrets-extended

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const src = resolve(repo, "lib/scanner/checks-data.json");
const outDir = resolve(repo, "lib/scanner/checks-data");

if (!existsSync(src)) {
  console.error(`source not found: ${src}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const data = JSON.parse(readFileSync(src, "utf8"));
const checks = data.checks || [];

// Map known IDs to the new category taxonomy. Anything not listed here
// stays in whatever category the original entry had.
const RECATEGORIZE = {
  // SSL — these are HTTP-level (URL is HTTP, deprecated TLS header)
  ssl: new Set(["deprecated-tls", "http-no-redirect", "ssl-strip-detected"]),
  // Content — pure HTML / page structure
  content: new Set([
    "iframe-no-sandbox",
    "iframe-sandbox-missing",
    "form-action-http",
    "form-target-blank",
    "form-method-get-sensitive",
    "mixed-content",
    "mixed-content-form-action",
    "sri-missing",
    "sri-stylesheet-missing",
    "sri-link-stylesheet-missing",
    "external-script-no-sri",
    "lazy-loading-missing",
    "input-no-maxlength",
    "html-lang-missing",
    "viewport-user-scalable-no",
    "insecure-iframes",
    "opengraph-injection",
    "service-worker-scope",
    "sensitive-meta-tags",
    "autocomplete-sensitive",
    "autocomplete-sensitive-fields",
    "password-paste-disabled",
    "password-input-no-name",
    "weak-password-policy",
    "session-cookie-flags",
    "cookie-no-secure-prefix",
    "set-cookie-samesite-none-no-secure",
    "cookie-max-age-excessive",
    "cookie-path-broad",
    "open-form-action",
    "sensitive-form-no-csrf",
    "sri-link-missing",
    "base-tag",
    "meta-refresh",
    "preconnect-third-party",
    "open-redirect-params",
    "open-redirect",
    "unencrypted-connections",
    "cross-site-websocket",
    "insecure-crypto",
    "postmessage-origin",
    "postmessage-star-origin",
    "reverse-tabnabbing",
    "source-maps",
    "sourcemap-reference",
    "inline-event-handlers",
    "local-storage-sensitive",
    "storage-api-usage",
    "excessive-permissions",
    "feature-policy-deprecated",
    "dangerous-html-attrs",
    "dangerous-inline-js",
    "window-opener-abuse",
    "document-domain",
    "document-domain-usage",
    "document-cookie-access",
    "sensitive-endpoints",
    "sensitive-comments",
    "email-address-leak",
    "email-exposure",
    "phone-number-leak",
    "credit-card-pattern",
    "ssn-pattern",
    "hardcoded-ip-addresses",
    "private-ip-exposure",
    "exposed-error-messages",
    "exposed-stack-trace",
    "sql-error-in-page",
    "php-error-in-page",
    "asp-error-in-page",
    "django-debug-page",
    "laravel-debug-page",
    "debug-indicators",
    "debug-endpoint",
    "admin-endpoint",
    "swagger-docs-exposed",
    "graphql-endpoint-exposed",
    "graphql-introspection",
    "spring-boot-actuator",
    "wp-login-exposed",
    "phpinfo-exposed",
    "git-directory-exposed",
    "env-file-reference",
    "backup-file-reference",
    "aws-metadata-reference",
    "s3-bucket-exposed",
    "firebase-config-exposed",
    "directory-listing",
    "robots-txt-exposure",
    "sensitive-files",
    "jwt-in-html",
    "jwt-in-url",
    "token-exposure",
    "private-key-in-source",
    "base64-credentials",
    "connection-string-exposed",
    "outdated-js-libs",
    "outdated-jquery",
    "outdated-angular",
    "prototype-js-outdated",
    "mootools-outdated",
    "cms-fingerprinting",
    "cdn-fallback-missing",
    "api-version-exposed",
    "exposed-api-version",
    "rate-limiting",
    "session-cookie-flags",
    "exposed-session-id",
    "password-in-get",
    "remember-me-token",
    "oauth-state-missing",
    "email-enumeration",
    "verbose-error-messages",
    "page-title-issues",
    "internal-ip-exposed",
    "security-txt-missing",
    "sensitive-endpoints",
  ]),
  // Configuration — server / framework config
  configuration: new Set([
    "server-header-disclosure",
    "x-powered-by-exposed",
    "x-aspnet-version-exposed",
    "x-aspnetmvc-version-exposed",
    "via-header-exposed",
    "x-runtime-exposed",
    "x-request-id-exposed",
    "x-backend-server-exposed",
    "age-header-reveals-cdn",
    "x-debug-header-exposed",
    "x-amz-request-id",
    "cf-ray-header",
    "x-vercel-id",
    "x-cache-header",
    "etag-inode",
    "etag-inode-leak",
    "date-time-skew",
    "cache-control-public-sensitive",
    "cache-control-missing",
    "document-policy-missing",
    "origin-agent-cluster",
    "x-dns-prefetch-control-off",
    "nel-header-missing",
    "report-to-header-missing",
    "access-control-expose-broad",
    "access-control-max-age-long",
    "server-version-detailed",
    "server-timing-exposure",
    "clickjacking-frameable",
    "x-amz-request-id",
  ]),
  // Cookies — anything that touches cookies
  cookies: new Set([
    "cookie-security",
    "cookie-httponly-missing",
    "cookie-secure-missing",
    "cookie-samesite-missing",
    "cookie-prefix-invalid",
    "cookie-no-secure-prefix",
    "session-cookie-flags",
    "set-cookie-samesite-none-no-secure",
    "cookie-max-age-excessive",
    "cookie-path-broad",
  ]),
  // Code — pure code / SAST-style patterns
  code: new Set([
    "dom-xss-sinks",
    "innerhtml-xss-sink",
    "outerhtml-xss-sink",
    "document-write-sink",
    "insertadjacenthtml-sink",
    "unsafe-setattribute",
    "eval-in-scripts",
    "eval-usage",
    "function-constructor",
    "settimeout-string",
    "prototype-pollution",
    "insecure-crypto",
    "sql-injection-patterns",
    "command-injection",
    "command-injection-indicators",
    "path-traversal",
    "path-traversal-indicators",
    "ssrf-vulnerability",
    "ssrf-indicators",
    "xxe-vulnerability",
    "xml-external-entity",
    "insecure-deserialization",
    "insecure-auth",
    "ssti-indicators",
    "ldap-injection-indicators",
    "reflected-input",
    "html-injection-patterns",
    "postmessage-star-origin",
    "dangerous-inline-js",
    "local-storage-sensitive",
    "storage-api-usage",
    "window-opener-abuse",
    "document-domain",
    "document-domain-usage",
    "document-cookie-access",
    "reverse-tabnabbing",
    "inline-event-handlers",
    "dangerous-html-attrs",
    "cross-site-websocket",
    "postmessage-origin",
    "service-worker-scope",
    "opengraph-injection",
    "open-redirect",
    "open-redirect-params",
    "unencrypted-connections",
    "websocket-unencrypted",
    "sri-missing",
    "sri-stylesheet-missing",
    "sri-link-stylesheet-missing",
    "external-script-no-sri",
    "javascript-outdated-jquery",
    "insecure-crypto",
    "jwt-in-html",
    "jwt-in-url",
    "token-exposure",
    "private-key-in-source",
    "base64-credentials",
    "connection-string-exposed",
    "insecure-form-submission",
    "form-action-http",
    "form-action-missing",
    "form-method-get-sensitive",
    "postmessage-star-origin",
    "iframe-sandbox-missing",
    "iframe-no-sandbox",
  ]),
  // secrets-extended — credit cards / SSN / phone / more tokens
  "secrets-extended": new Set([
    "credit-card-pattern",
    "ssn-pattern",
    "phone-number-leak",
    "email-exposure",
    "email-address-leak",
    "hardcoded-secrets",
    "hardcoded-ip-addresses",
    "private-ip-exposure",
    "internal-ip-exposed",
    "firebase-config-exposed",
    "s3-bucket-exposed",
    "aws-metadata-reference",
    "base64-credentials",
    "connection-string-exposed",
    "private-key-in-source",
    "jwt-in-html",
    "jwt-in-url",
    "token-exposure",
  ]),
  // api — GraphQL / REST / OpenAPI / Swagger
  api: new Set([
    "graphql-introspection",
    "graphql-endpoint-exposed",
    "swagger-docs-exposed",
    "api-version-exposed",
    "exposed-api-version",
    "rate-limiting",
    "email-enumeration",
  ]),
  // Email — SPF / DMARC / DKIM / DNSSEC moved here (also in async-checks.ts).
  // JSON entries don't include the async ones but we seed with a couple of
  // placeholder informational entries so /finding-types surfaces the
  // category on the API docs page.
  email: new Set([]),
  // DNS — pure DNS recon. Currently only informational placeholders.
  dns: new Set([]),
  // TLS — pure TLS (cert chain, OCSP, cipher, etc). All real checks live
  // in async-checks.ts.
  tls: new Set([]),
};

// Recategorize each check
const byCategory = new Map();
for (const def of checks) {
  let cat = def.category || "uncategorized";
  // Apply rename rules
  if (cat === "javascript") cat = "code";
  // Apply manual overrides by id (highest priority)
  for (const [target, ids] of Object.entries(RECATEGORIZE)) {
    if (ids.has(def.id)) {
      cat = target;
      break;
    }
  }
  def.category = cat;
  if (!byCategory.has(cat)) byCategory.set(cat, []);
  byCategory.get(cat).push(def);
}

// Make sure every category file exists, even if empty.
const ALL_CATS = [
  "headers",
  "ssl",
  "tls",
  "content",
  "cookies",
  "configuration",
  "information-disclosure",
  "dns",
  "email",
  "api",
  "code",
  "secrets-extended",
];

// Seed the three empty categories (tls, dns, email) with a couple of
// informational entries so the /finding-types response shape stays
// predictable and so consumers can render "no findings" for them
// honestly. These are flagged `type: "info"` and only show up on the
// docs page, not in scan output — the async-checks.ts executor handles
// the real checks.
const SEEDS = {
  tls: [
    {
      id: "tls-certificate-expiry",
      type: "header",
      title: "TLS Certificate Expiry",
      category: "tls",
      severity: "high",
      description:
        "Async check: opens a TLS connection to :443 and reports the certificate validity window, expiry, self-signing, and incomplete chains.",
      evidence: "Executed in async-checks.ts via Node tls.connect().",
      riskImpact:
        "An expired or self-signed certificate breaks HTTPS trust and exposes users to MITM attacks.",
      explanation:
        "TLS certificates are short-lived by design. The scan opens a TLS connection (not just an HTTP request) so it can inspect the leaf certificate and chain directly.",
      fixSteps: [
        "Renew the certificate via your CA (Let's Encrypt is free).",
        "Enable auto-renewal (certbot, Caddy, or hosting-provider automation).",
        "Verify the chain: openssl s_client -connect example.com:443 -showcerts.",
      ],
      codeExamples: [
        {
          label: "OpenSSL verification",
          language: "bash",
          code: "openssl s_client -connect example.com:443 -showcerts < /dev/null | openssl x509 -noout -dates -subject -issuer",
        },
      ],
    },
    {
      id: "tls-protocol-version",
      type: "header",
      title: "Weak TLS Protocol Version",
      category: "tls",
      severity: "high",
      description:
        "Async check: reports whether the negotiated TLS protocol is TLS 1.2+ or older (TLS 1.0/1.1/SSLv3).",
      evidence:
        "Executed via Node tls.connect() with negotiated protocol logged.",
      riskImpact:
        "Older TLS versions have known attacks (POODLE, BEAST, ROBOT) and lack modern cipher suites.",
      explanation:
        "TLS 1.0 and 1.1 have been deprecated by IETF (RFC 8996). Most browsers and APIs no longer support them.",
      fixSteps: [
        "Disable TLS 1.0 and 1.1 on the server.",
        "Keep TLS 1.2 and 1.3 enabled.",
        "Prefer AEAD ciphers (AES-GCM, ChaCha20-Poly1305).",
      ],
      codeExamples: [
        {
          label: "Nginx",
          language: "nginx",
          code: "ssl_protocols TLSv1.2 TLSv1.3;\nssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305;",
        },
      ],
    },
  ],
  dns: [
    {
      id: "dns-resolves",
      type: "header",
      title: "DNS A/AAAA Records",
      category: "dns",
      severity: "info",
      description:
        "Async check: resolves A and AAAA records for the target hostname and flags private/loopback addresses that should never appear in DNS for a public target.",
      evidence: "Executed via dns/promises.resolve4 and resolve6.",
      riskImpact:
        "Private IPs in public DNS can leak internal infrastructure and indicate takeover risk for dangling records.",
      explanation:
        "DNS resolution is the first step of every scan. If the resolver returns RFC1918 / loopback / link-local addresses for a hostname the user typed, the target isn't publicly reachable and the scan is blocked.",
      fixSteps: [
        "Remove A/AAAA records pointing at internal IPs.",
        "Audit CNAMEs for dangling-takeover risk (cloudfront, heroku, etc.).",
        "Use split-horizon DNS only where appropriate.",
      ],
      codeExamples: [
        {
          label: "dig",
          language: "bash",
          code: "dig +short example.com A\tdig +short example.com AAAA",
        },
      ],
    },
  ],
  email: [
    {
      id: "spf-record",
      type: "header",
      title: "SPF (Sender Policy Framework)",
      category: "email",
      severity: "medium",
      description:
        "Async check: queries TXT records at the apex for `v=spf1` and reports presence, weak mechanisms (+all), and lookup count.",
      evidence: "Executed via dns/promises.resolveTxt.",
      riskImpact:
        "Without SPF, attackers can spoof emails from your domain (phishing / BEC).",
      explanation:
        "SPF is the oldest of the three email-authentication mechanisms (SPF, DKIM, DMARC).",
      fixSteps: [
        "Publish a TXT record at the apex: v=spf1 include:_spf.google.com -all",
        "Stay under the 10-lookup limit (use ip4/ip6 for static ranges).",
        "Use -all (hard fail) or ~all (soft fail).",
      ],
      codeExamples: [
        {
          label: "DNS TXT",
          language: "dns",
          code: "v=spf1 include:_spf.google.com include:sendgrid.net -all",
        },
      ],
    },
    {
      id: "dmarc-record",
      type: "header",
      title: "DMARC (Domain-based Message Authentication)",
      category: "email",
      severity: "medium",
      description:
        "Async check: queries TXT records at _dmarc.<domain> for `v=DMARC1` and reports the policy (none/quarantine/reject).",
      evidence: "Executed via dns/promises.resolveTxt on _dmarc.<domain>.",
      riskImpact:
        "Without DMARC, receivers have no policy for handling SPF/DKIM failures.",
      explanation:
        "DMARC ties SPF and DKIM together with a policy. p=reject is the gold standard.",
      fixSteps: [
        "Add a TXT record at _dmarc.<domain>: v=DMARC1; p=reject; rua=mailto:...",
        "Start at p=none to monitor, then move to p=quarantine and finally p=reject.",
      ],
      codeExamples: [
        {
          label: "DNS TXT",
          language: "dns",
          code: "v=DMARC1; p=reject; rua=mailto:dmarc-reports@yourdomain.com; adkim=s; aspf=s",
        },
      ],
    },
    {
      id: "dkim-record",
      type: "header",
      title: "DKIM (DomainKeys Identified Mail)",
      category: "email",
      severity: "low",
      description:
        "Async check: tries a list of common DKIM selectors and reports whether any DKIM TXT or CNAME was found.",
      evidence:
        "Executed via dns/promises.resolveTxt / resolveCname for ~20 selectors.",
      riskImpact:
        "Without DKIM, receivers cannot verify message integrity end-to-end.",
      explanation:
        "DKIM adds a cryptographic signature to every outgoing message. Selectors are provider-specific.",
      fixSteps: [
        "Enable DKIM signing in your mail provider (Google Workspace, M365, Fastmail, etc.).",
        "Publish the public key as selector._domainkey.<domain> TXT.",
      ],
      codeExamples: [
        {
          label: "DNS TXT",
          language: "dns",
          code: "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCg...",
        },
      ],
    },
    {
      id: "dnssec-enabled",
      type: "header",
      title: "DNSSEC",
      category: "email",
      severity: "info",
      description:
        "Async check: queries Google and Cloudflare DNS-over-HTTPS for the AD (Authenticated Data) flag and reports whether the chain is DNSSEC-signed.",
      evidence:
        "Executed via dns.google/resolve and cloudflare-dns.com/dns-query.",
      riskImpact:
        "Without DNSSEC, an on-path attacker can forge DNS responses (cache poisoning).",
      explanation:
        "DNSSEC adds cryptographic signatures so resolvers can detect forged answers.",
      fixSteps: [
        "Enable DNSSEC at your registrar (most support one-click activation).",
        "Verify with: dig +dnssec <your domain>",
      ],
      codeExamples: [
        {
          label: "dig",
          language: "bash",
          code: "dig +dnssec example.com",
        },
      ],
    },
    {
      id: "mta-sts",
      type: "header",
      title: "MTA-STS (SMTP Strict Transport Security)",
      category: "email",
      severity: "medium",
      description:
        "Async check: probes _mta-sts.<domain> for an `v=STSv1` TXT record and fetches the policy file at mta-sts.<domain>/.well-known/mta-sts.txt.",
      evidence: "DNS TXT query + HTTPS GET on the policy URL.",
      riskImpact:
        "Without MTA-STS, attackers can downgrade SMTP STARTTLS or intercept mail in transit.",
      explanation:
        "MTA-STS tells receiving mail servers to require TLS and refuse downgraded sessions.",
      fixSteps: [
        "Publish _mta-sts.<domain> TXT with v=STSv1; id=<timestamp>",
        "Serve the policy at https://mta-sts.<domain>/.well-known/mta-sts.txt",
        "Submit to the TLSRPT reporting address.",
      ],
      codeExamples: [
        {
          label: "mta-sts.txt",
          language: "text",
          code: "version: STSv1\nmode: enforce\nmx: *.example.com\nmax_age: 86400",
        },
      ],
    },
    {
      id: "tls-rpt",
      type: "header",
      title: "TLS-RPT (TLS Reporting)",
      category: "email",
      severity: "info",
      description:
        "Async check: probes _smtp._tls.<domain> for a `v=TLSRPTv1` TXT record.",
      evidence: "DNS TXT query only.",
      riskImpact:
        "Without TLSRPT you get no telemetry about SMTP TLS failures.",
      explanation:
        "TLSRPT is a companion to MTA-STS: it tells receivers where to send aggregate reports.",
      fixSteps: [
        "Publish _smtp._tls.<domain> TXT with v=TLSRPTv1; rua=https://...",
      ],
      codeExamples: [
        {
          label: "DNS TXT",
          language: "dns",
          code: "v=TLSRPTv1; rua=https://tlsrpt.example.com/v1/report",
        },
      ],
    },
  ],
};

for (const [cat, seeds] of Object.entries(SEEDS)) {
  if (!byCategory.has(cat)) byCategory.set(cat, []);
  const existingIds = new Set(byCategory.get(cat).map((d) => d.id));
  for (const seed of seeds) {
    if (!existingIds.has(seed.id)) byCategory.get(cat).push(seed);
  }
}

// Ensure every category file exists, even if empty.
for (const cat of ALL_CATS) {
  if (!byCategory.has(cat)) byCategory.set(cat, []);
}

for (const cat of ALL_CATS) {
  const defs = byCategory.get(cat);
  const target = resolve(outDir, `${cat}.json`);
  writeFileSync(target, JSON.stringify(defs, null, 2));
}

// Move the monolithic JSON to a legacy name.
const legacy = resolve(repo, "lib/scanner/checks-data.legacy.json");
renameSync(src, legacy);

// Stats summary, sorted by count desc.
const sorted = [...byCategory.entries()].sort(
  (a, b) => b[1].length - a[1].length,
);
console.log("category breakdown:");
let total = 0;
for (const [cat, defs] of sorted) {
  console.log(`  ${cat.padEnd(25)} ${defs.length}`);
  total += defs.length;
}
console.log(`  ${"TOTAL".padEnd(25)} ${total}`);
console.log(
  `\nmoved monolithic -> checks-data.legacy.json (${checks.length} original + ${total - checks.length} seeded = ${total} total)`,
);
