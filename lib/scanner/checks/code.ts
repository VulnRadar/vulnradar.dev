/**
 * Code / SAST-style detectors.
 *
 * Pure regex-based detection of dangerous code patterns in inline
 * JavaScript, server-rendered HTML, and embedded source. Real SAST
 * requires AST parsing; this is a fast pre-filter that catches the
 * common sinks. Lives in its own category so the docs page can
 * present it as "code testing" instead of lumping it into headers.
 */

import {
  getSetCookies,
  stripExampleContent,
  type EvidenceFn as DetectFn,
} from "../_helpers";

function inlineScriptContent(body: string): string {
  const matches = body.matchAll(
    /<script(?![^>]*\bsrc\s*=)(?![^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi,
  );
  return [...matches].map((m) => m[1]).join("\n");
}

// ── Hardcoded-secrets pattern tiers ─────────────────────────────────────
//
// Shared by the four "hardcoded-secrets*" detectors below. Split out so
// each severity tier is a plain, reviewable list rather than one flat
// array that forces every match to the same severity regardless of
// whether the credential format was ever meant to be secret.

interface SecretPattern {
  name: string;
  pattern: RegExp;
}

// No legitimate reason to appear in client-visible source: compromise
// means full account, database, or infrastructure access.
const CRITICAL_SECRET_PATTERNS: SecretPattern[] = [
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
  {
    name: "Azure Storage Key",
    pattern:
      /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{86,88}/g,
  },
  {
    name: "GCP Service Account",
    pattern: /"type"\s*:\s*"service_account"/g,
  },
  { name: "Stripe Secret Key", pattern: /sk_live_[0-9a-zA-Z]{24,}/g },
  { name: "Stripe Restricted Key", pattern: /rk_live_[0-9a-zA-Z]{24,}/g },
  { name: "Stripe Webhook Secret", pattern: /whsec_[0-9a-zA-Z]{24,}/g },
  // Square has no "publishable" token tier like Stripe's pk_live_ — both
  // sq0atp- (OAuth access token) and sq0csp- (OAuth client secret) are
  // server-side credentials per Square's own docs, so both stay critical.
  { name: "Square Access Token", pattern: /sq0atp-[0-9A-Za-z_-]{22}/g },
  { name: "Square OAuth Secret", pattern: /sq0csp-[0-9A-Za-z_-]{43}/g },
  { name: "GitHub Token", pattern: /gh[pousr]_[0-9A-Za-z]{36,}/g },
  { name: "GitHub OAuth", pattern: /gho_[0-9A-Za-z]{36,}/g },
  { name: "GitLab Token", pattern: /glpat-[0-9A-Za-z_-]{20,}/g },
  { name: "Bitbucket Token", pattern: /ATBB[0-9A-Za-z]{32,}/g },
  { name: "Slack Token", pattern: /xox[bpras]-[0-9]{10,}-[0-9a-zA-Z-]+/g },
  {
    name: "Slack Webhook",
    pattern:
      /hooks\.slack\.com\/services\/T[0-9A-Z]{8,}\/B[0-9A-Z]{8,}\/[0-9A-Za-z]{24}/g,
  },
  {
    name: "Discord Bot Token",
    pattern: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{38,}/g,
  },
  // Bare SID, no adjacent auth token match — genuinely low-value on its
  // own, but kept critical per explicit product guidance: a leaked SID is
  // still an account identifier worth treating cautiously by default.
  { name: "Twilio Account SID", pattern: /AC[0-9a-fA-F]{32}/g },
  {
    name: "SendGrid Key",
    pattern: /SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}/g,
  },
  { name: "Mailgun Key", pattern: /key-[0-9a-f]{32}/g },
  {
    name: "MongoDB URI",
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
  },
  {
    name: "PostgreSQL URI",
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
  },
  { name: "MySQL URI", pattern: /mysql:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g },
  {
    name: "Redis URI",
    pattern: /rediss?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
  },
  { name: "OAuth Token", pattern: /ya29\.[0-9A-Za-z_-]{68,}/g },
  {
    name: "OpenAI Key",
    pattern: /sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/g,
  },
  { name: "OpenAI Project Key", pattern: /sk-proj-[A-Za-z0-9_-]{40,}/g },
  { name: "Anthropic Key", pattern: /sk-ant-[A-Za-z0-9_-]{40,}/g },
  // NRAK- is the New Relic full account/user API key (manage alerts,
  // users, query data via NerdGraph) — not to be confused with the
  // NRBR- browser monitoring key, which vendors embed client-side by
  // design (secret-newrelic-browser-key, medium, is the check for that).
  { name: "New Relic Key", pattern: /NRAK-[A-Z0-9]{27}/g },
  { name: "Facebook Token", pattern: /EAA[0-9A-Za-z]{100,}/g },
  { name: "RSA Private Key", pattern: /-----BEGIN RSA PRIVATE KEY-----/g },
  { name: "EC Private Key", pattern: /-----BEGIN EC PRIVATE KEY-----/g },
  {
    name: "PGP Private Key",
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
  },
  {
    name: "SSH Private Key",
    pattern: /-----BEGIN (?:OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    name: "Generic Secret",
    pattern:
      /(?:api_secret|secret_key|private_key|client_secret|app_secret)\s*[:=]\s*["'][a-zA-Z0-9/+=_-]{20,}["']/gi,
  },
  {
    name: "Connection String",
    pattern:
      /(?:connection_string|database_url|dsn)\s*[:=]\s*["'][^"']{20,}["']/gi,
  },
];

// Genuine server-side secrets, but the blast radius is narrower than the
// critical tier — abuse of a single third-party service's quota/billing
// or spoofed notifications, not account or infrastructure takeover.
// Matches this codebase's own secrets-extended.json precedent for the
// same vendors (secret-huggingface-write-token, secret-replicate-api-token
// are both "high").
const ELEVATED_RISK_SECRET_PATTERNS: SecretPattern[] = [
  // Legacy Firebase Cloud Messaging *server* key (distinct from the
  // AIzaSy* Firebase client config key below) — Google's own docs say
  // this must stay server-side. A leak allows spoofed/spam push
  // notifications to every user of the app, but not data or account
  // compromise, so "high" rather than "critical".
  {
    name: "Firebase Cloud Messaging Server Key",
    pattern: /AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/g,
  },
  { name: "HuggingFace Token", pattern: /hf_[A-Za-z0-9]{34,}/g },
  { name: "Replicate Token", pattern: /r8_[A-Za-z0-9]{40}/g },
];

// Vendor-documented client-exposed-by-design credentials, secured via
// restrictions (referrer/domain allowlists, write-only scopes, quota
// limits) rather than secrecy. Presence alone is normal; the risk is
// billing/quota abuse if the key is unrestricted.
const CLIENT_EXPOSED_SECRET_PATTERNS: SecretPattern[] = [
  // Discord webhooks are meant to be POSTed to from server code, but a
  // leaked URL lets anyone post as the webhook (spam/impersonation in
  // the target channel) — real abuse, bounded impact.
  {
    name: "Discord Webhook",
    pattern: /discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{60,68}/g,
  },
  // Sentry's own docs: "the DSN is not a secret" — it is meant to be
  // public and only allows writing events, not reading data. Risk is
  // quota exhaustion via a flood of bogus events.
  {
    name: "Sentry DSN",
    pattern: /https:\/\/[0-9a-f]{32}@[a-z0-9.]+\.sentry\.io\/\d+/g,
  },
  // "pk." is Mapbox's own public-token prefix convention (mirrors
  // Stripe's pk_/sk_ split) — meant for client-side use and restricted
  // by URL allowlist, not secrecy. secret-mapbox-secret-token (this
  // codebase, "high") is the actual secret "sk." token; this pattern
  // only ever matches the public one.
  {
    name: "Mapbox Public Token",
    pattern: /pk\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
];

// Near-public identifiers with no credential material — informational
// signal that a service is in use, not a leak by itself.
const LOW_RISK_SECRET_PATTERNS: SecretPattern[] = [
  // A Firebase Realtime Database hostname, nothing more — no key, no
  // token. Worth flagging so security-rules hygiene gets a look, but not
  // itself a secret.
  {
    name: "Firebase Database URL",
    pattern: /https:\/\/[a-z0-9-]+\.firebaseio\.com/g,
  },
];

/**
 * A response body that reads like API documentation showing example
 * secrets ("documentation" + "example" + "api" all present) suppresses
 * every hardcoded-secrets tier — those are demonstration values, not
 * leaked credentials.
 */
function isSecretsDocPage(body: string): boolean {
  const lowerBody = body.toLowerCase();
  return (
    lowerBody.includes("documentation") &&
    lowerBody.includes("example") &&
    lowerBody.includes("api")
  );
}

/** Redact a matched secret to `prefix****suffix`, same shape for every tier. */
function redactMatch(match: string): string {
  const len = match.length;
  return len <= 12
    ? match.slice(0, 4) + "****"
    : match.slice(0, 8) + "****" + match.slice(-4);
}

/**
 * Run one severity tier's patterns against the body, filtering obvious
 * placeholders (docs/example values) the same way for every tier.
 */
function matchSecretPatterns(
  body: string,
  patterns: SecretPattern[],
): string[] {
  const found: string[] = [];
  for (const { name, pattern } of patterns) {
    const matches = body.match(pattern);
    if (!matches) continue;
    const unique = [...new Set(matches)].filter((m) => {
      const lower = m.toLowerCase();
      if (
        lower.includes("example") ||
        lower.includes("your_") ||
        lower.includes("xxxx") ||
        lower.includes("0000")
      )
        return false;
      if (
        lower.includes("placeholder") ||
        lower.includes("test_") ||
        lower.includes("dummy")
      )
        return false;
      if (/localhost|127\.0\.0\.1/.test(m)) return false;
      return true;
    });
    if (unique.length === 0) continue;
    for (const match of unique.slice(0, 3)) {
      found.push(`${name}: ${redactMatch(match)}`);
    }
    if (unique.length > 3) {
      found.push(`  ...and ${unique.length - 3} more ${name} occurrence(s)`);
    }
  }
  return found;
}

function formatSecretFindings(found: string[]): string | null {
  return found.length > 0
    ? `Potential secrets detected:\n${found.join("\n")}`
    : null;
}

export const detectors: Record<string, DetectFn> = {
  // ── DOM XSS sinks ─────────────────────────────────────────────────────────

  "innerhtml-xss-sink": (_url, _headers, body) => {
    const matches = body.match(/\.innerHTML\s*=(?!\s*["'])/g) || [];
    if (matches.length < 2) return null;
    return `Found ${matches.length} innerHTML assignments that may be XSS sinks.`;
  },

  "outerhtml-xss-sink": (_url, _headers, body) => {
    const matches = body.match(/\.outerHTML\s*=/g) || [];
    if (matches.length < 1) return null;
    return `Found ${matches.length} outerHTML assignment(s) - potential XSS sink.`;
  },

  "document-write-sink": (_url, _headers, body) => {
    const matches = body.match(/document\.write(?:ln)?\s*\(/g) || [];
    if (matches.length < 1) return null;
    return `Found ${matches.length} document.write() call(s) - DOM XSS sink.`;
  },

  "insertadjacenthtml-sink": (_url, _headers, body) => {
    if (/\.insertAdjacentHTML\s*\(/.test(body)) {
      return "insertAdjacentHTML() found - potential DOM XSS sink.";
    }
    return null;
  },

  "unsafe-setattribute": (_url, _headers, body) => {
    if (/\.setAttribute\s*\(\s*["'](?:on\w+|href|src|action)["']/i.test(body)) {
      return "setAttribute() used with event handlers or URL attributes - XSS risk.";
    }
    return null;
  },

  "dom-xss-sinks": (_url, _headers, body) => {
    const sinks = [
      {
        name: "innerHTML with URL data",
        pattern:
          /\.innerHTML\s*=\s*(?:.*(?:location|document\.URL|document\.referrer|window\.name))/gi,
      },
      {
        name: "document.write with URL",
        pattern:
          /document\.write(?:ln)?\s*\(.*(?:location|document\.URL|document\.referrer)/gi,
      },
      {
        name: "eval with URL data",
        pattern:
          /eval\s*\(.*(?:location|document\.URL|document\.referrer|window\.name)/gi,
      },
      {
        name: "location assignment",
        pattern:
          /(?:location|location\.href)\s*=\s*(?:.*(?:location\.hash|location\.search|document\.referrer))/gi,
      },
    ];
    const found: string[] = [];
    for (const { name, pattern } of sinks) {
      if (pattern.test(body)) found.push(name);
    }
    return found.length > 0
      ? `DOM XSS sinks detected: ${found.join(", ")}`
      : null;
  },

  // ── Eval / function / setTimeout strings ────────────────────────────────

  "eval-in-scripts": (_url, _headers, body) => {
    const scripts = body.match(/<script[^>]*>[\s\S]*?<\/script[^>]*>/gi) || [];
    for (const s of scripts) {
      if (/\beval\s*\(/.test(s) && !s.includes("JSON.parse")) {
        return "eval() usage detected in inline scripts.";
      }
    }
    return null;
  },

  "eval-usage": (_url, _headers, _body) => {
    // eval() is already caught by eval-in-scripts (which scopes to inline scripts
    // and excludes JSON.parse callers). A global match fires on every minified
    // bundle that contains third-party code with eval(). Removed to reduce noise.
    return null;
  },

  "function-constructor": (_url, _headers, body) => {
    if (/new\s+Function\s*\(/.test(body)) {
      return "Function constructor used - similar risks to eval().";
    }
    return null;
  },

  "settimeout-string": (_url, _headers, _body) => {
    return null;
  },

  "dangerous-inline-js": (_url, _headers, body) => {
    const scripts = body.match(/<script[^>]*>[\s\S]*?<\/script[^>]*>/gi) || [];
    const dangerousPatterns = [
      /eval\s*\(/i,
      /document\.write\s*\(/i,
      /\.innerHTML\s*=\s*(?!['"]<)/i,
      /Function\s*\(/i,
      /setTimeout\s*\(\s*['"]/i,
      /setInterval\s*\(\s*['"]/i,
    ];
    const found: string[] = [];
    for (const script of scripts) {
      if (script.includes("src=")) continue;
      for (const p of dangerousPatterns) {
        if (p.test(script)) {
          found.push(p.source.replace(/\\s\*|\\|\['"]/g, "").slice(0, 20));
          break;
        }
      }
    }
    return found.length > 0
      ? `Found ${found.length} inline script(s) with dangerous patterns: ${[...new Set(found)].join(", ")}`
      : null;
  },

  "inline-event-handlers": (_url, _headers, body) => {
    const handlers = body.match(
      /\son(click|error|load|mouseover|focus|blur|submit|change|input)\s*=\s*["']/gi,
    );
    if (!handlers || handlers.length < 3) return null;
    return `${handlers.length} inline event handler attributes found (onclick, onerror, etc.).`;
  },

  "dangerous-html-attrs": (_url, _headers, body) => {
    const handlers =
      body.match(
        /\son\w+=["'][^"']*(?:location|document|window|eval|fetch|XMLHttpRequest|alert)[^"']*["']/gi,
      ) || [];
    return handlers.length > 0
      ? `Found ${handlers.length} inline event handler(s) with potentially dangerous patterns.`
      : null;
  },

  "unencrypted-connections": (_url, _headers, body) => {
    const wsInsecure = body.match(/new\s+WebSocket\s*\(\s*["']ws:\/\//gi) || [];
    const fetchHttp =
      body.match(/fetch\s*\(\s*["']http:\/\/(?!localhost)/gi) || [];
    const xhrHttp =
      body.match(
        /\.open\s*\(\s*["'](?:GET|POST)["']\s*,\s*["']http:\/\/(?!localhost)/gi,
      ) || [];
    const total = wsInsecure.length + fetchHttp.length + xhrHttp.length;
    return total > 0
      ? `Found ${total} unencrypted connection(s) in JavaScript.`
      : null;
  },

  "websocket-unencrypted": (_url, _headers, body) => {
    if (/new\s+WebSocket\s*\(\s*["']ws:\/\//i.test(body)) {
      return "Unencrypted WebSocket (ws://) connection detected. Use wss:// instead.";
    }
    return null;
  },

  "cross-site-websocket": (_url, _headers, body) => {
    const wsConnections = body.match(/new\s+WebSocket\s*\(/gi) || [];
    if (wsConnections.length === 0) return null;
    const hasOriginCheck = /origin|(?:ws|socket).*(?:verify|check|valid)/i.test(
      body,
    );
    if (hasOriginCheck) return null;
    return `Found ${wsConnections.length} WebSocket connection(s) without apparent origin validation.`;
  },

  // ── postMessage ──────────────────────────────────────────────────────────

  "postmessage-origin": (_url, _headers, body) => {
    const listeners =
      body.match(/addEventListener\s*\(\s*["']message["']/g) || [];
    if (listeners.length === 0) return null;
    const originCheck = /event\.origin|e\.origin|msg\.origin/i.test(body);
    if (originCheck) return null;
    return `Found ${listeners.length} message event listener(s) without apparent origin validation.`;
  },

  "postmessage-star-origin": (_url, _headers, body) => {
    if (/\.postMessage\s*\([^)]*,\s*["']\*["']\s*\)/.test(body)) {
      return "postMessage() called with wildcard (*) origin, sending data to any origin.";
    }
    return null;
  },

  // ── Storage / cookies ────────────────────────────────────────────────────

  "local-storage-sensitive": (_url, _headers, body) => {
    const sensitive =
      body.match(
        /(?:localStorage|sessionStorage)\.setItem\s*\(\s*["'](?:token|auth|jwt|password|session|secret|api[_-]?key|credit[_-]?card|ssn)[^"']*["']/gi,
      ) || [];
    return sensitive.length > 0
      ? `Found ${sensitive.length} instance(s) of sensitive data in browser storage.`
      : null;
  },

  "storage-api-usage": (_url, _headers, body) => {
    const sensitiveKeys =
      /(?:localStorage|sessionStorage)\.(?:setItem|getItem)\s*\(\s*["'](?:token|jwt|auth|password|session|secret|api[_-]?key|credit[_-]?card)[^"']*["']/gi;
    const matches = body.match(sensitiveKeys) || [];
    return matches.length > 0
      ? `Found ${matches.length} sensitive storage API usage(s).`
      : null;
  },

  "document-cookie-access": (_url, _headers, body) => {
    const matches = body.match(/document\.cookie/g) || [];
    if (matches.length > 2) {
      return `${matches.length} document.cookie accesses - consider HttpOnly cookies.`;
    }
    return null;
  },

  // ── Prototype / misc ─────────────────────────────────────────────────────

  "prototype-pollution": (_url, _headers, body) => {
    const patterns = [
      /__proto__/g,
      /Object\.assign\s*\(\s*{}\s*,\s*(?:req|request|params|query|body)\./gi,
      /constructor\s*\[\s*["']prototype["']\s*\]/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      const matches = body.match(p);
      if (matches) found.push(`${matches[0].slice(0, 25)} (${matches.length})`);
    }
    return found.length > 0
      ? `Prototype pollution patterns: ${found.join(", ")}`
      : null;
  },

  "insecure-crypto": (_url, _headers, body) => {
    const patterns = [
      { name: "MD5", pattern: /(?:CryptoJS\.)?MD5\s*\(/i },
      { name: "SHA-1", pattern: /(?:CryptoJS\.)?SHA1?\s*\(/i },
      {
        name: "Math.random for crypto",
        pattern:
          /Math\.random\s*\(\s*\).*(?:token|password|key|secret|nonce|salt)/i,
      },
    ];
    const found: string[] = [];
    for (const { name, pattern } of patterns) {
      if (pattern.test(body)) found.push(name);
    }
    return found.length > 0
      ? `Insecure crypto usage: ${found.join(", ")}`
      : null;
  },

  // ── SQL / command / SSRF / XXE / path / SSTI / LDAP ──────────────────────

  "sql-injection-patterns": (_url, _headers, body) => {
    const patterns = [
      /(?:SELECT|INSERT|UPDATE|DELETE)\s+.*(?:FROM|INTO|SET)\s+\w+.*(?:WHERE|VALUES)/gi,
      /(?:UNION\s+ALL\s+SELECT|OR\s+1\s*=\s*1|AND\s+1\s*=\s*1|'\s*OR\s*')/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      const matches = body.match(p) || [];
      const inScripts = matches.filter((m) => {
        const idx = body.indexOf(m);
        const before = body.slice(Math.max(0, idx - 200), idx);
        return /<script/i.test(before) && !/<code|<pre|```/i.test(before);
      });
      if (inScripts.length > 0) found.push(...inScripts.slice(0, 2));
    }
    return found.length > 0
      ? `SQL patterns in inline scripts: ${found
          .slice(0, 2)
          .map((f) => f.slice(0, 50))
          .join("; ")}`
      : null;
  },

  "command-injection": (_url, _headers, body) => {
    const patterns = [
      /(?:exec|spawn|execSync|system|popen)\s*\([^)]*(?:\$|`|\+\s*(?:req|request|params|query|body)\.)/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      if (p.test(body)) found.push(p.source.slice(0, 30));
    }
    return found.length > 0 ? `Command injection patterns detected.` : null;
  },

  "command-injection-indicators": (_url, _headers, body) => {
    if (/[?&](?:cmd|exec|command|run|shell)=/gi.test(body)) {
      return "Command-related parameter names found - potential command injection vector.";
    }
    return null;
  },

  "ssrf-vulnerability": (_url, _headers, body) => {
    const patterns = [
      /fetch\s*\(\s*(?:req|request|params|query|body)\./gi,
      /axios\s*\.\s*(?:get|post)\s*\(\s*(?:req|request|params|query)\./gi,
      /http\.(?:get|request)\s*\(\s*(?:req|request|params|query)\./gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      if (p.test(body)) found.push("User input in URL fetch");
    }
    return found.length > 0 ? `SSRF risk: ${found[0]}` : null;
  },

  "ssrf-indicators": (_url, _headers, _body) => {
    // Removed: url=http fires on any page with HTTP links; code-ssrf-* detectors
    // cover SSRF with user-input context. This was too broad.
    return null;
  },

  "path-traversal": (_url, _headers, body) => {
    const patterns = [
      /\.\.[\/\\]/g,
      /(?:readFile|readFileSync|createReadStream)\s*\([^)]*(?:\+|`\$\{).*(?:req|request|params|query)\./gi,
    ];
    const contextual = body.match(patterns[1]) || [];
    return contextual.length > 0
      ? `Path traversal risk: user input in file read operations.`
      : null;
  },

  "path-traversal-indicators": (_url, _headers, body) => {
    if (
      /[?&](?:file|path|dir|folder|include)=[^&]*(?:\.\.\/|\.\.%2F)/gi.test(
        body,
      )
    ) {
      return "Potential path traversal pattern in URL parameters.";
    }
    return null;
  },

  "xxe-vulnerability": (_url, _headers, _body) => {
    // Removed: duplicate of xml-external-entity which has more specific pattern
    // (requires SYSTEM or PUBLIC keyword).
    return null;
  },

  "xml-external-entity": (_url, _headers, body) => {
    const xxePattern =
      /<!DOCTYPE[^>]*\[[\s\S]*?<!ENTITY[^>]*(?:SYSTEM|PUBLIC)/i;
    if (xxePattern.test(body)) {
      const match = body.match(xxePattern);
      if (match) {
        const idx = body.indexOf(match[0]);
        const before = body.slice(Math.max(0, idx - 200), idx).toLowerCase();
        if (/<code|<pre|```|example|documentation/i.test(before)) return null;
        return "XML external entity declaration found - potential XXE vulnerability.";
      }
    }
    return null;
  },

  "insecure-deserialization": (_url, _headers, body) => {
    const patterns = [
      /JSON\.parse\s*\(\s*(?:req|request|params|query|body)\./gi,
      /unserialize\s*\(/gi,
      /pickle\.loads/gi,
      /yaml\.(?:load|safe_load)\s*\(\s*(?:req|request)/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      if (p.test(body)) found.push("Deserialization of user input");
    }
    return found.length > 0 ? `Insecure deserialization risk detected.` : null;
  },

  "insecure-auth": (_url, _headers, body) => {
    const patterns = [
      { name: "Basic auth over HTTP", pattern: /Authorization:\s*Basic/gi },
      {
        name: "Password in URL",
        pattern: /(?:password|passwd|pwd)\s*=\s*[^&\s]{3,}/gi,
      },
      {
        name: "Hardcoded credentials",
        pattern:
          /(?:username|user|login)\s*[:=]\s*["'][^"']+["']\s*[,;\n].*(?:password|passwd|pwd)\s*[:=]\s*["'][^"']+["']/gi,
      },
    ];
    const found: string[] = [];
    for (const { name, pattern } of patterns) {
      if (pattern.test(body)) found.push(name);
    }
    return found.length > 0
      ? `Insecure auth patterns: ${found.join(", ")}`
      : null;
  },

  "ssti-indicators": (_url, _headers, body) => {
    // Only match double-curly arithmetic PoC ({{7*7}}) — the classic SSTI probe.
    // ${ } is in every JS template literal; <% %> fires on ERB/JSP docs.
    if (/\{\{\s*\d+\s*\*\s*\d+\s*\}\}/.test(body)) {
      return "Template injection probe detected in output ({{N*N}}) - potential SSTI.";
    }
    return null;
  },

  "ldap-injection-indicators": (_url, _headers, body) => {
    if (/[?&](?:user|uid|cn|dn|filter)=[^&]*[()&|*]/gi.test(body)) {
      return "LDAP filter characters in URL parameters - potential LDAP injection.";
    }
    return null;
  },

  // ── Auth enumeration / hardcoded credentials ────────────────────────────

  "hardcoded-credentials": (_url, _headers, body) => {
    const patterns = [
      /(?:admin|root)\s*[:=]\s*["']([^"']+)["']/gi,
      /(?:password|passwd|pwd)\s*[:=]\s*["']([^"']+)["']/gi,
    ];
    const hits: string[] = [];
    for (const p of patterns) {
      const m = body.match(p);
      if (m) hits.push(m[0].slice(0, 60));
    }
    return hits.length > 0
      ? `Hardcoded credentials pattern detected: ${hits.slice(0, 3).join("; ")}`
      : null;
  },

  "default-credentials": (_url, _headers, body) => {
    const defaults = [
      "admin/admin",
      "root/root",
      "admin/password",
      "guest/guest",
    ];
    for (const d of defaults) {
      if (body.includes(d)) {
        return `Default credentials reference: ${d}`;
      }
    }
    return null;
  },

  // ── SRI / external assets (sast-ish for <script src>) ───────────────────

  "sri-missing": (_url, _headers, body) => {
    const externalScripts =
      body.match(/<script[^>]+src=["']https?:\/\/[^"']+["'][^>]*>/gi) || [];
    const noSRI = externalScripts.filter(
      (t) => !t.toLowerCase().includes("integrity="),
    );
    if (noSRI.length === 0) return null;
    const samples = noSRI.slice(0, 3).map((t) => {
      const srcMatch = t.match(/src=["'](https?:\/\/[^"']+)["']/i);
      return srcMatch ? srcMatch[1] : t.slice(0, 80);
    });
    return `Found ${noSRI.length} external script(s) without integrity:\n${samples.join("\n")}${noSRI.length > 3 ? `\n...and ${noSRI.length - 3} more` : ""}`;
  },

  "external-script-no-sri": (_url, _headers, body) => {
    const scripts =
      body.match(/<script[^>]*src\s*=\s*["'][^"']*["'][^>]*>/gi) || [];
    let missing = 0;
    for (const s of scripts) {
      if (/src\s*=\s*["']https?:\/\//i.test(s) && !s.includes("integrity"))
        missing++;
    }
    if (missing < 1) return null;
    return `${missing} external script(s) loaded without Subresource Integrity (SRI) hash.`;
  },

  // ── Window opener abuse ──────────────────────────────────────────────────

  "window-opener-abuse": (_url, _headers, body) => {
    const openerUsage = body.match(/window\.opener\./g) || [];
    return openerUsage.length > 0
      ? `Found ${openerUsage.length} window.opener reference(s).`
      : null;
  },

  "document-domain": (_url, _headers, body) => {
    const usage = body.match(/document\.domain\s*=/g) || [];
    return usage.length > 0
      ? `Found ${usage.length} document.domain assignment(s). This is deprecated and unsafe.`
      : null;
  },

  "document-domain-usage": (_url, _headers, body) => {
    if (/document\.domain\s*=/.test(body)) {
      return "document.domain assignment found. This deprecated practice relaxes same-origin policy.";
    }
    return null;
  },

  // ── Open redirect / SSRF patterns ────────────────────────────────────────

  "open-redirect": (_url, _headers, body) => {
    const patterns = [
      /[?&](?:redirect|return|next|url|goto|dest|redir|returnTo|continue|forward|target)=[^&"'\s]+/gi,
      /window\.location\s*=\s*(?:decodeURIComponent|unescape)?\(?\s*(?:new\s+URLSearchParams|location\.(?:search|hash))/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      const matches = body.match(p) || [];
      found.push(...matches.slice(0, 3));
    }
    return found.length > 0
      ? `Found ${found.length} redirect-related pattern(s): ${found.slice(0, 2).join(", ")}`
      : null;
  },

  "open-redirect-params": (_url, _headers, body) => {
    const matches = body.match(
      /[?&](redirect|return|next|url|goto|destination|continue|redir|returnTo)\s*=\s*https?%3A/gi,
    );
    if (!matches) return null;
    return `Potential open redirect parameter(s) found: ${matches.length} occurrence(s).`;
  },

  // ── GraphQL query patterns ───────────────────────────────────────────────

  "graphql-introspection": (_url, _headers, body) => {
    const indicators = [
      /__schema/i,
      /introspectionQuery/i,
      /__type/i,
      /graphiql/i,
      /playground.*graphql/i,
      /altair/i,
    ];
    const found: string[] = [];
    for (const p of indicators) {
      if (p.test(body)) found.push(p.source.replace(/[\\]/g, ""));
    }
    return found.length > 0
      ? `GraphQL introspection indicators: ${found.join(", ")}`
      : null;
  },

  // ── Source-map / debug paths in code ────────────────────────────────────

  "sourcemap-reference": (_url, _headers, body) => {
    if (/\/\/[#@]\s*sourceMappingURL\s*=\s*\S+\.map/i.test(body)) {
      return "JavaScript source map URL reference found. Source maps expose original source code.";
    }
    return null;
  },

  "source-maps": (_url, _headers, body) => {
    const mapRefs = body.match(/\/\/[#@]\s*sourceMappingURL=[^\s]+/g) || [];
    const mapFiles = body.match(/\.js\.map/g) || [];
    const total = mapRefs.length + mapFiles.length;
    return total > 0 ? `Found ${total} source map reference(s).` : null;
  },

  // ── Hardcoded secrets (SAST) ────────────────────────────────────────────
  //
  // Severity is split by whether the credential format has any legitimate
  // reason to be client-visible — see the CRITICAL/ELEVATED_RISK/
  // CLIENT_EXPOSED/LOW_RISK pattern lists above this object for the full
  // reasoning per pattern. The Google API Key pattern (AIzaSy*) that used
  // to live in this list has been removed entirely: `google-api-key-exposed`
  // (content.json, medium) and `secret-google-maps-api-key` /
  // `secret-firebase-api-key-public` (secrets-extended.json, medium/low)
  // already detect the exact same evidence. Keeping it here too meant one
  // Google API key on a page produced three findings, one of which called
  // it "critical" — that mismatch is what drove a scan of a normal site to
  // "unsafe".

  "hardcoded-secrets": (_url, _headers, body) => {
    if (isSecretsDocPage(body)) return null;
    return formatSecretFindings(
      matchSecretPatterns(body, CRITICAL_SECRET_PATTERNS),
    );
  },

  "hardcoded-secrets-high-risk": (_url, _headers, body) => {
    if (isSecretsDocPage(body)) return null;
    return formatSecretFindings(
      matchSecretPatterns(body, ELEVATED_RISK_SECRET_PATTERNS),
    );
  },

  "hardcoded-secrets-client-exposed": (_url, _headers, body) => {
    if (isSecretsDocPage(body)) return null;
    return formatSecretFindings(
      matchSecretPatterns(body, CLIENT_EXPOSED_SECRET_PATTERNS),
    );
  },

  "hardcoded-secrets-low-risk": (_url, _headers, body) => {
    if (isSecretsDocPage(body)) return null;
    return formatSecretFindings(
      matchSecretPatterns(body, LOW_RISK_SECRET_PATTERNS),
    );
  },

  // ── Geo / clipboard / media APIs ────────────────────────────────────────

  "geolocation-usage": (_url, _headers, body) => {
    if (/navigator\.geolocation/g.test(body)) {
      return "Geolocation API usage detected - ensure user consent.";
    }
    return null;
  },

  "clipboard-access": (_url, _headers, body) => {
    if (
      /navigator\.clipboard|document\.execCommand\s*\(\s*["']copy/gi.test(body)
    ) {
      return "Clipboard API access detected - potential data exfiltration vector.";
    }
    return null;
  },

  "webcam-microphone-access": (_url, _headers, body) => {
    if (/getUserMedia|mediaDevices/g.test(body)) {
      return "Media device access (camera/microphone) detected.";
    }
    return null;
  },

  // ── Form / page semantics (no-prefix, JSON category=code) ────────────────

  "insecure-form-submission": (_url, _headers, body) => {
    if (/<form[^>]+action\s*=\s*["']http:\/\//i.test(body)) {
      return "Form posts data over insecure HTTP.";
    }
    // Removed: "HTML form present - verify all form actions use HTTPS."
    // This fired on every HTML page that contained any form — virtually every
    // login page, contact page, and search page.
    return null;
  },

  "postmessage-wildcard": (_url, _headers, body) => {
    if (/\.postMessage\s*\([^)]*,\s*["']\*["']\s*\)/.test(body)) {
      return "postMessage() called with wildcard '*' target origin.";
    }
    // Removed: "postMessage listener found - verify origin is not wildcard."
    // This fired on any page with any postMessage listener, even when the
    // listener properly validates origin. The postmessage-no-origin check in
    // content.ts already does this correctly.
    return null;
  },

  "regex-dos-pattern": (_url, _headers, _body) => {
    // Removed: new RegExp() fires on every React/Vue app; nested quantifier pattern
    // fires on minified bundles. code-redos-* detectors handle this more specifically.
    return null;
  },

  "localstorage-sensitive": (_url, _headers, body) => {
    if (
      /localStorage\.setItem\s*\(\s*["'](?:token|jwt|auth|password|secret|session|api[_-]?key|ssn|credit)/i.test(
        body,
      )
    ) {
      return "Sensitive data being written to localStorage.";
    }
    return null;
  },

  "sessionstorage-tokens": (_url, _headers, body) => {
    if (
      /sessionStorage\.setItem\s*\(\s*["'](?:token|jwt|auth|access[_-]?token|refresh)/i.test(
        body,
      )
    ) {
      return "Authentication tokens stored in sessionStorage.";
    }
    return null;
  },

  "indexeddb-sensitive": (_url, _headers, body) => {
    if (
      /indexedDB\.open\s*\([^)]*(?:token|password|secret|user|credentials)/i.test(
        body,
      )
    ) {
      return "IndexedDB opened with potentially sensitive key name.";
    }
    // Removed: "IndexedDB usage detected - audit stored object stores for
    // sensitive data." Many modern PWAs use IndexedDB for legitimate
    // non-sensitive data. Any IndexedDB use fired this.
    return null;
  },

  "window-name-storage": (_url, _headers, body) => {
    if (/window\.name\s*=\s*[^;]*(?:token|password|secret|user)/i.test(body)) {
      return "Sensitive data assigned to window.name - cross-origin readable.";
    }
    // Removed: "window.name assignment - avoid storing any cross-origin
    // transferable data." Any window.name = ... fired this, including
    // frame-title or navigation-state assignments.
    return null;
  },

  "service-worker-insecure": (_url, _headers, body) => {
    // Only flag if explicitly registered over HTTP — an HTTPS registration is
    // required by the spec and is not an issue.
    if (/navigator\.serviceWorker\.register\s*\(\s*["']http:\/\//i.test(body)) {
      return "Service worker registered over insecure HTTP origin.";
    }
    return null;
  },

  "push-api-usage": (_url, _headers, _body) => {
    // Push / notification permission flows are legitimate on countless sites.
    // Presence alone is not a security finding.
    return null;
  },

  "payment-request-api": (_url, _headers, _body) => {
    // Payment Request API is a browser standard — presence alone is not a finding.
    return null;
  },

  "credential-management-api": (_url, _headers, _body) => {
    // Credential Management API (navigator.credentials) is a browser security feature.
    // Its presence improves security; flagging it creates noise.
    return null;
  },

  "webauthn-usage": (_url, _headers, _body) => {
    // WebAuthn / Passkey usage is a security improvement. Not a finding.
    return null;
  },

  "crypto-subtle-usage": (_url, _headers, _body) => {
    // SubtleCrypto is the preferred secure crypto API. Its presence is not a risk.
    return null;
  },

  "wasm-usage": (_url, _headers, _body) => {
    // WebAssembly is widely used by legitimate applications (image codecs, games,
    // compression). Presence alone is not a security finding.
    return null;
  },

  "console-log-production": (_url, _headers, _body) => {
    // console.* calls appear in virtually every production bundle via third-party
    // libraries. Flagging them produces noise without identifying actual data leaks.
    return null;
  },

  "debugger-statement": (_url, _headers, body) => {
    if (/(^|[^.\w])debugger\s*;/.test(body)) {
      return "JavaScript 'debugger' statement - remove from production code.";
    }
    return null;
  },

  // ── DOM XSS sinks (code-* prefix, category=code) ─────────────────────────

  "code-xss-insertadjacentelement": (_url, _headers, body) => {
    if (/\.insertAdjacentElement\s*\(/i.test(body)) {
      return "insertAdjacentElement sink - DOM XSS via live-node insertion.";
    }
    return null;
  },

  "code-xss-createcontextualfragment": (_url, _headers, body) => {
    if (/createContextualFragment\s*\(/i.test(body)) {
      return "Range.createContextualFragment sink - parses HTML into DocumentFragment.";
    }
    return null;
  },

  "code-xss-documentwrite-jsonparse": (_url, _headers, body) => {
    if (/document\.write(?:ln)?\s*\([^)]*JSON\.parse/i.test(body)) {
      return "document.write(JSON.parse(...)) - direct DOM XSS via parsed JSON.";
    }
    // Removed generic document.write fallback — already caught by document-write-sink.
    return null;
  },

  "code-xss-dangerouslysetinnerhtml-dynamic": (_url, _headers, body) => {
    if (
      /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!["'])[^}]*[+`]/.test(
        body,
      )
    ) {
      return "dangerouslySetInnerHTML receives a computed/concatenated string.";
    }
    return null;
  },

  "code-xss-vue-v-html-dynamic": (_url, _headers, body) => {
    if (/v-html\s*=\s*["'][^"']*[+`{][^"']*["']/i.test(body)) {
      return "Vue v-html bound to a dynamic expression - XSS via template concatenation.";
    }
    if (/v-html\s*=/.test(body)) {
      return "Vue v-html directive found - audit dynamic expressions.";
    }
    return null;
  },

  "code-xss-angular-bypass-dynamic": (_url, _headers, body) => {
    if (
      /bypassSecurityTrust(Html|Script|Style|Url|ResourceUrl)\s*\(/i.test(body)
    ) {
      return "Angular bypassSecurityTrust* defeats DomSanitizer - XSS risk.";
    }
    // Match Angular-specific bindings only, not React's dangerouslySetInnerHTML.
    // [innerHTML]="expr" or [attr.innerHTML]="expr" — Angular property binding.
    if (/\[\s*(?:attr\.innerHTML|innerHTML)\s*\]\s*=/i.test(body)) {
      return "Angular [innerHTML] property binding - confirm content is sanitized.";
    }
    if (/\bng-bind-html\s*=/i.test(body)) {
      return "Angular ng-bind-html directive - confirm content is sanitized.";
    }
    return null;
  },

  "code-xss-domparser-parsefromstring": (_url, _headers, body) => {
    if (/DOMParser\s*\(\s*\)\s*\.parseFromString/i.test(body)) {
      return "DOMParser.parseFromString sink - parses user-controlled HTML into a Document.";
    }
    // Removed: "DOMParser usage - audit parseFromString calls for user HTML."
    // DOMParser is a native browser API used legitimately for RSS/XML parsing.
    // Any DOMParser reference fired this — too broad.
    return null;
  },

  "code-xss-template-tag": (_url, _headers, body) => {
    if (
      /\bhtml\s*`[\s\S]*\$\{/i.test(body) ||
      /\bsvg\s*`[\s\S]*\$\{/i.test(body)
    ) {
      return "Tagged template literal (html`...`) - XSS if interpolations are unescaped.";
    }
    if (/<script[\s\S]*`[\s\S]*\$\{/i.test(body)) {
      return "Template literal interpolation in script context - audit escaping.";
    }
    return null;
  },

  // ── Command injection (code-cmdi-*) ──────────────────────────────────────

  "code-cmdi-spawn-shell-true": (_url, _headers, body) => {
    if (/spawn\s*\([^)]*\{\s*shell\s*:\s*true\s*\}/i.test(body)) {
      return "child_process.spawn called with shell:true - command injection risk.";
    }
    return null;
  },

  "code-cmdi-exec": (_url, _headers, body) => {
    if (/(?:child_process\.)?exec\s*\(\s*["'`].*\+/i.test(body)) {
      return "child_process.exec with concatenated argument - shell injection risk.";
    }
    // Removed: "child_process.exec usage - audit first argument for user input."
    // Any exec() call fired this, including exec('git status') which is safe.
    return null;
  },

  "code-cmdi-os-exec": (_url, _headers, body) => {
    if (/os\.(?:system|exec[a-z]*|popen)\s*\([^)]*\+/i.test(body)) {
      return "os.system / os.exec* / os.popen with concatenated input - shell injection.";
    }
    // Removed: "Python 'os' module imported - audit system/exec/popen callers."
    // Any Python file importing os fired this, including trivial os.path.join usage.
    return null;
  },

  "code-cmdi-bin-sh-concat": (_url, _headers, body) => {
    if (
      /["']\/bin\/sh\s+-c\s*["']\s*\+\s*\w+|"sh\s+-c\s*"\s*\+\s*\w+/i.test(body)
    ) {
      return "/bin/sh -c built via string concatenation - shell injection risk.";
    }
    return null;
  },

  "code-cmdi-popen": (_url, _headers, body) => {
    if (
      /subprocess\.(?:Popen|call|run)\s*\([^)]*shell\s*=\s*True/i.test(body)
    ) {
      return "subprocess.Popen / call / run with shell=True - command injection risk.";
    }
    if (/os\.popen\s*\(/i.test(body)) {
      return "os.popen() - argument is passed to the shell verbatim.";
    }
    return null;
  },

  "code-cmdi-process-spawn": (_url, _headers, body) => {
    if (
      /(?:spawn|execFile)\s*\(\s*[`"'][^`"']*\+\s*\w+|(?:spawn|execFile)\s*\(\s*`[^`]*\$\{/i.test(
        body,
      )
    ) {
      return "child_process.spawn/execFile built from concatenation - argument injection.";
    }
    // Removed: "spawn/execFile usage - audit argument strings for concatenation."
    // Any spawn() call fired this, including spawn('ls') with a fixed command.
    return null;
  },

  // ── SQL injection (code-sqli-*) ──────────────────────────────────────────

  "code-sqli-mongodb-where": (_url, _headers, body) => {
    if (
      /\$where\s*:\s*["'`].*\+/i.test(body) ||
      /\$where\s*:\s*Function/i.test(body)
    ) {
      return "MongoDB $where clause built from concatenation - server-side JS injection.";
    }
    // Removed: "$where usage - audit for user-controlled JavaScript."
    // Any $where: key fired this, even with a static string value.
    return null;
  },

  "code-sqli-mongodb-regex": (_url, _headers, body) => {
    if (
      /\$regex\s*:\s*(?:req|request|params|query|body)\./i.test(body) ||
      /new\s+RegExp\s*\(\s*(?:req|request|params|query|body)\./i.test(body)
    ) {
      return "MongoDB $regex / RegExp built from user input - data leak or ReDoS.";
    }
    // Removed: "$regex usage - audit the source of the pattern."
    // Any $regex: key fired this, including static patterns.
    return null;
  },

  "code-sqli-raw-query-string": (_url, _headers, body) => {
    if (
      /\.query\s*\(\s*["'`][^"'`]*["'`]\s*\+\s*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "SQL query concatenated with user input - SQL injection.";
    }
    // Removed: "Raw SQL query in source - audit concatenation with user input."
    // Any .query("...") with a string literal fired this, including parameterised
    // queries like .query("SELECT * FROM users WHERE id = ?", [id]).
    return null;
  },

  "code-sqli-template-literal-query": (_url, _headers, body) => {
    if (
      /\.query\s*\(\s*`[^`]*\$\{(?:req|request|params|query|body)\./i.test(body)
    ) {
      return "SQL query via template literal interpolation - SQL injection.";
    }
    // Removed: "Tag-less template literal used in .query() - SQL injection risk."
    // Any .query(`...`) with a static template literal fired this.
    return null;
  },

  "code-sqli-mongoose-find-user": (_url, _headers, body) => {
    if (
      /\.find\s*\(\s*(?:req|request|params|query|body)\./i.test(body) ||
      /\.find\s*\(\s*JSON\.parse\s*\(\s*(?:req|request)/i.test(body)
    ) {
      return "Mongoose .find() with user-supplied filter - operator injection risk.";
    }
    // Removed: "Mongoose .find() - audit argument for user JSON."
    // Any .find() call fired this, including .find({active: true}).
    return null;
  },

  "code-sqli-sequelize-literal": (_url, _headers, body) => {
    if (
      /Sequelize\.literal\s*\([^)]*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "Sequelize.literal with user input - SQL injection risk.";
    }
    // Removed: "Sequelize.literal usage - audit argument for user input."
    // Any Sequelize.literal() fired this, including static SQL fragments.
    return null;
  },

  // ── Deserialization (code-deser-*) ───────────────────────────────────────

  "code-deser-yaml-load": (_url, _headers, body) => {
    if (/\byaml\.load\s*\(/i.test(body) && !/yaml\.safe_load/i.test(body)) {
      return "yaml.load() without safe loader - arbitrary Python object instantiation.";
    }
    // Removed: "PyYAML imported - audit yaml.load vs yaml.safe_load usage."
    // Any yaml import fired this. Importing yaml is fine; only yaml.load() is risky.
    return null;
  },

  "code-deser-pickle-loads": (_url, _headers, body) => {
    if (/pickle\.loads\s*\([^)]*(?:req|request|input|file|read)/i.test(body)) {
      return "pickle.loads() with untrusted bytes - arbitrary code execution risk.";
    }
    // Removed: "pickle imported - never unpickle untrusted data."
    // Any pickle import fired this, including pickle.dumps() which is safe.
    return null;
  },

  "code-deser-base64-eval": (_url, _headers, body) => {
    if (
      /\beval\s*\(\s*(?:atob|Buffer\.from\([^)]*['"]base64['"])/i.test(body) ||
      /\beval\s*\(\s*Buffer\.from\([^)]+,\s*['"]base64['"]/i.test(body)
    ) {
      return "eval(atob(...)) / eval(Buffer.from(..., 'base64')) - RCE via base64.";
    }
    return null;
  },

  "code-deser-jsonparse-newfunction": (_url, _headers, body) => {
    if (/new\s+Function\s*\([^)]*JSON\.parse/i.test(body)) {
      return "new Function('return ' + JSON.parse(input)) - function body from attacker JSON.";
    }
    if (
      /new\s+Function\s*\([^)]*(?:req|request|body|params|query)\./i.test(body)
    ) {
      return "new Function() with user-supplied source - arbitrary code execution.";
    }
    return null;
  },

  "code-deser-node-serialize": (_url, _headers, body) => {
    if (
      /require\s*\(\s*["']node-serialize["']\)/.test(body) ||
      /serialize\.(?:unserialize|deserialize)\s*\(/i.test(body)
    ) {
      return "node-serialize deserialize() - IIFE payload can achieve RCE.";
    }
    return null;
  },

  "code-deser-php-unserialize": (_url, _headers, body) => {
    if (/unserialize\s*\(\s*\$_/i.test(body)) {
      return "PHP unserialize() on user input - POP gadget chain / RCE risk.";
    }
    // Removed: "unserialize() call - audit source of bytes."
    // Any unserialize() fired this, including internal data serialization
    // that never touches user input.
    return null;
  },

  // ── SSRF (code-ssrf-*) ────────────────────────────────────────────────────

  "code-ssrf-fetch-port": (_url, _headers, body) => {
    if (
      /fetch\s*\(\s*["']https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|169\.254\.169\.254|10\.|192\.168\.)/i.test(
        body,
      )
    ) {
      return "fetch() targets loopback or cloud-metadata IP - SSRF risk.";
    }
    return null;
  },

  "code-ssrf-fetch-user-input": (_url, _headers, body) => {
    if (/fetch\s*\(\s*(?:req|request|params|query|body)\./i.test(body)) {
      return "fetch() URL built from user input - SSRF.";
    }
    return null;
  },

  "code-ssrf-axios-user-input": (_url, _headers, body) => {
    if (
      /axios\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*(?:req|request|params|query|body)\./i.test(
        body,
      ) ||
      /axios\s*\(\s*\{\s*url\s*:\s*(?:req|request|params|query|body|`[^`]*\$\{)/i.test(
        body,
      )
    ) {
      return "axios request with user-controlled URL - SSRF.";
    }
    return null;
  },

  "code-ssrf-xhr-user-input": (_url, _headers, body) => {
    if (
      /XMLHttpRequest\s*\(\s*\)|new\s+XMLHttpRequest/i.test(body) &&
      /\.open\s*\(\s*["'](?:GET|POST)["']\s*,\s*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "XMLHttpRequest URL from user input - SSRF in server contexts.";
    }
    return null;
  },

  "code-ssrf-got-user-input": (_url, _headers, body) => {
    if (
      /\b(?:got|node-fetch|undici)\s*\(\s*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "got / node-fetch / undici request with user URL - SSRF.";
    }
    return null;
  },

  // ── ReDoS (code-redos-*) ─────────────────────────────────────────────────

  // code-redos-nested-quantifier and code-redos-catastrophic-backtrack removed:
  // their detection regexes were themselves O(n²) on 200KB+ HTML bodies,
  // hanging the scan server. No safe linear-time rewrite existed for the
  // detection patterns they used.

  "code-redos-greedy-quantifier": (_url, _headers, _body) => {
    // Removed: pattern matches any minified JS bundle — near 100% FP rate.
    return null;
  },

  "code-redos-alternation-overlap": (_url, _headers, _body) => {
    // Removed: pattern matches any minified JS bundle — near 100% FP rate.
    return null;
  },

  // ── Redirects (code-redirect-*) ──────────────────────────────────────────

  "code-redirect-window-location-href": (_url, _headers, body) => {
    if (
      /window\.location(?:\.href)?\s*=\s*(?:req|request|params|query|body)\./i.test(
        body,
      ) ||
      /window\.location(?:\.href)?\s*=\s*[`"][^`"]*\+/i.test(body)
    ) {
      return "window.location.href assigned to user input - open redirect.";
    }
    // Removed: "window.location referenced - audit assignments for user input."
    // Any use of window.location (including window.location.pathname,
    // window.location.origin) fired this — ubiquitous in every SPA.
    return null;
  },

  "code-redirect-location-replace": (_url, _headers, body) => {
    if (
      /location\.replace\s*\(\s*(?:req|request|params|query|body)\./i.test(body)
    ) {
      return "location.replace() with user input - open redirect.";
    }
    // Removed: "location.replace() called - audit argument for user input."
    // Any location.replace() fired this, including location.replace('/home').
    return null;
  },

  "code-redirect-top-location": (_url, _headers, body) => {
    if (
      /(?:top|parent)\.location(?:\.href)?\s*=\s*(?:req|request|params|query|body|["'][^"']*\+)/i.test(
        body,
      )
    ) {
      return "top.location / parent.location assigned to user input - iframe redirect.";
    }
    // Removed: "top.location / parent.location referenced - audit for user input."
    // top.location is used by legitimate frame-busting code (a security measure,
    // not a vulnerability). Flagging all uses is misleading.
    return null;
  },

  // ── Prototype pollution (code-proto-pollution-*) ─────────────────────────

  "code-proto-pollution-deep-merge": (_url, _headers, body) => {
    if (
      /(?:_\.merge|_\.mergeWith|deep-extend|deepmerge|extend\s*\(\s*true)/i.test(
        body,
      )
    ) {
      return "Deep merge helper used - audit sources for __proto__ keys.";
    }
    return null;
  },

  "code-proto-pollution-lodash-merge": (_url, _headers, body) => {
    if (/_\.merge\s*\([^)]*(?:req|request|body|input|user)/i.test(body)) {
      return "_.merge(target, userInput) - pre-4.17.12 lodash prototype pollution.";
    }
    // Removed: "_.merge usage - audit second argument for user input."
    // Any _.merge() call fired this — very common for non-user-input merging.
    return null;
  },

  "code-proto-pollution-object-assign-proto": (_url, _headers, body) => {
    if (
      /Object\.assign\s*\(\s*\w+\s*,\s*(?:JSON\.parse|JSON\.stringify)/i.test(
        body,
      ) ||
      /__proto__/i.test(body)
    ) {
      return "__proto__ assignment / Object.assign with parsed JSON - pollution risk.";
    }
    if (/Object\.assign\s*\(\s*\w+\s*,\s*JSON/i.test(body)) {
      return "Object.assign from JSON - audit for __proto__ key copy.";
    }
    return null;
  },

  "code-proto-pollution-recursive-merge": (_url, _headers, body) => {
    if (
      /Object\.keys\s*\(\s*\w+\s*\)\s*[\s\S]{0,80}function[^{]*\{[\s\S]{0,200}__proto__|function\s+\w*[mM]erge\s*\([^)]*\)\s*\{[\s\S]{0,200}for\s*\([^)]*Object\.keys/i.test(
        body,
      )
    ) {
      return "Custom recursive merge iterates Object.keys - prototype pollution risk.";
    }
    if (/function\s+\w*[mM]erge\s*\([^)]*Object\.keys/i.test(body)) {
      return "Hand-rolled merge function detected - audit for __proto__ writes.";
    }
    return null;
  },

  // ── JWT (code-jwt-*) ──────────────────────────────────────────────────────

  "code-jwt-verify-no-secret": (_url, _headers, body) => {
    if (
      /jwt\.verify\s*\([^,)]+\)/i.test(body) &&
      !/jwt\.verify\s*\([^,)]+,\s*[^,)]+/.test(body)
    ) {
      return "jwt.verify() called without a secret/key argument.";
    }
    return null;
  },

  "code-jwt-decode-only": (_url, _headers, body) => {
    if (/jwt\.decode\s*\(/i.test(body) && !/jwt\.verify/i.test(body)) {
      return "jwt.decode() used without jwt.verify() - signature not validated.";
    }
    // Removed: "jwt.decode call - confirm jwt.verify is also used for auth decisions."
    // This fired when both jwt.decode AND jwt.verify were present — a false positive
    // since verify was already being called.
    return null;
  },

  "code-jwt-hs256-weak-secret": (_url, _headers, body) => {
    if (/jwt\.sign\s*\([^)]*,\s*["'][^"']{1,15}["']/i.test(body)) {
      return "jwt.sign with short/literal HS256 secret - brute-forceable.";
    }
    return null;
  },

  "code-jwt-none-algorithm": (_url, _headers, body) => {
    if (/algorithms\s*:\s*\[[^\]]*["']none["']/i.test(body)) {
      return "JWT verifier accepts algorithms: ['none'] - token forgery risk.";
    }
    // Removed second branch: jwt.verify with any 'algorithms' key is CORRECT behavior.
    // Flagging correct usage was a false positive.
    return null;
  },

  // ── Trusted Types (code-csp-*) ────────────────────────────────────────────

  "code-csp-no-trustedtypes": (_url, _headers, body) => {
    if (/trustedTypes\.createPolicy\s*\(/i.test(body)) return null;
    const scripts = inlineScriptContent(body);
    if (
      /(?:innerHTML\s*=|document\.write\s*\(|eval\s*\()/i.test(scripts) &&
      !/trustedTypes/i.test(scripts)
    ) {
      return "DOM sinks without Trusted Types policy - prefer a sanitizing policy.";
    }
    return null;
  },

  "code-csp-missing-trusted-types": (_url, headers, body) => {
    const csp = headers.get("content-security-policy") || "";
    if (!csp || /trustedTypes/i.test(csp)) return null;
    const scripts = inlineScriptContent(body);
    if (/innerHTML\s*=|document\.write\s*\(/i.test(scripts)) {
      return "Page renders dynamic HTML without Trusted Types enforcement.";
    }
    return null;
  },

  // ── Auth / storage / cookies (code-auth-*, code-cookie-*) ────────────────

  "code-auth-localstorage-tokens": (_url, _headers, _body) => {
    return null;
  },

  "code-auth-sessionstorage-passwords": (_url, _headers, body) => {
    if (
      /sessionStorage\.setItem\s*\(\s*["'](?:password|passwd|pwd)/i.test(body)
    ) {
      return "Plaintext password stored in sessionStorage.";
    }
    return null;
  },

  "code-cookie-samesite-none-http": (_url, headers, body) => {
    if (/SameSite\s*=\s*None/i.test(body) && !/;\s*Secure/i.test(body)) {
      return "SameSite=None cookie without Secure flag - browsers reject, leaks via HTTP.";
    }
    // AUDIT-008 follow-up: this used to read headers.get("set-cookie"),
    // which comma-joins every Set-Cookie header into one string (the Fetch
    // spec's Headers.get() combines multi-value headers; Set-Cookie is only
    // exempted from that via the separate getSetCookie() method). On a
    // response with multiple cookies, that join let one cookie's own
    // "Secure" attribute satisfy the /;\s*Secure/ test for a completely
    // different cookie's SameSite=None, and vice versa. It also only
    // checked for the presence of "SameSite=None" anywhere in that joined
    // blob without checking Secure at all in this branch, so it fired
    // whenever ANY cookie declared SameSite=None regardless of whether
    // Secure was present. Iterate each Set-Cookie header on its own (same
    // per-cookie approach as cookies.ts's set-cookie-samesite-none-no-secure)
    // so both flags are checked together against the same cookie.
    for (const cookie of getSetCookies(headers)) {
      if (/SameSite\s*=\s*None/i.test(cookie) && !/;\s*Secure/i.test(cookie)) {
        return "Set-Cookie uses SameSite=None without Secure - downgrade risk.";
      }
    }
    return null;
  },

  "code-cookie-missing-secure-http": (_url, headers, body) => {
    if (
      /document\.cookie\s*=[^;]*(?:token|password|session)/i.test(body) &&
      !/;\s*Secure/i.test(body)
    ) {
      return "document.cookie write missing Secure flag - cookie can travel over HTTP.";
    }
    if (
      headers.has("set-cookie") &&
      !/;\s*Secure/i.test(headers.get("set-cookie") || "")
    ) {
      return "Set-Cookie header lacks Secure flag - sent on plaintext connections.";
    }
    return null;
  },

  // ── Clickjacking (code-clickjack-*) ──────────────────────────────────────

  "code-clickjack-target-blank-js-href": (_url, _headers, body) => {
    if (
      /<a[^>]+href\s*=\s*["']javascript:/i.test(body) &&
      /target\s*=\s*["']_blank["']/i.test(body)
    ) {
      return "Anchor with javascript: href and target=_blank - executes in new tab.";
    }
    if (/<a[^>]+href\s*=\s*["']javascript:/i.test(body)) {
      return "javascript: href in source - even with noopener it executes.";
    }
    return null;
  },

  "code-clickjack-x-frame-options": (_url, headers, _body) => {
    if (
      headers.has("x-frame-options") &&
      /ALLOWALL/i.test(headers.get("x-frame-options") || "")
    ) {
      return "X-Frame-Options: ALLOWALL - defeats clickjacking protection.";
    }
    return null;
  },

  // ── Timing-safe compare (code-timing-*) ──────────────────────────────────

  "code-timing-no-constant-time-compare": (_url, _headers, _body) => {
    // Cannot reliably detect non-constant-time comparisons from minified/
    // transpiled client-side JS without 100% false positive rate.
    return null;
  },

  "code-timing-hmac-equality": (_url, _headers, body) => {
    if (/hmac\s*\([^)]+\)\s*===/.test(body) || /HMAC[^=]*===/.test(body)) {
      return "HMAC comparison via === - byte-by-byte timing leak.";
    }
    return null;
  },

  // ── Cloud credentials (code-cloud-*) ─────────────────────────────────────

  "code-cloud-aws-hardcoded-credentials": (_url, _headers, body) => {
    if (
      /accessKeyId\s*:\s*["'][A-Z0-9]{16,}["']|secretAccessKey\s*:\s*["'][A-Za-z0-9/+=]{30,}["']/i.test(
        body,
      )
    ) {
      return "Hardcoded AWS accessKeyId / secretAccessKey in @aws-sdk client.";
    }
    return null;
  },

  "code-cloud-aws-s3-upload-no-acl": (_url, _headers, body) => {
    if (
      /PutObjectCommand\s*\([\s\S]*?ACL\s*:\s*["']public-read/i.test(body) ||
      /\.upload\s*\([\s\S]*?ACL\s*:\s*["']public-read/i.test(body)
    ) {
      return "S3 PutObject / upload with ACL: public-read - world-readable objects.";
    }
    return null;
  },

  "code-cloud-azure-blob-upload-no-acl": (_url, _headers, body) => {
    if (
      /(?:ContainerClient|BlobServiceClient|BlockBlobClient)[\s\S]{0,200}publicAccess/i.test(
        body,
      ) ||
      /accessLevel\s*:\s*["'](?:blob|container)["']/i.test(body)
    ) {
      return "Azure blob container accessLevel set to blob/container - public enumeration.";
    }
    return null;
  },

  // ── Code-prefixed entries with category=headers (placed in code.ts) ──────

  "code-fetch-without-credentials": (_url, _headers, _body) => {
    return null;
  },

  "code-axios-defaults-baseurl": (_url, headers, body) => {
    if (/axios\.defaults\.baseURL\s*=/i.test(body)) {
      return "axios.defaults.baseURL set globally - SSRF pivot if base is user-controlled.";
    }
    return null;
  },

  "code-eval-setinterval-string": (_url, headers, body) => {
    if (
      /set(?:Timeout|Interval)\s*\(\s*["'`]/i.test(body) ||
      /set(?:Timeout|Interval)\s*\([^,)]*,\s*[^,)]*[+`]/i.test(body)
    ) {
      return "setTimeout / setInterval with string argument - implicit eval().";
    }
    return null;
  },

  "code-object-assign-from-user": (_url, _headers, body) => {
    if (
      /Object\.assign\s*\(\s*\w+\s*,\s*(?:req|request|params|query|body|JSON\.parse)/i.test(
        body,
      )
    ) {
      return "Object.assign from user input - prototype pollution / mass-assignment risk.";
    }
    // Removed: "Object.assign usage - audit second argument for user input."
    // Object.assign() is used ubiquitously in virtually every JavaScript app
    // for non-user-input operations. Any use fired this.
    return null;
  },

  "code-spread-into-globals": (_url, headers, body) => {
    if (/\{\s*\.\.\.(?:req|request|params|query|body)\b/i.test(body)) {
      return "Spread of user input into object - prototype pollution / mass-assignment risk.";
    }
    return null;
  },

  "code-cookie-without-httponly": (_url, headers, body) => {
    if (
      /document\.cookie\s*=[^;]*\b(?:token|password|session|sid)/i.test(body) &&
      !/HttpOnly/i.test(body)
    ) {
      return "document.cookie write missing HttpOnly - readable from JS / XSS.";
    }
    if (
      headers.has("set-cookie") &&
      !/HttpOnly/i.test(headers.get("set-cookie") || "")
    ) {
      return "Set-Cookie header lacks HttpOnly - readable from JavaScript.";
    }
    return null;
  },

  "code-cookie-write-no-secure": (_url, _headers, _body) => {
    return null;
  },

  "code-cookie-write-no-samesite": (_url, headers, body) => {
    if (
      /document\.cookie\s*=[^;]*(?:token|session|sid)/i.test(body) &&
      !/SameSite/i.test(body)
    ) {
      return "document.cookie write missing SameSite attribute.";
    }
    if (
      headers.has("set-cookie") &&
      !/SameSite/i.test(headers.get("set-cookie") || "")
    ) {
      return "Set-Cookie header lacks SameSite attribute.";
    }
    return null;
  },

  "code-window-open-without-noopener": (_url, _headers, body) => {
    if (/window\.open\s*\([^)]*\)/i.test(body) && !/noopener/i.test(body)) {
      return "window.open() without noopener - reverse tabnabbing risk.";
    }
    // Removed: "window.open usage - confirm features string includes noopener."
    // The first branch already handles the case where noopener is absent.
    // The fallback fired when noopener WAS present, which is correct behaviour.
    return null;
  },

  "code-location-assign-with-user-input": (_url, _headers, _body) => {
    // Removed: duplicate of code-redirect-window-location-href which has the same logic.
    return null;
  },

  "code-vue-v-html": (_url, _headers, _body) => {
    // Removed: duplicate of code-xss-vue-v-html-dynamic which is more specific
    // (distinguishes dynamic vs static v-html bindings).
    return null;
  },

  "code-angular-bypass-security": (_url, _headers, _body) => {
    // Removed: duplicate of code-xss-angular-bypass-dynamic which is more comprehensive
    // (also checks [innerHTML] binding and ng-bind-html).
    return null;
  },

  "code-jquery-html": (_url, _headers, body) => {
    if (/\$\([^)]*\)\.html\s*\(\s*(?!["']\s*\))/i.test(body)) {
      return "jQuery .html() with non-literal argument - DOM XSS sink.";
    }
    // Removed: "jQuery .html() usage - audit argument source."
    // The first branch already catches non-literal arguments. The fallback
    // fired when a static string literal was passed — that is safe.
    return null;
  },

  "code-jquery-global-event": (_url, headers, body) => {
    if (/\$\([^)]*\)\.(?:on|bind)\s*\(\s*["'][^"']*["']/i.test(body)) {
      return "jQuery delegated event binding - audit selector for user-controlled markup.";
    }
    return null;
  },

  "code-local-storage-pii": (_url, headers, body) => {
    if (
      /localStorage\.setItem\s*\(\s*["'](?:email|name|phone|address|ssn|user)/i.test(
        body,
      )
    ) {
      return "PII being written to localStorage - any XSS exfiltrates it.";
    }
    return null;
  },

  "code-service-worker-no-csp": (_url, headers, body) => {
    if (
      /navigator\.serviceWorker\.register/i.test(body) &&
      !headers.get("content-security-policy")
    ) {
      return "Service worker registered but no Content-Security-Policy header found.";
    }
    return null;
  },

  "code-cookie-write-via-jquery": (_url, headers, body) => {
    if (/\$\.cookie\s*\(/i.test(body) && !/HttpOnly/i.test(body)) {
      return "jQuery $.cookie write missing HttpOnly - readable from JS / XSS.";
    }
    return null;
  },

  "code-stripe-publishable-key": (_url, headers, body) => {
    if (/pk_live_[0-9a-zA-Z]{20,}/i.test(body)) {
      return "Stripe live publishable key in client source - rotate if unintended.";
    }
    if (/pk_test_[0-9a-zA-Z]{20,}/i.test(body)) {
      return "Stripe test publishable key in client source - move to env config.";
    }
    return null;
  },

  "code-react-refs-innerhtml": (_url, headers, body) => {
    if (/this\.refs\.\w+\.innerHTML\s*=/i.test(body)) {
      return "React ref.innerHTML assignment - DOM XSS sink.";
    }
    return null;
  },

  "code-angular-interpolation-bypass": (_url, headers, body) => {
    if (
      /\[innerHTML\]\s*=/i.test(body) ||
      /\[(?:ngStyle|ngClass)\]\s*=/i.test(body)
    ) {
      return "Angular property-binding bypass of interpolation - audit user content.";
    }
    return null;
  },

  "html-injection-patterns": (_url, _headers, body) => {
    // Strip scripts and code blocks so normal framework bundles and examples
    // don't self-trigger. After stripping, only look for patterns that CANNOT
    // appear in legitimate HTML — not just any <script> tag.
    const html = stripExampleContent(body);
    // Script injected after </title> — classic stored XSS breakout
    if (/<\/title>\s*<script\b/i.test(html)) {
      return "HTML injection detected — script tag injected after </title>.";
    }
    // onerror with obvious JS execution (alert/eval/fetch — not a legit fallback)
    if (
      /\bonerror\s*=\s*(?:alert|eval|document\.write|fetch|XMLHttpRequest)\s*\(/i.test(
        html,
      )
    ) {
      return "HTML injection detected — onerror handler executing JavaScript.";
    }
    // javascript: URL in href/src/action that isn't void(0)
    if (
      /(?:href|src|action)\s*=\s*["']\s*javascript\s*:\s*(?!void\s*\()/i.test(
        html,
      )
    ) {
      return "HTML injection detected — javascript: URL in href/src/action.";
    }
    return null;
  },

  "reflected-input": (_url, _headers, body) => {
    // Only flag actual DOM XSS: a URL-derived source (location, referrer, etc.)
    // being assigned directly to a dangerous DOM sink in an inline script.
    // Avoid matching normal script bundles by restricting to inline-only scripts.
    const inlineScripts = [
      ...body.matchAll(/<script\b(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi),
    ].map((m) => m[1]);

    for (const script of inlineScripts) {
      if (
        /(?:document\.write|\.innerHTML|\.outerHTML)\s*(?:\+=?)\s*(?:location|document\.URL|document\.referrer|window\.name|location\.search|location\.hash)/i.test(
          script,
        )
      ) {
        return "DOM XSS sink detected — URL or referrer source written directly to a DOM sink.";
      }
    }
    return null;
  },

  // ── Additional eval-family sinks (code-eval-*) ───────────────────────────

  "code-eval-vm-module": (_url, _headers, body) => {
    if (
      /vm\.(?:runInNewContext|runInThisContext|runInContext)\s*\(\s*(?:req|request|params|query|body)\./i.test(
        body,
      ) ||
      /new\s+vm\.Script\s*\(\s*(?:req|request|params|query|body)\./i.test(body)
    ) {
      return "Node.js vm module (runInNewContext/runInThisContext/Script) executed with request-derived source — sandbox escape / RCE risk.";
    }
    return null;
  },

  "code-eval-groovyshell": (_url, _headers, body) => {
    if (
      /new\s+GroovyShell\s*\(\s*\)\s*\.\s*evaluate\s*\(\s*(?:request|req)\./i.test(
        body,
      )
    ) {
      return "GroovyShell.evaluate() called with request data — arbitrary Groovy/Java code execution risk.";
    }
    return null;
  },

  "code-eval-php-assert-string": (_url, _headers, body) => {
    if (/\bassert\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/i.test(body)) {
      return "PHP assert() called with user input — assert() evaluates string arguments as PHP code (CVE-class RCE).";
    }
    if (/\bcreate_function\s*\(/i.test(body)) {
      return "PHP create_function() detected — internally uses eval(); deprecated and removed in PHP 8. Replace with an anonymous function.";
    }
    return null;
  },

  // ── Additional insecure deserialization sinks (code-deser-*) ─────────────

  "code-deser-dotnet-binaryformatter": (_url, _headers, body) => {
    if (
      /BinaryFormatter\s*\(\s*\)[\s\S]{0,80}\.Deserialize\s*\(/i.test(body) ||
      /new\s+BinaryFormatter\s*\(\s*\)/i.test(body)
    ) {
      return "BinaryFormatter usage detected — Microsoft has deprecated it as fundamentally unsafe; deserializing untrusted data with it enables RCE.";
    }
    return null;
  },

  "code-deser-java-objectinputstream": (_url, _headers, body) => {
    const hasUserStream =
      /new\s+ObjectInputStream\s*\([^)]*(?:request\.|req\.|getInputStream\(\))/i.test(
        body,
      );
    if (hasUserStream && /\.readObject\s*\(\s*\)/.test(body)) {
      return "ObjectInputStream constructed from request data with readObject() called — classic Java deserialization RCE gadget-chain sink.";
    }
    return null;
  },

  "code-deser-ruby-marshal-load": (_url, _headers, body) => {
    if (/Marshal\.load\s*\(\s*(?:params|request|req)\b/i.test(body)) {
      return "Ruby Marshal.load() called with request/params data — Marshal.load can instantiate arbitrary objects, a known RCE gadget-chain sink.";
    }
    return null;
  },
};
