/**
 * Client-side detectors.
 *
 * Checks for JavaScript-level security issues in the response body:
 * unsafe DOM sinks, dangerous APIs, third-party script risks, and
 * client-side sensitive data exposure.
 */

import { getHeader, type EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  "cs-csp-unsafe-inline-script": (_url, headers) => {
    const csp = getHeader(headers, "content-security-policy");
    if (!csp) return null;
    const scriptSrc = csp.match(/script-src[^;]*/i)?.[0] ?? csp;
    if (/'unsafe-inline'/.test(scriptSrc)) {
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
    const hasOriginCheck = /event\.origin|message\.origin/i.test(body);
    if (!hasOriginCheck) {
      return "postMessage listener found without event.origin validation — any page can send messages.";
    }
    return null;
  },

  "localstorage-sensitive-data": (_url, _headers, body) => {
    const pattern =
      /localStorage\.setItem\s*\([^)]*(?:token|jwt|auth|session|secret|key|credential)/i;
    if (pattern.test(body)) {
      return "Authentication token or secret stored in localStorage — readable by any JavaScript on the page.";
    }
    return null;
  },

  "dom-xss-location-hash": (_url, _headers, body) => {
    const pattern =
      /(?:innerHTML|outerHTML|document\.write)\s*[=\(][^;]{0,100}location\.(?:hash|search|href)/i;
    if (pattern.test(body)) {
      return "DOM XSS sink (innerHTML/document.write) assigned location.hash or location.search without sanitization.";
    }
    return null;
  },

  "cs-document-write-usage": (_url, _headers, body) => {
    if (/document\.write\s*\(/.test(body)) {
      return "document.write() detected — deprecated API that is a DOM XSS sink and breaks modern frameworks.";
    }
    return null;
  },

  "eval-in-client-script": (_url, _headers, body) => {
    // Check for eval() in <script> blocks only
    const scripts: string[] = [];
    const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptPattern.exec(body)) !== null) {
      scripts.push(m[1]);
    }
    const combined = scripts.join("\n");
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
      if (!/integrity\s*=/i.test(tag)) {
        const host = new URL(url).hostname;
        return `External script from ${host} loaded without SRI integrity attribute.`;
      }
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

  "jsonp-callback-endpoint": (url, _headers, body) => {
    const urlCallback = /[?&]callback=([^&]+)/i.test(url);
    const bodyCallback =
      /[?&]callback=\w+/.test(body) ||
      /jsonp_callback|jsonCallback/i.test(body);
    if (urlCallback || bodyCallback) {
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
    const pattern =
      /bypassSecurityTrust(?:Html|Script|Style|Url|ResourceUrl)\s*\(/;
    if (pattern.test(body)) {
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
    // Match patterns like apiKey: 'sk-...', apiKey = "AIza..." in scripts
    const patterns = [
      /(?:apiKey|api_key|APIKey)\s*[:=]\s*["'](?:sk-|AIza|SG\.|pk_live_|rk_live_|AKID|eyJ)[A-Za-z0-9+/\-_]{20,}["']/,
      /(?:openai|anthropic|stripe|sendgrid|twilio)\s*(?:api.?key|secret)\s*[:=]\s*["'][A-Za-z0-9\-_]{20,}["']/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "API key or service credential hardcoded in client-side JavaScript — treat as compromised.";
      }
    }
    return null;
  },

  "debug-info-in-page-js": (_url, _headers, body) => {
    const patterns = [
      /"DATABASE_URL"\s*:/i,
      /window\.__(?:ENV|CONFIG|APP_CONFIG|INITIAL_STATE)__\s*=\s*\{[^}]{0,500}(?:password|secret|key|token)/i,
      /__NEXT_DATA__[^}]{0,500}(?:password|secret|private)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Sensitive configuration data serialized into page JavaScript — review server-side props for secret exposure.";
      }
    }
    return null;
  },

  "prototype-pollution-client": (_url, _headers, body) => {
    const patterns = [
      /\[["']__proto__["']\]/,
      /Object\.prototype\.\w+\s*=/,
      /Object\.assign\s*\(\s*(?:\w+\.prototype|\{\})\s*,\s*(?:user|input|data|params|query)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Client-side prototype pollution pattern detected — audit Object merge operations for __proto__ filtering.";
      }
    }
    return null;
  },
};
