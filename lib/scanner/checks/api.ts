/**
 * API-surface detectors.
 *
 * Detectors that look for REST/GraphQL/OpenAPI endpoints, HTTP method
 * allowlists, rate-limit headers, JSONP, and similar API-shape issues.
 */

import {
  hasHeader,
  stripDocBlocks,
  type EvidenceFn as DetectFn,
} from "../_helpers";

const rawDetectors: Record<string, DetectFn> = {
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
    // Removed: an unscoped `["']__schema["']\s*\{` branch that fired on ANY
    // page/response, not just /graphql ones. __schema{ is text every GraphQL
    // client library (Apollo, Relay, graphql-request) bundles for its own
    // fragment matching/codegen, present regardless of whether the server's
    // introspection is actually enabled -- the same false-positive class
    // already fixed for content.json's graphql-introspection check. Requiring
    // the /graphql path keeps this to endpoint-level evidence.
    if (
      /\/graphql/i.test(url) &&
      /__schema|__type|introspectionQuery/i.test(body)
    ) {
      return "GraphQL introspection query reference found on /graphql endpoint - confirm the server actually resolves it before treating this as enabled.";
    }
    return null;
  },

  "api-graphql-batch-queries": (url, _headers, body) => {
    // Unlike every other api-graphql-* check in this file, this one had no
    // gate requiring the response to actually be GraphQL-shaped. An array
    // of JSON objects that each happen to contain a "query" or "mutation"
    // key is common outside GraphQL entirely (router state, search/filter
    // state, analytics event queues serialized into a framework's hydration
    // data), so on an ordinary HTML page this fires on unrelated JSON, not
    // actual GraphQL batch syntax. Same looksLikeGraphQL gate as the
    // sibling api-graphql-suggestions-enabled check below.
    const looksLikeGraphQL =
      /\/graphql/i.test(url) || /"errors"\s*:\s*\[/.test(body);
    if (!looksLikeGraphQL) return null;
    if (/\[.*\{[\s\S]*?(?:"query"|"mutation")[\s\S]*?\}\s*,\s*\{/.test(body)) {
      return "GraphQL batch (array) query pattern detected in response body.";
    }
    return null;
  },

  "api-graphql-error-stack-trace": (url, _headers, body) => {
    // A bare "stacktrace" key can appear in any non-GraphQL API's error JSON
    // (a real leak, but a different check's concern) -- claiming it's
    // specifically "GraphQL error.extensions.stacktrace" needs actual
    // GraphQL context: the endpoint is /graphql, or the value sits inside a
    // GraphQL error's "extensions" object as the spec defines.
    if (!/\/graphql/i.test(url) && !/"extensions"\s*:\s*\{/i.test(body)) {
      return null;
    }
    if (
      /"stacktrace"\s*:\s*"/i.test(body) ||
      /"extensions"\s*:\s*\{[^}]*"stacktrace"/i.test(body)
    ) {
      return "GraphQL error.extensions.stacktrace leaked in response.";
    }
    return null;
  },

  "api-graphql-suggestions-enabled": (url, _headers, body) => {
    // "Did you mean" alone is an extremely common phrase in ordinary search
    // UIs (e-commerce, docs search) with nothing to do with GraphQL. Require
    // it to look like it came from an actual GraphQL response: either the
    // endpoint is /graphql, or the body carries a GraphQL error envelope, AND
    // the phrase is followed by the quoted-field-name shape graphql-js's own
    // suggestion messages always use ('Did you mean "fieldName"?'), which
    // generic UI copy doesn't happen to replicate.
    const looksLikeGraphQL =
      /\/graphql/i.test(url) || /"errors"\s*:\s*\[/.test(body);
    if (!looksLikeGraphQL) return null;
    if (
      /did you mean\s+"[^"]+"/i.test(body) ||
      /["']didYouMean["']\s*:/i.test(body)
    ) {
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
    // Removed the `|| headers.has("x-forwarded-for")` branch: that header
    // (when a response even carries it, which is unusual) says something
    // about request forwarding, not about how the endpoint keys its rate
    // limit -- it was an unrelated signal being read as confirming this
    // specific claim. Also worded the evidence as a probe result rather than
    // a confirmed absence of auth: the scanner itself never sends
    // credentials, so "no Authorization header on this request" doesn't
    // show the endpoint has no auth requirement -- a protected endpoint
    // returning 401 with rate-limit headers attached would look identical.
    if (
      (/\/api\//i.test(url) || /api\./i.test(url)) &&
      !headers.has("authorization") &&
      headers.has("x-ratelimit-limit")
    ) {
      return "API responded to an unauthenticated request with rate-limit headers present - verify the endpoint actually requires authentication and that limits are keyed on more than client IP.";
    }
    return null;
  },

  "api-rate-limit-headers-not-enforced-on-paths": (url, headers, _body) => {
    if (
      (/\/api\//i.test(url) || /api\./i.test(url)) &&
      headers.has("x-ratelimit-limit") &&
      !headers.has("x-ratelimit-remaining")
    ) {
      // A single response missing X-RateLimit-Remaining doesn't prove the
      // limit isn't enforced elsewhere (a server may only emit -Remaining
      // once a caller is close to the cap, or enforce via a mechanism this
      // scan didn't probe) -- worded as a gap to verify, not a confirmed fact.
      return "X-RateLimit-Limit advertised without X-RateLimit-Remaining on this response - verify the limit is actually enforced rather than only advertised.";
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
    // This only ever observes a RESPONSE containing role/isAdmin fields --
    // e.g. a normal /api/me returning the current (legitimately admin) user's
    // own role -- which proves nothing about whether the endpoint accepts
    // those same fields as unvalidated INPUT (what mass assignment actually
    // is). Evidence is worded as an observation to verify, not a confirmed
    // vulnerability, since the response body alone cannot show that.
    if (/"role"\s*:\s*"admin"|"isAdmin"\s*:\s*true/i.test(body)) {
      return "Response body exposes privileged fields (role/isAdmin) - verify the same field names are not writable by unauthenticated or under-privileged requests.";
    }
    return null;
  },
};

// None of the body-regex detectors above are scoped to actual API response
// content (JSON payloads have no <pre>/<code> tags to begin with, so this is
// a no-op there) -- but several also match plain HTML pages (soap-endpoint,
// xml-rpc, api-jwt-hs256-weak-secret's `jwt.sign(...)` pattern), where a
// tutorial or API-docs page rendering an example payload as literal text in
// a <pre>/<code> block would otherwise self-trigger them, matching the same
// false-positive class already fixed for vibe-code.ts.
export const detectors: Record<string, DetectFn> = Object.fromEntries(
  Object.entries(rawDetectors).map(([id, fn]) => [
    id,
    ((url, headers, body) =>
      fn(url, headers, stripDocBlocks(body))) as DetectFn,
  ]),
);
