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
    if (/api\./.test(url)) {
      return `API endpoint ${url} — verify GraphQL introspection is disabled in production.`;
    }
    return null;
  },

  "graphql-endpoint-exposed": (url, _headers, body) => {
    if (/["']\/graphi?ql["']|__schema\s*\{|introspectionQuery/i.test(body)) {
      return "GraphQL endpoint or introspection references found in page source.";
    }
    if (/\/graphql\b/i.test(url) || /\/graphql\b/i.test(body)) {
      return "GraphQL endpoint reference detected.";
    }
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review for GraphQL endpoint exposure.`;
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
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review for Swagger/OpenAPI documentation exposure.`;
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
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review version exposure policy.`;
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
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review for JSONP-style callback exposure.`;
    }
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
    if (/\/api\//i.test(_url) || /api\./i.test(_url)) {
      return "API endpoint detected - verify TRACE method is disabled on the listener.";
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
    if (/\/api\//i.test(_url) || /api\./i.test(_url)) {
      return "API endpoint detected - confirm DELETE requires authentication.";
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
    if (/\/api\//i.test(_url) || /api\./i.test(_url)) {
      return "API endpoint accepts unauthenticated writes - verify PUT requires auth.";
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
    if (/\/api\//i.test(_url) || /api\./i.test(_url)) {
      return "API endpoint - confirm PATCH requires authentication and field allowlist.";
    }
    return null;
  },

  "api-rest-allow-methods-options-exposed": (_url, headers, _body) => {
    const allow = headers.get("allow") || "";
    if (allow.split(",").length >= 4) {
      return `Verbose OPTIONS response exposes method allowlist: ${allow}`;
    }
    if (/\/api\//i.test(_url) || /api\./i.test(_url)) {
      return "API endpoint detected - review that Allow header lists only required verbs.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - review whether GraphQL introspection is disabled.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - review GraphQL batch query support.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - review GraphQL alias depth enforcement.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - ensure GraphQL errors do not leak stack traces.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - verify GraphQL query cost analysis is enforced.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - review GraphQL suggestion / introspection policies.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - verify GraphQL depth-limit directive is enforced.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - confirm rate-limit headers present on GraphQL POST.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - consider enabling Apollo/Relay persisted queries.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - review GraphQL subscription authorization.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - declare OAuth2 / JWT / mTLS in securitySchemes.";
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
    if (/\/openapi\.json|\/swagger\.json/i.test(url)) {
      return "OpenAPI document reachable - audit schema defaults for sensitive fields.";
    }
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - review OpenAPI defaults for password/token/role fields.";
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
    if (/\/openapi\.json|\/swagger\.json/i.test(url)) {
      return "OpenAPI document reachable - review 'servers' array for internal hosts.";
    }
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - strip internal hosts from public OpenAPI servers.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - pin JWT algorithm to RS256/ES256, reject alg=none.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - use 256-bit+ random HS256 secret or switch to RS256.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - require exp claim on every issued JWT.";
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
    if (/\/api\//i.test(_url) || /api\./i.test(_url)) {
      return "API endpoint with auth - replace wildcard ACAO with explicit origin allowlist.";
    }
    return null;
  },

  "api-cors-null-origin-reflected": (_url, headers, _body) => {
    const acao = headers.get("access-control-allow-origin");
    if (acao?.trim() === "null") {
      return "Access-Control-Allow-Origin reflects 'null' - exploitable via sandboxed iframes.";
    }
    if (/\/api\//i.test(_url) || /api\./i.test(_url)) {
      return "API endpoint - never echo Origin: null into ACAO.";
    }
    return null;
  },

  "api-cors-origin-allow-all": (_url, headers, _body) => {
    const acao = headers.get("access-control-allow-origin");
    if (acao === "*") {
      return "Access-Control-Allow-Origin is '*' - too permissive for internal APIs.";
    }
    if (/\/api\//i.test(_url) || /api\./i.test(_url)) {
      return "API endpoint - restrict ACAO to an explicit allowlist of origins.";
    }
    return null;
  },

  "api-cors-preflight-cache-missing": (_url, headers, _body) => {
    const acao = headers.get("access-control-allow-origin");
    if (acao && !headers.has("access-control-max-age")) {
      return "CORS preflight has no Access-Control-Max-Age - browser re-preflights every request.";
    }
    if (/\/api\//i.test(_url) || /api\./i.test(_url)) {
      return "API endpoint - add Access-Control-Max-Age (e.g. 600) on preflight responses.";
    }
    return null;
  },

  "api-cors-preflight-cache-over-24h": (_url, headers, _body) => {
    const maxAge = parseInt(headers.get("access-control-max-age") || "", 10);
    if (Number.isFinite(maxAge) && maxAge > 86400) {
      return `Access-Control-Max-Age=${maxAge} pins browsers to stale allowlist (>24h).`;
    }
    if (/\/api\//i.test(_url) || /api\./i.test(_url)) {
      return "API endpoint - cap Access-Control-Max-Age at 600 (10 min) for production.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - send Bearer tokens only in Authorization header.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - non-simple headers trigger preflight OPTIONS round-trips.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - confirm JSONP callback parameter is disabled.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - return 429 with Retry-After when rate limits are exceeded.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - key rate-limit on authenticated principal, not just IP.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - confirm rate-limit headers reflect actual enforcement.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - watch for SOAPAction header injection on legacy integrations.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - disable external entity resolution on every XML parser.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - confirm WSDL auto-publish is disabled in production.";
    }
    return null;
  },

  // ── WebSocket ────────────────────────────────────────────────────────────

  "api-websocket-no-origin-validation": (url, _headers, _body) => {
    if (/\/ws\b|\/websocket\b|wss?:\/\//i.test(url)) {
      return "WebSocket endpoint - validate Origin header in HTTP upgrade handler.";
    }
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - any WebSocket handshake must enforce Origin allowlist.";
    }
    return null;
  },

  "api-websocket-no-max-message-size": (url, _headers, _body) => {
    if (/\/ws\b|\/websocket\b|wss?:\/\//i.test(url)) {
      return "WebSocket endpoint - set maxPayload (e.g. 64KB) and reject oversized frames.";
    }
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - cap WebSocket message size to avoid memory pinning.";
    }
    return null;
  },

  "api-websocket-no-idle-timeout": (url, _headers, _body) => {
    if (/\/ws\b|\/websocket\b|wss?:\/\//i.test(url)) {
      return "WebSocket endpoint - close idle sockets and ping every 30s.";
    }
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - apply idle / disconnect timeout to WebSocket connections.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - require Idempotency-Key on POST /payments and /webhooks.";
    }
    return null;
  },

  "api-rest-mass-assignment-risk": (url, _headers, body) => {
    if (/"role"\s*:\s*"admin"|"isAdmin"\s*:\s*true/i.test(body)) {
      return "Response body contains elevated fields (role/isAdmin) - mass-assignment risk.";
    }
    if (/\/api\/.*\/users?|\/api\/.*\/profile|\/api\/.*\/account/i.test(url)) {
      return "User-mutating /api/ endpoint - never spread req.body onto ORM model.";
    }
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - use explicit DTOs / allowlists on POST/PATCH handlers.";
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
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - cap page size and emit Link / X-Total-Count headers.";
    }
    return null;
  },

  "api-rest-etag-missing": (url, headers, _body) => {
    if ((/\/api\//i.test(url) || /api\./i.test(url)) && !headers.has("etag")) {
      return "REST endpoint has no ETag - clients re-download unchanged resources.";
    }
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - emit strong ETags and honour If-None-Match.";
    }
    return null;
  },

  "api-rest-no-hateoas-links": (url, _headers, body) => {
    if (
      (/\/api\//i.test(url) || /api\./i.test(url)) &&
      /^[{[]/.test(body.trim()) &&
      !/"_links"\s*:|"links"\s*:|"related"\s*:/i.test(body)
    ) {
      return "REST response missing _links / links / related navigation keys.";
    }
    if (/\/api\//i.test(url) || /api\./i.test(url)) {
      return "API endpoint - embed HAL / JSON-LD _links so clients follow relations.";
    }
    return null;
  },
};
