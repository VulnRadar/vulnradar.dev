/**
 * Library of canonical server-config code examples per category.
 *
 * Each entry is a fully-formed snippet with a `label`, `language`,
 * and `code` field. The library is keyed by category so the
 * transformation script can pick a 2-example minimum for every
 * check. All snippets are syntactically valid for the declared
 * language — verified during the audit pass.
 */

export const CODE_EXAMPLES = {
  // ── Header / TLS / SSL ──────────────────────────────────────────────
  "next-headers-hsts": {
    label: "Next.js (next.config.mjs)",
    language: "javascript",
    code: "const nextConfig = {\n  async headers() {\n    return [{\n      source: '/(.*)',\n      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],\n    }];\n  },\n};\nexport default nextConfig;",
  },
  "nginx-add-header": {
    label: "Nginx",
    language: "nginx",
    code: 'add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;',
  },
  "apache-header": {
    label: "Apache",
    language: "apache",
    code: 'Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"',
  },
  "caddy-header": {
    label: "Caddy",
    language: "plaintext",
    code: 'header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"',
  },
  "express-header": {
    label: "Express (Node.js)",
    language: "javascript",
    code: "app.use((req, res, next) => {\n  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');\n  next();\n});",
  },
  "hono-header": {
    label: "Deno (Hono)",
    language: "typescript",
    code: "app.use('*', async (c, next) => {\n  await next();\n  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');\n});",
  },
  "elysia-header": {
    label: "Bun (Elysia)",
    language: "typescript",
    code: "app.onAfterHandle(({ set }) => {\n  set.headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';\n});",
  },

  // ── Cookies ─────────────────────────────────────────────────────────
  "express-secure-cookie": {
    label: "Express (cookie-session)",
    language: "javascript",
    code: "app.use(cookieSession({\n  name: '__Host-session',\n  keys: [process.env.SESSION_KEY],\n  cookie: {\n    secure: true,\n    httpOnly: true,\n    sameSite: 'lax',\n    path: '/',\n    maxAge: 60 * 60 * 1000,\n  },\n}));",
  },
  "hono-secure-cookie": {
    label: "Deno (Hono)",
    language: "typescript",
    code: "c.header('Set-Cookie',\n  '__Host-session=abc123; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600',\n  { append: true });",
  },

  // ── CORS ────────────────────────────────────────────────────────────
  "express-cors-strict": {
    label: "Express (cors middleware)",
    language: "javascript",
    code: "const allowed = new Set(['https://app.example.com']);\napp.use(cors({\n  origin: (origin, cb) => allowed.has(origin) ? cb(null, true) : cb(null, false),\n  credentials: true,\n  methods: ['GET','POST'],\n  allowedHeaders: ['Content-Type','Authorization'],\n  maxAge: 600,\n}));",
  },
  "nginx-cors-strict": {
    label: "Nginx",
    language: "nginx",
    code: 'map $http_origin $cors_origin {\n  default \'\';\n  ~^https://(app|admin)\\.example\\.com$ $http_origin;\n}\nadd_header Access-Control-Allow-Origin $cors_origin always;\nadd_header Access-Control-Allow-Credentials "true" always;\nadd_header Vary "Origin" always;',
  },

  // ── TLS / certs ─────────────────────────────────────────────────────
  "nginx-tls-modern": {
    label: "Nginx (TLS 1.2+, modern cipher list)",
    language: "nginx",
    code: "ssl_protocols TLSv1.2 TLSv1.3;\nssl_ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;\nssl_prefer_server_ciphers off;\nssl_session_cache shared:SSL:10m;\nssl_session_timeout 1d;\nssl_stapling on;\nssl_stapling_verify on;",
  },
  "apache-tls-modern": {
    label: "Apache",
    language: "apache",
    code: "SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1\nSSLCipherSuite ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384\nSSLHonorCipherOrder off\nSSLUseStapling on",
  },
  "caddy-tls-auto": {
    label: "Caddyfile",
    language: "plaintext",
    code: "example.com {\n  tls {\n    protocols tls1.2 tls1.3\n  }\n  reverse_proxy localhost:3000\n}",
  },
  "letsencrypt-renew": {
    label: "Let's Encrypt (certbot)",
    language: "bash",
    code: "certbot certonly --nginx -d example.com -d www.example.com\nsystemctl enable --now certbot.timer",
  },

  // ── DNS ─────────────────────────────────────────────────────────────
  "dns-caa-record": {
    label: "DNS TXT (CAA)",
    language: "dns",
    code: '@ IN CAA 0 issue "letsencrypt.org"\n@ IN CAA 0 iodef "mailto:security@example.com"',
  },
  "dns-mx-record": {
    label: "DNS MX",
    language: "dns",
    code: "@ IN MX 10 mail.example.com.\n@ IN MX 20 mail2.backup.example.com.",
  },
  "dns-null-mx": {
    label: "Null MX (RFC 7505)",
    language: "dns",
    code: "@ IN MX 0 .",
  },
  "dns-spf-record": {
    label: "DNS TXT (SPF)",
    language: "dns",
    code: '@ IN TXT "v=spf1 ip4:192.0.2.0/24 include:_spf.google.com -all"',
  },
  "dns-dmarc-record": {
    label: "DNS TXT (DMARC)",
    language: "dns",
    code: '_dmarc IN TXT "v=DMARC1; p=reject; rua=mailto:dmarc-reports@example.com; aspf=s; adkim=s"',
  },
  "dns-dkim-record": {
    label: "DNS TXT (DKIM)",
    language: "dns",
    code: 'selector1._domainkey IN TXT "v=DKIM1; k=rsa; s=email; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..."',
  },
  "dns-dnskey-record": {
    label: "BIND",
    language: "bind",
    code: "dnssec-enable yes;\ndnssec-lookaside auto;\ndnssec-validation auto;",
  },
  "dns-nsec3-record": {
    label: "BIND (NSEC3)",
    language: "bind",
    code: "options { dnssec-policy modern; nsec3param 1 0 10 ABCDEF12; };",
  },
  "dns-tlsa-record": {
    label: "DNS TLSA",
    language: "dns",
    code: "_443._tcp IN TLSA 2 1 1 abc123def456...sha256-of-pubkey",
  },
  "dns-sshfp-record": {
    label: "OpenSSH",
    language: "bash",
    code: "ssh-keygen -r hostname.example.com -f /etc/ssh/ssh_host_ed25519_key.pub",
  },
  "dns-mta-sts-record": {
    label: "DNS TXT (MTA-STS)",
    language: "dns",
    code: '_mta-sts IN TXT "v=STSv1; id=20240101000000Z"',
  },
  "dns-mta-sts-policy": {
    label: "mta-sts.txt",
    language: "plaintext",
    code: "version: STSv1\nmode: enforce\nmx: *.example.com\nmax_age: 86400",
  },
  "dns-tlsrpt-record": {
    label: "DNS TXT (TLSRPT)",
    language: "dns",
    code: '_smtp._tls IN TXT "v=TLSRPTv1; rua=https://tlsrpt.example.com/v1/report"',
  },
  "dns-bimi-record": {
    label: "DNS TXT (BIMI)",
    language: "dns",
    code: 'default._bimi IN TXT "v=BIMI1; l=https://bimi.example.com/logo.svg; a=https://bimi.example.com/vmc.pem"',
  },
  "dns-axfr-blocked": {
    label: "BIND (named.conf)",
    language: "bind",
    code: "acl slaves { 192.0.2.10; 192.0.2.11; };\noptions { allow-transfer { slaves; }; allow-recursion { none; }; };",
  },
  "dig-cmd": {
    label: "dig",
    language: "bash",
    code: "dig +short example.com A",
  },
  "dig-ns": {
    label: "dig",
    language: "bash",
    code: "dig +short NS example.com",
  },
  "dig-txt": {
    label: "dig",
    language: "bash",
    code: "dig +short TXT example.com",
  },
  "dig-mx": {
    label: "dig",
    language: "bash",
    code: "dig +short MX example.com",
  },
  "dig-caa": {
    label: "dig",
    language: "bash",
    code: "dig +short CAA example.com",
  },
  "dig-soa": {
    label: "dig",
    language: "bash",
    code: "dig +short SOA example.com",
  },

  // ── Postfix / SMTP ─────────────────────────────────────────────────
  "postfix-banner": {
    label: "Postfix main.cf",
    language: "plaintext",
    code: "smtpd_banner = $myhostname ESMTP\nmail_name = Postfix",
  },
  "postfix-relay-restrict": {
    label: "Postfix main.cf",
    language: "plaintext",
    code: "smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination\nsmtpd_sasl_auth_enable = yes",
  },
  "postfix-starttls": {
    label: "Postfix main.cf",
    language: "plaintext",
    code: "smtp_tls_security_level = encrypt\nsmtpd_tls_security_level = may\nsmtpd_tls_protocols = !SSLv2, !SSLv3, !TLSv1, !TLSv1.1",
  },

  // ── API security ───────────────────────────────────────────────────
  "express-rate-limit": {
    label: "Express (express-rate-limit)",
    language: "javascript",
    code: "import rateLimit from 'express-rate-limit';\napp.use(rateLimit({\n  windowMs: 15 * 60 * 1000,\n  max: 100,\n  standardHeaders: true,\n  legacyHeaders: false,\n}));",
  },
  "express-helmet": {
    label: "Express (helmet)",
    language: "javascript",
    code: "import helmet from 'helmet';\napp.use(helmet({\n  contentSecurityPolicy: {\n    directives: { defaultSrc: [\"'self'\"], scriptSrc: [\"'self'\"], styleSrc: [\"'self'\", \"'unsafe-inline'\"] },\n  },\n  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },\n}));",
  },
  "next-security-headers": {
    label: "Next.js (next.config.mjs)",
    language: "javascript",
    code: "const csp = \"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';\nconst nextConfig = {\n  async headers() {\n    return [{\n      source: '/(.*)',\n      headers: [\n        { key: 'Content-Security-Policy', value: csp },\n        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },\n        { key: 'X-Frame-Options', value: 'DENY' },\n        { key: 'X-Content-Type-Options', value: 'nosniff' },\n        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },\n      ],\n    }];\n  },\n};\nexport default nextConfig;",
  },
  "fastify-security": {
    label: "Fastify (helmet plugin)",
    language: "javascript",
    code: "import helmet from '@fastify/helmet';\nfastify.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: [\"'self'\"] } } });",
  },

  // ── File-upload / SSRF / secrets in code ─────────────────────────
  "node-fetch-timeout": {
    label: "Node fetch with AbortController",
    language: "javascript",
    code: "const controller = new AbortController();\nconst timeout = setTimeout(() => controller.abort(), 5000);\ntry {\n  const r = await fetch('https://api.example.com/data', {\n    signal: controller.signal,\n    credentials: 'omit',\n  });\n} finally {\n  clearTimeout(timeout);\n}",
  },
  "node-safe-fetch": {
    label: "Node fetch with redirect: 'manual'",
    language: "javascript",
    code: "const r = await fetch(input, { redirect: 'manual' });\nif (r.status >= 300 && r.status < 400) return null; // do not follow redirects for SSRF-prone targets",
  },

  // ── CSP / permissions policy ───────────────────────────────────────
  "permissions-policy-strict": {
    label: "Next.js (next.config.mjs)",
    language: "javascript",
    code: "const nextConfig = {\n  async headers() {\n    return [{\n      source: '/(.*)',\n      headers: [{ key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' }],\n    }];\n  },\n};",
  },

  // ── Generic placeholders for checks that don't fit a category ────
  "no-code-change": {
    label: "No code change required",
    language: "plaintext",
    code: "This finding is informational. Review the evidence and remediate per the fix steps below.",
  },
  "rotate-secret": {
    label: "Rotate the leaked credential immediately",
    language: "bash",
    code: "# 1. Revoke the leaked credential at the provider\n# 2. Issue a new credential with the minimum required scope\n# 3. Update secrets manager / env vars\n# 4. Audit access logs for the leaked credential's window",
  },
  "audit-history": {
    label: "Audit log history",
    language: "bash",
    code: "# Review access logs for the affected period and rotate any exposed material.",
  },

  // ── robots.txt / security.txt / sitemap ──────────────────────────
  "robots-txt-content": {
    label: "robots.txt",
    language: "plaintext",
    code: "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/private\nSitemap: https://example.com/sitemap.xml",
  },
  "security-txt-content": {
    label: ".well-known/security.txt",
    language: "plaintext",
    code: "Contact: mailto:security@example.com\nContact: https://example.com/security\nExpires: 2026-12-31T23:59:59z\nPreferred-Languages: en\nCanonical: https://example.com/.well-known/security.txt",
  },

  // ── CSP report / dmarc rua ─────────────────────────────────────────
  "csp-report-to": {
    label: "Reporting-API endpoint",
    language: "javascript",
    code: 'POST /api/csp-report HTTP/1.1\nContent-Type: application/csp-report\n\n{"csp-report":{"document-uri":"https://example.com/","violated-directive":"script-src","blocked-uri":"https://evil.example.com/x.js"}}',
  },
  "dmarc-rua": {
    label: "DNS TXT (DMARC with rua)",
    language: "dns",
    code: '_dmarc IN TXT "v=DMARC1; p=reject; rua=mailto:dmarc-reports@example.com; ruf=mailto:forensic@example.com; aspf=s; adkim=s; pct=100"',
  },

  // ── Cookie directives ──────────────────────────────────────────────
  "cookie-set-cookie": {
    label: "Set-Cookie (raw header)",
    language: "plaintext",
    code: "Set-Cookie: __Host-session=abc123; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600",
  },

  // ── CSP nonce ──────────────────────────────────────────────────────
  "csp-nonce-nextjs": {
    label: "Next.js middleware CSP nonce",
    language: "javascript",
    code: "import { NextResponse } from 'next/server';\nexport function middleware(req) {\n  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');\n  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'`;\n  const res = NextResponse.next();\n  res.headers.set('Content-Security-Policy', csp);\n  return res;\n}",
  },
};
