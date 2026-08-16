/**
 * Client-side detectors.
 *
 * Checks for JavaScript-level security issues in the response body:
 * unsafe DOM sinks, dangerous APIs, third-party script risks, and
 * client-side sensitive data exposure.
 */

import {
  escapeRegExp,
  extractScriptContents,
  getHeader,
  type EvidenceFn as DetectFn,
} from "../_helpers";

// Hosts that intentionally serve scripts/stylesheets without SRI support:
// content is mutable server-side by design (analytics/payment/CAPTCHA
// providers push updates without notice), so pinning a hash would break the
// integration. Exported so headers.ts's sri-missing/sri-stylesheet-missing
// detectors use the same list instead of drifting out of sync with this one.
export const SRI_EXEMPT_HOSTS = new Set([
  "js.stripe.com",
  "checkout.stripe.com",
  "www.googletagmanager.com",
  "googletagmanager.com",
  "www.google-analytics.com",
  "google-analytics.com",
  "www.google.com",
  "www.gstatic.com",
  "googlesyndication.com",
  "fonts.googleapis.com",
  "widget.intercom.io",
  "js.intercomcdn.com",
  "www.paypalobjects.com",
  "connect.facebook.net",
  "cdn.segment.com",
  "static.hotjar.com",
  "snap.licdn.com",
  "use.typekit.net",
]);

// Example/test credentials a vendor publishes in its own docs and that get
// copied verbatim into countless tutorials and demo pages -- permanently
// inert, never wired to a real account. Same principle as
// KNOWN_TEST_CARD_NUMBERS in secrets-extended.ts.
const KNOWN_TEST_API_KEYS = new Set([
  "sk_test_4eC39HqLyjWDarjtT1zdp7dc", // Stripe's own docs example secret key
]);

function isPlausibleApiKeyValue(value: string): boolean {
  if (KNOWN_TEST_API_KEYS.has(value)) return false;
  if (/^(?:x+|0+)$/i.test(value)) return false;
  if (
    /^(?:test|example|sample|dummy|placeholder|your[_-]?api[_-]?key)/i.test(
      value,
    )
  )
    return false;
  return true;
}

export const detectors: Record<string, DetectFn> = {
  "cs-csp-unsafe-inline-script": (_url, headers) => {
    const csp = getHeader(headers, "content-security-policy");
    if (!csp) return null;
    // script-src falls back to default-src per CSP fallback rules when absent —
    // but NOT to unrelated directives like style-src or img-src, which have no
    // bearing on whether inline scripts execute.
    const scriptSrc =
      csp.match(/script-src[^;]*/i)?.[0] ?? csp.match(/default-src[^;]*/i)?.[0];
    if (scriptSrc && /'unsafe-inline'/.test(scriptSrc)) {
      return "CSP script-src includes 'unsafe-inline' — inline script injection will execute despite the CSP.";
    }
    return null;
  },

  "csp-unsafe-eval-script": (_url, headers) => {
    const csp = getHeader(headers, "content-security-policy");
    if (!csp) return null;
    if (/'unsafe-eval'/.test(csp)) {
      return "CSP includes 'unsafe-eval' — eval(), Function(), and setTimeout(string) are permitted.";
    }
    return null;
  },

  "postmessage-no-origin-check": (_url, _headers, body) => {
    const listenerPattern = /addEventListener\s*\(\s*["']message["']/;
    if (!listenerPattern.test(body)) return null;
    // Match any identifier's .origin access, not just the literal names
    // "event"/"message" — handlers commonly name the param e, evt, ev, msg, etc.
    const hasOriginCheck = /\w+\.origin\b/.test(body);
    if (!hasOriginCheck) {
      return "postMessage listener found without event.origin validation — any page can send messages.";
    }
    return null;
  },

  "localstorage-sensitive-data": (_url, _headers, body) => {
    const callPattern = /localStorage\.setItem\s*\(\s*["']([^"']+)["']/gi;
    const sensitiveKeyword =
      /\b(?:token|jwt|auth|session|secret|credential|apikey)\b/i;
    let m: RegExpExecArray | null;
    while ((m = callPattern.exec(body)) !== null) {
      // Normalize snake_case/kebab-case/camelCase to a common delimiter so \b
      // sees real word boundaries (underscore is itself a \w character, so
      // "auth_token" has no native \b between "auth" and "token"), then fold
      // "api|key" back into a single "apikey" token — bare "key" alone stays
      // unmatched since it's too generic (cacheKey, themeKey, queryKey, etc.).
      const key = m[1]
        .replace(/[_-]/g, "|")
        .replace(/([a-z0-9])([A-Z])/g, "$1|$2")
        .replace(/api\|key/gi, "apikey");
      if (sensitiveKeyword.test(key)) {
        return "Authentication token or secret stored in localStorage — readable by any JavaScript on the page.";
      }
    }
    return null;
  },

  "dom-xss-location-hash": (_url, _headers, body) => {
    const pattern =
      /(?:innerHTML|outerHTML|document\.write)\s*[=\(][^;]{0,100}location\.(?:hash|search|href)/i;
    const m = pattern.exec(body);
    if (m) {
      if (/DOMPurify|sanitize|xss\s*\(/i.test(m[0])) return null;
      return "DOM XSS sink (innerHTML/document.write) assigned location.hash or location.search without sanitization.";
    }
    return null;
  },

  "cs-document-write-usage": (_url, _headers, body) => {
    const combined = extractScriptContents(body).join("\n");
    if (/document\.write\s*\(/.test(combined)) {
      return "document.write() detected — deprecated API that is a DOM XSS sink and breaks modern frameworks.";
    }
    return null;
  },

  "eval-in-client-script": (_url, _headers, body) => {
    // Check for eval() in <script> blocks only
    const combined = extractScriptContents(body).join("\n");
    // Detect eval() - intentional use for JS security scanning
    if (/\beval\s*\(/.test(combined) || /new\s+Function\s*\(/.test(combined)) {
      return "eval() or new Function() detected in inline script — primary DOM XSS code execution sink.";
    }
    return null;
  },

  "third-party-script-no-sri": (_url, _headers, body) => {
    const externalScriptPattern =
      /<script[^>]+src=["'](https?:\/\/(?!(?:localhost|127\.0\.0\.1))[^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = externalScriptPattern.exec(body)) !== null) {
      const tag = m[0];
      const url = m[1];
      if (/integrity\s*=/i.test(tag)) continue;
      const host = new URL(url).hostname;
      if (SRI_EXEMPT_HOSTS.has(host)) continue;
      return `External script from ${host} loaded without SRI integrity attribute.`;
    }
    return null;
  },

  "source-map-exposed-production": (_url, _headers, body) => {
    // Check for external sourceMappingURL (not data: URIs)
    const pattern = /\/\/[#@]\s*sourceMappingURL\s*=\s*(?!data:)([^\s]+\.map)/i;
    const m = pattern.exec(body);
    if (m) {
      return `JavaScript source map reference detected: ${m[1]} — exposes original un-minified source code.`;
    }
    return null;
  },

  "jsonp-callback-endpoint": (_url, _headers, body) => {
    // Require the actual JSONP response shape (a function call wrapping a
    // JSON object/array at the start of the body) rather than a bare
    // "callback=" substring, which also appears in OAuth redirect URLs and
    // third-party widget script tags that have nothing to do with JSONP.
    const jsonpResponseShape = /^\s*[\w$.]{1,80}\(\s*[\{\[]/;
    if (jsonpResponseShape.test(body)) {
      return "JSONP callback pattern detected — any website can load this endpoint and read the response data.";
    }
    return null;
  },

  "open-redirect-client-js": (_url, _headers, body) => {
    const patterns = [
      /window\.location\s*=\s*(?:searchParams|location\.hash|params|query)\./i,
      /location\.(?:href|assign|replace)\s*\([^)]*(?:searchParams|hash|params\.get|query)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Client-side location assignment from URL parameters without validation — open redirect risk.";
      }
    }
    return null;
  },

  "angular-bypass-security": (_url, _headers, body) => {
    const scripts = extractScriptContents(body).join("\n");
    const pattern =
      /bypassSecurityTrust(?:Html|Script|Style|Url|ResourceUrl)\s*\(/;
    // Angular's own DomSanitizer field is conventionally named "this.sanitizer",
    // which contains "sanitize" as a substring — a bare /sanitize/i test would
    // match (and suppress) virtually every real Angular call site. Require an
    // actual sanitizer call/package name instead, same as cs-unsanitized-markdown-render.
    if (
      pattern.test(scripts) &&
      !/DOMPurify|sanitize-html|xss\s*\(/i.test(scripts)
    ) {
      return "Angular bypassSecurityTrust* usage detected — verify content is fully sanitized before this call.";
    }
    return null;
  },

  "vue-v-html-directive": (_url, _headers, body) => {
    const pattern = /v-html\s*=\s*["'][^"']*["']|:v-html\s*=|v-html\s*=\s*"/;
    if (pattern.test(body)) {
      const hasSanitize = /DOMPurify|sanitize|xss/i.test(body);
      if (!hasSanitize) {
        return "Vue v-html directive detected without visible DOMPurify sanitization — XSS risk with user content.";
      }
    }
    return null;
  },

  "api-key-hardcoded-in-js": (_url, _headers, body) => {
    // Match patterns like apiKey: 'sk-...' in scripts. 'AIza' (Firebase/Google
    // client config key) and 'pk_live_' (Stripe's own publishable-key prefix)
    // are excluded: both are vendor-documented as safe to expose client-side,
    // restricted via origin/domain allowlisting rather than secrecy.
    const patterns = [
      /(?:apiKey|api_key|APIKey)\s*[:=]\s*["']((?:sk-|SG\.|rk_live_|AKID|eyJ)[A-Za-z0-9+/\-_]{20,})["']/,
      /(?:openai|anthropic|stripe|sendgrid|twilio)\s*(?:api.?key|secret)\s*[:=]\s*["'](?!pk_)([A-Za-z0-9\-_]{20,})["']/i,
    ];
    for (const p of patterns) {
      const m = p.exec(body);
      if (m && isPlausibleApiKeyValue(m[1])) {
        return "API key or service credential hardcoded in client-side JavaScript — treat as compromised.";
      }
    }
    return null;
  },

  "debug-info-in-page-js": (_url, _headers, body) => {
    const patterns = [
      /"DATABASE_URL"\s*:/i,
      /__NEXT_DATA__[^}]{0,500}(?:password|secret|private)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Sensitive configuration data serialized into page JavaScript — review server-side props for secret exposure.";
      }
    }
    const hydration =
      /window\.__(?:ENV|CONFIG|APP_CONFIG|INITIAL_STATE)__\s*=\s*\{([^}]{0,500})/i.exec(
        body,
      );
    if (hydration) {
      // Same normalize-then-whole-word-match reasoning as
      // localstorage-sensitive-data above: a bare "key" substring matches
      // apiKey/siteKey/publicKey (Firebase, reCAPTCHA, Stripe publishable
      // key) which are vendor-documented as safe client-side and routinely
      // land in SSR hydration state -- so "key" is only matched via the
      // explicit privateKey case, not as a standalone word.
      const normalized = hydration[1]
        .replace(/[_-]/g, "|")
        .replace(/([a-z0-9])([A-Z])/g, "$1|$2");
      if (/\b(?:password|secret|token|private\|?key)\b/i.test(normalized)) {
        return "Sensitive configuration data serialized into page JavaScript — review server-side props for secret exposure.";
      }
    }
    return null;
  },

  "prototype-pollution-client": (_url, _headers, body) => {
    // Only a write into __proto__ (not a `delete`/`===`/`!==` guard reading or
    // filtering it) is an actual pollution sink. A write of null/undefined/
    // Object.create(null) right after the `=` is the opposite of pollution:
    // it's the defensive pattern that GUARDS against it (a common hardening
    // idiom in merge/clone utilities), and matched identically before this
    // exclusion existed -- e.g. flagged as a critical finding on google.com.
    const protoAssign = /\[["']__proto__["']\]\s*=(?!=)/g;
    let m: RegExpExecArray | null;
    while ((m = protoAssign.exec(body)) !== null) {
      const before = body.slice(Math.max(0, m.index - 20), m.index);
      if (/\bdelete\s*$/.test(before)) continue;
      const after = body.slice(
        m.index + m[0].length,
        m.index + m[0].length + 30,
      );
      if (
        /^\s*(?:(?:null|undefined|void 0)\b|Object\.create\(\s*null\s*\))/.test(
          after,
        )
      )
        continue;
      return "Client-side prototype pollution pattern detected — audit Object merge operations for __proto__ filtering.";
    }
    const patterns = [
      /Object\.prototype\.\w+\s*=/,
      // Object.assign into a freshly created {} literal can't pollute a shared
      // prototype — only flag merges into an existing/shared prototype target.
      /Object\.assign\s*\(\s*\w+\.prototype\s*,\s*(?:user|input|data|params|query)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Client-side prototype pollution pattern detected — audit Object merge operations for __proto__ filtering.";
      }
    }
    return null;
  },

  // ── AI/vibe-coded client-side smells ─────────────────────────────────────

  "cs-hardcoded-localhost-api-url": (_url, _headers, body) => {
    const scripts = extractScriptContents(body).join("\n");
    const pattern =
      /(?:baseURL|apiUrl|API_URL|API_BASE_URL|endpoint)\s*[:=]\s*["']https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^"']*["']/i;
    if (pattern.test(scripts)) {
      return "Client-side script hardcodes an API base URL pointing at localhost — looks like a dev config that was never swapped for production before shipping.";
    }
    return null;
  },

  "cs-unsanitized-markdown-render": (_url, _headers, body) => {
    const scripts = extractScriptContents(body).join("\n");
    const pattern =
      /(?:innerHTML\s*=|dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:)\s*(?:marked|markdownit|md)\s*(?:\.\w+)?\s*\(/i;
    if (!pattern.test(scripts)) return null;
    if (/DOMPurify|sanitize-html|xss\s*\(/i.test(scripts)) return null;
    return "Markdown renderer output (marked()/markdown-it) assigned directly to innerHTML/dangerouslySetInnerHTML without visible sanitization — stored/reflected XSS risk if the markdown source is user-controlled.";
  },

  "cs-websocket-token-in-query": (_url, _headers, body) => {
    const scripts = extractScriptContents(body).join("\n");
    const pattern =
      /new\s+WebSocket\s*\(\s*[^)]*[?&](?:token|auth|api[_-]?key|jwt)=/i;
    if (pattern.test(scripts)) {
      return "WebSocket connection URL includes an auth token/key as a query parameter — tokens in URLs are logged by proxies, load balancers, and browser history.";
    }
    return null;
  },

  "cs-client-only-role-gate": (_url, _headers, body) => {
    const scripts = extractScriptContents(body).join("\n");
    const pattern =
      /if\s*\(\s*(?:user|currentUser|session)\.(?:role|isAdmin|permissions?)\s*(?:===|==|\.includes)[^)]*\)\s*\{[^}]{0,120}\.style\.(?:display|visibility)/i;
    if (pattern.test(scripts)) {
      return "UI element visibility gated by a client-side role/permission check (e.g. user.role === 'admin') — verify the underlying action is also enforced server-side, since this alone is trivially bypassed.";
    }
    return null;
  },

  "cs-dev-tunnel-script-reference": (_url, _headers, body) => {
    const pattern =
      /<script[^>]+src=["']https?:\/\/[^"']*\.(?:ngrok(?:-free)?\.app|ngrok\.io|loca\.lt|trycloudflare\.com|serveo\.net)[^"']*["']/i;
    const m = body.match(pattern);
    if (m) {
      const src = m[0].match(/src=["']([^"']+)["']/i)?.[1] ?? "tunnel URL";
      return `Script loaded from a development tunneling domain (${src}) — looks like a temporary dev/debug endpoint left wired into production markup.`;
    }
    return null;
  },

  "cs-clipboard-writetext-hardcoded-secret": (_url, _headers, body) => {
    const scripts = extractScriptContents(body).join("\n");
    const pattern =
      /clipboard\.writeText\s*\(\s*["'](?:sk-|AIza|ghp_|xox[bpras]-)[A-Za-z0-9_\-]{16,}["']\s*\)/i;
    if (pattern.test(scripts)) {
      return "navigator.clipboard.writeText() call contains a hardcoded credential-shaped string — likely a leftover debug 'copy my API key' button shipped with a real key.";
    }
    return null;
  },

  // Only flag postMessage to an actual *other* window (contentWindow,
  // opener, parent, top, a captured event.source, or an explicit frames[]
  // reference): bare window.postMessage(msg, "*") / self.postMessage(...)
  // is the well-known setImmediate-polyfill "self message to schedule a
  // tick" trick (shipped in next/dist/compiled/setimmediate and the
  // standalone setimmediate/object-hash packages), the message never
  // leaves the page, so "*" there carries none of the cross-origin leak
  // risk this check exists to catch.
  "cs-postmessage-wildcard-origin": (_url, _headers, body) => {
    const scripts = extractScriptContents(body).join("\n");
    const pattern =
      /\b(?:contentWindow|opener|parent|top|source|frames\[[^\]]*\])\s*\.postMessage\s*\(\s*[\s\S]{1,150}?,\s*["']\*["']\s*[,)]/;
    if (pattern.test(scripts)) {
      return 'postMessage() call targets another window (contentWindow/opener/parent/top/event.source) with a literal "*" targetOrigin: the message is delivered to whatever origin that window currently holds, not a specific expected origin.';
    }
    return null;
  },

  "cs-dynamic-import-untrusted-specifier": (_url, _headers, body) => {
    const scripts = extractScriptContents(body).join("\n");
    // Case A: the URL-derived source expression is written directly inside
    // the import() call's argument list.
    const inlinePattern =
      /\bimport\s*\(\s*[^)]{0,120}(?:location\.(?:hash|search|href)|searchParams\.get\s*\(|new\s+URLSearchParams)/i;
    if (inlinePattern.test(scripts)) {
      return "Dynamic import() call built directly from a URL-derived value (location.hash/search/href): an attacker-controlled module specifier can load and execute arbitrary JavaScript from any origin.";
    }
    // Case B: a variable is assigned in one hop from a URL-derived source,
    // then interpolated into an import() template literal shortly after,
    // with no visible allowlist/lookup guard in between.
    const assignPattern =
      /\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:new\s+URLSearchParams\s*\([^)]*\)\s*\.get\s*\([^)]*\)|[\w.]+\.searchParams\.get\s*\([^)]*\)|location\.(?:hash|search|href)(?:\.\w+\([^)]*\))?)\s*;?/g;
    let m: RegExpExecArray | null;
    while ((m = assignPattern.exec(scripts)) !== null) {
      const varName = m[1];
      const after = scripts.slice(
        m.index + m[0].length,
        m.index + m[0].length + 400,
      );
      const importRe = new RegExp(
        `import\\s*\\([^)]*\\$\\{\\s*${escapeRegExp(varName)}\\s*\\}`,
      );
      const im = importRe.exec(after);
      if (!im) continue;
      const between = after.slice(0, im.index);
      if (
        /ALLOWED|SUPPORTED|WHITELIST|ALLOWLIST|\.includes\s*\(|\.indexOf\s*\(|\bswitch\s*\(/i.test(
          between,
        )
      ) {
        continue;
      }
      return `Dynamic import() call interpolates "${varName}", a variable assigned directly from a URL-derived value, with no visible allowlist check in between: an attacker-controlled module specifier can load and execute arbitrary JavaScript from any origin.`;
    }
    return null;
  },

  "cs-document-domain-relaxation": (_url, _headers, body) => {
    const scripts = extractScriptContents(body).join("\n");
    const pattern = /document\.domain\s*=\s*["']([^"']+)["']/;
    const m = pattern.exec(scripts);
    if (m) {
      return `document.domain is reassigned to "${m[1]}": this relaxes the Same-Origin Policy so every subdomain that also sets this value can script this page directly.`;
    }
    return null;
  },

  "cs-websocket-eval-message-data": (_url, _headers, body) => {
    const scripts = extractScriptContents(body).join("\n");
    if (!/new\s+WebSocket\s*\(/.test(scripts)) return null;
    const pattern =
      /\beval\s*\(\s*[\w$]+\.data\b|\bnew\s+Function\s*\(\s*[\w$]+\.data\b/;
    if (pattern.test(scripts)) {
      return "WebSocket message .data is passed directly to eval()/new Function(): every message received over the socket executes as JavaScript with full page privileges.";
    }
    return null;
  },
};
