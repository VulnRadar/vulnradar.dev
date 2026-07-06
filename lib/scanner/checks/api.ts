/**
 * API-surface detectors.
 *
 * Detectors that look for REST/GraphQL/OpenAPI endpoints, HTTP method
 * allowlists, rate-limit headers, JSONP, and similar API-shape issues.
 */

import { hasHeader, type EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  // graphql-introspection, graphql-endpoint-exposed, swagger-docs-exposed handled by content.ts

  "rate-limiting": (url, headers) => {
    // Rate-limit headers only appear on API/auth endpoints, not HTML pages.
    // Firing on a homepage is always a false positive.
    try {
      const { pathname } = new URL(url);
      const lp = pathname.toLowerCase();
      const isApiPath =
        /\/api\//.test(lp) ||
        /\/auth\//.test(lp) ||
        /\/login/.test(lp) ||
        /\/signup/.test(lp) ||
        /\/v\d+\//.test(lp);
      if (!isApiPath) return null;
    } catch {
      return null;
    }
    const rateHeaders = [
      "x-ratelimit-limit",
      "x-rate-limit-limit",
      "ratelimit-limit",
      "retry-after",
      "x-ratelimit-remaining",
    ];
    for (const rh of rateHeaders) {
      if (hasHeader(headers, rh)) return null;
    }
    return "No rate-limiting headers detected. API endpoints may be vulnerable to abuse.";
  },

  // email-enumeration, api-version-exposed, exposed-api-version handled by content.ts

  // ── REST method allowlist ───────────────────────────────────────────────

  "options-method-exposed": (_url, headers) => {
    if (headers.has("allow")) {
      const allowed = headers.get("allow") || "";
      if (/TRACE|DELETE|PUT/i.test(allowed)) {
        return `Server Allow header reveals risky methods: ${allowed}`;
      }
    }
    return null;
  },

  // jsonp-endpoint handled by content.ts; api-jsonp-callback below is the API-specific version

  "soap-endpoint": (_url, _headers, body) => {
    if (/<(?:soap:)?envelope|<wsdl|\?wsdl|\?wsdl=/i.test(body)) {
      return "SOAP / WSDL endpoint reference found.";
    }
    return null;
  },

  "xml-rpc": (_url, _headers, body) => {
    if (/xmlrpc|\/RPC2\b/i.test(body)) {
      return "XML-RPC endpoint reference found (often unauthenticated).";
    }
    return null;
  },

  // ── Excessive method surface ─────────────────────────────────────────────

  "trace-method-enabled": (_url, headers) => {
    if (headers.has("allow") && /TRACE/i.test(headers.get("allow") || "")) {
      return "HTTP TRACE method is enabled - potential Cross-Site Tracing (XST) attack vector.";
    }
    return null;
  },

  // ── Admin / debug endpoints in body ─────────────────────────────────────

  "debug-endpoint": (_url, _headers, body) => {
    if (/\/debug\/|\/trace\/|\/profiler\/|\/_debug\//gi.test(body)) {
      return "Debug endpoints referenced in page source.";
    }
    return null;
  },

  "admin-endpoint": (_url, _headers, body) => {
    // Removed /\/dashboard\// — "dashboard" appears in navigation of nearly
    // every web application and does not constitute an admin-endpoint finding.
    if (/\/admin\/|\/administrator\/|\/management\//gi.test(body)) {
      return "Admin/management endpoints referenced in page source.";
    }
    return null;
  },

  // ── REST verb allowlist / authentication ─────────────────────────────────

  "api-rest-allow-methods-trace": (_url, headers, body) => {
    const allow = headers.get("allow") || "";
    if (/TRACE/i.test(allow)) {
      return "HTTP TRACE method enabled - Cross-Site Tracing (XST) attack vector.";
    }
    if (/method\s*[:=]\s*["'][^"']*TRACE/i.test(body)) {
      return "TRACE method advertised in response body.";
    }
    return null;
  },

  "api-rest-allow-methods-delete": (_url, headers, _body) => {
    const allow = headers.get("allow") || "";
    if (/DELETE/i.test(allow)) {
      return `Server Allow header lists DELETE method: ${allow}. Verify DELETE is protected by authentication.`;
    }
    return null;
  },

  "api-rest-allow-methods-put-no-auth": (_url, headers, _body) => {
    const allow = headers.get("allow") || "";
    if (/PUT/i.test(allow) && (/\/api\//i.test(_url) || /api\./i.test(_url))) {
      return `PUT method exposed on API endpoint: Allow: ${allow}. Verify PUT is protected by authentication.`;
    }
    return null;
  },

  "api-rest-allow-methods-patch-no-auth": (_url, headers, _body) => {
    const allow = headers.get("allow") || "";
    if (
      /PATCH/i.test(allow) &&
      (/\/api\//i.test(_url) || /api\./i.test(_url))
    ) {
      return `PATCH method exposed on API endpoint: Allow: ${allow}. Verify PATCH is protected by authentication.`;
    }
    return null;
  },

  "api-rest-allow-methods-options-exposed": (_url, headers, _body) => {
    const allow = headers.get("allow") || "";
    if (allow.split(",").length >= 4) {
      return `Verbose OPTIONS response exposes method allowlist: ${allow}`;
    }
    return null;
  },

  // ── GraphQL ──────────────────────────────────────────────────────────────

  "api-graphql-introspection-enabled": (url, _headers, body) => {
    if (
      /\/graphql/i.test(url) &&
      /__schema|__type|introspectionQuery/i.test(body)
    ) {
      return "GraphQL introspection appears enabled on /graphql endpoint.";
    }
    if (/["']__schema["']\s*\{/.test(body)) {
      return "GraphQL __schema query reference found in response.";
    }
    return null;
  },

  "api-graphql-batch-queries": (_url, _headers, body) => {
    if (/\[.*\{[\s\S]*?(?:"query"|"mutation")[\s\S]*?\}\s*,\s*\{/.test(body)) {
      return "GraphQL batch (array) query pattern detected in response body.";
    }
    return null;
  },

  "api-graphql-error-stack-trace": (_url, _headers, body) => {
    if (
      /"stacktrace"\s*:\s*"/i.test(body) ||
      /"extensions"\s*:\s*\{[^}]*"stacktrace"/i.test(body)
    ) {
      return "GraphQL error.extensions.stacktrace leaked in response.";
    }
    return null;
  },

  "api-graphql-suggestions-enabled": (_url, _headers, body) => {
    if (/["']did you mean["']|["']didYouMean["']\s*:/i.test(body)) {
      return "GraphQL field suggestion ('did you mean') enabled - schema enumeration aid.";
    }
    return null;
  },

  "api-graphql-no-rate-limit": (url, headers, _body) => {
    if (!/\/graphql/i.test(url)) return null;
    const hasRate = [
      "x-ratelimit-limit",
      "x-rate-limit-limit",
      "ratelimit-limit",
      "retry-after",
    ].some((h) => headers.has(h));
    if (!hasRate) {
      return "GraphQL endpoint has no rate-limit headers - cost-based limits recommended.";
    }
    return null;
  },

  // ── OpenAPI / Swagger ────────────────────────────────────────────────────

  "api-openapi-security-scheme-weak": (url, _headers, body) => {
    if (
      /"securitySchemes"\s*:\s*{[\s\S]*?"basic"|"apiKey"\s*:\s*{[^}]*"in"\s*:\s*"query"/i.test(
        body,
      )
    ) {
      return "OpenAPI document declares weak security scheme (basic auth or apiKey in query).";
    }
    // Only flag as reachable when the URL is an API schema endpoint —
    // not when "openapi" merely appears in page body (docs, code examples).
    if (
      /\/openapi(?:\.json|\.yaml)?|\/swagger(?:\.json|\.yaml)?|\/api-docs/i.test(
        url,
      )
    ) {
      return "OpenAPI document reachable - review declared securitySchemes.";
    }
    return null;
  },

  "api-openapi-default-values-sensitive": (url, _headers, body) => {
    if (
      /"(?:password|secret|token|apiKey|apikey|api_key|role|isAdmin)"\s*:\s*{[^}]*"default"\s*:/i.test(
        body,
      )
    ) {
      return "OpenAPI schema declares default value for sensitive field (password/token/role).";
    }
    return null;
  },

  "api-openapi-server-url-leak": (url, _headers, body) => {
    if (
      /"servers"\s*:\s*\[[^\]]*"https?:\/\/(?:localhost|127\.0\.0\.1|10\.|192\.168\.|internal|staging)/i.test(
        body,
      )
    ) {
      return "OpenAPI document leaks internal/staging server URL in 'servers' array.";
    }
    return null;
  },

  // ── JWT ──────────────────────────────────────────────────────────────────

  "api-jwt-alg-none": (_url, headers, body) => {
    if (/"alg"\s*:\s*"none"/i.test(body)) {
      return "Response body contains JWT with alg=none header.";
    }
    const auth = headers.get("authorization") || "";
    if (/"alg"\s*:\s*"none"/i.test(auth)) {
      return "Authorization header carries a JWT with alg=none.";
    }
    return null;
  },

  "api-jwt-hs256-weak-secret": (_url, _headers, body) => {
    if (/jwt\.sign\([^)]*['"][a-zA-Z0-9]{1,15}['"]/i.test(body)) {
      return "JWT signed with short or hardcoded HS256 secret.";
    }
    return null;
  },

  "api-jwt-missing-exp-claim": (_url, headers, body) => {
    const auth = headers.get("authorization") || "";
    const looksLikeJwt =
      /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/.test(auth) ||
      /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/.test(body);
    if (looksLikeJwt && !/"exp"\s*:\s*\d+/i.test(auth + body)) {
      return "JWT payload without exp claim - tokens live forever once stolen.";
    }
    return null;
  },

  // ── CORS ─────────────────────────────────────────────────────────────────
  // Note: cors-wildcard, cors-credentials-wildcard, cors-null-origin-allowed
  // are registered by headers.ts (bundle 0). Only API-specific CORS checks go here.

  "api-cors-preflight-cache-missing": (_url, headers, _body) => {
    const acao = headers.get("access-control-allow-origin");
    const acam = headers.get("access-control-allow-methods");
    // Only flag when this is a real preflight response (has Allow-Methods + no Max-Age)
    if (acao && acam && !headers.has("access-control-max-age")) {
      return "CORS preflight response has no Access-Control-Max-Age - browser re-preflights every request.";
    }
    return null;
  },

  "api-cors-preflight-cache-over-24h": (_url, headers, _body) => {
    const maxAge = parseInt(headers.get("access-control-max-age") || "", 10);
    if (Number.isFinite(maxAge) && maxAge > 86400) {
      return `Access-Control-Max-Age=${maxAge} pins browsers to stale allowlist (>24h).`;
    }
    return null;
  },

  // ── Bearer header ────────────────────────────────────────────────────────

  "api-bearer-header-leak": (url, _headers, _body) => {
    // Only check URL-based token leaks. Authorization in response headers is
    // not a security issue — that header belongs in the REQUEST, not the response.
    if (/[?&](?:token|access_token|bearer)=/i.test(url)) {
      return "Bearer token present in URL query string - leaks via logs and Referer.";
    }
    return null;
  },

  // ── JSONP / older API patterns ───────────────────────────────────────────

  "api-jsonp-callback": (url, _headers, body) => {
    if (/[?&](?:callback|cb|jsonp)\s*=/i.test(url)) {
      return "JSONP callback parameter accepted - XSS via content-type confusion.";
    }
    if (/^[\w$]+\s*\(/.test(body.trim()) && /\)\s*;?\s*$/.test(body.trim())) {
      return "Response wrapped as JSONP callback - prefer CORS-served JSON.";
    }
    return null;
  },

  // ── Rate limiting ────────────────────────────────────────────────────────

  "api-rate-limit-per-ip-no-auth": (url, headers, _body) => {
    if (
      (/\/api\//i.test(url) || /api\./i.test(url)) &&
      !headers.has("authorization") &&
      (headers.has("x-ratelimit-limit") || headers.has("x-forwarded-for"))
    ) {
      return "API rate-limit keyed only on client IP, no authentication required.";
    }
    return null;
  },

  "api-rate-limit-headers-not-enforced-on-paths": (url, headers, _body) => {
    if (
      (/\/api\//i.test(url) || /api\./i.test(url)) &&
      headers.has("x-ratelimit-limit") &&
      !headers.has("x-ratelimit-remaining")
    ) {
      return "X-RateLimit-Limit advertised without X-RateLimit-Remaining - cap not enforced.";
    }
    return null;
  },

  // ── SOAP ─────────────────────────────────────────────────────────────────

  "api-soap-soapaction-injection": (_url, headers, body) => {
    const soapAction = headers.get("soapaction") || "";
    if (/["'`;|&$()<>]/.test(soapAction)) {
      return "SOAPAction header contains metacharacters - SSRF risk on downstream call.";
    }
    if (/<(?:soap:)?envelope/i.test(body)) {
      return "SOAP envelope detected - ensure SOAPAction is allowlisted, not concatenated.";
    }
    return null;
  },

  "api-soap-xxe-enabled": (_url, _headers, body) => {
    if (/<!DOCTYPE[^>]*\[[\s\S]*?<!ENTITY[^>]*(?:SYSTEM|PUBLIC)/i.test(body)) {
      return "SOAP/XML payload contains DOCTYPE with external ENTITY - XXE enabled.";
    }
    if (/<(?:soap:)?envelope/i.test(body)) {
      return "SOAP envelope detected - disable DTD / external entity processing on parser.";
    }
    return null;
  },

  "api-soap-wsdl-publicly-accessible": (url, _headers, body) => {
    if (/\?wsdl\b|\?WSDL\b|\/wsdl\b/i.test(url)) {
      return "WSDL endpoint publicly accessible - full operation blueprint exposed.";
    }
    if (/<(?:definitions|wsdl:definitions)\b/i.test(body)) {
      return "WSDL document served - enumerates every operation and binding.";
    }
    return null;
  },

  // ── WebSocket ────────────────────────────────────────────────────────────

  "api-websocket-no-origin-validation": (url, _headers, body) => {
    if (!/\/ws\b|\/websocket\b|wss?:\/\//i.test(url)) return null;
    // Flag when there's no Sec-WebSocket-Protocol or upgrade-related headers
    // signaling the server enforces per-origin checks.
    if (!body.includes("origin") && !body.includes("Origin")) {
      return "WebSocket endpoint reachable - validate the Origin header in the HTTP upgrade handler.";
    }
    return null;
  },

  // ── REST semantics ───────────────────────────────────────────────────────

  "api-rest-mass-assignment-risk": (url, _headers, body) => {
    if (/"role"\s*:\s*"admin"|"isAdmin"\s*:\s*true/i.test(body)) {
      return "Response body contains elevated fields (role/isAdmin) - mass-assignment risk.";
    }
    return null;
  },
};
