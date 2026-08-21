/**
 * API-surface detectors.
 *
 * Detectors that look for REST/GraphQL/OpenAPI endpoints, HTTP method
 * allowlists, rate-limit headers, JSONP, and similar API-shape issues.
 */

import {
  getSetCookies,
  hasHeader,
  stripDocBlocks,
  type EvidenceFn as DetectFn,
} from "../_helpers";

// ── JWT jku/x5u header decoding ─────────────────────────────────────────────
// Header-only decode (no signature check, no network fetch) so this stays a
// passive, self-contained detector like the rest of this file.

const JWT_TOKEN_PATTERN =
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/g;

function decodeJwtHeaderClaims(token: string): Record<string, unknown> | null {
  const segment = token.split(".")[0];
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8"),
    );
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function findJwtCandidates(body: string, headers: Headers, max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  JWT_TOKEN_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JWT_TOKEN_PATTERN.exec(body)) !== null && out.length < max) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      out.push(m[0]);
    }
  }
  for (const cookie of getSetCookies(headers)) {
    JWT_TOKEN_PATTERN.lastIndex = 0;
    const cm = JWT_TOKEN_PATTERN.exec(cookie);
    if (cm && !seen.has(cm[0]) && out.length < max) {
      seen.add(cm[0]);
      out.push(cm[0]);
    }
  }
  return out;
}

// ── OAuth authorize-endpoint URL shape ──────────────────────────────────────

function isOAuthAuthorizeEndpoint(pathname: string): boolean {
  return (
    /\/authorize(?:\/|$)/i.test(pathname) ||
    /\/(?:oauth2?|connect)\/.*\/auth(?:orize)?(?:\/|$)/i.test(pathname) ||
    /openid-connect\/auth(?:\/|$)/i.test(pathname)
  );
}

// ── Verbose API error: stack trace / internal file path ────────────────────

const STACK_FRAME_PATTERN =
  /\bat\s+[\w.$<>[\] ]*\(?(?:[a-zA-Z]:\\|\/)[^\s"')]+:\d+:\d+\)?/;
const INTERNAL_PATH_PATTERN =
  /(?:\/(?:usr|home|opt|etc)\/|\/var\/(?:www|task|lib)\/|\/node_modules\/|site-packages[/\\]|[A-Za-z]:\\(?:Users|inetpub|Windows|Program Files)\\)[^\s"'<>]{2,}?\.[A-Za-z]{1,4}(?::\d+)?/i;
const DOC_CONTEXT_PATTERN = /```|<code|<pre|\bexample\b|\bdocumentation\b/i;

function precededByDocContext(body: string, matchIndex: number): boolean {
  const before = body.slice(Math.max(0, matchIndex - 200), matchIndex);
  return DOC_CONTEXT_PATTERN.test(before);
}

// ── GraphQL introspection: top-level field names only ──────────────────────
// Regex alone can't tell a field's own "name" from the "name" on its nested
// args/type objects (every __Type ref also carries a name). Track bracket
// depth so only object boundaries at the array's top level count.

function extractTopLevelFieldNames(fieldsArrayInner: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let i = 0;
  const len = fieldsArrayInner.length;
  while (i < len) {
    const ch = fieldsArrayInner[i];
    if (ch === '"') {
      i++;
      while (i < len && fieldsArrayInner[i] !== '"') {
        if (fieldsArrayInner[i] === "\\") i++;
        i++;
      }
    } else if (ch === "{" || ch === "[") {
      if (ch === "{" && depth === 0) {
        const m = /^\{\s*"name"\s*:\s*"([^"]*)"/.exec(
          fieldsArrayInner.slice(i),
        );
        if (m) names.push(m[1]);
      }
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
    }
    i++;
  }
  return names;
}

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
    // The URL-shape match above is satisfied by plenty of static HTML docs
    // pages too (e.g. an API-reference page served at /api/authentication) --
    // those legitimately carry no rate-limit headers, so without a
    // Content-Type check every such docs page misreports as an unprotected
    // API endpoint.
    const contentType = headers.get("content-type") || "";
    if (/text\/html/i.test(contentType)) return null;
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
    // WordPress emits <link rel="pingback" href=".../xmlrpc.php"> in every
    // page's <head> by default, whether or not the endpoint is actually
    // reachable or has been hardened — strip that tag so this doesn't fire
    // on virtually every WordPress site regardless of its security posture.
    const withoutPingback = body.replace(
      /<link[^>]+rel=["']pingback["'][^>]*>/gi,
      "",
    );
    const xmlRpcPattern = /xmlrpc|\/RPC2\b/i;
    const match = xmlRpcPattern.exec(withoutPingback);
    if (match) {
      const idx = withoutPingback.indexOf(match[0]);
      const before = withoutPingback
        .slice(Math.max(0, idx - 200), idx)
        .toLowerCase();
      if (/<code|<pre|```|example|documentation/i.test(before)) return null;
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

  "api-rest-allow-methods-trace": (_url, _headers, body) => {
    // The Allow-header branch was a duplicate of trace-method-enabled below
    // (same headers.get("allow") test), so one server response stacked two
    // findings for the identical signal. That branch is now covered solely
    // by trace-method-enabled; this check keeps only its distinct signal.
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
    // The alternation used to be ungrouped, so `"apiKey":{...."in":"query"`
    // matched anywhere in the document regardless of securitySchemes, and
    // the "basic" branch's unbounded [\s\S]*? could reach past the
    // securitySchemes object into unrelated later content. Extract the
    // securitySchemes object first (one level of nested braces, matching
    // how scheme entries are actually shaped) and test both conditions only
    // within it.
    const schemesBlock =
      /"securitySchemes"\s*:\s*\{((?:[^{}]|\{[^{}]*\})*)\}/i.exec(body)?.[1];
    if (
      schemesBlock &&
      (/"basic"/i.test(schemesBlock) ||
        /"apiKey"\s*:\s*\{[^}]*"in"\s*:\s*"query"/i.test(schemesBlock))
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
    // Unlike the sibling OpenAPI checks above, this had no requirement that
    // the response actually be an OpenAPI/Swagger document, so it matched
    // the same generic JSON-Schema shape (a "role"/"default" field pair)
    // used by plenty of non-OpenAPI form-schema payloads (Strapi, Directus,
    // react-jsonschema-form). Gate it the same way api-openapi-security-
    // scheme-weak already is: an OpenAPI-shaped URL, or an explicit
    // "openapi"/"swagger" version marker in the body.
    const looksLikeOpenApiDoc =
      /\/openapi(?:\.json|\.yaml)?|\/swagger(?:\.json|\.yaml)?|\/api-docs/i.test(
        url,
      ) || /"(?:openapi|swagger)"\s*:\s*"/i.test(body);
    if (!looksLikeOpenApiDoc) return null;
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

  "api-jwt-alg-none": (_url, _headers, _body) => {
    // Retired: this was a raw substring search for `"alg":"none"` in the
    // page body (matching a blog post that merely discusses the
    // vulnerability) plus a dead check of headers.get("authorization") on
    // the RESPONSE, which is a request-only header (see the same reasoning
    // on api-bearer-header-leak below). Superseded by page-jwt-alg-none
    // (checks/page-checks/jwt.ts), which finds a real JWT-shaped token and
    // base64url-decodes its header instead of grepping for literal text.
    return null;
  },

  "api-jwt-hs256-weak-secret": (_url, _headers, body) => {
    // The greedy [^)]*  used to backtrack to the LAST short quoted string
    // before the call's closing paren, which is typically an option value
    // (expiresIn: '1h') rather than the secret argument — so the secure
    // pattern this same check's own JSON recommends (env-var secret,
    // explicit algorithm/expiry options) matched as "weak secret". Anchor
    // on the secret's actual position: the second argument to jwt.sign().
    if (
      /jwt\.sign\(\s*(?:\{[^{}]*\}|[^,{}]+)\s*,\s*['"][a-zA-Z0-9]{1,15}['"]/i.test(
        body,
      )
    ) {
      return "JWT signed with short or hardcoded HS256 secret.";
    }
    return null;
  },

  "api-jwt-missing-exp-claim": (_url, _headers, _body) => {
    // Retired: this checked for the literal text `"exp":` in the still
    // base64url-ENCODED body/header — a JWT payload's real exp claim is
    // never visible as that literal text, so this fired on virtually any
    // JWT-bearing page regardless of whether the token actually carries an
    // exp claim. Superseded by page-jwt-missing-exp-claim (checks/page-
    // checks/jwt.ts), which base64url-decodes the payload and checks the
    // real exp property.
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
    const match = /[?&](?:token|access_token|bearer)=([^&]+)/i.exec(url);
    if (!match) return null;
    // Password-reset / email-verification / unsubscribe links are a
    // standard one-time-use pattern with a different security model than a
    // long-lived Bearer credential, and use the same param name.
    if (/\/(?:reset|forgot|verify|confirm|unsubscribe)/i.test(url)) {
      return null;
    }
    // Match on the parameter NAME alone flagged any value, including a
    // short one-time token. Require the value to actually look like a
    // Bearer credential: JWT-shaped, or a long opaque high-entropy string.
    // Malformed percent-encoding (e.g. ?token=100%off) throws from
    // decodeURIComponent; guard it so the throw can't disable the whole check.
    let value: string;
    try {
      value = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
    const looksLikeBearerToken =
      /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value) ||
      /^[A-Za-z0-9_-]{32,}$/.test(value);
    if (!looksLikeBearerToken) return null;
    return "Bearer token present in URL query string - leaks via logs and Referer.";
  },

  // ── JSONP / older API patterns ───────────────────────────────────────────

  "api-jsonp-callback": (url, _headers, body) => {
    if (/[?&](?:callback|cb|jsonp)\s*=/i.test(url)) {
      return "JSONP callback parameter accepted - XSS via content-type confusion.";
    }
    // Any bare `identifier(...)` shaped body used to match here — true for
    // a huge range of unrelated single-statement JS (init(), a health-check
    // ping script) that has nothing to do with JSONP. The defining trait of
    // JSONP is that the wrapper name came from an attacker-controllable
    // query parameter, so require the two to actually match, covering
    // callback param names this check's first branch doesn't enumerate.
    const trimmed = body.trim();
    const wrapped = /^([\w$]+)\s*\(/.exec(trimmed);
    if (wrapped && /\)\s*;?\s*$/.test(trimmed)) {
      let params: URLSearchParams;
      try {
        params = new URL(url).searchParams;
      } catch {
        return null;
      }
      for (const value of params.values()) {
        if (value === wrapped[1]) {
          return "Response wrapped as JSONP callback - prefer CORS-served JSON.";
        }
      }
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

  "api-soap-soapaction-injection": (_url, headers, _body) => {
    // The envelope-only branch fired on the mere presence of a SOAP
    // response, the same non-differentiating signal already reported at
    // info severity by soap-endpoint below — every ordinary SOAP call
    // stacked a duplicate high-severity finding on top of it with no
    // SOAPAction value, metacharacter, or forwarding behavior examined.
    const soapAction = headers.get("soapaction") || "";
    if (/["'`;|&$()<>]/.test(soapAction)) {
      return "SOAPAction header contains metacharacters - SSRF risk on downstream call.";
    }
    return null;
  },

  "api-soap-xxe-enabled": (_url, _headers, body) => {
    // The envelope-only branch fired on the mere presence of a SOAP
    // response, the same non-differentiating signal already reported at
    // info severity by soap-endpoint below — every ordinary (and correctly
    // hardened) SOAP call stacked a duplicate critical finding on top of it
    // with zero DOCTYPE/ENTITY evidence.
    if (/<!DOCTYPE[^>]*\[[\s\S]*?<!ENTITY[^>]*(?:SYSTEM|PUBLIC)/i.test(body)) {
      return "SOAP/XML payload contains DOCTYPE with external ENTITY - XXE enabled.";
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
    // Origin validation happens server-side during the HTTP upgrade and
    // isn't observable in the page's static body content either way — this
    // is only a word-presence heuristic, not a live handshake test with a
    // foreign Origin header, so it's worded as something to verify rather
    // than a confirmed missing check.
    if (!body.includes("origin") && !body.includes("Origin")) {
      return "WebSocket endpoint reachable and its response body doesn't reference Origin handling - verify the HTTP upgrade handler validates Origin against an allowlist.";
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

  // ── Modern auth/session + API hardening ─────────────────────────────────

  "api-jwt-jku-x5u-header-claim": (_url, headers, body) => {
    for (const token of findJwtCandidates(body, headers)) {
      const header = decodeJwtHeaderClaims(token);
      if (!header) continue;
      const claim =
        typeof header.jku === "string"
          ? "jku"
          : typeof header.x5u === "string"
            ? "x5u"
            : null;
      if (!claim) continue;
      const value = header[claim] as string;
      if (!/^https?:\/\//i.test(value)) continue;
      return `JWT header declares "${claim}": "${value}" - the verifying server may fetch the signing key from a URL embedded in the token itself; confirm it validates that URL against an allowlisted host before trusting it.`;
    }
    return null;
  },

  "api-oauth-authorize-missing-pkce": (url, _headers, _body) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!isOAuthAuthorizeEndpoint(parsed.pathname)) return null;
    const responseType = parsed.searchParams.get("response_type") || "";
    if (!/\bcode\b/i.test(responseType)) return null;
    if (!parsed.searchParams.has("client_id")) return null;
    if (parsed.searchParams.has("code_challenge")) return null;
    return `Authorization request to ${parsed.pathname} uses response_type=code with a client_id but no code_challenge parameter - PKCE is not being used for this authorization code request.`;
  },

  "api-oauth-implicit-flow-response-type-token": (url, _headers, _body) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!isOAuthAuthorizeEndpoint(parsed.pathname)) return null;
    const responseType = parsed.searchParams.get("response_type") || "";
    if (!/\btoken\b/i.test(responseType)) return null;
    if (/\bcode\b/i.test(responseType)) return null;
    if (!parsed.searchParams.has("client_id")) return null;
    return `Authorization request to ${parsed.pathname} uses response_type=${responseType} (the OAuth implicit grant) - the access token is returned directly in the redirect URL fragment instead of via a back-channel exchange.`;
  },

  "api-verbose-error-internal-path": (url, headers, body) => {
    const contentType = headers.get("content-type") || "";
    const looksLikeApiResponse =
      /application\/json/i.test(contentType) || /\/api\//i.test(url);
    if (!looksLikeApiResponse) return null;

    const stackField = /"stack"\s*:\s*"((?:[^"\\]|\\.)*)"/i.exec(body);
    if (
      stackField &&
      STACK_FRAME_PATTERN.test(stackField[1]) &&
      !precededByDocContext(body, stackField.index)
    ) {
      return 'Response body includes a "stack" field containing a full stack trace with internal file paths and line numbers.';
    }

    const messageField = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/i.exec(body);
    if (
      messageField &&
      INTERNAL_PATH_PATTERN.test(messageField[1]) &&
      !precededByDocContext(body, messageField.index)
    ) {
      return 'Response body\'s "message" field exposes an internal filesystem path.';
    }
    return null;
  },

  "api-deprecation-header-missing": (_url, headers, body) => {
    const contentType = headers.get("content-type") || "";
    const looksLikeJson =
      /application\/json/i.test(contentType) || /^\s*[{[]/.test(body);
    if (!looksLikeJson) return null;
    const selfReportsDeprecated =
      /"deprecated"\s*:\s*true/i.test(body) ||
      /"(?:status|message)"\s*:\s*"[^"]*\bdeprecated\b[^"]*"/i.test(body);
    if (!selfReportsDeprecated) return null;
    if (headers.has("deprecation") || headers.has("sunset")) return null;
    return "Response body reports this endpoint/version as deprecated, but the HTTP response carries neither a Deprecation nor a Sunset header - API gateways and client tooling that watch for those standard headers won't detect the deprecation.";
  },

  "api-graphql-introspection-mutation-heavy": (url, _headers, body) => {
    if (!/"__schema"\s*:\s*\{/i.test(body)) return null;
    const mutationBlock =
      /"kind"\s*:\s*"OBJECT"\s*,\s*"name"\s*:\s*"Mutation"[\s\S]{0,80}?"fields"\s*:\s*\[((?:[^[\]]|\[[^[\]]*\])*)\]/i.exec(
        body,
      );
    if (!mutationBlock) return null;
    const names = [...new Set(extractTopLevelFieldNames(mutationBlock[1]))];
    if (names.length < 5) return null;
    const sample = names.slice(0, 5).join(", ");
    return `GraphQL introspection at ${url} resolves a "Mutation" type exposing ${names.length} mutations (${sample}${names.length > 5 ? ", ..." : ""}) - the complete write surface of the API is enumerable without authentication.`;
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
