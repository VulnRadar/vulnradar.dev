import type { Category } from "./types";

/** Display label + one-line description per scanner category. Shared
 *  source of truth for anywhere category names/counts are shown to a
 *  human or an LLM (landing page, AI chat system prompt) so they can't
 *  drift out of sync with each other or with the live check registry. */
export const CATEGORY_META: Record<Category, { label: string; blurb: string }> =
  {
    headers: {
      label: "Headers",
      blurb: "CSP, HSTS, X-Frame-Options, referrer policy, permissions policy.",
    },
    ssl: {
      label: "SSL",
      blurb: "Certificate chain, signature algorithm, issuer, expiry date.",
    },
    tls: {
      label: "TLS",
      blurb: "Protocol version, cipher suite, ALPN negotiation, OCSP stapling.",
    },
    content: {
      label: "Content",
      blurb: "XSS sinks, reflected parameters, open redirects, mixed content.",
    },
    cookies: {
      label: "Cookies",
      blurb:
        "Secure, HttpOnly, SameSite, scope, __Host- and __Secure- prefixes.",
    },
    configuration: {
      label: "Config",
      blurb: "Server banner, framework fingerprint, exposed debug endpoints.",
    },
    "information-disclosure": {
      label: "Info disclosure",
      blurb: "Source maps, .env files, .git exposure, stack traces in errors.",
    },
    dns: {
      label: "DNS",
      blurb: "SPF, DMARC, DKIM, DNSSEC, CAA records, dangling CNAMEs.",
    },
    email: {
      label: "Email",
      blurb: "MX records, SMTP TLS, SPF alignment, spoofing surface area.",
    },
    api: {
      label: "API",
      blurb: "CORS policy, rate-limit headers, GraphQL introspection, OpenAPI.",
    },
    code: {
      label: "Code",
      blurb: "Inline JS patterns, vulnerable library versions, leaked tokens.",
    },
    "secrets-extended": {
      label: "Secrets",
      blurb: "AWS keys, Stripe, GitHub, OpenAI, generic high-entropy strings.",
    },
    "vibe-code": {
      label: "AI code",
      blurb:
        "Placeholder auth, disabled TLS verification, weak crypto: the gaps generated code ships with.",
    },
    "client-side": {
      label: "Client-side",
      blurb:
        "DOM XSS sinks, postMessage origin checks, unsafe-inline CSP, prototype pollution.",
    },
    "supply-chain": {
      label: "Supply chain",
      blurb:
        "Exposed lock files, dependency manifests, build artifacts, source maps.",
    },
    "host-validation": {
      label: "Host validation",
      blurb:
        "Open redirects, SSRF through the Host header, subdomain takeover markers.",
    },
  };
