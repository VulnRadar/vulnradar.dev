/**
 * API-surface detectors.
 *
 * Detectors that look for REST/GraphQL/OpenAPI endpoints, HTTP method
 * allowlists, rate-limit headers, JSONP, and similar API-shape issues.
 */

import {
  getSetCookies,
  hasHeader,
  withDocBlocksStripped,
  type EvidenceFn as DetectFn,
} from "../_helpers";
import { tagsWith } from "./_tag-scan";

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

/**
 * Base64url-decode a JWT's PAYLOAD (second segment) the same way
 * decodeJwtHeaderClaims above decodes the header. Kept separate rather than
 * parameterised so the header path, which several checks already depend on,
 * keeps its exact behaviour.
 */
function decodeJwtPayloadClaims(token: string): Record<string, unknown> | null {
  const segment = token.split(".")[1];
  if (!segment) return null;
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

// ── Shared gates for the document/spec detectors ───────────────────────────
//
// Every one of these anchors with indexOf before it runs a regex. The bodies
// these checks read can be a full 1 MiB of attacker-chosen bytes, and a
// substring scan that fails is one linear pass, where a regex that fails is a
// retry from every offset. ref: tests/lib/scanner/_perf-budget.test.ts

/** True when the body is an OpenAPI/Swagger document rather than a page that
 *  merely mentions one. */
function looksLikeOpenApiDocument(body: string): boolean {
  if (body.indexOf('"openapi"') === -1 && body.indexOf('"swagger"') === -1) {
    return false;
  }
  return (
    /"(?:openapi|swagger)"\s*:\s*"\d/.test(body) && body.indexOf('"paths"') > -1
  );
}

/** True when the body is an OpenID Connect / OAuth 2.0 authorization-server
 *  metadata document (RFC 8414 / OIDC Discovery 1.0). */
function looksLikeOidcDiscoveryDocument(body: string): boolean {
  if (body.indexOf('"issuer"') === -1) return false;
  return (
    body.indexOf('"authorization_endpoint"') > -1 ||
    body.indexOf('"token_endpoint"') > -1
  );
}

/**
 * The values of a JSON string array, e.g. `"response_types_supported": [...]`.
 * Returns an empty array when the key is absent so callers can tell "declared
 * nothing" from "did not declare the key" by checking presence separately.
 */
function jsonStringArrayValues(body: string, key: string): string[] {
  const at = body.indexOf(`"${key}"`);
  if (at === -1) return [];
  const window = body.slice(at, at + 4000);
  const arr = /^"[^"]+"\s*:\s*\[([^\]]{0,3000})\]/.exec(window);
  if (!arr) return [];
  return [...arr[1].matchAll(/"([^"]{0,120})"/g)].map((m) => m[1]);
}

/** Hostnames that must never appear in a public response header's URL. */
function isInternalHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1") return true;
  if (/\.(?:local|internal|intranet|lan|corp|home|test|localdomain)$/.test(h)) {
    return true;
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^fd[0-9a-f]{2}:/i.test(h) || /^fe80:/i.test(h)) return true;
  return false;
}

/** Seconds-or-HTTP-date parse used by the Retry-After / Sunset checks. */
function parseHttpDate(value: string): number | null {
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? ms : null;
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

/**
 * Structural test for GraphQL batch (array) syntax: `[{ ..."query"... }, {`.
 *
 * Deliberately not a single regex; see the call site for why and for the
 * measurements. Anchoring on the keyword with indexOf makes the common case
 * (a body with no "query"/"mutation" at all) one substring scan instead of a
 * cubic backtracking walk, and confines the structural match to a constant
 * window where real batch syntax actually sits.
 */
function looksLikeGraphQLBatch(body: string): boolean {
  const WINDOW = 2000;
  for (const keyword of ['"query"', '"mutation"']) {
    let at = body.indexOf(keyword);
    while (at !== -1) {
      const before = body.slice(Math.max(0, at - WINDOW), at);
      const after = body.slice(at, at + WINDOW);
      // An array open then an object open before the keyword, and an object
      // close followed by the next object after it. Both regexes run against
      // a bounded slice, so neither can blow up on body length.
      if (/[[sS]*{/.test(before) && /}s*,s*{/.test(after)) return true;
      at = body.indexOf(keyword, at + keyword.length);
    }
  }
  return false;
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
    let withoutPingback = body;
    for (const tag of tagsWith(body, "link", /rel=["']pingback["']/i)) {
      withoutPingback = withoutPingback.split(tag).join("");
    }
    // Every occurrence is judged at its own offset. A single non-global
    // exec plus `return null` on the doc-context guard meant one benign
    // earlier mention ("for example, xmlrpc.php ...") decided the whole
    // page, so a real endpoint reference further down went unreported: a
    // silent false negative, worse than the false positive the guard exists
    // to prevent. Iterate and `continue` past each doc-context hit instead.
    const xmlRpcPattern = /xmlrpc|\/RPC2\b/gi;
    let match: RegExpExecArray | null;
    while ((match = xmlRpcPattern.exec(withoutPingback)) !== null) {
      const before = withoutPingback
        .slice(Math.max(0, match.index - 200), match.index)
        .toLowerCase();
      if (/<code|<pre|```|example|documentation/i.test(before)) continue;
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
    // The single-regex form of this test was cubic. A greedy .* followed by
    // two lazy [sS]*? bridges that can never be satisfied when the keyword
    // is absent means every "[{" is retried against every suffix: measured
    // 8 KB of '"errors":[' + "[{".repeat(n) at 3.9 s, 16 KB at 31 s. The gate
    // above is satisfiable by body content alone, so no /graphql URL is
    // needed, and this runs on every default scan.
    if (looksLikeGraphQLBatch(body)) {
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
    // The quotes around the suggested field name arrive backslash-escaped in
    // the overwhelmingly common case: graphql-js puts the suggestion inside
    // errors[].message, so a real JSON response body literally reads
    // `Did you mean \"user\"?`. Requiring a bare `"` there made this check
    // miss every actual GraphQL error response and only match the message
    // rendered as plain text, so the optional `\\?` is what makes the
    // graphql-js shape (the whole point of the gate) detectable at all.
    if (
      /did you mean\s+\\?"[^"\\]{1,120}\\?"/i.test(body) ||
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
    //
    // Split into one pattern per payload shape rather than an alternation
    // wrapped in `\s*`. The single pattern was
    // `jwt\.sign\(\s*(?:\{[^{}]*\}|[^,{}]+)\s*,` and `[^,{}]` matches
    // whitespace, so `\s*`, the payload run and the trailing `\s*` all
    // competed for the same characters while the mandatory `,` never
    // arrived: `"jwt.sign(" + " ".repeat(n)` measured 53 ms at 500 bytes,
    // 418 ms at 1 KB and 3573 ms at 2 KB, roughly eight times the cost for
    // twice the input, which puts 4 KB at half a minute. The body cap does
    // not help because the payload is tiny.
    //
    // Neither pattern below has a splice point. OBJECT_PAYLOAD's runs are
    // separated by `{`, `}` and `,`, none of which is whitespace, so no two
    // of them can match the same character. BARE_PAYLOAD drops the leading
    // `\s*` entirely because `[^,{}]` already covers leading whitespace, and
    // bounds the run: a first argument that is not an object and is longer
    // than 200 characters does not occur, and the bound is what makes the
    // failed match cost 200 steps instead of one per offset.
    const OBJECT_PAYLOAD =
      /jwt\.sign\(\s*\{[^{}]{0,2000}\}\s*,\s*['"][a-zA-Z0-9]{1,15}['"]/i;
    const BARE_PAYLOAD =
      /jwt\.sign\([^,{}]{1,200},\s*['"][a-zA-Z0-9]{1,15}['"]/i;
    if (OBJECT_PAYLOAD.test(body) || BARE_PAYLOAD.test(body)) {
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
    // Password-reset / email-verification / unsubscribe links are a
    // standard one-time-use pattern with a different security model than a
    // long-lived Bearer credential, and use the same param name.
    if (/\/(?:reset|forgot|verify|confirm|unsubscribe)/i.test(url)) {
      return null;
    }
    // Match on the parameter NAME alone flagged any value, including a
    // short one-time token. Require the value to actually look like a
    // Bearer credential: JWT-shaped, or a long opaque high-entropy string.
    // Every candidate parameter is checked, not just the first: a URL like
    // ?token=1&access_token=eyJ... would otherwise be cleared by the short
    // leading value and the real credential beside it never reported.
    const tokenParams = /[?&](?:token|access_token|bearer)=([^&]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = tokenParams.exec(url)) !== null) {
      // Malformed percent-encoding (e.g. ?token=100%off) throws from
      // decodeURIComponent; guard it so the throw can't disable the check.
      let value: string;
      try {
        value = decodeURIComponent(match[1]);
      } catch {
        continue;
      }
      const looksLikeBearerToken =
        /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value) ||
        /^[A-Za-z0-9_-]{32,}$/.test(value);
      if (!looksLikeBearerToken) continue;
      return "Bearer token present in URL query string - leaks via logs and Referer.";
    }
    return null;
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
    if (
      /<!DOCTYPE[^>]{0,2000}\[[\s\S]*?<!ENTITY[^>]{0,2000}(?:SYSTEM|PUBLIC)/i.test(
        body,
      )
    ) {
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

    // Both fields are scanned globally and judged at each hit's own offset.
    // A single non-global exec let the FIRST "stack"/"message" field decide
    // the whole response, so a benign leading one (a "stack":"" placeholder,
    // an earlier field sitting in doc context) masked a real leak further
    // down the same body and the check reported clean on a response that
    // genuinely leaks. STACK_FRAME_PATTERN/INTERNAL_PATH_PATTERN are
    // non-global, so .test() carries no lastIndex state between iterations.
    const stackFields = /"stack"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;
    let field: RegExpExecArray | null;
    while ((field = stackFields.exec(body)) !== null) {
      if (
        STACK_FRAME_PATTERN.test(field[1]) &&
        !precededByDocContext(body, field.index)
      ) {
        return 'Response body includes a "stack" field containing a full stack trace with internal file paths and line numbers.';
      }
    }

    const messageFields = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;
    while ((field = messageFields.exec(body)) !== null) {
      if (
        INTERNAL_PATH_PATTERN.test(field[1]) &&
        !precededByDocContext(body, field.index)
      ) {
        return 'Response body\'s "message" field exposes an internal filesystem path.';
      }
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

  // ── API description documents served in production ──────────────────────

  "api-graphql-ide-exposed": (_url, _headers, body) => {
    // Structural markers only: the IDE's own bundle filename, its document
    // title, or the function that renders it. A page that merely writes
    // "GraphQL Playground" in prose does not match any of them, which is
    // what keeps this off marketing and documentation pages.
    const markers: [RegExp, string][] = [
      [/graphql-playground[\w-]{0,20}\.(?:js|css)\b/i, "GraphQL Playground"],
      [/<title>\s*GraphiQL/i, "GraphiQL"],
      [/\bGraphiQL\.createFetcher\b|\brenderGraphiQL\b/i, "GraphiQL"],
      [/graphiql(?:\.min)?\.(?:js|css)\b/i, "GraphiQL"],
      [/\bApolloServerPluginLandingPage\b/, "Apollo Server landing page"],
      [
        /embeddable-sandbox[\w.-]{0,20}\.(?:js|umd\.production\.min\.js)\b/i,
        "Apollo Sandbox",
      ],
      [/graphql-voyager[\w-]{0,20}\.(?:js|css)\b/i, "GraphQL Voyager"],
      [/\bHasura\s+Console\b|\b__hasuraConsole\b/, "Hasura Console"],
    ];
    for (const [pattern, name] of markers) {
      if (pattern.test(body)) {
        return `${name} is served from this endpoint, so the interactive GraphQL IDE is reachable in this environment.`;
      }
    }
    return null;
  },

  "api-graphql-schema-sdl-exposed": (_url, headers, body) => {
    // An SDL file is plain text; an HTML page that happens to contain the
    // words is not. Requiring the response NOT to be HTML is what separates
    // "the schema is being served" from "a tutorial shows a schema".
    const contentType = headers.get("content-type") || "";
    if (/text\/html/i.test(contentType)) return null;
    if (body.indexOf("type Query") === -1) return null;
    if (
      !/(?:^|\n)\s*type\s+Query\s*(?:implements\s+[\w\s&]{1,80})?\{/.test(body)
    ) {
      return null;
    }
    const supporting =
      /(?:^|\n)\s*type\s+Mutation\s*\{/.test(body) ||
      /(?:^|\n)\s*schema\s*\{/.test(body) ||
      /(?:^|\n)\s*input\s+\w{1,60}\s*\{/.test(body) ||
      /(?:^|\n)\s*enum\s+\w{1,60}\s*\{/.test(body);
    if (!supporting) return null;
    return "The GraphQL schema is served as raw SDL, so every type, field, and argument the API defines is readable without issuing an introspection query.";
  },

  "api-openapi-no-security-declared": (_url, _headers, body) => {
    if (!looksLikeOpenApiDocument(body)) return null;
    // Only meaningful for a spec that describes writes. A read-only public
    // catalogue with no security block is a legitimate design.
    if (!/"(?:post|put|patch|delete)"\s*:\s*\{/i.test(body)) return null;
    if (body.indexOf('"security"') > -1) return null;
    if (
      body.indexOf('"securitySchemes"') > -1 ||
      body.indexOf('"securityDefinitions"') > -1
    ) {
      return null;
    }
    return "OpenAPI document describes state-changing operations (POST/PUT/PATCH/DELETE) but declares no security schemes and no security requirement, so the published contract says every one of them is callable anonymously.";
  },

  "api-openapi-server-url-plain-http": (_url, _headers, body) => {
    if (!looksLikeOpenApiDocument(body)) return null;
    // Internal/staging hosts are api-openapi-server-url-leak's finding; this
    // one is specifically about a PUBLIC base URL published as cleartext
    // http://, so those hosts are excluded here rather than double-reported.
    const at = body.indexOf('"servers"');
    if (at > -1) {
      const window = body.slice(at, at + 3000);
      const m =
        /"url"\s*:\s*"(http:\/\/(?!localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|internal|staging)[^"]{1,200})"/i.exec(
          window,
        );
      if (m) {
        return `OpenAPI document publishes a cleartext base URL: "${m[1]}".`;
      }
    }
    if (
      /"schemes"\s*:\s*\[[^\]]{0,200}"http"/i.test(body) &&
      !/"schemes"\s*:\s*\[[^\]]{0,200}"https"/i.test(body)
    ) {
      return 'Swagger 2.0 document declares "schemes": ["http"] with no https entry, so every generated client talks to this API in cleartext.';
    }
    return null;
  },

  "api-openapi-swagger-2-document": (_url, _headers, body) => {
    if (body.indexOf('"swagger"') === -1) return null;
    if (!/"swagger"\s*:\s*"2\.0"/.test(body)) return null;
    if (body.indexOf('"paths"') === -1) return null;
    return 'Document declares "swagger": "2.0". Swagger 2.0 was superseded by OpenAPI 3.0 in 2017 and by 3.1 in 2021.';
  },

  "api-openapi-deprecated-operations-exposed": (_url, _headers, body) => {
    if (!looksLikeOpenApiDocument(body)) return null;
    const matches = body.match(/"deprecated"\s*:\s*true/g);
    if (!matches) return null;
    return `OpenAPI document marks ${matches.length} operation(s) or parameter(s) as "deprecated": true while still publishing them as callable.`;
  },

  "api-openapi-oauth2-implicit-flow-declared": (_url, _headers, body) => {
    if (!looksLikeOpenApiDocument(body)) return null;
    // OpenAPI 3: flows.implicit. Swagger 2: "flow": "implicit".
    if (/"implicit"\s*:\s*\{[^}]{0,400}"authorizationUrl"/i.test(body)) {
      return 'OpenAPI document declares an OAuth2 "implicit" flow with an authorizationUrl.';
    }
    if (/"flow"\s*:\s*"implicit"/i.test(body)) {
      return 'Swagger 2.0 document declares an OAuth2 security definition with "flow": "implicit".';
    }
    return null;
  },

  "api-asyncapi-document-exposed": (_url, _headers, body) => {
    const jsonForm = /"asyncapi"\s*:\s*"[23]\./.test(body);
    const yamlForm = /(?:^|\n)asyncapi:\s*["']?[23]\./.test(body);
    if (!jsonForm && !yamlForm) return null;
    if (body.indexOf("channels") === -1) return null;
    return "An AsyncAPI document is served from this URL, publishing the event-driven side of the system: broker addresses, channel and topic names, and message payload schemas.";
  },

  "api-postman-collection-exposed": (_url, _headers, body) => {
    if (
      body.indexOf('"_postman_id"') === -1 &&
      body.indexOf("schema.getpostman.com") === -1
    ) {
      return null;
    }
    if (
      !/"_postman_id"\s*:\s*"/.test(body) &&
      !/"schema"\s*:\s*"https?:\/\/schema\.getpostman\.com/.test(body)
    ) {
      return null;
    }
    const named = /"name"\s*:\s*"([^"]{1,80})"/.exec(body)?.[1];
    return `A Postman collection export is served from this URL${named ? ` ("${named}")` : ""}. Collections carry every request path, body, and header the author saved, and frequently the auth values used while testing.`;
  },

  "api-insomnia-export-exposed": (_url, _headers, body) => {
    if (
      body.indexOf("insomnia") === -1 &&
      body.indexOf('"__export_format"') === -1
    ) {
      return null;
    }
    if (
      !/"__export_source"\s*:\s*"[^"]{0,80}insomnia/i.test(body) &&
      !(
        /"__export_format"\s*:\s*\d/.test(body) &&
        /"_type"\s*:\s*"(?:export|request|environment)"/.test(body)
      )
    ) {
      return null;
    }
    return "An Insomnia workspace export is served from this URL. The export contains every saved request, and any environment values stored alongside them.";
  },

  "api-wadl-document-exposed": (_url, _headers, body) => {
    if (body.indexOf("wadl") === -1) return null;
    if (
      !/xmlns(?::\w{1,20})?="http:\/\/wadl\.dev\.java\.net\/2009\/02"/i.test(
        body,
      ) &&
      !/<(?:\w{1,20}:)?application\b[^>]{0,300}wadl/i.test(body)
    ) {
      return null;
    }
    return "A WADL (Web Application Description Language) document is served from this URL, enumerating every resource, method, and parameter the service exposes.";
  },

  "api-raml-document-exposed": (_url, _headers, body) => {
    if (!/^#%RAML\s+[01]\.\d/m.test(body.slice(0, 4000))) return null;
    return "A RAML API definition is served from this URL, enumerating every resource, method, and declared security scheme.";
  },

  "api-odata-metadata-document-exposed": (url, _headers, body) => {
    const isMetadataUrl = /\/\$metadata(?:\?|$)/i.test(url);
    const hasEdmx =
      body.indexOf("edmx") > -1 &&
      /<(?:\w{1,20}:)?Edmx\b/i.test(body) &&
      /<(?:\w{1,20}:)?EntityType\b/i.test(body);
    if (!isMetadataUrl && !hasEdmx) return null;
    if (!hasEdmx) return null;
    return "An OData $metadata document is served from this URL. It publishes the complete entity model: every entity set, property name and type, navigation property, and callable function or action.";
  },

  // ── OpenID Connect / OAuth 2.0 discovery ────────────────────────────────

  "api-oidc-discovery-alg-none-supported": (_url, _headers, body) => {
    if (!looksLikeOidcDiscoveryDocument(body)) return null;
    const algs = jsonStringArrayValues(
      body,
      "id_token_signing_alg_values_supported",
    );
    if (!algs.some((a) => a.toLowerCase() === "none")) return null;
    return `Authorization-server metadata advertises "none" in id_token_signing_alg_values_supported (declared: ${algs.join(", ")}).`;
  },

  "api-oidc-discovery-implicit-flow-supported": (_url, _headers, body) => {
    if (!looksLikeOidcDiscoveryDocument(body)) return null;
    const types = jsonStringArrayValues(body, "response_types_supported");
    const implicit = types.filter(
      (t) => /\btoken\b/.test(t) && !/\bcode\b/.test(t),
    );
    if (implicit.length === 0) return null;
    return `Authorization-server metadata advertises implicit-grant response types: ${implicit.join(", ")}.`;
  },

  "api-oidc-discovery-pkce-not-advertised": (_url, _headers, body) => {
    if (!looksLikeOidcDiscoveryDocument(body)) return null;
    const types = jsonStringArrayValues(body, "response_types_supported");
    if (!types.some((t) => /\bcode\b/.test(t))) return null;
    if (body.indexOf('"code_challenge_methods_supported"') > -1) return null;
    return "Authorization-server metadata advertises the authorization-code response type but omits code_challenge_methods_supported, so a conforming client has no way to discover that PKCE is available.";
  },

  // ── OAuth authorization requests ────────────────────────────────────────

  "api-oauth-authorize-redirect-uri-insecure": (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!isOAuthAuthorizeEndpoint(parsed.pathname)) return null;
    const redirect = parsed.searchParams.get("redirect_uri");
    if (!redirect || !/^http:\/\//i.test(redirect)) return null;
    let host: string;
    try {
      host = new URL(redirect).hostname;
    } catch {
      return null;
    }
    // A loopback redirect URI over http is explicitly permitted for native
    // apps by RFC 8252 section 7.3, so it is not a finding.
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return null;
    }
    return `Authorization request carries redirect_uri=${redirect}, a cleartext http:// callback on a non-loopback host.`;
  },

  "api-oauth-authorize-oidc-nonce-missing": (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!isOAuthAuthorizeEndpoint(parsed.pathname)) return null;
    const responseType = parsed.searchParams.get("response_type") || "";
    if (!/\bid_token\b/i.test(responseType)) return null;
    if (parsed.searchParams.has("nonce")) return null;
    return `Authorization request uses response_type=${responseType} but carries no nonce parameter, which OpenID Connect Core section 3.2.2.1 requires for every flow that returns an ID token from the authorization endpoint.`;
  },

  "api-jwt-long-lived-token": (_url, headers, body) => {
    const NINETY_DAYS = 90 * 24 * 60 * 60;
    for (const token of findJwtCandidates(body, headers)) {
      const claims = decodeJwtPayloadClaims(token);
      if (!claims) continue;
      const exp = typeof claims.exp === "number" ? claims.exp : null;
      if (exp === null) continue;
      const iat = typeof claims.iat === "number" ? claims.iat : null;
      const nbf = typeof claims.nbf === "number" ? claims.nbf : null;
      const start = iat ?? nbf ?? Math.floor(Date.now() / 1000);
      const lifetime = exp - start;
      if (lifetime <= NINETY_DAYS) continue;
      const days = Math.round(lifetime / 86400);
      return `A JWT reachable from this response has a ${days}-day lifetime (iat/nbf to exp), far beyond the minutes-to-hours an access token is normally given.`;
    }
    return null;
  },

  // ── Response-header correctness ─────────────────────────────────────────

  "api-retry-after-invalid-value": (_url, headers) => {
    const raw = headers.get("retry-after");
    if (!raw) return null;
    const value = raw.trim();
    if (/^\d+$/.test(value)) return null;
    if (parseHttpDate(value) !== null) return null;
    return `Retry-After: ${value.slice(0, 120)} is neither a non-negative integer number of seconds nor an HTTP-date, the only two forms RFC 9110 defines.`;
  },

  "api-sunset-header-in-past": (_url, headers) => {
    const raw = headers.get("sunset");
    if (!raw) return null;
    const at = parseHttpDate(raw);
    if (at === null) return null;
    if (at >= Date.now()) return null;
    return `Sunset: ${raw.trim()} is in the past, yet the endpoint is still answering requests.`;
  },

  "api-json-response-content-type-mismatch": (_url, headers, body) => {
    const head = body.slice(0, 400).trimStart();
    if (!head.startsWith("{") && !head.startsWith("[")) return null;
    // Structural, not a full parse: a 1 MiB body must not be JSON.parse'd on
    // every scan just to answer "does this look like JSON".
    if (!/^[[{]\s*(?:"|\]|\})/.test(head)) return null;
    const opening = body.slice(0, 2000).toLowerCase();
    if (opening.includes("<html") || opening.includes("<!doctype")) return null;
    const contentType = headers.get("content-type");
    if (contentType === null || contentType.trim() === "") {
      return "Response body is JSON-shaped but the response carries no Content-Type header at all, so the browser is left to sniff the type.";
    }
    if (/text\/html/i.test(contentType)) {
      return `Response body is JSON-shaped but is served as Content-Type: ${contentType.slice(0, 120)}.`;
    }
    return null;
  },

  "api-response-header-internal-host": (_url, headers) => {
    for (const name of ["location", "content-location", "link"]) {
      const value = headers.get(name);
      if (!value) continue;
      const urls = value.match(/https?:\/\/[^\s<>",;]{1,300}/gi) || [];
      for (const candidate of urls) {
        let host: string;
        try {
          host = new URL(candidate).hostname;
        } catch {
          continue;
        }
        if (!isInternalHostname(host)) continue;
        return `Response header ${name} points at an internal host: ${candidate.slice(0, 160)}`;
      }
    }
    return null;
  },

  "api-www-authenticate-realm-internal-detail": (_url, headers) => {
    const value = headers.get("www-authenticate");
    if (!value) return null;
    const realm = /realm\s*=\s*"([^"]{1,200})"/i.exec(value)?.[1];
    if (!realm) return null;
    const looksInternal =
      /(?:^|[\s@/\\])(?:\/(?:usr|home|opt|etc|var|srv)\/|[A-Za-z]:\\)/.test(
        realm,
      ) ||
      /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(realm) ||
      /\b[\w-]{1,40}\.(?:local|internal|intranet|lan|corp)\b/i.test(realm) ||
      /\b(?:localhost|127\.0\.0\.1)\b/i.test(realm);
    if (!looksInternal) return null;
    return `WWW-Authenticate realm exposes internal infrastructure detail: realm="${realm.slice(0, 160)}"`;
  },

  "api-problem-json-trace-exposed": (_url, headers, body) => {
    const contentType = headers.get("content-type") || "";
    const isProblemJson = /application\/problem\+json/i.test(contentType);
    const looksLikeProblem =
      isProblemJson ||
      (/"title"\s*:\s*"/.test(body) &&
        /"status"\s*:\s*\d{3}/.test(body) &&
        /"(?:type|detail)"\s*:\s*"/.test(body));
    if (!looksLikeProblem) return null;
    const traceField =
      /"(?:trace|stackTrace|stack_trace)"\s*:\s*"((?:[^"\\]|\\.){0,4000})"/i.exec(
        body,
      );
    // A real trace arrives JSON-escaped, so its frames read `\n\tat com...`
    // and STACK_FRAME_PATTERN's leading \b never matches: the literal `t` of
    // the `\t` escape runs straight into `at`. Turn the escapes back into
    // whitespace first, or this only fires on a trace already flattened onto
    // one line, which is the rarer shape.
    const traceText = traceField?.[1].replace(/\\[ntr]/g, " ");
    if (traceText && STACK_FRAME_PATTERN.test(traceText)) {
      return 'RFC 9457 problem document carries a "trace" member containing a full stack trace with file paths and line numbers.';
    }
    const exceptionField = /"exception"\s*:\s*"([\w.$]{8,200})"/.exec(body);
    if (exceptionField && exceptionField[1].includes(".")) {
      return `RFC 9457 problem document names the internal exception class that produced it: "${exceptionField[1]}".`;
    }
    return null;
  },

  "api-swagger-ui-outdated-version": (_url, _headers, body) => {
    if (body.indexOf("swagger-ui") === -1) return null;
    // Bounded on both sides of the version and anchored on a real separator,
    // so there is no lazy bridge between the name and the digits.
    const m =
      /swagger-ui(?:-dist|-bundle|-react)?[@/-](\d{1,2})\.(\d{1,3})\.(\d{1,3})/i.exec(
        body,
      );
    if (!m) return null;
    const [major, minor, patch] = [+m[1], +m[2], +m[3]];
    // 4.1.3 is the first release carrying the fix for the DOM XSS in
    // Swagger UI's own rendering of a spec (CVE-2021-46708).
    const isOld =
      major < 4 ||
      (major === 4 && minor === 0) ||
      (major === 4 && minor === 1 && patch < 3);
    if (!isOld) return null;
    return `Swagger UI ${major}.${minor}.${patch} is loaded by this page. Releases before 4.1.3 are affected by a DOM XSS in Swagger UI's own spec rendering.`;
  },

  "api-cors-allow-origin-multiple-values": (_url, headers) => {
    const acao = headers.get("access-control-allow-origin");
    if (!acao) return null;
    const value = acao.trim();
    if (value === "*" || value === "null") return null;
    // The header takes exactly one origin. Two comma- or space-separated
    // origins is a server that concatenated its allowlist instead of
    // echoing the matching entry, and every browser rejects the response.
    const origins = value.split(/[,\s]+/).filter(Boolean);
    if (origins.length < 2) return null;
    if (!origins.every((o) => /^(?:https?:\/\/|\*$|null$)/i.test(o)))
      return null;
    return `Access-Control-Allow-Origin carries ${origins.length} values ("${value.slice(0, 160)}"), but the header is defined to hold exactly one origin.`;
  },

  "api-cors-credentials-without-allow-origin": (_url, headers) => {
    const acac = headers.get("access-control-allow-credentials");
    if (!acac || acac.trim().toLowerCase() !== "true") return null;
    if (headers.has("access-control-allow-origin")) return null;
    return "Access-Control-Allow-Credentials: true is sent with no Access-Control-Allow-Origin header, so no browser will ever honour the credentialed request this header exists to permit.";
  },
};

// None of the body-regex detectors above are scoped to actual API response
// content (JSON payloads have no <pre>/<code> tags to begin with, so this is
// a no-op there) -- but several also match plain HTML pages (soap-endpoint,
// xml-rpc, api-jwt-hs256-weak-secret's `jwt.sign(...)` pattern), where a
// tutorial or API-docs page rendering an example payload as literal text in
// a <pre>/<code> block would otherwise self-trigger them, matching the same
// false-positive class already fixed for vibe-code.ts.
export const detectors: Record<string, DetectFn> =
  withDocBlocksStripped(rawDetectors);
