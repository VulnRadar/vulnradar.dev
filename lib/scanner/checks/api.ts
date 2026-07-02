/**
 * API-surface detectors.
 *
 * Detectors that look for REST/GraphQL/OpenAPI endpoints, HTTP method
 * allowlists, rate-limit headers, JSONP, and similar API-shape issues.
 */

import { hasHeader, type EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  "graphql-introspection": (url, _headers, body) => {
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
    if (found.length > 0)
      return `GraphQL introspection indicators: ${found.join(", ")}`;
    return null;
  },

  "graphql-endpoint-exposed": (url, _headers, body) => {
    if (/["']\/graphi?ql["']|__schema\s*\{|introspectionQuery/i.test(body)) {
      return "GraphQL endpoint or introspection references found in page source.";
    }
    if (/\/graphql\b/i.test(url) || /\/graphql\b/i.test(body)) {
      return "GraphQL endpoint reference detected.";
    }
    return null;
  },

  "swagger-docs-exposed": (url, _headers, body) => {
    if (/swagger-ui|\/api-docs|openapi\.json|\/swagger\.json/i.test(body)) {
      return "Swagger/OpenAPI documentation endpoints referenced in page source.";
    }
    const swaggerPatterns = [
      /\/swagger(?:\.json|\.yaml|\/ui)?/i,
      /\/openapi(?:\.json|\.yaml)?/i,
      /api-docs|redoc/i,
    ];
    for (const p of swaggerPatterns) {
      if (p.test(url) || p.test(body))
        return "API documentation endpoint reference detected (Swagger/OpenAPI).";
    }
    return null;
  },

  "rate-limiting": (_url, headers) => {
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

  "email-enumeration": (_url, _headers, body) => {
    if (/email.*(?:already exists|not found|is taken|invalid)/gi.test(body)) {
      return "Error message reveals email existence - user enumeration risk.";
    }
    return null;
  },

  "api-version-exposed": (url, _headers, body) => {
    if (
      /["']\/api\/v[0-9]+/gi.test(body) &&
      /["']\/api\/v[0-9]+.*["']\/api\/v[0-9]+/gi.test(body)
    ) {
      return "Multiple API versions exposed - older versions may have vulnerabilities.";
    }
    const re = /\/api\/v(\d+)(?:\.\d+)?\//gi;
    const matches = body.match(re) || [];
    if (matches.length > 0) {
      const versions = new Set(matches.map((m) => m));
      if (versions.size > 1)
        return `Multiple API versions exposed: ${[...versions].slice(0, 3).join(", ")}.`;
    }
    return null;
  },

  "exposed-api-version": (_url, headers, body) => {
    const exposed: string[] = [];
    for (const hdr of ["x-api-version", "x-app-version", "x-build-id"]) {
      const val = headers.get(hdr);
      if (val) exposed.push(`${hdr}: ${val}`);
    }
    const bodyVersions =
      body.match(
        /(?:api[_-]?version|build[_-]?id)\s*[:=]\s*["'][\d.]+["']/gi,
      ) || [];
    if (bodyVersions.length > 0) exposed.push(...bodyVersions.slice(0, 2));
    return exposed.length > 0
      ? `Exposed version info: ${exposed.join("; ")}`
      : null;
  },

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

  "cors-wildcard": (_url, headers) => {
    const acao = headers.get("access-control-allow-origin");
    return acao === "*" ? "Access-Control-Allow-Origin is set to '*'." : null;
  },

  "cors-credentials-wildcard": (_url, headers) => {
    const acao = headers.get("access-control-allow-origin");
    const acac = headers.get("access-control-allow-credentials");
    if (acao === "*" && acac?.toLowerCase() === "true") {
      return "Access-Control-Allow-Origin: * combined with Access-Control-Allow-Credentials: true";
    }
    return null;
  },

  // ── JSONP / older API patterns ───────────────────────────────────────────

  "jsonp-endpoint": (url, _headers, body) => {
    if (/["']\?(?:callback|cb|jsonp)\s*=/i.test(body)) {
      return "JSONP-style callback parameters detected - older API risk.";
    }
    if (/[?&](?:callback|jsonp)\s*=/i.test(url))
      return "JSONP callback parameter present in URL.";
    if (/[?&](?:callback|jsonp)\s*=/i.test(body))
      return "JSONP callback parameter reference detected in body.";
    return null;
  },

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
    if (
      /\/admin\/|\/administrator\/|\/management\/|\/dashboard\//gi.test(body)
    ) {
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

  "api-rest-allow-methods-delete": (_url, headers, body) => {
    const allow = headers.get("allow") || "";
    if (/DELETE/i.test(allow) && !headers.has("authorization")) {
      return "DELETE method exposed without authentication.";
    }
    if (/method\s*[:=]\s*["'][^"']*DELETE/i.test(body)) {
      return "DELETE method advertised in response body.";
    }
    return null;
  },

  "api-rest-allow-methods-put-no-auth": (_url, headers, _body) => {
    if (
      /PUT/i.test(headers.get("allow") || "") &&
      !headers.has("authorization") &&
      (/\/api\//i.test(_url) || /api\./i.test(_url))
    ) {
      return "PUT method exposed on /api/ endpoint without authentication.";
    }
    return null;
  },

  "api-rest-allow-methods-patch-no-auth": (_url, headers, _body) => {
    if (
      /PATCH/i.test(headers.get("allow") || "") &&
      !headers.has("authorization") &&
      (/\/api\//i.test(_url) || /api\./i.test(_url))
    ) {
      return "PATCH method exposed on /api/ endpoint without authentication.";
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
    if (/\/graphql/i.test(url)) {
      return "GraphQL endpoint reachable - verify introspection is disabled in production.";
    }
    return null;
  },

  "api-graphql-batch-queries": (url, _headers, body) => {
    if (/\[.*{[\s\S]*?(?:query|mutation)[\s\S]*?}\s*[,;][\s\S]*?{/.test(body)) {
      return "GraphQL batch (array) query pattern detected in response body.";
    }
    if (/\/graphql/i.test(url)) {
      return "GraphQL endpoint reachable - verify batch queries are disabled.";
    }
    return null;
  },

  "api-graphql-no-alias-depth-limit": (url, _headers, body) => {
    const aliases =
      body.match(/\b\w+\s*:\s*(?:user|users|node|nodes|item|items)\b/g) || [];
    if (aliases.length >= 3) {
      return `${aliases.length} GraphQL aliases detected - verify alias-aware cost analysis.`;
    }
    if (/\/graphql/i.test(url)) {
      return "GraphQL endpoint reachable - confirm alias-aware query cost limits.";
    }
    return null;
  },

  "api-graphql-error-stack-trace": (url, _headers, body) => {
    if (
      /"stacktrace"\s*:\s*"/i.test(body) ||
      /"extensions"\s*:\s*{[^}]*"stacktrace"/i.test(body)
    ) {
      return "GraphQL error.extensions.stacktrace leaked in response.";
    }
    if (/\/graphql/i.test(url)) {
      return "GraphQL endpoint reachable - mask stacktraces in error responses.";
    }
    return null;
  },

  "api-graphql-query-cost-not-enforced": (url, _headers, body) => {
    if (
      /@cost\s*\(\s*weight/i.test(body) ||
      /queryComplexity|graphqlQueryComplexity/i.test(body)
    ) {
      return null;
    }
    if (/\/graphql/i.test(url)) {
      return "GraphQL endpoint reachable - no @cost directive or graphql-query-complexity found.";
    }
    return null;
  },

  "api-graphql-suggestions-enabled": (url, _headers, body) => {
    if (/["']did you mean["']|["']didYouMean["']\s*:/i.test(body)) {
      return "GraphQL field suggestion ('did you mean') enabled - schema enumeration aid.";
    }
    if (/\/graphql/i.test(url)) {
      return "GraphQL endpoint reachable - confirm field suggestions are disabled.";
    }
    return null;
  },

  "api-graphql-no-depth-limit": (url, _headers, body) => {
    const depth = (body.match(/\{\s*[\w]+\s*\{/g) || []).length;
    if (depth > 15) {
      return `GraphQL query depth appears to be ${depth} - exceeds safe depth limit.`;
    }
    if (/\/graphql/i.test(url)) {
      return "GraphQL endpoint reachable - confirm depth-limit middleware is enabled.";
    }
    return null;
  },

  "api-graphql-no-rate-limit": (url, headers, _body) => {
    const hasRate = [
      "x-ratelimit-limit",
      "x-rate-limit-limit",
      "ratelimit-limit",
      "retry-after",
    ].some((h) => headers.has(h));
    if (/\/graphql/i.test(url) && !hasRate) {
      return "GraphQL endpoint has no rate-limit headers - cost-based limits recommended.";
    }
    if (/\/graphql/i.test(url)) {
      return "GraphQL endpoint reachable - verify rate-limit by query cost, not request count.";
    }
    return null;
  },

  "api-graphql-persisted-queries": (url, _headers, body) => {
    if (/persistedQuery|AutomaticPersistedQueries|APQ/i.test(body)) {
      return null;
    }
    if (/\/graphql/i.test(url)) {
      return "GraphQL endpoint reachable - no persisted-query (APQ) support detected.";
    }
    return null;
  },

  "api-graphql-subscription-auth-missing": (url, _headers, _body) => {
    if (/\/graphql/i.test(url) && !url.includes("subscription")) {
      return "GraphQL endpoint reachable - subscriptions must authorize at the source stream.";
    }
    if (/\/graphql/i.test(url) || /subscription/i.test(url)) {
      return "GraphQL subscription endpoint - verify per-event authorization checks.";
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
    if (
      /\/openapi\.json|\/swagger\.json|\/api-docs/i.test(url) ||
      /openapi|swagger/i.test(body)
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

  "api-jwt-alg-none": (url, headers, body) => {
    if (/"alg"\s*:\s*"none"/i.test(body)) {
      return "Response body contains JWT with alg=none header.";
    }
    const auth = headers.get("authorization") || "";
    if (/"alg"\s*:\s*"none"/i.test(auth)) {
      return "Authorization header carries a JWT with alg=none.";
    }
    if (/\/auth|\/login|\/token/i.test(url)) {
      return "Auth endpoint reachable - ensure JWT verifier rejects alg=none.";
    }
    return null;
  },

  "api-jwt-hs256-weak-secret": (url, _headers, body) => {
    if (/jwt\.sign\([^)]*['"][a-zA-Z0-9]{1,15}['"]/i.test(body)) {
      return "JWT signed with short or hardcoded HS256 secret.";
    }
    if (/\/auth|\/login/i.test(url)) {
      return "Auth endpoint reachable - HS256 secret should be 256-bit random from KMS.";
    }
    return null;
  },

  "api-jwt-missing-exp-claim": (url, headers, body) => {
    const auth = headers.get("authorization") || "";
    const looksLikeJwt =
      /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/.test(auth) ||
      /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/.test(body);
    if (looksLikeJwt && !/"exp"\s*:\s*\d+/i.test(auth + body)) {
      return "JWT payload without exp claim - tokens live forever once stolen.";
    }
    if (/\/auth|\/login|\/token/i.test(url)) {
      return "Auth endpoint reachable - confirm JWT always carries exp claim.";
    }
    return null;
  },

  // ── CORS ─────────────────────────────────────────────────────────────────

  "api-cors-credentials-with-wildcard-origin": (_url, headers, _body) => {
    const acao = headers.get("access-control-allow-origin");
    const acac = headers.get("access-control-allow-credentials");
    if (acao === "*" && acac?.toLowerCase() === "true") {
      return "Critical: ACAO=* with ACAC=true - any site can issue authenticated requests.";
    }
    return null;
  },

  "api-cors-null-origin-reflected": (_url, headers, _body) => {
    const acao = headers.get("access-control-allow-origin");
    if (acao?.trim() === "null") {
      return "Access-Control-Allow-Origin reflects 'null' - exploitable via sandboxed iframes.";
    }
    return null;
  },

  "api-cors-origin-allow-all": (_url, headers, _body) => {
    const acao = headers.get("access-control-allow-origin");
    if (acao === "*") {
      return "Access-Control-Allow-Origin is '*' - too permissive for internal APIs.";
    }
    return null;
  },

  "api-cors-preflight-cache-missing": (_url, headers, _body) => {
    const acao = headers.get("access-control-allow-origin");
    if (acao && !headers.has("access-control-max-age")) {
      return "CORS preflight has no Access-Control-Max-Age - browser re-preflights every request.";
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

  "api-bearer-header-leak": (url, headers, _body) => {
    if (headers.has("authorization")) {
      return "Authorization header reflected in response - Bearer tokens must not be echoed.";
    }
    if (/[?&](?:token|access_token|bearer)=/i.test(url)) {
      return "Bearer token present in URL query string - leaks via logs and Referer.";
    }
    return null;
  },

  "api-no-cors-preflight-required": (url, headers, _body) => {
    const auth = headers.get("authorization") || "";
    if (
      (/\/api\//i.test(url) || /api\./i.test(url)) &&
      /^Bearer\s/i.test(auth) &&
      !headers.has("access-control-allow-headers")
    ) {
      return "API endpoint requires CORS preflight (Bearer is not a simple request header).";
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

  "api-rate-limit-not-429": (url, headers, _body) => {
    const rate =
      headers.get("retry-after") || headers.get("x-ratelimit-remaining") || "";
    if (rate && headers.get("status") === "200") {
      return "Rate-limit headers present with HTTP 200 - blocked requests should return 429.";
    }
    return null;
  },

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

  "api-soap-soapaction-injection": (url, headers, body) => {
    const soapAction = headers.get("soapaction") || "";
    if (/["'`;|&$()<>]/.test(soapAction)) {
      return "SOAPAction header contains metacharacters - SSRF risk on downstream call.";
    }
    if (/<(?:soap:)?envelope/i.test(body)) {
      return "SOAP envelope detected - ensure SOAPAction is allowlisted, not concatenated.";
    }
    if (/\/soap|\.svc|\/ws/i.test(url)) {
      return "SOAP-style endpoint - validate SOAPAction against a strict allowlist.";
    }
    return null;
  },

  "api-soap-xxe-enabled": (url, _headers, body) => {
    if (/<!DOCTYPE[^>]*\[[\s\S]*?<!ENTITY[^>]*(?:SYSTEM|PUBLIC)/i.test(body)) {
      return "SOAP/XML payload contains DOCTYPE with external ENTITY - XXE enabled.";
    }
    if (/<(?:soap:)?envelope/i.test(body)) {
      return "SOAP envelope detected - disable DTD / external entity processing on parser.";
    }
    if (/\/soap|\.svc|\/ws/i.test(url)) {
      return "SOAP endpoint - harden XML factory to reject DTD and external entities.";
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
    if (/\/soap|\.svc/i.test(url)) {
      return "SOAP endpoint reachable - restrict ?wsdl behind authentication.";
    }
    return null;
  },

  // ── WebSocket ────────────────────────────────────────────────────────────

  "api-websocket-no-origin-validation": (url, _headers, _body) => {
    if (/\/ws\b|\/websocket\b|wss?:\/\//i.test(url)) {
      return "WebSocket endpoint - validate Origin header in HTTP upgrade handler.";
    }
    return null;
  },

  "api-websocket-no-max-message-size": (url, _headers, _body) => {
    if (/\/ws\b|\/websocket\b|wss?:\/\//i.test(url)) {
      return "WebSocket endpoint - set maxPayload (e.g. 64KB) and reject oversized frames.";
    }
    return null;
  },

  "api-websocket-no-idle-timeout": (url, _headers, _body) => {
    if (/\/ws\b|\/websocket\b|wss?:\/\//i.test(url)) {
      return "WebSocket endpoint - close idle sockets and ping every 30s.";
    }
    return null;
  },

  // ── REST semantics ───────────────────────────────────────────────────────

  "api-rest-no-idempotency-key": (url, headers, _body) => {
    if (
      (/\/api\//i.test(url) || /api\./i.test(url)) &&
      !headers.has("idempotency-key")
    ) {
      return "POST /api/ endpoint accepts no Idempotency-Key - retries can double-charge.";
    }
    return null;
  },

  "api-rest-mass-assignment-risk": (url, _headers, body) => {
    if (/"role"\s*:\s*"admin"|"isAdmin"\s*:\s*true/i.test(body)) {
      return "Response body contains elevated fields (role/isAdmin) - mass-assignment risk.";
    }
    return null;
  },

  "api-rest-pagination-headers-missing": (url, headers, _body) => {
    if (
      (/\/api\//i.test(url) || /api\./i.test(url)) &&
      !headers.has("x-total-count") &&
      !headers.has("link")
    ) {
      return "REST list endpoint missing X-Total-Count / Link pagination headers.";
    }
    return null;
  },

  "api-rest-etag-missing": (url, headers, _body) => {
    const isApiUrl = /\/api\//i.test(url) || /\bapi\./i.test(url);
    if (!isApiUrl) return null;
    if (headers.has("etag") || headers.has("last-modified")) return null;
    return "REST resource endpoint has no ETag or Last-Modified — clients cannot use conditional requests for cache validation.";
  },

  "api-rest-no-hateoas-links": (url, _headers, body) => {
    if (
      (/\/api\//i.test(url) || /api\./i.test(url)) &&
      /^[{[]/.test(body.trim()) &&
      !/"_links"\s*:|"links"\s*:|"related"\s*:/i.test(body)
    ) {
      return "REST response missing _links / links / related navigation keys.";
    }
    return null;
  },
};
