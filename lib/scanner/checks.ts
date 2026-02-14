/**
 * VulnRadar Detection Engine v1.4.0
 *
 * Pure detection engine. ALL metadata (title, description, fixSteps, codeExamples, etc.)
 * lives in checks-data.json. This file contains ONLY detection logic.
 *
 * To add a new check:
 * 1. Add metadata to checks-data.json
 * 2. Add a detection case in the detect() switch below
 */

import type { Vulnerability, Category } from "./types"
import checksData from "./checks-data.json"

type CheckFn = (url: string, headers: Headers, body: string) => Vulnerability | null

// ── Helpers ────────────────────────────────────────────────────────────────

let idCounter = 0
function generateId(): string {
  return `vuln-${Date.now()}-${idCounter++}`
}

function h(headers: Headers, key: string): string | null {
  return headers.get(key)
}

function hLower(headers: Headers, key: string): string {
  return (headers.get(key) || "").toLowerCase()
}

function hasHeader(headers: Headers, key: string): boolean {
  return headers.has(key)
}

// ── Detection Functions ────────────────────────────────────────────────────
// Each function returns evidence string (truthy = found) or null (not found).
// The framework wraps the evidence into a full Vulnerability object using JSON metadata.

type DetectFn = (url: string, headers: Headers, body: string) => string | null

const detectors: Record<string, DetectFn> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER CHECKS
  // ═══════════════════════════════════════════════════════════════════════════

  "hsts-missing": (_url, headers) => {
    if (hasHeader(headers, "strict-transport-security")) return null
    return "Header 'Strict-Transport-Security' is not present in the response."
  },

  "csp-missing": (_url, headers) => {
    if (hasHeader(headers, "content-security-policy")) return null
    return "Header 'Content-Security-Policy' is not present in the response."
  },

  "clickjack-missing": (_url, headers) => {
    const xfo = h(headers, "x-frame-options")
    const csp = h(headers, "content-security-policy")
    if (xfo) return null
    if (csp && csp.includes("frame-ancestors")) return null
    return "Neither 'X-Frame-Options' header nor CSP 'frame-ancestors' directive is set."
  },

  "xcto-missing": (_url, headers) => {
    if (hasHeader(headers, "x-content-type-options")) return null
    return "Header 'X-Content-Type-Options' is not present in the response."
  },

  "referrer-policy-missing": (_url, headers) => {
    if (hasHeader(headers, "referrer-policy")) return null
    return "Header 'Referrer-Policy' is not present in the response."
  },

  "permissions-policy-missing": (_url, headers) => {
    if (hasHeader(headers, "permissions-policy") || hasHeader(headers, "feature-policy")) return null
    return "Neither 'Permissions-Policy' nor 'Feature-Policy' headers are present."
  },

  "server-header-disclosure": (_url, headers) => {
    const server = h(headers, "server")
    const powered = h(headers, "x-powered-by")
    const via = h(headers, "x-aspnet-version")
    const found: string[] = []
    if (server && server !== "cloudflare" && server !== "Vercel") found.push(`Server: ${server}`)
    if (powered) found.push(`X-Powered-By: ${powered}`)
    if (via) found.push(`X-AspNet-Version: ${via}`)
    return found.length > 0 ? `Technology disclosed: ${found.join(", ")}` : null
  },

  "mixed-content": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null
    const httpRefs = body.match(/(?:src|href|action)=["']http:\/\/(?!localhost)[^"']+["']/gi) || []
    if (httpRefs.length === 0) return null
    const samples = httpRefs.slice(0, 3).map((r) => r.replace(/^(?:src|href|action)=["']/i, "").replace(/["']$/, ""))
    return `Found ${httpRefs.length} HTTP resource(s) on HTTPS page:\n${samples.join("\n")}${httpRefs.length > 3 ? `\n...and ${httpRefs.length - 3} more` : ""}`
  },

  "open-redirect": (_url, _headers, body) => {
    const patterns = [
      /[?&](?:redirect|return|next|url|goto|dest|redir|returnTo|continue|forward|target)=[^&"'\s]+/gi,
      /window\.location\s*=\s*(?:decodeURIComponent|unescape)?\(?\s*(?:new\s+URLSearchParams|location\.(?:search|hash))/gi,
    ]
    const found: string[] = []
    for (const p of patterns) {
      const matches = body.match(p) || []
      found.push(...matches.slice(0, 3))
    }
    return found.length > 0 ? `Found ${found.length} redirect-related pattern(s): ${found.slice(0, 2).join(", ")}` : null
  },

  "cookie-security": (_url, headers) => {
    const setCookies: string[] = []
    headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") setCookies.push(value)
    })
    if (setCookies.length === 0) return null
    const issues: string[] = []
    for (const cookie of setCookies) {
      const lower = cookie.toLowerCase()
      const name = cookie.split("=")[0]?.trim()
      if (!lower.includes("httponly") && !name?.startsWith("__Host-")) issues.push(`${name} missing HttpOnly`)
      if (!lower.includes("secure")) issues.push(`${name} missing Secure`)
      if (!lower.includes("samesite")) issues.push(`${name} missing SameSite`)
    }
    return issues.length > 0 ? issues.slice(0, 5).join("; ") : null
  },

  "deprecated-tls": (url) => {
    return url.startsWith("http://") ? `URL uses HTTP: ${url}` : null
  },

  "cors-wildcard": (_url, headers) => {
    const acao = h(headers, "access-control-allow-origin")
    return acao === "*" ? "Access-Control-Allow-Origin is set to '*'." : null
  },

  "sri-missing": (_url, _headers, body) => {
    const externalScripts = body.match(/<script[^>]+src=["']https?:\/\/[^"']+["'][^>]*>/gi) || []
    const noSRI = externalScripts.filter((t) => !t.toLowerCase().includes("integrity="))
    if (noSRI.length === 0) return null
    const samples = noSRI.slice(0, 3).map((t) => {
      const srcMatch = t.match(/src=["'](https?:\/\/[^"']+)["']/i)
      return srcMatch ? srcMatch[1] : t.slice(0, 80)
    })
    return `Found ${noSRI.length} external script(s) without integrity:\n${samples.join("\n")}${noSRI.length > 3 ? `\n...and ${noSRI.length - 3} more` : ""}`
  },

  "form-action-http": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null
    const httpForms = body.match(/<form[^>]*action=["']http:\/\/[^"']+["'][^>]*>/gi) || []
    return httpForms.length > 0 ? `Found ${httpForms.length} form(s) submitting over HTTP.` : null
  },

  "cache-control-missing": (_url, headers) => {
    if (hasHeader(headers, "cache-control") || hasHeader(headers, "pragma")) return null
    return "Neither 'Cache-Control' nor 'Pragma' headers are present."
  },

  "xxss-protection-missing": (_url, headers) => {
    if (hasHeader(headers, "x-xss-protection")) return null
    if (hasHeader(headers, "content-security-policy")) return null
    return "Neither 'X-XSS-Protection' nor CSP is set."
  },

  "email-exposure": (_url, _headers, body) => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    const emails = body.match(emailRegex) || []
    const filtered = emails.filter((e) => {
      const lower = e.toLowerCase()
      return !lower.endsWith(".png") && !lower.endsWith(".jpg") && !lower.endsWith(".svg") &&
        !lower.endsWith(".gif") && !lower.endsWith(".webp") && !lower.includes("@example") &&
        !lower.includes("@test") && !lower.includes("schema.org") && !lower.includes("w3.org") &&
        !lower.includes("sentry.io") && !lower.includes("@2x") && !lower.includes("@3x")
    })
    const unique = [...new Set(filtered)]
    return unique.length > 0 ? `Found ${unique.length} email address(es): ${unique.slice(0, 3).join(", ")}` : null
  },

  "directory-listing": (_url, _headers, body) => {
    const indicators = [
      /<title>Index of \/[^<]*<\/title>/i,
      /<h1>Index of \/[^<]*<\/h1>/i,
      /\[To Parent Directory\]/i,
      /<pre>.*<a href="[^"]*">.*<\/a>.*\d{4}-\d{2}-\d{2}/si,
    ]
    for (const p of indicators) {
      if (p.test(body)) return "Directory listing indicators found in response."
    }
    return null
  },

  "sensitive-files": (_url, _headers, body) => {
    const patterns = [/\.env(?:\b|["'])/i, /\.git\//i, /\.htaccess/i, /\.htpasswd/i, /wp-config\.php/i, /\.aws\/credentials/i, /\.ssh\//i, /id_rsa/i, /\.npmrc/i, /docker-compose\.yml/i]
    const found: string[] = []
    for (const p of patterns) {
      if (p.test(body)) found.push(p.source.replace(/[\\()]/g, ""))
    }
    return found.length > 0 ? `References to sensitive files: ${found.slice(0, 5).join(", ")}` : null
  },

  "outdated-js-libs": (_url, _headers, body) => {
    const libs: { name: string; pattern: RegExp; maxSafe: string }[] = [
      { name: "jQuery < 3.5.0", pattern: /jquery[./\-]([123]\.\d+\.\d+)/i, maxSafe: "3.5.0" },
      { name: "Angular.js 1.x", pattern: /angular(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i, maxSafe: "2.0.0" },
      { name: "Lodash < 4.17.21", pattern: /lodash.*?(\d+\.\d+\.\d+)/i, maxSafe: "4.17.21" },
      { name: "Bootstrap < 5.3.0", pattern: /bootstrap(?:\.min)?\.(?:js|css).*?(\d+\.\d+\.\d+)/i, maxSafe: "5.3.0" },
      { name: "Moment.js (deprecated)", pattern: /moment(?:\.min)?\.js/i, maxSafe: "" },
    ]
    const found: string[] = []
    for (const lib of libs) {
      const match = body.match(lib.pattern)
      if (match) {
        if (!lib.maxSafe) {
          found.push(lib.name)
        } else if (match[1]) {
          const v = match[1].split(".").map(Number)
          const s = lib.maxSafe.split(".").map(Number)
          if (v[0] < s[0] || (v[0] === s[0] && v[1] < s[1]) || (v[0] === s[0] && v[1] === s[1] && v[2] < s[2])) {
            found.push(`${lib.name} (found ${match[1]})`)
          }
        }
      }
    }
    return found.length > 0 ? `Outdated libraries detected: ${found.join("; ")}` : null
  },

  "robots-txt-exposure": (_url, _headers, body) => {
    const sensitive = [/Disallow:\s*\/admin/i, /Disallow:\s*\/backup/i, /Disallow:\s*\/config/i, /Disallow:\s*\/database/i, /Disallow:\s*\/private/i, /Disallow:\s*\/secret/i, /Disallow:\s*\/\.env/i, /Disallow:\s*\/\.git/i]
    const found: string[] = []
    for (const p of sensitive) {
      const match = body.match(p)
      if (match) found.push(match[0].trim())
    }
    return found.length > 0 ? `Sensitive paths in robots.txt: ${found.join(", ")}` : null
  },

  "cms-fingerprinting": (_url, headers, body) => {
    const found: string[] = []
    const generator = body.match(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i)
    if (generator) found.push(`Generator: ${generator[1]}`)
    const powered = h(headers, "x-powered-by")
    if (powered) found.push(`X-Powered-By: ${powered}`)
    if (/wp-content|wp-includes/i.test(body)) found.push("WordPress")
    if (/drupal\.js|Drupal\.settings/i.test(body)) found.push("Drupal")
    if (/\/joomla\//i.test(body)) found.push("Joomla")
    if (body.includes("__NEXT_DATA__") || body.includes("/_next/")) found.push("Next.js")
    if (body.includes("__nuxt") || body.includes("/_nuxt/")) found.push("Nuxt.js")
    return found.length > 0 ? `Technology fingerprints: ${found.join(", ")}` : null
  },

  "security-txt-missing": (_url, _headers, body) => {
    if (body.includes("/.well-known/security.txt") || body.includes("security.txt")) return null
    return "No reference to /.well-known/security.txt found."
  },

  "dangerous-inline-js": (_url, _headers, body) => {
    const scripts = body.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || []
    const dangerousPatterns = [/eval\s*\(/i, /document\.write\s*\(/i, /\.innerHTML\s*=\s*(?!['"]<)/i, /Function\s*\(/i, /setTimeout\s*\(\s*['"]/i, /setInterval\s*\(\s*['"]/i]
    const found: string[] = []
    for (const script of scripts) {
      if (script.includes("src=")) continue // external script tag
      for (const p of dangerousPatterns) {
        if (p.test(script)) {
          found.push(p.source.replace(/\\s\*|\\|\['"]/g, "").slice(0, 20))
          break
        }
      }
    }
    return found.length > 0 ? `Found ${found.length} inline script(s) with dangerous patterns: ${[...new Set(found)].join(", ")}` : null
  },

  "cors-credentials-wildcard": (_url, headers) => {
    const acao = h(headers, "access-control-allow-origin")
    const acac = h(headers, "access-control-allow-credentials")
    if (acao === "*" && acac?.toLowerCase() === "true") {
      return "Access-Control-Allow-Origin: * combined with Access-Control-Allow-Credentials: true"
    }
    return null
  },

  "coop-missing": (_url, headers) => {
    if (hasHeader(headers, "cross-origin-opener-policy")) return null
    return "Header 'Cross-Origin-Opener-Policy' is not present."
  },

  "corp-missing": (_url, headers) => {
    if (hasHeader(headers, "cross-origin-resource-policy")) return null
    return "Header 'Cross-Origin-Resource-Policy' is not present."
  },

  "reverse-tabnabbing": (_url, _headers, body) => {
    const links = body.match(/<a[^>]*target=["']_blank["'][^>]*>/gi) || []
    const unsafe = links.filter((l) => !/rel=["'][^"']*noopener/i.test(l))
    return unsafe.length > 2 ? `Found ${unsafe.length} link(s) with target="_blank" missing rel="noopener".` : null
  },

  "source-maps": (_url, _headers, body) => {
    const mapRefs = body.match(/\/\/[#@]\s*sourceMappingURL=[^\s]+/g) || []
    const mapFiles = body.match(/\.js\.map/g) || []
    const total = mapRefs.length + mapFiles.length
    return total > 0 ? `Found ${total} source map reference(s).` : null
  },

  "sensitive-comments": (_url, _headers, body) => {
    const comments = body.match(/<!--[\s\S]*?-->/g) || []
    const sensitivePatterns = [/TODO/i, /FIXME/i, /HACK/i, /password/i, /secret/i, /admin/i, /internal/i, /debug/i, /temporary/i, /remove\s+(?:this|before)/i, /api[_\-]?key/i]
    const found: string[] = []
    for (const comment of comments) {
      for (const p of sensitivePatterns) {
        if (p.test(comment)) {
          found.push(comment.slice(0, 80).replace(/[\n\r]/g, " ").trim())
          break
        }
      }
    }
    if (found.length === 0) return null
    const samples = found.slice(0, 3)
    return `Found ${found.length} comment(s) with sensitive keywords:\n${samples.join("\n")}${found.length > 3 ? `\n...and ${found.length - 3} more` : ""}`
  },

  "hardcoded-secrets": (_url, _headers, body) => {
    const patterns = [
      // ── Cloud Providers ────────────────────────────────────────
      { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
      { name: "AWS MFA Serial", pattern: /arn:aws:iam::\d{12}:mfa\/\S+/g },
      { name: "Azure Storage Key", pattern: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{86,88}/g },
      { name: "Azure Client Secret", pattern: /[a-zA-Z0-9~_.-]{34,}(?=.*(?:azure|microsoft|tenant))/gi },
      { name: "GCP Service Account", pattern: /"type"\s*:\s*"service_account"/g },
      { name: "Google API Key", pattern: /AIzaSy[0-9A-Za-z_-]{33}/g },
      { name: "Google OAuth ID", pattern: /\d{12}-[a-z0-9]{32}\.apps\.googleusercontent\.com/g },
      { name: "Firebase Key", pattern: /AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/g },

      // ── Payment Providers ──────────────────────────────────────
      { name: "Stripe Secret Key", pattern: /sk_live_[0-9a-zA-Z]{24,}/g },
      { name: "Stripe Publishable Key", pattern: /pk_live_[0-9a-zA-Z]{24,}/g },
      { name: "Stripe Restricted Key", pattern: /rk_live_[0-9a-zA-Z]{24,}/g },
      { name: "Stripe Webhook Secret", pattern: /whsec_[0-9a-zA-Z]{24,}/g },
      { name: "PayPal Client ID", pattern: /A[a-zA-Z0-9]{15,80}(?=.*paypal)/gi },
      { name: "Square Access Token", pattern: /sq0atp-[0-9A-Za-z_-]{22}/g },
      { name: "Square OAuth Secret", pattern: /sq0csp-[0-9A-Za-z_-]{43}/g },

      // ── Version Control & CI ───────────────────────────────────
      { name: "GitHub Token", pattern: /gh[pousr]_[0-9A-Za-z]{36,}/g },
      { name: "GitHub OAuth", pattern: /gho_[0-9A-Za-z]{36,}/g },
      { name: "GitLab Token", pattern: /glpat-[0-9A-Za-z_-]{20,}/g },
      { name: "Bitbucket Token", pattern: /ATBB[0-9A-Za-z]{32,}/g },
      { name: "CircleCI Token", pattern: /circle-token\s*[:=]\s*["']?[0-9a-f]{40}["']?/gi },
      { name: "Travis CI Token", pattern: /travis-ci\.(?:com|org)\S*\s+["'][0-9A-Za-z]{20,}["']/g },

      // ── Communication ──────────────────────────────────────────
      { name: "Slack Token", pattern: /xox[bpras]-[0-9]{10,}-[0-9a-zA-Z-]+/g },
      { name: "Slack Webhook", pattern: /hooks\.slack\.com\/services\/T[0-9A-Z]{8,}\/B[0-9A-Z]{8,}\/[0-9A-Za-z]{24}/g },
      { name: "Discord Bot Token", pattern: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/g },
      { name: "Discord Webhook", pattern: /discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{60,68}/g },
      { name: "Twilio API Key", pattern: /SK[0-9a-fA-F]{32}/g },
      { name: "Twilio Account SID", pattern: /AC[0-9a-fA-F]{32}/g },
      { name: "Telegram Bot Token", pattern: /\d{8,10}:[A-Za-z0-9_-]{35}/g },

      // ── Email Services ─────────────────────────────────────────
      { name: "SendGrid Key", pattern: /SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}/g },
      { name: "Mailgun Key", pattern: /key-[0-9a-f]{32}/g },
      { name: "Mailchimp Key", pattern: /[0-9a-f]{32}-us\d{1,2}/g },
      { name: "Postmark Token", pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g },

      // ── Database & BaaS ────────────────────────────────────────
      { name: "MongoDB URI", pattern: /mongodb(?:\+srv)?:\/\/[^\s"'<>]{10,}/g },
      { name: "PostgreSQL URI", pattern: /postgres(?:ql)?:\/\/[^\s"'<>]{10,}/g },
      { name: "MySQL URI", pattern: /mysql:\/\/[^\s"'<>]{10,}/g },
      { name: "Redis URI", pattern: /redis(?:s)?:\/\/[^\s"'<>]{10,}/g },
      { name: "Supabase Key", pattern: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/g },
      { name: "Firebase URL", pattern: /https:\/\/[a-z0-9-]+\.firebaseio\.com/g },

      // ── Auth & Identity ────────────────────────────────────────
      { name: "JWT Token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
      { name: "Auth0 Secret", pattern: /[A-Za-z0-9_-]{64}(?=.*auth0)/gi },
      { name: "OAuth Token", pattern: /ya29\.[0-9A-Za-z_-]{68,}/g },

      // ── CDN & Infrastructure ───────────────────────────────────
      { name: "Cloudflare API Key", pattern: /[0-9a-f]{37}(?=.*cloudflare)/gi },
      { name: "Cloudflare Token", pattern: /[A-Za-z0-9_-]{40}(?=.*cloudflare)/gi },
      { name: "Heroku API Key", pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=.*heroku)/gi },
      { name: "Vercel Token", pattern: /[A-Za-z0-9]{24}(?=.*vercel)/gi },
      { name: "Netlify Token", pattern: /[0-9a-f]{40,}(?=.*netlify)/gi },

      // ── AI & ML ────────────────────────────────────────────────
      { name: "OpenAI Key", pattern: /sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/g },
      { name: "OpenAI Project Key", pattern: /sk-proj-[A-Za-z0-9_-]{40,}/g },
      { name: "Anthropic Key", pattern: /sk-ant-[A-Za-z0-9_-]{40,}/g },
      { name: "HuggingFace Token", pattern: /hf_[A-Za-z0-9]{34,}/g },
      { name: "Replicate Token", pattern: /r8_[A-Za-z0-9]{40}/g },
      { name: "Cohere Key", pattern: /[A-Za-z0-9]{40}(?=.*cohere)/gi },

      // ── Analytics & Monitoring ─────────────────────────────────
      { name: "Datadog API Key", pattern: /[0-9a-f]{32}(?=.*datadog)/gi },
      { name: "New Relic Key", pattern: /NRAK-[A-Z0-9]{27}/g },
      { name: "Sentry DSN", pattern: /https:\/\/[0-9a-f]{32}@[a-z0-9.]+\.sentry\.io\/\d+/g },
      { name: "Segment Write Key", pattern: /[A-Za-z0-9]{32}(?=.*segment)/gi },
      { name: "Mixpanel Token", pattern: /[0-9a-f]{32}(?=.*mixpanel)/gi },
      { name: "Amplitude Key", pattern: /[0-9a-f]{32}(?=.*amplitude)/gi },

      // ── Maps & Location ────────────────────────────────────────
      { name: "Mapbox Token", pattern: /pk\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
      { name: "Algolia API Key", pattern: /[0-9a-f]{32}(?=.*algolia)/gi },

      // ── Social ─────────────────────────────────────────────────
      { name: "Facebook Token", pattern: /EAA[0-9A-Za-z]{100,}/g },
      { name: "Twitter Bearer", pattern: /AAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]{30,}/g },
      { name: "LinkedIn Secret", pattern: /[0-9A-Za-z]{16}(?=.*linkedin)/gi },

      // ── Crypto & Keys ──────────────────────────────────────────
      { name: "RSA Private Key", pattern: /-----BEGIN RSA PRIVATE KEY-----/g },
      { name: "EC Private Key", pattern: /-----BEGIN EC PRIVATE KEY-----/g },
      { name: "PGP Private Key", pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g },
      { name: "SSH Private Key", pattern: /-----BEGIN (?:OPENSSH |DSA )?PRIVATE KEY-----/g },

      // ── Generic Patterns (catch-all) ───────────────────────────
      { name: "Generic API Key", pattern: /(?:api[_\-]?key|apikey|api[_\-]?secret|secret[_\-]?key|private[_\-]?key|auth[_\-]?token|access[_\-]?token|client[_\-]?secret|app[_\-]?secret|application[_\-]?key)\s*[:=]\s*["'][a-zA-Z0-9/+=_-]{16,}["']/gi },
      { name: "Generic Bearer Token", pattern: /['"](Bearer\s+[A-Za-z0-9_\-.]{20,})['"]/g },
      { name: "Password Assignment", pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/gi },
      { name: "Connection String", pattern: /(?:connection[_\-]?string|dsn)\s*[:=]\s*["'][^"']{20,}["']/gi },
    ]
    const found: string[] = []
    for (const { name, pattern } of patterns) {
      const matches = body.match(pattern)
      if (matches) {
        // Deduplicate matches
        const unique = [...new Set(matches)]
        for (const match of unique.slice(0, 3)) {
          const len = match.length
          const redacted =
            len <= 12
              ? match.slice(0, 4) + "****"
              : match.slice(0, 8) + "****" + match.slice(-4)
          found.push(`${name}: ${redacted}`)
        }
        if (unique.length > 3) {
          found.push(`  ...and ${unique.length - 3} more ${name} occurrence(s)`)
        }
      }
    }
    return found.length > 0 ? `Potential secrets detected:\n${found.join("\n")}` : null
  },

  "private-ip-exposure": (_url, _headers, body) => {
    const privateIPs = body.match(/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})/g) || []
    const filtered = [...new Set(privateIPs)].filter((ip) => {
      return !body.includes(`schema.org`) || body.indexOf(ip) < body.indexOf("schema.org")
    })
    return filtered.length > 0 ? `Private IP addresses found: ${filtered.slice(0, 5).join(", ")}` : null
  },

  "debug-indicators": (_url, headers, body) => {
    const found: string[] = []
    if (hasHeader(headers, "x-debug-token")) found.push("X-Debug-Token header")
    if (hasHeader(headers, "x-debug-token-link")) found.push("X-Debug-Token-Link header")
    if (body.includes("Traceback (most recent call last)")) found.push("Python traceback")
    if (body.includes("at Object.<anonymous>") && body.includes(".js:")) found.push("Node.js stack trace")
    if (/SQLSTATE\[/i.test(body)) found.push("SQL error")
    if (/Fatal error:.+on line \d+/i.test(body)) found.push("PHP fatal error")
    if (/Exception in thread/i.test(body)) found.push("Java exception")
    if (body.includes("Laravel") && body.includes("Stack trace")) found.push("Laravel debug mode")
    if (body.includes("DEBUG = True") || body.includes("debug_toolbar")) found.push("Debug mode enabled")
    return found.length > 0 ? `Debug indicators found: ${found.join(", ")}` : null
  },

  "dom-xss-sinks": (_url, _headers, body) => {
    const sinks = [
      { name: "innerHTML with URL data", pattern: /\.innerHTML\s*=\s*(?:.*(?:location|document\.URL|document\.referrer|window\.name))/gi },
      { name: "document.write with URL", pattern: /document\.write(?:ln)?\s*\(.*(?:location|document\.URL|document\.referrer)/gi },
      { name: "eval with URL data", pattern: /eval\s*\(.*(?:location|document\.URL|document\.referrer|window\.name)/gi },
      { name: "location assignment", pattern: /(?:location|location\.href)\s*=\s*(?:.*(?:location\.hash|location\.search|document\.referrer))/gi },
    ]
    const found: string[] = []
    for (const { name, pattern } of sinks) {
      if (pattern.test(body)) found.push(name)
    }
    return found.length > 0 ? `DOM XSS sinks detected: ${found.join(", ")}` : null
  },

  "insecure-iframes": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null
    const httpIframes = body.match(/<iframe[^>]+src=["']http:\/\/[^"']+["'][^>]*>/gi) || []
    return httpIframes.length > 0 ? `Found ${httpIframes.length} iframe(s) loading HTTP content on HTTPS page.` : null
  },

  "token-exposure": (_url, _headers, body) => {
    const patterns = [
      { name: "JWT", pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
      { name: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9_.-]{20,}/g },
      { name: "Session ID", pattern: /(?:session[_-]?id|PHPSESSID|JSESSIONID|ASP\.NET_SessionId)\s*=\s*[a-f0-9]{16,}/gi },
    ]
    const found: string[] = []
    for (const { name, pattern } of patterns) {
      const matches = body.match(pattern)
      if (matches) found.push(`${name} (${matches.length})`)
    }
    return found.length > 0 ? `Tokens exposed in source: ${found.join(", ")}` : null
  },

  "autocomplete-sensitive": (_url, _headers, body) => {
    const pwFields = body.match(/<input[^>]*type=["']password["'][^>]*>/gi) || []
    const ccFields = body.match(/<input[^>]*(?:name|id)=["'][^"']*(?:card|credit|cc)[^"']*["'][^>]*>/gi) || []
    const noAC = [...pwFields, ...ccFields].filter((f) => !/autocomplete\s*=/i.test(f))
    return noAC.length > 0 ? `Found ${noAC.length} sensitive field(s) without autocomplete attribute.` : null
  },

  "csp-report-only": (_url, headers) => {
    const reportOnly = hasHeader(headers, "content-security-policy-report-only")
    const enforcing = hasHeader(headers, "content-security-policy")
    if (reportOnly && !enforcing) return "CSP-Report-Only is set but no enforcing CSP header exists."
    return null
  },

  "form-target-blank": (_url, _headers, body) => {
    const forms = body.match(/<form[^>]*target=["']_blank["'][^>]*>/gi) || []
    return forms.length > 0 ? `Found ${forms.length} form(s) with target="_blank".` : null
  },

  "meta-refresh": (_url, _headers, body) => {
    const metaRefresh = body.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["']([^"']+)["']/i)
    if (!metaRefresh) return null
    const content = metaRefresh[1]
    if (content.toLowerCase().includes("url=")) return `Meta refresh redirect detected: ${content}`
    return null
  },

  "base-tag": (_url, _headers, body) => {
    const baseTag = body.match(/<base[^>]*href=["']([^"']+)["']/i)
    if (!baseTag) return null
    const csp = body.match(/<meta[^>]*content=["'][^"']*base-uri[^"']*["']/i)
    if (csp) return null // CSP restricts base-uri
    return `<base> tag found with href="${baseTag[1]}". Without CSP base-uri, this can be hijacked.`
  },

  "excessive-permissions": (_url, headers) => {
    const pp = h(headers, "permissions-policy") || h(headers, "feature-policy")
    if (!pp) return null
    const dangerous = ["camera=*", "microphone=*", "geolocation=*", "payment=*", "usb=*", 'camera ("*")', 'microphone ("*")', 'geolocation ("*")']
    const found: string[] = []
    for (const d of dangerous) {
      if (pp.includes(d)) found.push(d)
    }
    return found.length > 0 ? `Overly permissive Permissions-Policy: ${found.join(", ")}` : null
  },

  "postmessage-origin": (_url, _headers, body) => {
    const listeners = body.match(/addEventListener\s*\(\s*["']message["']/g) || []
    if (listeners.length === 0) return null
    const originCheck = /event\.origin|e\.origin|msg\.origin/i.test(body)
    if (originCheck) return null
    return `Found ${listeners.length} message event listener(s) without apparent origin validation.`
  },

  "sensitive-endpoints": (_url, _headers, body) => {
    const endpoints = [/\/api\/v\d+\/(?:users|admin|internal|debug|graphql|webhook)/gi, /\/wp-admin/gi, /\/phpmyadmin/gi, /\/\.env/gi, /\/actuator/gi, /\/elmah\.axd/gi, /\/server-status/gi]
    const found: string[] = []
    for (const p of endpoints) {
      const matches = body.match(p)
      if (matches) found.push(...matches.slice(0, 2))
    }
    const unique = [...new Set(found)]
    return unique.length > 0 ? `Sensitive endpoint references: ${unique.slice(0, 5).join(", ")}` : null
  },

  "dangerous-html-attrs": (_url, _headers, body) => {
    const handlers = body.match(/\son\w+=["'][^"']*(?:location|document|window|eval|fetch|XMLHttpRequest|alert)[^"']*["']/gi) || []
    return handlers.length > 0 ? `Found ${handlers.length} inline event handler(s) with potentially dangerous patterns.` : null
  },

  "insecure-form-submission": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null
    const httpForms = body.match(/<form[^>]*action=["']http:\/\/[^"']+["'][^>]*>/gi) || []
    return httpForms.length > 0 ? `Found ${httpForms.length} form(s) submitting to HTTP on HTTPS page.` : null
  },

  "weak-csp-directives": (_url, headers, body) => {
    const csp = h(headers, "content-security-policy")
    if (!csp) return null

    // Detect frameworks - these require certain CSP directives that are NOT weaknesses
    const isFramework =
      body.includes("__NEXT_DATA__") || body.includes("/_next/") ||
      body.includes("__nuxt") || body.includes("/_nuxt/") ||
      /ng-version/i.test(body)

    const issues: string[] = []

    // For framework sites: unsafe-inline and unsafe-eval are handled by
    // the INFO-level "csp-framework-required" check. Do NOT duplicate here.
    // Only flag these on non-framework (plain HTML) sites.
    if (!isFramework) {
      if (csp.includes("'unsafe-inline'") && !csp.includes("'nonce-") && !csp.includes("'strict-dynamic'")) {
        issues.push("unsafe-inline without nonce")
      }
      if (csp.includes("'unsafe-eval'")) {
        issues.push("unsafe-eval")
      }
    }

    // These are ALWAYS genuinely weak regardless of framework
    if (csp.includes("data:")) {
      const scriptSrc = csp.match(/script-src[^;]*/i)?.[0] || ""
      if (scriptSrc.includes("data:")) issues.push("data: in script-src")
    }
    if (/default-src[^;]*\*/.test(csp)) issues.push("wildcard in default-src")
    if (/script-src[^;]*\*/.test(csp)) issues.push("wildcard in script-src")

    return issues.length > 0 ? `Weak CSP directives: ${issues.join(", ")}` : null
  },

  "unencrypted-connections": (_url, _headers, body) => {
    const wsInsecure = body.match(/new\s+WebSocket\s*\(\s*["']ws:\/\//gi) || []
    const fetchHttp = body.match(/fetch\s*\(\s*["']http:\/\/(?!localhost)/gi) || []
    const xhrHttp = body.match(/\.open\s*\(\s*["'](?:GET|POST)["']\s*,\s*["']http:\/\/(?!localhost)/gi) || []
    const total = wsInsecure.length + fetchHttp.length + xhrHttp.length
    return total > 0 ? `Found ${total} unencrypted connection(s) in JavaScript.` : null
  },

  "html-comment-leaks": (_url, _headers, body) => {
    const comments = body.match(/<!--[\s\S]*?-->/g) || []
    const sensitive = comments.filter((c) => /(?:password|secret|api[_-]?key|token|credential|private|database|mysql|mongo|redis|admin|root|config)/i.test(c))
    return sensitive.length > 0 ? `Found ${sensitive.length} HTML comment(s) with sensitive keywords.` : null
  },

  "jwt-in-url": (_url, _headers, body) => {
    const jwtUrls = body.match(/(?:href|src|action|url)\s*=\s*["'][^"']*(?:\?|&)(?:token|jwt|access_token|auth)=eyJ[A-Za-z0-9_-]+/gi) || []
    return jwtUrls.length > 0 ? `Found ${jwtUrls.length} URL(s) containing JWT tokens.` : null
  },

  "sensitive-meta-tags": (_url, _headers, body) => {
    const metas = body.match(/<meta[^>]*(?:name|property)=["'][^"']*["'][^>]*content=["'][^"']+["'][^>]*>/gi) || []
    const sensitiveNames = ["csrf", "token", "api-key", "secret", "session", "internal"]
    const found = metas.filter((m) => sensitiveNames.some((s) => m.toLowerCase().includes(s)))
    return found.length > 0 ? `Found ${found.length} meta tag(s) with sensitive data.` : null
  },

  "storage-api-usage": (_url, _headers, body) => {
    const sensitiveKeys = /(?:localStorage|sessionStorage)\.(?:setItem|getItem)\s*\(\s*["'](?:token|jwt|auth|password|session|secret|api[_-]?key|credit[_-]?card)[^"']*["']/gi
    const matches = body.match(sensitiveKeys) || []
    return matches.length > 0 ? `Found ${matches.length} sensitive storage API usage(s).` : null
  },

  "sri-link-missing": (_url, _headers, body) => {
    const extScripts = body.match(/<script[^>]+src=["']https?:\/\/[^"']+["'][^>]*>/gi) || []
    const noSRI = extScripts.filter((t) => !t.toLowerCase().includes("integrity="))
    return noSRI.length > 0 ? `Found ${noSRI.length} external resource(s) without SRI.` : null
  },

  "opengraph-injection": (_url, _headers, body) => {
    const ogTags = body.match(/<meta[^>]*property=["']og:[^"']+["'][^>]*content=["']([^"']+)["']/gi) || []
    const suspicious = ogTags.filter((t) => /javascript:|data:|on\w+=/i.test(t))
    return suspicious.length > 0 ? `Found ${suspicious.length} suspicious OpenGraph tag(s).` : null
  },

  "service-worker-scope": (_url, _headers, body) => {
    const swReg = body.match(/navigator\.serviceWorker\.register\s*\(\s*["']([^"']+)["']/gi) || []
    if (swReg.length === 0) return null
    const wide = swReg.filter((r) => /scope\s*:\s*["']\/["']/i.test(r) || !/scope/i.test(r))
    return wide.length > 0 ? `Service worker registered with broad scope.` : null
  },

  "window-opener-abuse": (_url, _headers, body) => {
    const openerUsage = body.match(/window\.opener\./g) || []
    return openerUsage.length > 0 ? `Found ${openerUsage.length} window.opener reference(s).` : null
  },

  "cross-site-websocket": (_url, _headers, body) => {
    const wsConnections = body.match(/new\s+WebSocket\s*\(/gi) || []
    if (wsConnections.length === 0) return null
    const hasOriginCheck = /origin|(?:ws|socket).*(?:verify|check|valid)/i.test(body)
    if (hasOriginCheck) return null
    return `Found ${wsConnections.length} WebSocket connection(s) without apparent origin validation.`
  },

  "document-domain": (_url, _headers, body) => {
    const usage = body.match(/document\.domain\s*=/g) || []
    return usage.length > 0 ? `Found ${usage.length} document.domain assignment(s). This is deprecated and unsafe.` : null
  },

  "prototype-pollution": (_url, _headers, body) => {
    const patterns = [/__proto__/g, /Object\.assign\s*\(\s*{}\s*,\s*(?:req|request|params|query|body)\./gi, /constructor\s*\[\s*["']prototype["']\s*\]/gi]
    const found: string[] = []
    for (const p of patterns) {
      const matches = body.match(p)
      if (matches) found.push(`${matches[0].slice(0, 25)} (${matches.length})`)
    }
    return found.length > 0 ? `Prototype pollution patterns: ${found.join(", ")}` : null
  },

  "insecure-crypto": (_url, _headers, body) => {
    const patterns = [{ name: "MD5", pattern: /(?:CryptoJS\.)?MD5\s*\(/gi }, { name: "SHA-1", pattern: /(?:CryptoJS\.)?SHA1?\s*\(/gi }, { name: "Math.random for crypto", pattern: /Math\.random\s*\(\s*\).*(?:token|password|key|secret|nonce|salt)/gi }]
    const found: string[] = []
    for (const { name, pattern } of patterns) {
      if (pattern.test(body)) found.push(name)
    }
    return found.length > 0 ? `Insecure crypto usage: ${found.join(", ")}` : null
  },

  "dns-prefetch-control": (_url, headers) => {
    if (hasHeader(headers, "x-dns-prefetch-control")) return null
    return "X-DNS-Prefetch-Control header is not set."
  },

  "password-paste-disabled": (_url, _headers, body) => {
    const noPaste = body.match(/<input[^>]*type=["']password["'][^>]*onpaste=["'].*(?:return false|preventDefault)[^"']*["']/gi) || []
    return noPaste.length > 0 ? `Found ${noPaste.length} password field(s) blocking paste. This harms security.` : null
  },

  "exposed-error-messages": (_url, _headers, body) => {
    const patterns = [
      { name: "PHP error", pattern: /(?:Fatal|Parse) error:.*on line \d+/i },
      { name: "MySQL error", pattern: /(?:mysql_|mysqli_).*error|You have an error in your SQL syntax/i },
      { name: "PostgreSQL error", pattern: /ERROR:\s+(?:relation|column|syntax error at)/i },
      { name: ".NET error", pattern: /Server Error in ['"]\/['"] Application|Stack Trace:.*at System\./i },
      { name: "Django error", pattern: /Traceback \(most recent call last\)|SyntaxError at \//i },
    ]
    const found: string[] = []
    for (const { name, pattern } of patterns) {
      if (pattern.test(body)) found.push(name)
    }
    return found.length > 0 ? `Error messages exposed: ${found.join(", ")}` : null
  },

  "sql-injection-patterns": (_url, _headers, body) => {
    const patterns = [/(?:SELECT|INSERT|UPDATE|DELETE)\s+.*(?:FROM|INTO|SET)\s+\w+.*(?:WHERE|VALUES)/gi, /(?:UNION\s+ALL\s+SELECT|OR\s+1\s*=\s*1|AND\s+1\s*=\s*1|'\s*OR\s*')/gi]
    const found: string[] = []
    for (const p of patterns) {
      const matches = body.match(p) || []
      // Filter: only flag raw SQL in inline scripts, not in code examples or documentation
      const inScripts = matches.filter((m) => {
        const idx = body.indexOf(m)
        const before = body.slice(Math.max(0, idx - 200), idx)
        return /<script/i.test(before) && !/<code|<pre|```/i.test(before)
      })
      if (inScripts.length > 0) found.push(...inScripts.slice(0, 2))
    }
    return found.length > 0 ? `SQL patterns in inline scripts: ${found.slice(0, 2).map((f) => f.slice(0, 50)).join("; ")}` : null
  },

  "command-injection": (_url, _headers, body) => {
    const patterns = [/(?:exec|spawn|execSync|system|popen)\s*\([^)]*(?:\$|`|\+\s*(?:req|request|params|query|body)\.)/gi]
    const found: string[] = []
    for (const p of patterns) {
      if (p.test(body)) found.push(p.source.slice(0, 30))
    }
    return found.length > 0 ? `Command injection patterns detected.` : null
  },

  "xxe-vulnerability": (_url, _headers, body) => {
    const patterns = [/<!DOCTYPE[^>]*\[.*<!ENTITY/si, /DOMParser.*parseFromString/gi, /xml2js|fast-xml-parser|libxmljs/gi]
    const found: string[] = []
    for (const p of patterns) {
      if (p.test(body)) found.push("XML parsing detected")
    }
    return found.length > 0 ? `XXE risk: ${found[0]}` : null
  },

  "ssrf-vulnerability": (_url, _headers, body) => {
    const patterns = [/fetch\s*\(\s*(?:req|request|params|query|body)\./gi, /axios\s*\.\s*(?:get|post)\s*\(\s*(?:req|request|params|query)\./gi, /http\.(?:get|request)\s*\(\s*(?:req|request|params|query)\./gi]
    const found: string[] = []
    for (const p of patterns) {
      if (p.test(body)) found.push("User input in URL fetch")
    }
    return found.length > 0 ? `SSRF risk: ${found[0]}` : null
  },

  "path-traversal": (_url, _headers, body) => {
    const patterns = [/\.\.[/\\]/g, /(?:readFile|readFileSync|createReadStream)\s*\([^)]*(?:\+|`\$\{).*(?:req|request|params|query)\./gi]
    const contextual = body.match(patterns[1]) || []
    return contextual.length > 0 ? `Path traversal risk: user input in file read operations.` : null
  },

  "insecure-auth": (_url, _headers, body) => {
    const patterns = [
      { name: "Basic auth over HTTP", pattern: /Authorization:\s*Basic/gi },
      { name: "Password in URL", pattern: /(?:password|passwd|pwd)\s*=\s*[^&\s]{3,}/gi },
      { name: "Hardcoded credentials", pattern: /(?:username|user|login)\s*[:=]\s*["'][^"']+["']\s*[,;\n].*(?:password|passwd|pwd)\s*[:=]\s*["'][^"']+["']/gi },
    ]
    const found: string[] = []
    for (const { name, pattern } of patterns) {
      if (pattern.test(body)) found.push(name)
    }
    return found.length > 0 ? `Insecure auth patterns: ${found.join(", ")}` : null
  },

  "insecure-deserialization": (_url, _headers, body) => {
    const patterns = [/JSON\.parse\s*\(\s*(?:req|request|params|query|body)\./gi, /unserialize\s*\(/gi, /pickle\.loads/gi, /yaml\.(?:load|safe_load)\s*\(\s*(?:req|request)/gi]
    const found: string[] = []
    for (const p of patterns) {
      if (p.test(body)) found.push("Deserialization of user input")
    }
    return found.length > 0 ? `Insecure deserialization risk detected.` : null
  },

  "rate-limiting": (_url, headers) => {
    const rateHeaders = ["x-ratelimit-limit", "x-rate-limit-limit", "ratelimit-limit", "retry-after", "x-ratelimit-remaining"]
    for (const rh of rateHeaders) {
      if (hasHeader(headers, rh)) return null
    }
    return "No rate-limiting headers detected. API endpoints may be vulnerable to abuse."
  },

  "graphql-introspection": (_url, _headers, body) => {
    const indicators = [/__schema/i, /introspectionQuery/i, /__type/i, /graphiql/i, /playground.*graphql/i, /altair/i]
    const found: string[] = []
    for (const p of indicators) {
      if (p.test(body)) found.push(p.source.replace(/[\\]/g, ""))
    }
    return found.length > 0 ? `GraphQL introspection indicators: ${found.join(", ")}` : null
  },

  "csp-frame-ancestors": (_url, headers) => {
    const csp = h(headers, "content-security-policy")
    if (!csp) return null
    if (csp.includes("frame-ancestors")) return null
    const xfo = h(headers, "x-frame-options")
    if (xfo) return null
    return "CSP exists but lacks frame-ancestors directive and X-Frame-Options is not set."
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NEW JSON-ONLY CHECKS (25 additional checks from checks-data.json)
  // ═══════════════════════════════════════════════════════════════════════════

  "access-control-expose": (_url, headers) => {
    const aeh = h(headers, "access-control-expose-headers")
    if (!aeh) return null
    const sensitive = ["authorization", "set-cookie", "x-csrf-token"]
    const exposed = sensitive.filter((s) => aeh.toLowerCase().includes(s))
    return exposed.length > 0 ? `Sensitive headers exposed via CORS: ${exposed.join(", ")}` : null
  },

  "server-timing-exposure": (_url, headers) => {
    const st = h(headers, "server-timing")
    if (!st) return null
    if (/dur=\d|;desc=/i.test(st)) return `Server-Timing header exposes performance details: ${st.slice(0, 100)}`
    return null
  },

  "coep-missing": (_url, headers) => {
    if (hasHeader(headers, "cross-origin-embedder-policy")) return null
    return "Header 'Cross-Origin-Embedder-Policy' is not present."
  },

  "cors-origin-reflection": (_url, headers) => {
    const acao = h(headers, "access-control-allow-origin")
    if (!acao || acao === "*" || acao === "null") return null
    const acac = h(headers, "access-control-allow-credentials")
    if (acac?.toLowerCase() === "true" && acao.startsWith("http")) {
      return `ACAO set to '${acao}' with credentials. Verify origin is validated against an allowlist.`
    }
    return null
  },

  "clear-site-data-missing": (_url, headers, body) => {
    const isLogout = /logout|sign.?out|log.?out/i.test(body)
    if (!isLogout) return null
    if (hasHeader(headers, "clear-site-data")) return null
    return "Logout page detected without Clear-Site-Data header."
  },

  "csp-unsafe-eval-non-framework": (_url, headers, body) => {
    const csp = h(headers, "content-security-policy")
    if (!csp || !csp.includes("'unsafe-eval'")) return null
    const isFramework = body.includes("/_next/") || body.includes("__NEXT_DATA__") ||
      body.includes("__nuxt") || body.includes("ng-version")
    if (isFramework) return null
    return "CSP contains 'unsafe-eval' but no framework indicators detected."
  },

  "csp-form-action-missing": (_url, headers) => {
    const csp = h(headers, "content-security-policy")
    if (!csp) return null
    if (csp.includes("form-action")) return null
    return "CSP exists but no form-action directive."
  },

  "csp-base-uri-missing": (_url, headers) => {
    const csp = h(headers, "content-security-policy")
    if (!csp) return null
    if (csp.includes("base-uri")) return null
    return "CSP exists but no base-uri directive."
  },

  "csp-object-src-missing": (_url, headers) => {
    const csp = h(headers, "content-security-policy")
    if (!csp) return null
    if (csp.includes("object-src")) return null
    if (/default-src\s+'none'/.test(csp)) return null
    return "CSP exists but no object-src directive."
  },

  "csp-framework-required": (_url, headers, body) => {
    const csp = h(headers, "content-security-policy")
    if (!csp) return null

    const isNextJs = body.includes("__NEXT_DATA__") || body.includes("/_next/")
    const isNuxt = body.includes("__nuxt") || body.includes("/_nuxt/")
    const isAngular = /ng-version/i.test(body)

    if (!isNextJs && !isNuxt && !isAngular) return null

    const framework = isNextJs ? "Next.js" : isNuxt ? "Nuxt.js" : "Angular"
    const frameworkDirectives: string[] = []

    // Next.js requires unsafe-inline in style-src for styled-jsx / CSS-in-JS
    if (isNextJs) {
      const styleSrc = csp.match(/style-src[^;]*/i)?.[0] || ""
      if (styleSrc.includes("'unsafe-inline'")) frameworkDirectives.push("style-src 'unsafe-inline' (required by Next.js styled-jsx)")
      // Next.js uses inline scripts with nonce for hydration
      const scriptSrc = csp.match(/script-src[^;]*/i)?.[0] || ""
      if (scriptSrc.includes("'unsafe-inline'")) frameworkDirectives.push("script-src 'unsafe-inline' (consider using nonces instead)")
    }

    // Nuxt requires unsafe-inline for styles and sometimes unsafe-eval for Vue reactivity
    if (isNuxt) {
      if (csp.includes("'unsafe-inline'")) frameworkDirectives.push("unsafe-inline (required by Nuxt/Vue for styles)")
      if (csp.includes("'unsafe-eval'")) frameworkDirectives.push("unsafe-eval (used by Vue template compiler)")
    }

    // Angular requires unsafe-eval in dev mode
    if (isAngular && csp.includes("'unsafe-eval'")) {
      frameworkDirectives.push("unsafe-eval (may be required by Angular JIT compiler)")
    }

    return frameworkDirectives.length > 0
      ? `${framework} detected. Framework-required CSP directives: ${frameworkDirectives.join("; ")}`
      : null
  },

  "sri-stylesheet-missing": (_url, _headers, body) => {
    const extStyles = body.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:\/\/[^"']+["'][^>]*>/gi) || []
    const noSRI = extStyles.filter((t) => !t.toLowerCase().includes("integrity="))
    return noSRI.length > 0 ? `Found ${noSRI.length} external stylesheet(s) without integrity attribute.` : null
  },

  "websocket-wss": (_url, _headers, body) => {
    const wsInsecure = body.match(/new\s+WebSocket\s*\(\s*["']ws:\/\//gi) || []
    return wsInsecure.length > 0 ? `Found ${wsInsecure.length} insecure ws:// WebSocket connection(s).` : null
  },

  "iframe-sandbox-missing": (_url, _headers, body) => {
    const iframes = body.match(/<iframe[^>]*src=["'][^"']+["'][^>]*>/gi) || []
    const noSandbox = iframes.filter((t) => !t.toLowerCase().includes("sandbox"))
    return noSandbox.length > 2 ? `Found ${noSandbox.length} iframe(s) without sandbox attribute.` : null
  },

  "password-input-no-name": (_url, _headers, body) => {
    const pwInputs = body.match(/<input[^>]*type=["']password["'][^>]*>/gi) || []
    const noAttrs = pwInputs.filter((t) => !/autocomplete\s*=\s*["']/i.test(t) && !/name\s*=\s*["']/i.test(t))
    return noAttrs.length > 0 ? `Found ${noAttrs.length} password field(s) missing name or autocomplete.` : null
  },

  "sensitive-form-no-csrf": (_url, _headers, body) => {
    const postForms = body.match(/<form[^>]*method=["']post["'][^>]*>[\s\S]*?<\/form>/gi) || []
    const noCsrf = postForms.filter((f) => !(/name=["'][^"']*(?:csrf|token|nonce|_token|authenticity_token)[^"']*["']/i.test(f)))
    const isFramework = body.includes("__NEXT_DATA__") || body.includes("_next/") || body.includes("__nuxt")
    if (isFramework) return null
    return noCsrf.length > 0 ? `Found ${noCsrf.length} POST form(s) without CSRF token fields.` : null
  },

  "exposed-api-version": (_url, headers, body) => {
    const exposed: string[] = []
    for (const hdr of ["x-api-version", "x-app-version", "x-build-id"]) {
      const val = h(headers, hdr)
      if (val) exposed.push(`${hdr}: ${val}`)
    }
    const bodyVersions = body.match(/(?:api[_-]?version|build[_-]?id)\s*[:=]\s*["'][\d.]+["']/gi) || []
    if (bodyVersions.length > 0) exposed.push(...bodyVersions.slice(0, 2))
    return exposed.length > 0 ? `Exposed version info: ${exposed.join("; ")}` : null
  },

  "html-lang-missing": (_url, _headers, body) => {
    const htmlTag = body.match(/<html[^>]*>/i)
    if (htmlTag && !/lang\s*=/i.test(htmlTag[0])) return "The <html> tag does not include a lang attribute."
    return null
  },

  "open-form-action": (_url, _headers, body) => {
    const forms = body.match(/<form[^>]*action=["']https?:\/\/[^"']+["'][^>]*>/gi) || []
    if (forms.length === 0) return null
    const external = forms.filter((f) => {
      const match = f.match(/action=["'](https?:\/\/[^"'/]+)/i)
      if (!match) return false
      const domain = match[1].toLowerCase()
      return !domain.includes("stripe.com") && !domain.includes("paypal.com") && !domain.includes("google.com")
    })
    return external.length > 0 ? `Found ${external.length} form(s) submitting to external domains.` : null
  },

  "local-storage-sensitive": (_url, _headers, body) => {
    const sensitive = body.match(/(?:localStorage|sessionStorage)\.setItem\s*\(\s*["'](?:token|auth|jwt|password|session|secret|api[_-]?key|credit[_-]?card|ssn)[^"']*["']/gi) || []
    return sensitive.length > 0 ? `Found ${sensitive.length} instance(s) of sensitive data in browser storage.` : null
  },

  "viewport-user-scalable-no": (_url, _headers, body) => {
    if (/<meta[^>]*name=["']viewport["'][^>]*content=["'][^"']*user-scalable\s*=\s*no/i.test(body)) return "Viewport sets user-scalable=no."
    if (/<meta[^>]*name=["']viewport["'][^>]*content=["'][^"']*maximum-scale\s*=\s*1(?:\.0)?/i.test(body)) return "Viewport sets maximum-scale=1."
    return null
  },

  "exposed-stack-trace": (_url, _headers, body) => {
    const patterns = [/at\s+\w+\s+\(\/[^\s)]+:\d+:\d+\)/i, /at\s+\w+\s+\(file:\/\/[^\s)]+:\d+:\d+\)/i, /at\s+\w+\s+\([A-Z]:\\[^\s)]+:\d+:\d+\)/i]
    for (const p of patterns) {
      if (p.test(body)) return "Stack trace with file paths and line numbers found."
    }
    return null
  },

  "hardcoded-ip-addresses": (_url, _headers, body) => {
    const ipPattern = /(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)/g
    const ips = body.match(ipPattern) || []
    const filtered = ips.filter((ip) => ip !== "0.0.0.0" && ip !== "127.0.0.1" && ip !== "255.255.255.255" && !ip.startsWith("0."))
    const unique = [...new Set(filtered)]
    return unique.length >= 2 ? `Found ${unique.length} IP address(es): ${unique.slice(0, 3).join(", ")}` : null
  },

  "document-write-usage": (_url, _headers, body) => {
    const dw = body.match(/document\.write\s*\(|document\.writeln\s*\(/gi) || []
    return dw.length > 0 ? `Found ${dw.length} document.write() usage(s).` : null
  },

  "preconnect-third-party": (_url, _headers, body) => {
    const domains = new Set<string>()
    const srcMatches = body.match(/(?:src|href)=["']https?:\/\/([^"'/]+)/gi) || []
    for (const m of srcMatches) {
      const d = m.match(/https?:\/\/([^"'/]+)/i)
      if (d) domains.add(d[1].toLowerCase())
    }
    return domains.size > 10 ? `Connections to ${domains.size} third-party domains.` : null
  },

  "input-no-maxlength": (_url, _headers, body) => {
    const inputs = body.match(/<input[^>]*type=["'](?:text|email|search|tel|url)["'][^>]*>/gi) || []
    const textareas = body.match(/<textarea[^>]*>/gi) || []
    const noMax = [...inputs, ...textareas].filter((t) => !/maxlength\s*=/i.test(t))
    return noMax.length > 3 ? `Found ${noMax.length} input(s) without maxlength.` : null
  },

  "lazy-loading-missing": (_url, _headers, body) => {
    const imgs = body.match(/<img[^>]*src=["'][^"']+["'][^>]*>/gi) || []
    const noLazy = imgs.filter((t) => !/loading\s*=\s*["']lazy["']/i.test(t))
    return noLazy.length > 5 ? `Found ${noLazy.length} image(s) without loading='lazy'.` : null
  },

  "unsafe-target-blank": (_url, _headers, body) => {
    const links = body.match(/<a[^>]*target=["']_blank["'][^>]*>/gi) || []
    const noOpener = links.filter((l) => !/rel=["'][^"']*noopener/i.test(l))
    return noOpener.length > 2 ? `Found ${noOpener.length} link(s) with target="_blank" missing rel="noopener".` : null
  },
}

// ─�� Build CheckFn array from JSON + detectors ─────────────────────────────

interface CheckDef {
  id: string
  type: string
  title: string
  category: string
  severity: string
  description: string
  evidence: string
  riskImpact: string
  explanation: string
  fixSteps: string[]
  codeExamples: { label: string; language: string; code: string }[]
}

function buildCheck(def: CheckDef): CheckFn | null {
  const detect = detectors[def.id]
  if (!detect) return null

  return (url: string, headers: Headers, body: string): Vulnerability | null => {
    const evidence = detect(url, headers, body)
    if (!evidence) return null

    return {
      id: generateId(),
      title: def.title,
      severity: def.severity.toLowerCase() as any,
      category: def.category as Category,
      description: def.description,
      evidence,
      riskImpact: def.riskImpact,
      explanation: def.explanation,
      fixSteps: def.fixSteps,
      codeExamples: def.codeExamples,
    }
  }
}

// Load all checks from JSON and wire up detection
export const allChecks: CheckFn[] = (checksData as { checks: CheckDef[] }).checks
  .map(buildCheck)
  .filter((fn): fn is CheckFn => fn !== null)
