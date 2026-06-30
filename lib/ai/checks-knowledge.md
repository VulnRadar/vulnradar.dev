# VulnRadar Scanner Checks — AI Knowledge

_Auto-compiled from `lib/scanner/checks-data/*.json` on 2026-06-30._

This file is consumed by the AI system prompt at runtime so the
assistant can answer questions about specific scanner checks:
what a check does, why it matters, how to fix it, and what code
examples the project ships. Treat this as authoritative for
detection behavior.

Severity levels: critical, high, medium, low, info.
Types: header, content, body-pattern, status-based, combined,
protocol-specific, async, port, banner, email-dns, etc.
When the user asks about a check ID (e.g. 'hsts-missing'), find it
in this file and quote the title, description, and fix steps.

---

## Summary

- **Total checks:** 739
- **Categories:** 12 (api, code, configuration, content, cookies, dns, email, headers, information-disclosure, secrets-extended, ssl, tls)
- **By severity:**
  - info: 299
  - high: 143
  - medium: 131
  - low: 91
  - critical: 75
- **By type:**
  - header: 264
  - body-pattern: 232
  - stub: 180
  - combined: 42
  - header-value: 8
  - header-present: 6
  - header-missing: 4
  - url-check: 3

---

## Category: api (48 checks)

### `api-rest-allow-methods-trace` [api / medium / header]
**REST endpoint allows TRACE method**

HTTP TRACE reflects the request body and is exploitable for Cross-Site Tracing (XST).

**Risk:** Disable TRACE on the server / reverse proxy

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Disable TRACE on the server / reverse proxy
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rest-allow-methods-delete` [api / info / header]
**REST endpoint allows DELETE**

REST endpoint exposes DELETE without authentication.

**Risk:** Require authentication on state-changing verbs (DELETE/PATCH/PUT/POST)

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Require authentication on state-changing verbs (DELETE/PATCH/PUT/POST)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-graphql-suggestions-enabled` [api / low / header]
**GraphQL introspection field suggestions**

Field suggestions on error responses let attackers enumerate the schema.

**Risk:** Disable GraphQL field suggestions in production

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Disable GraphQL field suggestions in production
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-graphql-no-depth-limit` [api / medium / header]
**GraphQL schema missing depth-limit directive**

Without depth-limit, malicious queries can blow up the server with deeply nested queries.

**Risk:** Add depth-limit / cost-analysis middleware (graphql-depth-limit, graphql-query-complexity)

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Add depth-limit / cost-analysis middleware (graphql-depth-limit, graphql-query-complexity)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-graphql-no-rate-limit` [api / medium / header]
**GraphQL endpoint has no rate-limit headers**

GraphQL POST endpoints need rate-limiting because one query can touch many resolvers.

**Risk:** Rate-limit by query cost / depth, not just request count

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Rate-limit by query cost / depth, not just request count
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-graphql-persisted-queries` [api / info / header]
**GraphQL persisted queries not enabled**

Persisted queries (APQ) lock the schema surface to known queries.

**Risk:** Enable Apollo Persisted Queries / Relay Compiler

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Enable Apollo Persisted Queries / Relay Compiler
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-openapi-server-url-leak` [api / low / header]
**OpenAPI server URL leaks internal host**

swagger.json often contains the internal / staging host in the 'servers' array.

**Risk:** Strip internal hosts from public OpenAPI documents

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Strip internal hosts from public OpenAPI documents
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-cors-preflight-cache-missing` [api / low / header]
**CORS preflight result not cached**

Missing Access-Control-Max-Age forces browsers to send preflight OPTIONS on every cross-origin request.

**Risk:** Add Access-Control-Max-Age: 600 (10 minutes) for stable CORS configs

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Add Access-Control-Max-Age: 600 (10 minutes) for stable CORS configs
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-bearer-header-leak` [api / high / header]
**Bearer token in URL or cookie**

Authorization: Bearer is fine, but Bearer tokens in URL or cookies can leak via logs.

**Risk:** Send Bearer tokens only in the Authorization header

**References:**
- https://datatracker.ietf.org/doc/html/rfc6750

**Fix:**
- Send Bearer tokens only in the Authorization header
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-no-cors-preflight-required` [api / low / header]
**CORS preflight required for simple request**

Non-simple headers (Authorization, X-Custom) trigger a preflight OPTIONS.

**Risk:** Document this in your API guide; consider a session-token pattern that uses cookies

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Document this in your API guide; consider a session-token pattern that uses cookies
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rate-limit-not-429` [api / low / header]
**Rate limit response missing 429 status**

Rate-limited responses should return HTTP 429 with Retry-After.

**Risk:** Return 429 + Retry-After when limits are exceeded

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Return 429 + Retry-After when limits are exceeded
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-jsonp-callback` [api / medium / header]
**JSONP callback parameter accepted**

JSONP allows arbitrary JS to be loaded in the victim's origin. Prefer CORS.

**Risk:** Disable JSONP; serve CORS-allowed JSON instead

**References:**
- https://blog.mozilla.org/security/2014/08/26/jsonp-content-type-confusion-xss/

**Fix:**
- Disable JSONP; serve CORS-allowed JSON instead
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-cors-origin-allow-all` [api / high / header]
**CORS origin allow-all**

Access-Control-Allow-Origin: * with credentials is unsafe; without credentials it may still be too permissive for an internal API.

**Risk:** Replace wildcard with the smallest allowlist of origins that need access

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Replace wildcard with the smallest allowlist of origins that need access
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rest-allow-methods-put-no-auth` [api / high / header]
**REST endpoint allows PUT without authentication**

PUT changes server state. Without authentication, anyone reachable to the endpoint can overwrite resources (config, user profiles, files).

**Risk:** Require authentication on PUT and reject anonymous writes at the proxy or framework layer.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/

**Fix:**
- Require authentication on PUT and reject anonymous writes at the proxy or framework layer.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rest-allow-methods-patch-no-auth` [api / high / header]
**REST endpoint allows PATCH without authentication**

PATCH partially mutates a resource. Unauthenticated PATCH endpoints allow attackers to flip boolean fields, escalate privileges, or change ownership markers.

**Risk:** Require authentication on PATCH and validate the JSON merge patch against an explicit allowlist of fields.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Require authentication on PATCH and validate the JSON merge patch against an explicit allowlist of fields.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rest-allow-methods-options-exposed` [api / low / header]
**OPTIONS response exposes full method allowlist**

A verbose OPTIONS response (Allow: GET, POST, PUT, PATCH, DELETE) leaks the entire verb surface to attackers, simplifying endpoint enumeration.

**Risk:** Restrict Allow to only the verbs you actually serve and disable unused HTTP methods on the listener.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Restrict Allow to only the verbs you actually serve and disable unused HTTP methods on the listener.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-graphql-introspection-enabled` [api / high / header]
**GraphQL introspection enabled in production**

__schema / __type queries dump the entire schema, including internal fields, admin-only mutations, and deprecation hints that aid targeted attacks.

**Risk:** Disable introspection in production (Apollo: introspection: false, GraphQL.NET: ExposeMetadata=false).

**References:**
- https://graphql.org/learn/introspection/

**Fix:**
- Disable introspection in production (Apollo: introspection: false, GraphQL.NET: ExposeMetadata=false).
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-graphql-batch-queries` [api / medium / header]
**GraphQL batch (array) queries accepted**

Accepting an array of queries lets a single HTTP request fan out to N independent operations, multiplying rate-limit cost and bypassing per-request throttles.

**Risk:** Disable batch queries or charge each item in the array against the rate-limit budget.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Disable batch queries or charge each item in the array against the rate-limit budget.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-graphql-no-alias-depth-limit` [api / medium / header]
**GraphQL alias-based depth bypass**

A naive depth-limit can be evaded with aliases that rename the same field many times. Each alias resolves independently, multiplying cost.

**Risk:** Combine depth-limit with query-cost analysis (graphql-query-complexity) and per-field cost limits.

**References:**
- https://github.com/graphql/graphiql/issues/841

**Fix:**
- Combine depth-limit with query-cost analysis (graphql-query-complexity) and per-field cost limits.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-graphql-error-stack-trace` [api / medium / header]
**GraphQL error response leaks stack trace**

Stack traces in error.extensions.stacktrace expose file paths, framework versions, and SQL fragments to any unauthenticated caller.

**Risk:** Mask stacktrace in production and log it server-side only (Apollo: formatError, graphql-playground: HideStackTrace).

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Mask stacktrace in production and log it server-side only (Apollo: formatError, graphql-playground: HideStackTrace).
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-graphql-query-cost-not-enforced` [api / high / header]
**GraphQL query cost / complexity not enforced**

Without cost analysis, a query that joins every table or fires N+1 resolvers can pin a CPU for minutes. Depth-limit alone misses wide queries.

**Risk:** Add graphql-query-complexity or graphql-cost-analysis and reject queries above your budget.

**References:**
- https://github.com/slicknode/graphql-query-complexity

**Fix:**
- Add graphql-query-complexity or graphql-cost-analysis and reject queries above your budget.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-openapi-security-scheme-weak` [api / high / header]
**OpenAPI security scheme is weak or missing**

An OpenAPI document with no securitySchemes, or one that lists only apiKey in header, signals that the API does not enforce real authentication.

**Risk:** Declare a strong security scheme (OAuth2 + JWT or mTLS) and require it on every operation.

**References:**
- https://swagger.io/docs/specification/authentication/

**Fix:**
- Declare a strong security scheme (OAuth2 + JWT or mTLS) and require it on every operation.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-openapi-default-values-sensitive` [api / medium / header]
**OpenAPI schema declares defaults for sensitive fields**

Defaults such as isAdmin: false, role: user, or apiKey: REPLACE_ME teach attackers the shape of state and embed credentials in client SDKs.

**Risk:** Remove default values from any field marked x-sensitive or whose name contains token / password / role.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Remove default values from any field marked x-sensitive or whose name contains token / password / role.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-jwt-alg-none` [api / critical / header]
**JWT verifier accepts alg=none**

A token with alg=none carries no signature. Verifiers that accept it let attackers forge any subject, role, or expiry they want.

**Risk:** Pin alg to RS256/ES256 explicitly; reject any token whose header alg is none or mismatched to the key type.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8725

**Fix:**
- Pin alg to RS256/ES256 explicitly; reject any token whose header alg is none or mismatched to the key type.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-jwt-hs256-weak-secret` [api / critical / header]
**JWT HS256 signed with weak or hard-coded secret**

HS256 trusts a shared secret. If the secret is short, default, or checked into source, attackers can sign forged tokens offline.

**Risk:** Use 256-bit+ random secrets from a KMS, rotate periodically, or switch to RS256 with a private key.

**References:**
- https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/

**Fix:**
- Use 256-bit+ random secrets from a KMS, rotate periodically, or switch to RS256 with a private key.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-jwt-missing-exp-claim` [api / high / header]
**JWT issued without exp claim**

Tokens without an explicit expiry live forever once stolen. Replay attacks succeed indefinitely and revocation is impossible.

**Risk:** Always include exp (<=1h for access tokens) and validate exp server-side on every request.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Always include exp (<=1h for access tokens) and validate exp server-side on every request.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-cors-credentials-with-wildcard-origin` [api / critical / header]
**CORS allows credentials with wildcard or reflected origin**

Sending Access-Control-Allow-Credentials: true alongside Access-Control-Allow-Origin: * (or a reflected Origin) lets any site issue authenticated requests as the victim.

**Risk:** Replace wildcard with an explicit allowlist of origins and only set Allow-Credentials when the request matches.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Credentials

**Fix:**
- Replace wildcard with an explicit allowlist of origins and only set Allow-Credentials when the request matches.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-cors-null-origin-reflected` [api / high / header]
**CORS reflects Origin: null**

Echoing the literal string 'null' as Access-Control-Allow-Origin is exploitable because sandboxed iframes, file://, and data: URIs all send Origin: null.

**Risk:** Never echo 'null'; reject it or require an explicit origin match against your allowlist.

**References:**
- https://portswigger.net/web-security/cors

**Fix:**
- Never echo 'null'; reject it or require an explicit origin match against your allowlist.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-cors-preflight-cache-over-24h` [api / low / header]
**CORS preflight cache exceeds 24 hours**

Access-Control-Max-Age above 86400 pins browsers to a stale allowlist. New disallowed headers or origins take up to Max-Age seconds to take effect.

**Risk:** Cap Max-Age at 600 (10 min) for production APIs; use shorter windows when rolling out CORS changes.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Cap Max-Age at 600 (10 min) for production APIs; use shorter windows when rolling out CORS changes.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rate-limit-per-ip-no-auth` [api / medium / header]
**Rate-limit keyed only on client IP, no auth required**

Per-IP throttling is fine for anonymous traffic, but auth-less endpoints behind a shared NAT or proxy can be exhausted by one noisy neighbour.

**Risk:** Require authentication on sensitive endpoints and key rate-limits on the authenticated principal.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Require authentication on sensitive endpoints and key rate-limits on the authenticated principal.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rate-limit-headers-not-enforced-on-paths` [api / medium / header]
**Rate-limit headers present but only enforced on some paths**

Returning X-RateLimit-* headers without enforcing the cap is theatre. Callers see budgets they cannot exceed in the response but can hammer the server anyway.

**Risk:** Verify that every endpoint emitting rate-limit headers actually blocks or throttles at the limit.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Verify that every endpoint emitting rate-limit headers actually blocks or throttles at the limit.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-soap-soapaction-injection` [api / high / header]
**SOAPAction header injection / SSRF**

If the SOAPAction header is passed verbatim to a downstream HTTP call without validation, attackers can pivot the request to internal services.

**Risk:** Strict-allowlist the SOAPAction value; never concatenate it into outbound URLs.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Strict-allowlist the SOAPAction value; never concatenate it into outbound URLs.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-soap-xxe-enabled` [api / critical / header]
**SOAP/XML parser has external entities enabled (XXE)**

XML parsers with DOCTYPE / external entity processing enabled allow attackers to read local files, hit SSRF endpoints, and exfiltrate via DTD.

**Risk:** Disable DTD processing and external entity resolution on every XML/SOAP parser; use a hardened factory.

**References:**
- https://owasp.org/www-community/vulnerabilities/XML_External_Entity_Processing

**Fix:**
- Disable DTD processing and external entity resolution on every XML/SOAP parser; use a hardened factory.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-soap-wsdl-publicly-accessible` [api / medium / header]
**WSDL publicly accessible**

Auto-published WSDL files enumerate every operation, parameter type, and binding - a blueprint for crafting SOAP-level attacks.

**Risk:** Restrict ?wsdl behind authentication or remove it from production endpoints.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Restrict ?wsdl behind authentication or remove it from production endpoints.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-websocket-no-origin-validation` [api / high / header]
**WebSocket upgrade does not validate Origin**

A WebSocket handshake that ignores the Origin header lets any malicious site open an authenticated WS connection and stream events to the victim.

**Risk:** Validate the Origin header against an allowlist in the HTTP upgrade handler before completing the handshake.

**References:**
- https://portswigger.net/web-security/websockets

**Fix:**
- Validate the Origin header against an allowlist in the HTTP upgrade handler before completing the handshake.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-websocket-no-max-message-size` [api / medium / header]
**WebSocket has no max message size**

Without a max message size, a single client can pin server memory by sending an oversized frame, or trigger decompressor-bombs if payloads are gzipped.

**Risk:** Set maxPayload to a sane limit (e.g., 64KB) and reject larger frames at the server.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Set maxPayload to a sane limit (e.g., 64KB) and reject larger frames at the server.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-websocket-no-idle-timeout` [api / low / header]
**WebSocket has no idle / disconnect timeout**

Idle WS connections accumulate as file descriptors and sockets. Eventually the process hits FD limits and refuses new connections.

**Risk:** Close idle sockets after 60s of inactivity and ping every 30s to keep them warm.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Close idle sockets after 60s of inactivity and ping every 30s to keep them warm.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rest-no-idempotency-key` [api / medium / header]
**POST endpoint accepts no Idempotency-Key**

Without an Idempotency-Key header, network retries can double-charge payments, duplicate records, or fire emails twice.

**Risk:** Require Idempotency-Key on POST /payments, /webhooks and dedupe by key for >=24h.

**References:**
- https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header

**Fix:**
- Require Idempotency-Key on POST /payments, /webhooks and dedupe by key for >=24h.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rest-mass-assignment-risk` [api / high / header]
**REST endpoint mass-assignment risk**

Endpoints that bind a request body directly to a model (e.g., user.role, isAdmin, internalId) without an explicit allowlist let clients escalate privileges.

**Risk:** Use explicit DTOs / allowlists; never spread req.body onto ORM models.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html

**Fix:**
- Use explicit DTOs / allowlists; never spread req.body onto ORM models.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rest-pagination-headers-missing` [api / low / header]
**REST list endpoint missing pagination headers**

List endpoints without X-Total-Count or Link: rel="next" force clients to fetch until empty, enabling unbounded dumps and denial-of-service via huge queries.

**Risk:** Cap page size (<=100), return total count and Link rel=next/prev headers.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Cap page size (<=100), return total count and Link rel=next/prev headers.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rest-etag-missing` [api / info / header]
**REST endpoint missing ETag / conditional GET**

Without ETags, clients re-download unchanged resources, wasting bandwidth and amplifying scrape traffic.

**Risk:** Emit strong ETags on GET responses and honour If-None-Match.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Emit strong ETags on GET responses and honour If-None-Match.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-graphql-subscription-auth-missing` [api / high / header]
**GraphQL subscription missing per-field auth**

Subscriptions bypass query-time authorization checks. A user subscribed to onUserUpdated can be fed events for other tenants if authZ is on the resolver, not the source stream.

**Risk:** Authorize on the subscribe step and re-check on every event emitted by the async iterator.

**References:**
- https://www.apollographql.com/docs/graphql-subscriptions/

**Fix:**
- Authorize on the subscribe step and re-check on every event emitted by the async iterator.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-rest-no-hateoas-links` [api / info / header]
**REST response missing _links / HATEOAS navigation**

Without discoverable links in responses, clients hard-code URLs and break when paths change. Not a security issue but a maintainability one.

**Risk:** Embed HAL / JSON-LD _links so clients follow relations instead of strings.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Embed HAL / JSON-LD _links so clients follow relations instead of strings.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `rate-limiting` [api / info / stub]
**Rate Limiting**

Security check `rate-limiting` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under api.

**Why it matters:** The rate-limiting check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `options-method-exposed` [api / info / stub]
**Options Method Exposed**

Security check `options-method-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under api.

**Why it matters:** The options-method-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `soap-endpoint` [api / info / stub]
**Soap Endpoint**

Security check `soap-endpoint` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under api.

**Why it matters:** The soap-endpoint check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `xml-rpc` [api / info / stub]
**Xml Rpc**

Security check `xml-rpc` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under api.

**Why it matters:** The xml-rpc check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `trace-method-enabled` [api / info / stub]
**Trace Method Enabled**

Security check `trace-method-enabled` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under api.

**Why it matters:** The trace-method-enabled check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- https://owasp.org/API-Security/editions/2023/en/0x10-toc/

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Category: code (126 checks)

### `insecure-form-submission` [code / critical / combined]
**Form Submits Data Over Insecure HTTP**

An HTTPS page contains a form that submits data to an HTTP endpoint.

**Risk:** User credentials and form inputs are transmitted in plaintext.

**Why it matters:** When a secure page sends form data to an insecure endpoint, all submitted data travels unencrypted.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Change all form action URLs to use HTTPS.
- Use relative URLs so forms inherit the page protocol.
- Implement HSTS.
- **Fix** (html):
```html
<!-- BAD -->
<form action="http://example.com/login" method="POST">
<!-- GOOD -->
<form action="/login" method="POST">
```

### `prototype-pollution` [code / medium / body-pattern]
**Potential Prototype Pollution Sinks Detected**

Vulnerable library functions that could allow modification of Object.prototype.

**Risk:** Prototype pollution can lead to XSS, privilege escalation, or denial of service.

**Why it matters:** Vulnerable functions like Lodash merge/set or jQuery.extend with deep merging can be exploited via __proto__ keys.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Update vulnerable libraries: Lodash to 4.17.12+, jQuery to 3.4.0+.
- Use Object.create(null) for dictionary objects.
- Sanitize user input to reject __proto__ and constructor keys.
- Use Map instead of plain objects for user-controlled data.
- **Safe merge** (javascript):
```javascript
function safeMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    target[key] = source[key];
  }
}
```

### `command-injection` [code / high / body-pattern]
**Potential Command Injection Vectors**

Code patterns that execute system commands, potentially vulnerable to command injection.

**Risk:** Command injection allows attackers to execute arbitrary system commands.

**Why it matters:** Executing system commands with user-controlled input is extremely dangerous.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Never pass user input to system command functions.
- Use language-native APIs instead of shell commands.
- Run with minimal privileges.
- **Safe alternative** (typescript):
```typescript
// BAD: exec(`rm <value>`);
// GOOD:
import { unlink } from 'fs/promises';
await unlink(sanitizedPath);
```

### `code-jwt-decode-only` [code / high / body-pattern]
**XML External Entity (XXE) Declaration Detected**

XML entity declarations using SYSTEM keyword that can enable XXE attacks.

**Risk:** XXE can lead to file disclosure, SSRF, denial of service, and sometimes remote code execution.

**Why it matters:** XML External Entity attacks exploit XML parsers that process external entities.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Disable external entity processing in all XML parsers.
- Use JSON instead of XML when possible.
- Keep XML parsing libraries updated.
- **Disable XXE (Node.js)** (javascript):
```javascript
const doc = libxmljs.parseXml(xmlString, { noent: false, nonet: true });
```

### `path-traversal` [code / high / body-pattern]
**Potential Path Traversal Vulnerability**

File operations with user-controlled paths that could allow directory traversal.

**Risk:** Path traversal allows attackers to read arbitrary files on the server.

**Why it matters:** Path traversal occurs when user input is used to construct file paths without validation.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Never use user input directly in file paths.
- Validate resolved path is within expected directory.
- Use an allowlist of permitted files.
- Reject input containing '..' or absolute paths.
- **Safe path handling** (typescript):
```typescript
import path from 'path';
const baseDir = '/var/app/uploads';
const safePath = path.resolve(baseDir, userInput);
if (!safePath.startsWith(baseDir)) throw new Error('Invalid path');
```

### `insecure-auth` [code / high / combined]
**Insecure Authentication Mechanisms Detected**

Authentication security issues that could compromise user sessions.

**Risk:** Weak authentication allows credential theft, session hijacking, or authentication bypass.

**Why it matters:** Secure authentication requires proper cookie flags, token handling in headers, and avoiding Basic authentication.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use secure session cookies with HttpOnly, Secure, SameSite=Strict.
- Never pass authentication tokens in URLs.
- Replace HTTP Basic Auth with token-based authentication.
- **Secure cookie** (typescript):
```typescript
response.headers.set('Set-Cookie', `sessionId=<value>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`);
```

### `insecure-deserialization` [code / high / body-pattern]
**Potential Insecure Deserialization**

Deserialization operations on potentially untrusted data.

**Risk:** Insecure deserialization can allow remote code execution.

**Why it matters:** Deserializing untrusted data can instantiate arbitrary objects or execute code.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Only deserialize data from trusted sources.
- Use safe formats like JSON.
- Implement integrity checks (signatures/HMACs).
- Use allowlists for deserializable classes.
- **Safe JSON parsing** (typescript):
```typescript
const schema = z.object({ id: z.number(), name: z.string() });
const data = schema.parse(JSON.parse(input));
```

### `eval-in-scripts` [code / medium / body-pattern]
**eval() Usage in Inline Scripts**

Direct eval() calls found in inline scripts.

**Risk:** eval() can execute arbitrary code if input is attacker-controlled.

**Why it matters:** eval() interprets strings as code, creating injection risks.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Replace eval() with JSON.parse() or safe alternatives.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `innerhtml-xss-sink` [code / medium / body-pattern]
**innerHTML DOM XSS Sink**

Multiple innerHTML assignments detected.

**Risk:** User input reaching innerHTML can execute arbitrary scripts.

**Why it matters:** innerHTML parses and executes HTML, making it a common XSS vector.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use textContent for text, or sanitize HTML before assignment.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `outerhtml-xss-sink` [code / medium / body-pattern]
**outerHTML DOM XSS Sink**

outerHTML assignment detected.

**Risk:** Similar to innerHTML, can execute arbitrary scripts.

**Why it matters:** outerHTML replaces the element entirely with parsed HTML.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Avoid outerHTML with user input, use safe DOM methods.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `document-write-sink` [code / high / body-pattern]
**document.write DOM XSS Sink**

document.write() call detected.

**Risk:** Can completely overwrite page content with attacker-controlled HTML.

**Why it matters:** document.write is a powerful and dangerous DOM manipulation method.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Replace with appendChild or insertAdjacentHTML with sanitization.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `insertadjacenthtml-sink` [code / medium / body-pattern]
**insertAdjacentHTML DOM Sink**

insertAdjacentHTML() usage detected.

**Risk:** Can inject HTML at various positions in the DOM.

**Why it matters:** Like innerHTML, this method parses HTML strings.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Sanitize input or use insertAdjacentText for text-only insertion.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `unsafe-setattribute` [code / medium / body-pattern]
**Unsafe setAttribute Usage**

setAttribute used with event handlers or URL attributes.

**Risk:** Can create XSS by setting onclick, onload, href, src attributes.

**Why it matters:** Event handler attributes execute JavaScript when triggered.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use property assignment or sanitize values before setAttribute.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `ssrf-indicators` [code / medium / body-pattern]
**Potential SSRF Indicators**

URL parameters that may be used for server-side requests.

**Risk:** Attacker could make server fetch internal resources.

**Why it matters:** SSRF allows attackers to access internal services through the server.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Validate and whitelist allowed URLs, block internal IPs.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `path-traversal-indicators` [code / high / body-pattern]
**Path Traversal Indicators**

Path traversal sequences in URL parameters.

**Risk:** Could access files outside intended directory.

**Why it matters:** ../sequences can escape the web root to read sensitive files.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Validate paths, use basename(), never concatenate user input.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `ssti-indicators` [code / high / body-pattern]
**Template Injection Indicators**

Template syntax detected in output.

**Risk:** Server-Side Template Injection can lead to RCE.

**Why it matters:** Unescaped template expressions can execute arbitrary code.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Escape all user input before template rendering.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-xss-template-tag` [code / high / body-pattern]
**XML External Entity Declaration**

XML entity declaration found in response.

**Risk:** XXE can read local files, perform SSRF, or cause DoS.

**Why it matters:** External entities can reference local files or URLs.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Disable external entity processing in XML parser.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `command-injection-indicators` [code / medium / body-pattern]
**Command Injection Parameter Names**

Command-related parameter names detected.

**Risk:** Could execute arbitrary OS commands.

**Why it matters:** Parameters named cmd, exec, etc. may be passed to shell.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Never pass user input to shell commands, use parameterized APIs.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `eval-usage` [code / high / body-pattern]
**eval() Usage Detected**

JavaScript eval() function calls detected.

**Risk:** eval executes arbitrary code, enabling code injection.

**Why it matters:** eval() is one of the most dangerous JavaScript functions.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Replace eval with JSON.parse or safer alternatives.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `function-constructor` [code / high / body-pattern]
**Function Constructor Usage**

new Function() usage detected.

**Risk:** Similar to eval(), can execute arbitrary code.

**Why it matters:** Function constructor creates functions from strings.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Avoid Function constructor, use direct function definitions.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `settimeout-string` [code / medium / body-pattern]
**setTimeout/setInterval with String**

Timer functions with string argument.

**Risk:** String arguments are eval'd, enabling code injection.

**Why it matters:** setTimeout('code', 0) is equivalent to eval('code').

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Pass functions, not strings, to setTimeout/setInterval.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cmdi-exec` [code / info / body-pattern]
**Media Device Access**

Camera/microphone API access detected.

**Risk:** Privacy concern - ensure user consent.

**Why it matters:** getUserMedia accesses camera and microphone.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Ensure explicit user consent before accessing media.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `regex-dos-pattern` [code / medium / body-pattern]
**Potential ReDoS Pattern**

Regex pattern that may be vulnerable to ReDoS.

**Risk:** CPU exhaustion via crafted input.

**Why it matters:** Nested quantifiers cause exponential backtracking.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Review and simplify regex patterns.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `localstorage-sensitive` [code / medium / body-pattern]
**Sensitive Data in localStorage**

Sensitive data patterns being stored in localStorage.

**Risk:** Data accessible to any script on the page.

**Why it matters:** localStorage is not encrypted and accessible via XSS.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use secure, HttpOnly cookies for sensitive data.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sessionstorage-tokens` [code / medium / body-pattern]
**Tokens in sessionStorage**

Authentication tokens stored in sessionStorage.

**Risk:** Vulnerable to XSS-based token theft.

**Why it matters:** sessionStorage is accessible via JavaScript.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Store tokens in HttpOnly cookies.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `indexeddb-sensitive` [code / low / body-pattern]
**IndexedDB Storing Sensitive Data**

IndexedDB usage with potentially sensitive data.

**Risk:** Data persists and is accessible to scripts.

**Why it matters:** IndexedDB can store large amounts of data.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Encrypt sensitive data before storing in IndexedDB.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `window-name-storage` [code / medium / body-pattern]
**Data Storage in window.name**

window.name used for data storage.

**Risk:** Data persists across navigations and can leak.

**Why it matters:** window.name is shared across origins in some cases.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Clear window.name, use proper storage APIs.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `service-worker-insecure` [code / info / body-pattern]
**Service Worker Registration**

Service worker registration detected.

**Risk:** Compromised SW can intercept all requests.

**Why it matters:** Service workers are powerful and persistent.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Ensure SW is properly secured and scoped.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `push-api-usage` [code / info / body-pattern]
**Push Notification API Usage**

Push API/notifications usage detected.

**Risk:** Privacy concern if abused.

**Why it matters:** Push notifications require user consent.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Ensure notifications are used appropriately.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `payment-request-api` [code / info / body-pattern]
**Payment Request API Usage**

Payment Request API detected.

**Risk:** Ensure secure payment handling.

**Why it matters:** Payment API handles financial transactions.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Follow PCI DSS guidelines for payment handling.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `credential-management-api` [code / info / body-pattern]
**Credential Management API Usage**

Credential Management API detected.

**Risk:** Handles sensitive credential storage.

**Why it matters:** This API stores and retrieves credentials.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use properly with HTTPS and security best practices.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `webauthn-usage` [code / info / body-pattern]
**WebAuthn/Passkey Implementation**

WebAuthn API usage detected.

**Risk:** Strong authentication method.

**Why it matters:** WebAuthn enables passwordless authentication.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Ensure proper implementation.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `crypto-subtle-usage` [code / info / body-pattern]
**SubtleCrypto API Usage**

Web Crypto API usage detected.

**Risk:** Ensure proper key management.

**Why it matters:** Web Crypto provides cryptographic operations.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use secure random generation and proper key storage.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `wasm-usage` [code / info / body-pattern]
**WebAssembly Usage Detected**

WebAssembly modules detected.

**Risk:** WASM code harder to audit.

**Why it matters:** WebAssembly runs compiled code in browser.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Ensure WASM source is trusted.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `console-log-production` [code / low / body-pattern]
**Console Logging in Production**

Extensive console.log statements detected.

**Risk:** May expose sensitive debug information.

**Why it matters:** Console logs can reveal internal state.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Remove or disable console.log in production.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `debugger-statement` [code / low / body-pattern]
**Debugger Statement in Code**

JavaScript debugger statement found.

**Risk:** Pauses execution in dev tools.

**Why it matters:** Debugger statements should be removed.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Remove debugger statements in production.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `error-boundary-missing` [code / low / body-pattern]
**React Error Boundary Issues**

React components may lack error boundaries.

**Risk:** Unhandled errors may crash the app.

**Why it matters:** Error boundaries prevent full-page crashes.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Implement React error boundaries.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-fetch-without-credentials` [code / low / header]
**fetch() call without credentials mode**

fetch(url, { credentials: 'omit' }) prevents cookies from being sent, but auth tokens via cookies won't work.

**Risk:** Explicitly set credentials: 'include' or 'same-origin'

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Explicitly set credentials: 'include' or 'same-origin'
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-axios-defaults-baseurl` [code / info / header]
**axios.defaults.baseURL set to dev server**

Hard-coded axios.defaults.baseURL = 'http://localhost:3000' will leak into production builds.

**Risk:** Move API base URLs to environment variables

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Move API base URLs to environment variables
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-fetch-no-timeout` [code / low / header]
**fetch() without AbortSignal.timeout**

fetch() with no timeout can hang indefinitely under network failure.

**Risk:** Add signal: AbortSignal.timeout(5000) to every fetch

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Add signal: AbortSignal.timeout(5000) to every fetch
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-dangerously-setinnerhtml` [code / high / header]
**dangerouslySetInnerHTML usage**

React's dangerouslySetInnerHTML bypasses React's escaping. Combine with user input = XSS.

**Risk:** Replace dangerouslySetInnerHTML with safe React rendering; if needed, sanitize with DOMPurify

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Replace dangerouslySetInnerHTML with safe React rendering; if needed, sanitize with DOMPurify
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-eval-setinterval-string` [code / high / header]
**setInterval with string arg**

setInterval('code', 1000) is implicitly eval(). Pass a function reference instead.

**Risk:** Use setInterval(function() {}, 1000) instead of setInterval('...', 1000)

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use setInterval(function() {}, 1000) instead of setInterval('...', 1000)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-object-assign-from-user` [code / medium / header]
**Object.assign target from user**

Object.assign(target, userInput) with a user-supplied target can pollute Object.prototype.

**Risk:** Never let the user control the Object.assign target; use spread instead

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Never let the user control the Object.assign target; use spread instead
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-spread-into-globals` [code / low / header]
**Spread into globals**

Spreading user input into a globals object can leak fields like __proto__.

**Risk:** Sanitize keys; reject any that contain __proto__, constructor, prototype

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Sanitize keys; reject any that contain __proto__, constructor, prototype
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cookie-without-httponly` [code / medium / header]
**document.cookie write missing HttpOnly**

document.cookie = 'sid=...'; sets a cookie without HttpOnly, allowing JS access.

**Risk:** Set HttpOnly; if the cookie must be readable by JS, prefer localStorage

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Set HttpOnly; if the cookie must be readable by JS, prefer localStorage
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cookie-write-no-secure` [code / medium / header]
**document.cookie write missing Secure flag**

Cookies set via document.cookie without Secure can be sent over HTTP.

**Risk:** Add Secure; to every cookie set via document.cookie

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Add Secure; to every cookie set via document.cookie
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cookie-write-no-samesite` [code / low / header]
**document.cookie write missing SameSite**

Cookies without SameSite are sent on cross-site requests (CSRF).

**Risk:** Add SameSite=Lax or SameSite=Strict

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Add SameSite=Lax or SameSite=Strict
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-window-open-without-noopener` [code / medium / header]
**window.open() without noopener**

window.open(url, '_blank') without 'noopener' lets the new tab navigate the source page.

**Risk:** Use window.open(url, '_blank', 'noopener,noreferrer')

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use window.open(url, '_blank', 'noopener,noreferrer')
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-location-assign-with-user-input` [code / high / header]
**location.assign(userInput)**

Assigning to location.* with user-supplied data is an open-redirect vector.

**Risk:** Validate destination host against an allowlist before navigation

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Validate destination host against an allowlist before navigation
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-vue-v-html` [code / high / header]
**Vue v-html directive**

Vue's v-html bypasses Vue's escaping. XSS risk if the bound expression includes user input.

**Risk:** Use {{ }} interpolation; sanitize HTML with DOMPurify if you must use v-html

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use {{ }} interpolation; sanitize HTML with DOMPurify if you must use v-html
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-angular-bypass-security` [code / high / header]
**Angular bypassSecurityTrustHtml**

bypassSecurityTrustHtml marks content as safe, defeating Angular's sanitiser.

**Risk:** Avoid bypassSecurityTrust* unless absolutely necessary; sanitize with DomSanitizer

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Avoid bypassSecurityTrust* unless absolutely necessary; sanitize with DomSanitizer
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-jquery-html` [code / high / header]
**jQuery .html() with user input**

$el.html(userInput) executes arbitrary HTML. Always escape or use .text().

**Risk:** Use .text() or escape user input via a DOMPurify-like library

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use .text() or escape user input via a DOMPurify-like library
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-jquery-global-event` [code / low / header]
**jQuery global event handler**

$(document).on('click', sel, fn) can be triggered by an attacker-controlled selector.

**Risk:** Bind handlers to specific elements, not document

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Bind handlers to specific elements, not document
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-local-storage-pii` [code / medium / header]
**localStorage storing PII**

localStorage is not encrypted and is readable by any JS that runs in the same origin.

**Risk:** Don't store PII, tokens, or session identifiers in localStorage

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Don't store PII, tokens, or session identifiers in localStorage
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-service-worker-no-csp` [code / low / header]
**Service worker registered without CSP**

Service workers can intercept any request on the same origin. CSP without worker-src / script-src leaves them open.

**Risk:** Add worker-src 'self'; restrict script-src to your origin

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Add worker-src 'self'; restrict script-src to your origin
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cookie-write-via-jquery` [code / low / header]
**jQuery cookie plugin usage**

jQuery.cookie() sets cookies via JS and bypasses HttpOnly-equivalent protections.

**Risk:** Use the server's Set-Cookie header instead

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use the server's Set-Cookie header instead
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-stripe-publishable-key` [code / info / header]
**Stripe publishable key exposed**

Stripe publishable keys (pk_live_*) are designed to be client-side. Not a secret.

**Risk:** This is informational

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- This is informational
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-react-refs-innerhtml` [code / medium / header]
**React ref + innerHTML**

Setting element.innerHTML via a ref after hydration bypasses React's rendering.

**Risk:** Use React state to update DOM instead of mutating via refs

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use React state to update DOM instead of mutating via refs
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-angular-interpolation-bypass` [code / medium / header]
**Angular interpolation bypass**

AngularJS (1.x) template injection: user-controlled values rendered via {{ }} or ng-bind-html-unsafe are XSS sinks.

**Risk:** Migrate off AngularJS 1.x; never bind user data into ng-bind-html-unsafe

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Migrate off AngularJS 1.x; never bind user data into ng-bind-html-unsafe
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-xss-insertadjacentelement` [code / high / body-pattern]
**insertAdjacentElement XSS sink**

insertAdjacentElement splices a live DOM node into the document. When the node is built from attacker-controlled input, it bypasses HTML-string sanitizers because no HTML parsing is performed.

**Risk:** Attacker-controlled DOM nodes can execute JavaScript in the page origin without HTML-parser sanitizers firing.

**Why it matters:** The code-xss-insertadjacentelement check verifies that the server does not expose the xss-insertadjacentelement weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/API/Element/insertAdjacentElement
- https://owasp.org/www-community/attacks/xss/

**Fix:**
- Treat any element passed to insertAdjacentElement as untrusted; build it server-side with escaping.
- Prefer insertAdjacentText for plain-text interpolation.
- If nodes must be created from strings, sanitize with DOMPurify before parsing into a node.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-xss-createcontextualfragment` [code / high / body-pattern]
**Range.createContextualFragment XSS sink**

Range.createContextualFragment(fragString) parses HTML and returns a DocumentFragment. Passing user-controlled HTML directly into the fragment lets attackers inject <script> or event-handler nodes that execute immediately on insertion.

**Risk:** Attacker-controlled HTML strings execute JavaScript in the page origin the moment the fragment is inserted.

**Why it matters:** The code-xss-createcontextualfragment check verifies that the server does not expose the xss-createcontextualfragment weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/API/Range/createContextualFragment

**Fix:**
- Sanitize the HTML string with DOMPurify before passing it to createContextualFragment.
- Prefer DOMParser.parseFromString with explicit text/html and sanitization.
- Use textContent for text-only insertion.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-xss-documentwrite-jsonparse` [code / critical / body-pattern]
**document.write with JSON.parse(userInput)**

Combining document.write with JSON.parse(userInput) reflects attacker-controlled string values straight into the document, where any <script> or on* attribute is executed before any sanitizer can intercept it.

**Risk:** document.write runs synchronously during parse; injected scripts execute in the page origin and persist.

**Why it matters:** The code-xss-documentwrite-jsonparse check verifies that the server does not expose the xss-documentwrite-jsonparse weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://owasp.org/www-community/attacks/xss/

**Fix:**
- Never reflect parsed user JSON into document.write.
- Render values via textContent into a known-safe container after DOMContentLoaded.
- Add a strict CSP with script-src 'self' to block inline injection.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-xss-dangerouslysetinnerhtml-dynamic` [code / high / body-pattern]
**dangerouslySetInnerHTML with computed value**

dangerouslySetInnerHTML={{ __html: buildHtml(userInput) }} constructs the HTML string at render time from attacker-controlled parts, defeating any earlier sanitization that operated on the raw field alone.

**Risk:** Computed or concatenated HTML strings can smuggle <script>, <iframe>, or event handlers past component-level sanitizers.

**Why it matters:** The code-xss-dangerouslysetinnerhtml-dynamic check verifies that the server does not expose the xss-dangerouslysetinnerhtml-dynamic weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html

**Fix:**
- Sanitize the final computed string with DOMPurify before passing it to dangerouslySetInnerHTML.
- Avoid string concatenation; render React components for trusted structure.
- Consider Trusted Types policy with require-trusted-types-for 'script'.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-xss-vue-v-html-dynamic` [code / high / body-pattern]
**Vue v-html with computed expression**

<div v-html="computed(userInput)"></div> evaluates a computed expression that mixes user data into HTML; any <script> or event-handler tags are inserted verbatim.

**Risk:** Attacker-controlled HTML executes JavaScript in the Vue app origin.

**Why it matters:** The code-xss-vue-v-html-dynamic check verifies that the server does not expose the xss-vue-v-html-dynamic weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://vuejs.org/api/built-in-directives.html#v-html

**Fix:**
- Sanitize the computed string with DOMPurify before binding to v-html.
- Use Mustache interpolation {{ value }} unless the HTML is provably safe.
- Adopt Trusted Types to gate v-html assignments.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-xss-angular-bypass-dynamic` [code / high / body-pattern]
**Angular bypassSecurityTrust* with user input**

Calling bypassSecurityTrustHtml(userInput) or bypassSecurityTrustScript(userInput) tells Angular the value is safe, completely defeating its built-in DomSanitizer.

**Risk:** Attacker-controlled HTML or URL is rendered as-is, enabling stored XSS or javascript: navigation.

**Why it matters:** The code-xss-angular-bypass-dynamic check verifies that the server does not expose the xss-angular-bypass-dynamic weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://angular.dev/api/core/DomSanitizer

**Fix:**
- Sanitize the value with DomSanitizer.sanitize(SecurityContext.HTML, ...) before trusting it.
- Avoid passing user input directly into bypassSecurityTrust* APIs.
- Render Angular templates with interpolation; reserve bypass for known-static strings.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-xss-domparser-parsefromstring` [code / medium / body-pattern]
**DOMParser.parseFromString user HTML**

new DOMParser().parseFromString(userInput, 'text/html') parses arbitrary HTML into a Document. Subsequent node import via adoptNode or document.importNode preserves <script> elements, which can execute when reattached.

**Risk:** Scripts parsed via DOMParser can survive adoption into the host document and execute.

**Why it matters:** The code-xss-domparser-parsefromstring check verifies that the server does not expose the xss-domparser-parsefromstring weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString

**Fix:**
- Sanitize the parsed result with DOMPurify before adopting any nodes.
- Strip <script> elements after parseFromString.
- Prefer textContent rendering to direct DOM adoption.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cmdi-spawn-shell-true` [code / critical / body-pattern]
**child_process.spawn with shell:true**

spawn(cmd, { shell: true }) or spawn("sh -c " + cmd) re-routes the command through /bin/sh, so any unescaped metacharacter in arguments (& ; | $ ` \n) executes attacker commands.

**Risk:** Attacker-controlled arguments gain full shell-injection capability, leading to RCE on the host.

**Why it matters:** The code-cmdi-spawn-shell-true check verifies that the server does not expose the cmdi-spawn-shell-true weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://nodejs.org/api/child_process.html#child_processspawncommand-args-options

**Fix:**
- Pass args as a separate array; spawn with shell:false and let Node escape them.
- Validate every argument against a strict allowlist before invoking.
- Run the child process under a non-root user and inside a sandboxed environment.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cmdi-os-exec` [code / critical / body-pattern]
**os.exec / os.system / os.popen usage**

Python's os.system, os.exec*, and os.popen pass their string argument to the shell. Any user-controlled portion executes as a shell command.

**Risk:** Attacker can chain arbitrary shell commands and read or destroy server files.

**Why it matters:** The code-cmdi-os-exec check verifies that the server does not expose the cmdi-os-exec weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://docs.python.org/3/library/os.html#os.system

**Fix:**
- Use subprocess.run([...], shell=False) with argument arrays.
- Validate inputs against an allowlist of permitted values.
- Avoid shlex.join on attacker-controlled strings; allowlist first.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cmdi-bin-sh-concat` [code / critical / body-pattern]
**String-built /bin/sh invocation**

Patterns like os.system("/bin/sh -c '" + userInput + "'") or exec("sh -c " + userInput) build a shell command via concatenation or interpolation, embedding attacker input into a parsed shell string.

**Risk:** Concatenated shell strings let attackers break out of quotes and execute arbitrary commands.

**Why it matters:** The code-cmdi-bin-sh-concat check verifies that the server does not expose the cmdi-bin-sh-concat weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://cwe.mitre.org/data/definitions/78.html

**Fix:**
- Eliminate the shell entirely: use execve, subprocess.run(args), or Node's spawn with an arg array.
- If a shell is mandatory, use shlex.quote or equivalent escaping on every variable.
- Validate the final command against an allowlist of permitted executables and flags.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cmdi-popen` [code / high / body-pattern]
**subprocess.Popen / os.popen with user input**

subprocess.Popen(builtString, shell=True) and os.popen(builtString) both run their input through a shell. Even partial user influence over arguments enables command injection via metacharacters.

**Risk:** Shell injection through Popen/popen gives the attacker a shell on the host.

**Why it matters:** The code-cmdi-popen check verifies that the server does not expose the cmdi-popen weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://docs.python.org/3/library/subprocess.html#subprocess.Popen

**Fix:**
- Always pass shell=False and an args list to Popen.
- Run untrusted input through shlex.quote before any shell-escape necessity.
- Set close_fds=True and use minimal env to reduce side effects.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cmdi-process-spawn` [code / high / body-pattern]
**child_process.spawn/execFile concatenated args**

spawn("git " + userArg) or execFile(`tool ${userArg}`) builds an argument string via concatenation. Although execFile itself does not invoke a shell, the embedded space allows attackers to inject additional flags or arguments.

**Risk:** Argument injection lets attackers invoke unintended subcommands, read arbitrary files, or trigger built-in shell escapes.

**Why it matters:** The code-cmdi-process-spawn check verifies that the server does not expose the cmdi-process-spawn weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://nodejs.org/api/child_process.html#child_processspawncommand-args-options

**Fix:**
- Pass user input as a discrete array element: spawn(cmd, [userArg]).
- Allowlist each argument value before passing to execFile.
- Use -- separator to stop flag parsing when relevant.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-sqli-mongodb-where` [code / high / body-pattern]
**MongoDB $where injection**

MongoDB queries of the form { $where: "this.field == '" + userInput + "'" } or { $where: Function("return this.x == '" + userInput + "'") } embed user input into JavaScript that runs server-side on every document in the collection.

**Risk:** Attacker can run arbitrary JavaScript on the MongoDB server, leaking documents and bypassing authentication.

**Why it matters:** The code-sqli-mongodb-where check verifies that the server does not expose the sqli-mongodb-where weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://www.mongodb.com/docs/manual/reference/operator/query/where/

**Fix:**
- Avoid $where entirely; use standard query operators with typed values.
- If aggregation is required, prefer $expr with sanitized expressions.
- Disable server-side JavaScript via --noscripting on mongod.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-sqli-mongodb-regex` [code / medium / body-pattern]
**MongoDB $regex from user input**

Building a MongoDB query with { field: { $regex: userInput } } or new RegExp(userInput) lets attackers supply patterns that match every document (.*) or trigger catastrophic backtracking, leaking data or causing DoS.

**Risk:** Wildcard or pathological regex patterns expose every document or stall the server.

**Why it matters:** The code-sqli-mongodb-regex check verifies that the server does not expose the sqli-mongodb-regex weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://www.mongodb.com/docs/manual/reference/operator/query/regex/

**Fix:**
- Escape regex metacharacters before compiling user input with RegExp.
- Anchor patterns with ^ and bound their length; reject unbounded inputs.
- Prefer $text indexes over $regex for user-driven search.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-sqli-raw-query-string` [code / critical / body-pattern]
**Raw query string concatenation**

db.query("SELECT * FROM users WHERE id = '" + userId + "'") or knex.raw(`SELECT * FROM x WHERE id = ${userId}`) build a SQL string from user input, enabling classic SQL injection.

**Risk:** Classic SQL injection: data exfiltration, authentication bypass, and potentially full RCE on the database server.

**Why it matters:** The code-sqli-raw-query-string check verifies that the server does not expose the sqli-raw-query-string weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Use parameterized queries or prepared statements with placeholders.
- Replace knex.raw with knex('table').where({ id: userId }).
- Run a query allowlist review for every knex.raw / sequelize.literal / db.query call site.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-sqli-template-literal-query` [code / critical / body-pattern]
**SQL via template literal interpolation**

Tag-less template literals like pool.query(`SELECT * FROM t WHERE id = ${id}`) interpolate user input directly into SQL text. Tagged sql`` libraries are safe; bare backticks are not.

**Risk:** Template-literal SQL injection exposes all rows the caller can see and can pivot to RCE on the database host.

**Why it matters:** The code-sqli-template-literal-query check verifies that the server does not expose the sqli-template-literal-query weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://github.com/Poordeveloper/node-sql-template-tag

**Fix:**
- Switch to a tagged template SQL helper (sql...) that auto-parameterizes.
- Or use placeholders: pool.query('SELECT * FROM t WHERE id = $1', [id]).
- Add a lint rule banning untagged template SQL.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-sqli-mongoose-find-user` [code / high / body-pattern]
**Mongoose find with user JSON**

Model.find(JSON.parse(req.body)) passes a user-supplied object directly into a Mongo query. Attackers can inject query operators like $where, $regex, or $ne to bypass access control.

**Risk:** Attacker injects NoSQL operators to bypass filters, leak other users' documents, or trigger $where JavaScript.

**Why it matters:** The code-sqli-mongoose-find-user check verifies that the server does not expose the sqli-mongoose-find-user weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://www.npmjs.com/package/express-mongo-sanitize

**Fix:**
- Use an explicit schema (Joi/Zod) to strip unknown keys before reaching find().
- Apply express-mongo-sanitize or mongo-sanitize to remove $-prefixed operators.
- Validate types: ensure ids are strings, numbers, or ObjectIds only.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-sqli-sequelize-literal` [code / high / body-pattern]
**Sequelize.literal with user input**

Sequelize.literal(userInput) or Sequelize.fn('CONCAT', userInput, 'x') interpolates raw SQL. When the literal contains user data, the resulting WHERE clause is vulnerable to SQL injection.

**Risk:** SQL injection via Sequelize.literal breaks parameterized query boundaries and can exfiltrate the entire database.

**Why it matters:** The code-sqli-sequelize-literal check verifies that the server does not expose the sqli-sequelize-literal weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://sequelize.org/docs/v6/core-concepts/raw-queries/

**Fix:**
- Use Sequelize replacements: { replacements: [userInput] } instead of literal().
- Allowlist column or operator names before passing to literal().
- Wrap identifiers with Sequelize.literal only when names are static.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-deser-yaml-load` [code / critical / body-pattern]
**yaml.load without safe loader**

yaml.load(input) uses the unsafe Loader by default and instantiates arbitrary Python objects via !!python/object tags. yaml.safe_load rejects those tags.

**Risk:** Crafted YAML can execute arbitrary Python during parsing, leading to full RCE on the host.

**Why it matters:** The code-deser-yaml-load check verifies that the server does not expose the deser-yaml-load weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://pyyaml.org/wiki/PyYAMLDocumentation

**Fix:**
- Use yaml.safe_load(input) for any untrusted YAML.
- Or pin a safe Loader: yaml.load(input, Loader=yaml.SafeLoader).
- Validate the YAML schema with a strict parser (e.g. pydantic) before deserialization.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-deser-pickle-loads` [code / critical / body-pattern]
**pickle.loads on untrusted bytes**

pickle.loads(untrusted_bytes) reconstructs arbitrary Python objects and executes their __reduce__ method. Crafted pickles achieve arbitrary code execution at parse time.

**Risk:** Untrusted pickle data triggers arbitrary code execution in the Python interpreter.

**Why it matters:** The code-deser-pickle-loads check verifies that the server does not expose the deser-pickle-loads weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://docs.python.org/3/library/pickle.html

**Fix:**
- Never unpickle data from untrusted sources; use JSON or msgpack instead.
- If unavoidable, verify an HMAC signature on the pickled bytes before loading.
- Use pickle.loads only in isolated processes with restricted privileges.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-deser-base64-eval` [code / critical / body-pattern]
**atob/base64 + eval chain**

Patterns like eval(atob(payload)) or eval(Buffer.from(payload,'base64').toString()) decode and immediately execute attacker-supplied JavaScript. The base64 layer adds nothing; eval still runs the result.

**Risk:** Encoded eval() bypasses naive content filters and runs arbitrary JavaScript in the page or server.

**Why it matters:** The code-deser-base64-eval check verifies that the server does not expose the deser-base64-eval weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://owasp.org/www-community/attacks/Code_Injection

**Fix:**
- Remove eval entirely; decode with atob only if you need data, then JSON.parse.
- Use a sandboxed interpreter like vm2 with strict context if you must run untrusted code.
- Add CSP script-src 'self' to block injected source code.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-deser-jsonparse-newfunction` [code / critical / body-pattern]
**JSON.parse piped into new Function**

new Function('return ' + JSON.parse(input)) or new Function(JSON.parse(input).body) constructs a function body from parsed JSON. The parsed JSON still ships attacker-controlled source code.

**Risk:** Function constructor evaluates attacker-controlled source, enabling arbitrary code execution.

**Why it matters:** The code-deser-jsonparse-newfunction check verifies that the server does not expose the deser-jsonparse-newfunction weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/Function

**Fix:**
- Avoid new Function for untrusted input; use real functions or modules.
- If dynamic logic is required, evaluate it through a safe DSL like JSONLogic.
- Add CSP to block inline scripts even if injection succeeds.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-deser-node-serialize` [code / critical / body-pattern]
**node-serialize deserialize()**

node-serializes serialize/deserialize supports an IIFE payload (rce: _$ND_FUNC$$ = function(){...}()). The deserialize() call evaluates that payload and executes attacker JavaScript on the server.

**Risk:** Untrusted serialized input is evaluated, leading directly to remote code execution.

**Why it matters:** The code-deser-node-serialize check verifies that the server does not expose the deser-node-serialize weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://www.npmjs.com/package/node-serialize

**Fix:**
- Replace node-serialize with JSON.parse; node-serialize is unmaintained and unsafe.
- Validate any unserialized data with a strict schema (Zod, Joi).
- Block the package via package.json overrides or denoising rules.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-deser-php-unserialize` [code / critical / body-pattern]
**PHP unserialize on user input**

unserialize($_COOKIE['x']) or unserialize($request->body) can trigger __wakeup, __destruct, or other magic methods on attacker-chosen classes, leading to RCE via POP gadget chains.

**Risk:** Object injection via PHP unserialize enables property-oriented programming chains and remote code execution.

**Why it matters:** The code-deser-php-unserialize check verifies that the server does not expose the deser-php-unserialize weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://www.php.net/manual/en/function.unserialize.php

**Fix:**
- Use json_decode for any untrusted data instead of unserialize.
- If serialization is required, pass ['allowed_classes' => false] as the second argument.
- Audit any class with magic methods (__wakeup, __destruct) for side effects.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-ssrf-fetch-port` [code / high / body-pattern]
**fetch() targeting localhost / loopback / link-local**

fetch("http://127.0.0.1:8080/..."), fetch("http://[::1]:..."), or fetch("http://169.254.169.254/...") target loopback or cloud metadata endpoints. When the URL is even partially user-controlled, the request can be redirected to internal services.

**Risk:** Attacker reaches internal services such as admin panels, databases, or cloud metadata APIs.

**Why it matters:** The code-ssrf-fetch-port check verifies that the server does not expose the ssrf-fetch-port weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://owasp.org/www-community/attacks/Server_Side_Request_Forgery

**Fix:**
- Resolve the destination hostname and reject private/loopback/link-local ranges before fetching.
- Use an outbound HTTP proxy that enforces an allowlist of external hosts.
- Disable HTTP redirects or re-validate the host after each redirect.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-ssrf-fetch-user-input` [code / high / body-pattern]
**fetch() URL built from user input**

fetch(req.query.url) or fetch(`https://api.example.com/${userPath}`) lets attackers redirect the request to internal hosts (http://localhost, http://169.254.169.254) or arbitrary external services.

**Risk:** Server-side request forgery to internal services, cloud metadata endpoints, or other external systems.

**Why it matters:** The code-ssrf-fetch-user-input check verifies that the server does not expose the ssrf-fetch-user-input weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

**Fix:**
- Build URLs from server-side allowlists, not from raw user input.
- Resolve the host and reject private/loopback IP ranges before issuing the fetch.
- Use a forward proxy that enforces the destination allowlist.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-ssrf-axios-user-input` [code / high / body-pattern]
**axios.get with user-controlled URL**

axios.get(req.body.url) or axios({ url: `https://api/${userId}` }) issues HTTP from the server with attacker-controlled destinations, enabling SSRF and credential theft from metadata endpoints.

**Risk:** Outbound requests reach internal services or cloud metadata APIs that the attacker cannot otherwise reach.

**Why it matters:** The code-ssrf-axios-user-input check verifies that the server does not expose the ssrf-axios-user-input weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://github.com/axios/axios

**Fix:**
- Validate the URL against an allowlist of permitted hosts and paths.
- Resolve the host and block private IP ranges (RFC 1918, loopback, link-local).
- Disable axios follow-redirects or re-validate after each redirect.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-ssrf-xhr-user-input` [code / medium / body-pattern]
**XMLHttpRequest URL from user input**

xhr.open("GET", userInput) or fetch via XHR with a user-supplied URL allows attackers to drive requests to arbitrary hosts when called server-side (e.g. in Node + jsdom or in service workers).

**Risk:** Server-side XHR can reach internal services or leak response contents through error messages.

**Why it matters:** The code-ssrf-xhr-user-input check verifies that the server does not expose the ssrf-xhr-user-input weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/open

**Fix:**
- Restrict XHR destinations to an allowlist of trusted hosts.
- Resolve the URL host and reject private IP ranges.
- Use the Fetch API with redirect: 'manual' to prevent silent host hopping.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-ssrf-got-user-input` [code / high / body-pattern]
**got / node-fetch / undici with user URL**

got(req.query.url), undici.fetch(userUrl), or node-fetch(requestUrl) perform HTTP from the server process. Without URL allowlisting, attackers route requests to internal infrastructure.

**Risk:** SSRF via popular HTTP clients exposes internal services and cloud metadata endpoints.

**Why it matters:** The code-ssrf-got-user-input check verifies that the server does not expose the ssrf-got-user-input weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://github.com/sindresorhus/got

**Fix:**
- Validate the URL against an allowlist of permitted hosts and ports.
- Resolve the hostname and reject loopback / RFC1918 / link-local addresses.
- Disable automatic redirects or re-validate after each hop.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-redos-nested-quantifier` [code / high / body-pattern]
**Nested quantifier regex (ReDoS)**

Patterns like (a+)+, ([a-z]+)*, or (\d+\.\d+)* contain nested quantifiers that produce exponential backtracking on crafted input, hanging the event loop or worker.

**Risk:** Single crafted input causes the regex engine to consume CPU indefinitely, blocking the service.

**Why it matters:** The code-redos-nested-quantifier check verifies that the server does not expose the redos-nested-quantifier weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS

**Fix:**
- Eliminate nested quantifiers; use possessive groups or atomic groups where supported.
- Validate the input length before running the regex.
- Run the regex in a worker thread with a timeout.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-redos-catastrophic-backtrack` [code / high / body-pattern]
**Catastrophic backtracking pattern (ReDoS)**

Regexes with alternation overlap and greedy quantifiers such as (a|a)+ or (\w+)*\b produce catastrophic backtracking on inputs like 'aaaaaaaaaaaa!'. Detection looks for patterns with overlapping alternates inside a quantified group.

**Risk:** Service can be frozen by a single request that triggers the bad regex.

**Why it matters:** The code-redos-catastrophic-backtrack check verifies that the server does not expose the redos-catastrophic-backtrack weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://github.com/davisjam/vuln-regex-detector

**Fix:**
- Rewrite alternations so alternatives cannot match the same input (use distinct anchors or character classes).
- Test the regex with a ReDoS tool such as vuln-regex-detector before shipping.
- Cap regex execution time with re2 or a worker timeout.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-redos-greedy-quantifier` [code / medium / body-pattern]
**Greedy quantifier on unanchored pattern (ReDoS)**

Patterns like .*foo or .+\d+ apply greedy quantifiers to wildcards; long inputs without the trailing literal force the engine to backtrack through every split, producing near-linear but expensive match times.

**Risk:** Long attacker-controlled strings cause noticeable latency spikes even when the regex does not fully match.

**Why it matters:** The code-redos-greedy-quantifier check verifies that the server does not expose the redos-greedy-quantifier weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://www.regular-expressions.info/catastrophic.html

**Fix:**
- Replace .* with [^\n]* or a bounded character class.
- Anchor the trailing literal at the end of the input.
- Limit the length of regex subjects via a validator.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-redos-alternation-overlap` [code / medium / body-pattern]
**Alternation overlap regex (ReDoS)**

Patterns with overlapping alternation such as (a|ab)+ or (\w|\d|\s)+ cause the regex engine to try every combination before failing. On inputs that never match, this backtracking is exponential.

**Risk:** Single request can stall a server thread or event-loop tick.

**Why it matters:** The code-redos-alternation-overlap check verifies that the server does not expose the redos-alternation-overlap weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://www.regular-expressions.info/alternation.html

**Fix:**
- Order alternations by specificity (longest match first) to reduce overlaps.
- Use atomic groups or possessive quantifiers where supported.
- Switch to a non-backtracking engine (RE2) for untrusted input.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-redirect-window-location-href` [code / high / body-pattern]
**window.location.href = userInput**

Assigning window.location.href to a user-supplied URL performs a top-level navigation to the attacker-chosen host, enabling phishing and credential theft via open redirect.

**Risk:** Attacker hosts a convincing phishing page at the destination and uses the open redirect as the launchpad.

**Why it matters:** The code-redirect-window-location-href check verifies that the server does not expose the redirect-window-location-href weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet

**Fix:**
- Compare the destination origin against an allowlist before assigning.
- Use URL parsing to extract and validate the host component.
- Prefer server-issued 302 redirects with allowlisted destinations.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-redirect-location-replace` [code / high / body-pattern]
**location.replace(userInput)**

location.replace(userUrl) navigates the current page to the attacker-supplied URL while removing the original entry from history. The open-redirect impact is identical to window.location but harder for the victim to back out of.

**Risk:** Phishing campaigns can replace the legitimate history entry, making the back button useless.

**Why it matters:** The code-redirect-location-replace check verifies that the server does not expose the redirect-location-replace weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/API/Location/replace

**Fix:**
- Validate the destination host against a strict allowlist.
- Use URL parsing to extract and compare origins.
- Log all redirect destinations for audit.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-redirect-top-location` [code / high / body-pattern]
**top.location / parent.location assignment**

top.location = userInput or parent.location.href = userInput navigates the top-most frame from inside an iframe. When the URL is attacker-controlled, it enables clickjacking-aided redirects and breaks frame-busting controls.

**Risk:** Cross-frame navigation to attacker-controlled pages bypasses frame protections and supports phishing chains.

**Why it matters:** The code-redirect-top-location check verifies that the server does not expose the redirect-top-location weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://owasp.org/www-community/attacks/Cross_Frame_Scripting

**Fix:**
- Restrict top-level navigation to same-origin hosts.
- Set Content-Security-Policy: frame-ancestors to limit who can frame your pages.
- Avoid JavaScript-driven top navigation entirely when possible.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-proto-pollution-deep-merge` [code / high / body-pattern]
**deep-extend / deepmerge prototype pollution**

Lodash's _.merge and _.mergeWith, jQuery's $.extend(true, ...), and libraries such as deep-extend recursively copy enumerable keys. When the source contains __proto__, constructor.prototype, or prototype, the copy writes to Object.prototype.

**Risk:** Polluting Object.prototype can lead to XSS, authentication bypass, denial of service, or remote code execution.

**Why it matters:** The code-proto-pollution-deep-merge check verifies that the server does not expose the proto-pollution-deep-merge weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://github.com/lodash/lodash/pull/4759

**Fix:**
- Upgrade Lodash to 4.17.21+ or use lodash-es with the same patch.
- Replace jQuery $.extend(true, ...) with structuredClone after sanitizing keys.
- Sanitize keys: skip __proto__, constructor, prototype before merging.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-proto-pollution-lodash-merge` [code / high / body-pattern]
**Lodash _.merge / _.defaultsDeep prototype pollution**

_.merge(target, userInput) and _.defaultsDeep(target, userInput) recursively copy properties from user input. Before Lodash 4.17.12 the copy wrote through __proto__, allowing attackers to set arbitrary properties on Object.prototype.

**Risk:** Object.prototype pollution enables XSS, authentication bypass, and DoS via type-confusion gadgets.

**Why it matters:** The code-proto-pollution-lodash-merge check verifies that the server does not expose the proto-pollution-lodash-merge weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://snyk.io/vuln/SNYK-JS-LODASH-590103

**Fix:**
- Upgrade Lodash to 4.17.21 or later.
- Switch to structuredClone for trusted internal data and validate keys for the rest.
- Block keys __proto__, constructor, prototype in any merge helper.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-proto-pollution-object-assign-proto` [code / medium / body-pattern]
**Object.assign with __proto__ key**

Object.assign(target, JSON.parse(userInput)) or spread {...userInput} into a target object copies a __proto__ key literally; combined with a subsequent access, this can pollute Object.prototype in engines that honor the assignment.

**Risk:** Object.prototype pollution enables XSS, type confusion, and bypass of authorization checks.

**Why it matters:** The code-proto-pollution-object-assign-proto check verifies that the server does not expose the proto-pollution-object-assign-proto weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign

**Fix:**
- Use Object.create(null) as the target for untrusted key sets.
- Filter keys against an allowlist before Object.assign.
- Adopt Object.hasOwn or hasOwnProperty checks on every read.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-proto-pollution-recursive-merge` [code / high / body-pattern]
**Custom recursive merge prototype pollution**

Hand-rolled recursive merge functions that iterate Object.keys(source) and recurse into nested values will write through __proto__ and pollute Object.prototype when the source is attacker-controlled.

**Risk:** Same downstream impact as library-driven prototype pollution: XSS, auth bypass, DoS.

**Why it matters:** The code-proto-pollution-recursive-merge check verifies that the server does not expose the proto-pollution-recursive-merge weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://github.com/HoLyVieR/prototype-pollution-nsec18

**Fix:**
- Skip keys named __proto__, constructor, or prototype in the merge loop.
- Use Object.hasOwn(target, key) to guard against inherited keys.
- Replace the custom helper with a vetted library patched against pollution.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-jwt-verify-no-secret` [code / critical / body-pattern]
**jwt.verify called without a secret**

jwt.verify(token) without a secret/key/algorithms option accepts an unsigned or 'alg: none' token. Some libraries will also silently accept any signing key, breaking the trust boundary.

**Risk:** Tokens forged by attackers pass verification and grant arbitrary identities or privileges.

**Why it matters:** The code-jwt-verify-no-secret check verifies that the server does not expose the jwt-verify-no-secret weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/

**Fix:**
- Always pass an explicit secret or public key plus algorithms: ['HS256'] or ['RS256'].
- Reject tokens whose alg is 'none'.
- Centralize verification in a single middleware to enforce consistent options.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-jwt-hs256-weak-secret` [code / high / body-pattern]
**HS256 signed with weak or hardcoded secret**

jwt.sign(payload, 'secret') or jwt.sign(payload, process.env.JWT_SECRET) where JWT_SECRET is a short, low-entropy string enables offline brute-force of the HMAC key.

**Risk:** Attackers recover the HS256 secret and forge tokens for any identity, bypassing authentication entirely.

**Why it matters:** The code-jwt-hs256-weak-secret check verifies that the server does not expose the jwt-hs256-weak-secret weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7518#section-3.2

**Fix:**
- Use a 256-bit (32-byte) random secret generated with crypto.randomBytes.
- Rotate secrets regularly and store them in a secret manager, not env files.
- Consider migrating to RS256 or EdDSA so verifiers only need the public key.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-jwt-none-algorithm` [code / critical / body-pattern]
**JWT 'alg: none' or algorithm confusion**

jwt.verify(token, secret, { algorithms: ['none'] }) or failing to pin algorithms allows an attacker to switch alg to 'none' or to a weaker asymmetric/HMAC algorithm that the verifier accepts.

**Risk:** Tokens are accepted without signatures or with a key the attacker controls, granting impersonation.

**Why it matters:** The code-jwt-none-algorithm check verifies that the server does not expose the jwt-none-algorithm weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://github.com/auth0/node-jsonwebtoken/security/advisories/GHSA-qwph-4952-7xr6

**Fix:**
- Always set algorithms explicitly: { algorithms: ['HS256'] } or ['RS256'].
- Reject any token whose header.alg differs from the expected list.
- Use jose or PyJWT >= 2.4 which enforce algorithms by default.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-csp-no-trustedtypes` [code / medium / body-pattern]
**No Trusted Types policy created**

Pages that write to innerHTML, document.write, or eval without first creating a trustedTypes policy leave every string-to-DOM sink undefended. Trusted Types forces a sanitizing policy to gate these sinks.

**Risk:** DOM XSS via injected strings cannot be blocked without Trusted Types enforcement.

**Why it matters:** The code-csp-no-trusted-types check verifies that the server does not expose the csp-no-trusted-types weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://w3c.github.io/trusted-types/dist/spec/

**Fix:**
- Create a default policy: trustedTypes.createPolicy('default', { createHTML: s => DOMPurify.sanitize(s) }).
- Add require-trusted-types-for 'script' to your CSP header.
- Replace direct innerHTML writes with policy.createHTML(userInput).
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-csp-no-require-trusted-types` [code / medium / body-pattern]
**CSP missing require-trusted-types-for**

The CSP directive require-trusted-types-for 'script' is required to enforce Trusted Types. Without it, browsers ignore policy violations on DOM sinks.

**Risk:** Trusted Types policies are not enforced; injected strings still flow to innerHTML and eval.

**Why it matters:** The code-csp-no-require-trusted-types check verifies that the server does not expose the csp-no-require-trusted-types weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/require-trusted-types-for

**Fix:**
- Add require-trusted-types-for 'script' to the Content-Security-Policy header.
- Combine with trustedTypes default policy to sanitize legacy sinks.
- Audit reports to trusted-types-violation to find remaining sinks.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-csp-missing-trusted-types` [code / medium / body-pattern]
**No Content-Security-Policy enforces Trusted Types**

Pages that render user-controlled HTML but lack both a Trusted Types policy and the CSP directive to enforce it leave classic DOM XSS vectors undefended.

**Risk:** Attacker-controlled HTML strings reach innerHTML / insertAdjacentHTML unchecked, enabling stored DOM XSS.

**Why it matters:** The code-csp-missing-trusted-types check verifies that the server does not expose the csp-missing-trusted-types weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://web.dev/articles/trusted-types

**Fix:**
- Set CSP: require-trusted-types-for 'script'; trusted-types default.
- Register a sanitizing policy (DOMPurify) and use it everywhere.
- Subscribe to securitypolicyviolation events to detect leaks.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-auth-localstorage-tokens` [code / high / body-pattern]
**Auth tokens stored in localStorage**

localStorage.setItem('token', jwt) makes the JWT accessible to any script that runs in the same origin. A single XSS payload can exfiltrate it via fetch.

**Risk:** XSS enables full account takeover by reading the JWT from localStorage.

**Why it matters:** The code-auth-localstorage-tokens check verifies that the server does not expose the auth-localstorage-tokens weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://owasp.org/www-community/HttpOnly

**Fix:**
- Move auth tokens to HttpOnly; Secure; SameSite=Strict cookies set by the server.
- If a token must live client-side, encrypt it with a server-issued key before storage.
- Adopt BFF pattern so the browser never sees raw tokens.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-auth-sessionstorage-passwords` [code / critical / body-pattern]
**Passwords stored in sessionStorage**

sessionStorage.setItem('password', pwd) or sessionStorage.setItem('pwd', val) keeps plaintext credentials in the browser for the lifetime of the tab. Any XSS reads it instantly.

**Risk:** Plaintext password exfiltration via XSS yields direct credential reuse against other services.

**Why it matters:** The code-auth-sessionstorage-passwords check verifies that the server does not expose the auth-sessionstorage-passwords weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Credential_Storage_Cheat_Sheet.html

**Fix:**
- Never persist plaintext passwords client-side; send them once to the server over HTTPS.
- Issue an opaque session token via Set-Cookie HttpOnly; Secure; SameSite=Strict.
- Adopt WebAuthn for passwordless flows where possible.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cookie-samesite-none-http` [code / high / body-pattern]
**SameSite=None cookie on HTTP page**

Cookies set with SameSite=None but without the Secure flag are rejected by browsers, but client-side code can still emit them on HTTP origins. The cookie then flows cross-site over insecure transports.

**Risk:** Cross-site requests over HTTP can carry the cookie, enabling CSRF and session hijacking on downgrade.

**Why it matters:** The code-cookie-samesite-none-http check verifies that the server does not expose the cookie-samesite-none-http weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite

**Fix:**
- Pair SameSite=None with Secure; on the same origin.
- Use SameSite=Lax or Strict for any cookie that does not need cross-site delivery.
- Set cookies from the server via Set-Cookie, not document.cookie.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cookie-missing-secure-http` [code / medium / body-pattern]
**Cookie written without Secure flag on HTTP**

document.cookie = 'sid=' + token without '; Secure' allows the cookie to be transmitted over HTTP. Network observers and downgrade attackers can read or replay it.

**Risk:** Cookie captured on an unencrypted hop enables session hijacking without ever breaking TLS at the user.

**Why it matters:** The code-cookie-missing-secure-http check verifies that the server does not expose the cookie-missing-secure-http weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies

**Fix:**
- Append '; Secure' to every document.cookie write for sensitive values.
- Better: set the cookie from the server via Set-Cookie with Secure; HttpOnly; SameSite.
- Add HSTS so the browser refuses plain-HTTP requests for the host.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-clickjack-target-blank-js-href` [code / high / body-pattern]
**target=_blank with javascript: href**

Anchor patterns like <a target="_blank" href="javascript:..."> combine reverse tabnabbing risk with javascript: URL execution. Even with noopener, javascript: still runs in the new tab.

**Risk:** Opening a javascript: URL in a new tab executes attacker code in that tab's origin context.

**Why it matters:** The code-clickjack-target-blank-js-href check verifies that the server does not expose the clickjack-target-blank-js-href weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://owasp.org/www-community/attacks/Reverse_Tabnabbing

**Fix:**
- Validate href against an allowlist of http(s) URLs; reject javascript:, data:, vbscript:.
- Set rel="noopener noreferrer" on every target="_blank" anchor.
- Adopt Trusted Types to gate javascript: URLs.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-clickjack-x-frame-options` [code / medium / body-pattern]
**Missing X-Frame-Options / frame-ancestors CSP**

Pages without X-Frame-Options: DENY (or a CSP frame-ancestors 'none') can be embedded inside an attacker-controlled iframe, enabling clickjacking against authenticated users.

**Risk:** Attacker overlays a transparent iframe on a decoy page; clicks land on the victim's session, performing unintended actions.

**Why it matters:** The code-clickjack-x-frame-options check verifies that the server does not expose the clickjack-x-frame-options weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options

**Fix:**
- Send X-Frame-Options: DENY (or SAMEORIGIN if same-origin framing is required).
- Set Content-Security-Policy: frame-ancestors 'none' (or 'self').
- Combine with SameSite=Lax cookies to reduce cross-site risk.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-timing-no-constant-time-compare` [code / high / body-pattern]
**Non-constant-time signature comparison**

if (providedSig === storedSig) compares HMACs or tokens with JavaScript ===, which short-circuits on the first differing byte. Attackers measure timing to recover the signature byte-by-byte.

**Risk:** Timing oracle leaks signature bytes, allowing an attacker to forge valid signatures or replay tokens.

**Why it matters:** The code-timing-no-constant-time-compare check verifies that the server does not expose the timing-no-constant-time-compare weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b

**Fix:**
- Use crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)) for any secret comparison.
- Hash both sides with SHA-256 first if lengths differ, then compare.
- Add a unit test that fails if comparison timing varies by input.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-timing-hmac-equality` [code / high / body-pattern]
**HMAC verification with === operator**

if (hmac(secret, msg) === providedTag) uses == / === to compare authentication tags. JavaScript string comparison is not constant time and leaks the prefix of a correct tag.

**Risk:** Network-local attackers recover the HMAC byte-by-byte and forge authenticated requests.

**Why it matters:** The code-timing-hmac-equality check verifies that the server does not expose the timing-hmac-equality weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://paragonie.com/blog/2015/11/02/why-hash-youre-using-not-secure

**Fix:**
- Compare HMAC outputs with crypto.timingSafeEqual.
- Convert both sides to Buffer of equal length; reject length mismatches.
- Prefer library helpers (e.g. noble-ed25519 verify) that already do this.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cloud-aws-hardcoded-credentials` [code / critical / body-pattern]
**Hardcoded AWS credentials in @aws-sdk**

Patterns like new S3Client({ accessKeyId: 'AKIA...', secretAccessKey: '...' }) embed long-lived IAM keys directly into source. Once the source is logged or committed, the keys are compromised.

**Risk:** Leaked keys grant whoever holds them the same AWS permissions as the application, including S3, IAM, and STS.

**Why it matters:** The code-cloud-aws-hardcoded-credentials check verifies that the server does not expose the cloud-aws-hardcoded-credentials weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/loading-node-credentials-iam-role.html

**Fix:**
- Remove hardcoded keys; let the SDK pull credentials from the environment, IAM role, or SSO.
- Rotate the exposed credentials immediately and audit CloudTrail for misuse.
- Adopt short-lived STS tokens via AssumeRole with web identity or OIDC.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cloud-aws-s3-upload-no-acl` [code / high / body-pattern]
**S3 upload without ACL restriction**

s3.upload({ Bucket, Key, Body, ACL: 'public-read' }) or PutObjectCommand with explicit public ACLs creates world-readable objects. Worse, buckets without Block Public Access can leak every object.

**Risk:** Public S3 objects leak customer data, backups, or sensitive logs at internet scale.

**Why it matters:** The code-cloud-aws-s3-upload-no-acl check verifies that the server does not expose the cloud-aws-s3-upload-no-acl weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-best-practices.html

**Fix:**
- Default to ACL 'private' and serve downloads via short-lived presigned URLs.
- Enable S3 Block Public Access at the account and bucket level.
- Use SSE-KMS with a key policy that denies unencrypted uploads.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `code-cloud-azure-blob-upload-no-acl` [code / high / body-pattern]
**Azure Blob upload with container public access**

Azure blob uploads that set container access level to 'blob' or 'container' make every object publicly listable. Anonymous enumeration of the container then leaks all uploaded files.

**Risk:** Public containers expose uploaded documents, backups, and user-generated content to anyone who guesses the URL.

**Why it matters:** The code-cloud-azure-blob-upload-no-acl check verifies that the server does not expose the cloud-azure-blob-upload-no-acl weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.

**References:**
- https://learn.microsoft.com/azure/storage/blobs/anonymous-read-access-configure

**Fix:**
- Set container access level to 'private' and use SAS tokens or AAD for access.
- Generate short-lived user delegation SAS URLs instead of account SAS.
- Audit storage account firewalls and disable public network access where possible.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `insecure-crypto` [code / info / stub]
**Insecure Crypto**

Security check `insecure-crypto` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under code.

**Why it matters:** The insecure-crypto check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sql-injection-patterns` [code / info / stub]
**Sql Injection Patterns**

Security check `sql-injection-patterns` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under code.

**Why it matters:** The sql-injection-patterns check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `ssrf-vulnerability` [code / info / stub]
**Ssrf Vulnerability**

Security check `ssrf-vulnerability` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under code.

**Why it matters:** The ssrf-vulnerability check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `xxe-vulnerability` [code / info / stub]
**Xxe Vulnerability**

Security check `xxe-vulnerability` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under code.

**Why it matters:** The xxe-vulnerability check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `xml-external-entity` [code / info / stub]
**Xml External Entity**

Security check `xml-external-entity` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under code.

**Why it matters:** The xml-external-entity check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `ldap-injection-indicators` [code / info / stub]
**Ldap Injection Indicators**

Security check `ldap-injection-indicators` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under code.

**Why it matters:** The ldap-injection-indicators check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `hardcoded-credentials` [code / info / stub]
**Hardcoded Credentials**

Security check `hardcoded-credentials` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under code.

**Why it matters:** The hardcoded-credentials check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `default-credentials` [code / info / stub]
**Default Credentials**

Security check `default-credentials` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under code.

**Why it matters:** The default-credentials check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `hardcoded-secrets` [code / info / stub]
**Hardcoded Secrets**

Security check `hardcoded-secrets` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under code.

**Why it matters:** The hardcoded-secrets check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `postmessage-wildcard` [code / info / stub]
**Postmessage Wildcard**

Security check `postmessage-wildcard` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under code.

**Why it matters:** The postmessage-wildcard check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Category: configuration (19 checks)

### `ratelimit-policy-missing` [configuration / medium / combined]
**Page Is Frameable (No Protection)**

No clickjacking protection headers detected.

**Risk:** Page can be embedded in iframes by malicious sites.

**Why it matters:** Without X-Frame-Options or CSP frame-ancestors, clickjacking is possible.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Add X-Frame-Options: DENY or CSP frame-ancestors 'self'.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `vary-header-cookie` [configuration / medium / header]
**Debug flag set via cookie**

A debug=true cookie flips debug behaviour — easy to forget when staging.

**Risk:** Avoid debug toggles via cookie; use environment variables instead

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Avoid debug toggles via cookie; use environment variables instead
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-too-large` [configuration / low / header]
**Set-Cookie header > 4KB**

Browsers drop cookies larger than ~4KB.

**Risk:** Store less data in cookies; use server-side session storage

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Store less data in cookies; use server-side session storage
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `vary-header-missing` [configuration / low / header]
**Vary Header Missing on Compressed Responses**

When serving different content based on Accept-Encoding, the Vary header is required to avoid cache poisoning.

**Risk:** Add Vary: Accept-Encoding to all compressed responses

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Add Vary: Accept-Encoding to all compressed responses
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `transfer-encoding-chunked` [configuration / info / header]
**Transfer-Encoding: chunked in use**

Transfer-Encoding: chunked is fine, but worth tracking.

**Risk:** Prefer Content-Length where possible for cacheability

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Prefer Content-Length where possible for cacheability
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `content-disposition-inline` [configuration / info / header]
**Content-Disposition: inline for downloadable content**

PDFs, images, etc. served as inline can be exfiltrated by iframes.

**Risk:** Add Content-Disposition: attachment; filename=... for sensitive downloads

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Add Content-Disposition: attachment; filename=... for sensitive downloads
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-xss-protection-block` [configuration / info / header]
**X-XSS-Protection set to '1; mode=block'**

X-XSS-Protection is deprecated and the Chrome auditor has been removed. Modern browsers ignore this header.

**Risk:** Remove X-XSS-Protection; rely on CSP instead

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Remove X-XSS-Protection; rely on CSP instead
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `server-timing-cache-timings` [configuration / low / header-value]
**Server-Timing exposes cache timings**

Server-Timing values like cache;dur=12 or edge;dur=4 expose internal cache hit/miss timing to the client.

**Risk:** Drop cache-specific Server-Timing entries outside of debug builds

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Drop cache-specific Server-Timing entries outside of debug builds
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `vary-cookie-on-static-resource` [configuration / low / combined]
**Vary: Cookie set on static resource**

A static asset (image, JS, CSS) served with Vary: Cookie forces every cache to store one copy per Cookie value, defeating caching.

**Risk:** Drop Vary: Cookie from responses on static asset paths

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Drop Vary: Cookie from responses on static asset paths
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `vary-origin-missing-cors` [configuration / medium / combined]
**CORS endpoint missing Vary: Origin**

An endpoint that reflects Access-Control-Allow-Origin per request must also include Vary: Origin so caches don't serve one origin's response to another.

**Risk:** Add Vary: Origin alongside dynamic Access-Control-Allow-Origin

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Add Vary: Origin alongside dynamic Access-Control-Allow-Origin
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-amz-cf-id` [configuration / info / header-value]
**X-Amz-Cf-Id CloudFront request ID exposed**

CloudFront's X-Amz-Cf-Id header reveals an AWS CloudFront request identifier on every response.

**Risk:** Strip X-Amz-Cf-Id at the edge via Lambda@Edge if you don't want CloudFront request IDs leaked

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Strip X-Amz-Cf-Id at the edge via Lambda@Edge if you don't want CloudFront request IDs leaked
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-vercel-cache` [configuration / info / header-value]
**X-Vercel-Cache reveals Vercel edge caching**

Vercel's X-Vercel-Cache header exposes HIT/MISS/BYPASS status on every response.

**Risk:** Drop X-Vercel-Cache at the edge or set Cache-Control: private to avoid leaking cache status

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Drop X-Vercel-Cache at the edge or set Cache-Control: private to avoid leaking cache status
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-nextjs-cache` [configuration / info / header-value]
**X-Nextjs-Cache reveals Next.js ISR cache**

Next.js sets X-Nextjs-Cache: HIT | MISS | STALE | BYPASS to indicate ISR/SSG cache state. Helpful for debugging, leaks architecture detail.

**Risk:** Remove the header in next.config.js or behind an env flag for production

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Remove the header in next.config.js or behind an env flag for production
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-netlify-cache` [configuration / info / header-value]
**X-Netlify-Cache exposes Netlify CDN cache state**

Netlify's X-Netlify-Cache header exposes HIT/MISS/PASS/REVALIDATE status on responses.

**Risk:** Strip X-Netlify-Cache via _headers if you don't want CDN cache state exposed

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Strip X-Netlify-Cache via _headers if you don't want CDN cache state exposed
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-cache-hits` [configuration / info / header-value]
**X-Cache-Hits exposes repeated cache hits**

Some CDNs (Cloudflare, Fastly) include X-Cache-Hits to indicate how many times an asset was served from cache.

**Risk:** Strip X-Cache-Hits if you don't want cache-usage patterns exposed

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Strip X-Cache-Hits if you don't want cache-usage patterns exposed
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `vary-header-missing-user-agent` [configuration / info / stub]
**Vary Header Missing User Agent**

Security check `vary-header-missing-user-agent` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under configuration.

**Why it matters:** The vary-header-missing-user-agent check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `server-timing-allow-origin-public` [configuration / low / header]
**Server-Timing exposed without Timing-Allow-Origin gate**

Server-Timing is exposed publicly without a Timing-Allow-Origin restriction, allowing any cross-origin page to read performance data.

**Risk:** Cross-origin attackers can read precise timing data and fingerprint the backend.

**Why it matters:** Server-Timing carries per-request performance metrics. When exposed without a Timing-Allow-Origin restriction, the browser sends it to the cross-origin document and any timing-based fingerprinting attack can run.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing

**Fix:**
- Hide Server-Timing at the edge (proxy_hide_header Server-Timing) for public responses.
- If you need to expose it for monitoring, set Timing-Allow-Origin to a specific trusted origin instead of '*'.
- Strip cache;dur, db;dur, edge;dur style entries that reveal backend internals.
- **Nginx** (nginx):
```nginx
proxy_hide_header Server-Timing;
proxy_hide_header Timing-Allow-Origin;
```
- **Cloudflare** (http):
```http
Server-Timing: miss=0; description=public-cache-hit (without server-internal metrics)
```

### `debug-via-cookie` [configuration / info / stub]
**Debug Via Cookie**

Security check `debug-via-cookie` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under configuration.

**Why it matters:** The debug-via-cookie check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-cache-status-cloudflare` [configuration / info / stub]
**X Cache Status Cloudflare**

Security check `x-cache-status-cloudflare` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under configuration.

**Why it matters:** The x-cache-status-cloudflare check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Category: content (175 checks)

### `open-redirect` [content / medium / body-pattern]
**Potential Open Redirect Parameters**

The page contains URL parameters or JavaScript patterns commonly associated with open redirect vulnerabilities.

**Risk:** Open redirects can be used in phishing attacks by making malicious URLs appear to originate from your trusted domain.

**Why it matters:** Open redirect vulnerabilities occur when a web application takes a user-supplied URL parameter and redirects to it without validation.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Validate all redirect URLs against an allowlist.
- Use relative URLs for redirects.
- Reject any redirect URL that points to an external domain.
- Implement server-side URL validation.
- **Validation** (typescript):
```typescript
const ALLOWED = ['yourdomain.com'];
const url = new URL(redirect);
if (!ALLOWED.includes(url.hostname)) throw new Error('Invalid');
```

### `email-exposure` [content / info / body-pattern]
**Email Address Exposure**

Email addresses were found in the page source.

**Risk:** Exposed email addresses can be harvested by bots for spam or targeted phishing.

**Why it matters:** Bots constantly crawl websites looking for email addresses in the HTML source.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Replace plaintext emails with contact forms.
- Use JavaScript to dynamically render email addresses.
- Encode email addresses using HTML entities.
- Consider Cloudflare email obfuscation.
- **React Obfuscation** (tsx):
```tsx
function ObfuscatedEmail({ user, domain }: { user: string; domain: string }) {
  return <button onClick={() => window.location.href = `mailto:<value>@<value>`}>{user} [at] {domain}</button>;
}
```

### `directory-listing` [content / high / body-pattern]
**Directory Listing Appears Enabled**

The response contains patterns indicating directory listing is enabled.

**Risk:** Attackers can browse your server's file structure, discovering sensitive files.

**Why it matters:** Directory listing allows anyone to see all files in a directory when no index file is present.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Disable directory listing in your web server configuration.
- Ensure every directory has an index file.
- Review exposed directories for sensitive files.
- **Nginx** (nginx):
```nginx
autoindex off;
```
- **Apache** (apache):
```apache
Options -Indexes
```

### `sensitive-files` [content / medium / body-pattern]
**Sensitive File References Detected**

The page references files commonly associated with sensitive configuration or development artifacts.

**Risk:** References to sensitive files may indicate they are accessible.

**Why it matters:** Sensitive files like .env, .git/, and configuration files should never be referenced in public pages.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove all references to sensitive files from public HTML.
- Block access in your web server configuration.
- Ensure .env, .git, and other config files are in .gitignore.
- **Nginx** (nginx):
```nginx
location ~ /\. { deny all; return 404; }
location ~ \.(env|sql|bak|config|log)$ { deny all; return 404; }
```

### `outdated-js-libs` [content / high / body-pattern]
**Potentially Outdated JavaScript Libraries**

The page references JavaScript libraries with known security vulnerabilities.

**Risk:** Outdated libraries contain publicly known vulnerabilities that attackers can exploit.

**Why it matters:** Using outdated client-side libraries exposes your application to known attack vectors.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Update all JavaScript libraries to their latest stable versions.
- Use npm audit or Snyk to track vulnerabilities.
- Set up Dependabot or Renovate for automated updates.
- Remove unused libraries.
- **npm audit** (bash):
```bash
npm audit
npm audit fix
npm audit fix --force
```

### `robots-txt-exposure` [content / info / body-pattern]
**Sensitive Paths Exposed in Robots.txt**

The robots.txt file reveals potentially sensitive directory paths.

**Risk:** Robots.txt effectively creates a map of sensitive areas for attackers to probe.

**Why it matters:** Robots.txt files are publicly accessible and listing sensitive paths tells attackers exactly where to look.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove sensitive paths from robots.txt.
- Ensure all sensitive endpoints require proper authentication.
- Use auth and authorization rather than path hiding.
- **Secure robots.txt** (text):
```text
User-agent: *
Disallow: /api/
Sitemap: https://yourdomain.com/sitemap.xml
```

### `cms-fingerprinting` [content / info / combined]
**CMS / Technology Fingerprinting**

The site exposes CMS or technology stack details that aid attacker reconnaissance.

**Risk:** Knowing the CMS type and version allows attackers to search for specific exploits.

**Why it matters:** CMS fingerprinting reveals the underlying technology, version, and sometimes plugin information.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove or obscure the generator meta tag.
- Hide version numbers from public-facing pages.
- Keep your CMS and all plugins updated.
- Remove default installation files.
- **WordPress** (php):
```php
remove_action('wp_head', 'wp_generator');
add_filter('the_generator', '__return_empty_string');
```

### `security-txt-missing` [content / info / body-pattern]
**Missing security.txt File**

No reference to a security.txt file was found.

**Risk:** Security researchers may not know how to responsibly report vulnerabilities.

**Why it matters:** The security.txt file (RFC 9116) provides a standardized way for security researchers to find contact information.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Create a /.well-known/security.txt file.
- Include Contact, Preferred-Languages, Expires fields.
- Sign the file with PGP if possible.
- **security.txt** (text):
```text
Contact: mailto:security@yourdomain.com
Expires: 2026-12-31T23:59:00.000Z
Preferred-Languages: en
```

### `dangerous-inline-js` [content / medium / body-pattern]
**Potentially Dangerous Inline JavaScript**

The page contains inline JavaScript with potentially dangerous patterns like eval(), document.write().

**Risk:** Dangerous JavaScript patterns can be exploited via XSS.

**Why it matters:** Patterns like eval(), document.write(), and direct innerHTML assignment with user input are common XSS vectors.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Replace eval() with JSON.parse().
- Use textContent instead of innerHTML.
- Move inline scripts to external files.
- Use DOMPurify to sanitize HTML.
- **Safe alternatives** (javascript):
```javascript
const data = JSON.parse(jsonString);
element.textContent = userInput;
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(htmlContent);
```

### `version-disclosure` [content / low / body-pattern]
**Server version disclosed in response header**

A response header carries a value that matches a version-like pattern (e.g. '1.0', '2.3.1').

**Risk:** Version strings in headers give attackers a target list of CVEs without further probing.

**Why it matters:** Headers like Server, X-Powered-By, X-AspNet-Version, NEL, and Report-To frequently leak exact upstream versions. Strip them at the edge or use generic placeholders.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers

**Fix:**
- Set server_tokens off; in nginx or strip the Server header at the reverse proxy.
- Disable X-Powered-By by setting poweredByHeader: false in Next.js or removing the Express x-powered-by setting.
- Genericize NEL and Report-To headers or remove the 'version' field.
- **Nginx** (nginx):
```nginx
server_tokens off;
proxy_hide_header X-Powered-By;
proxy_hide_header Server;
```
- **Next.js** (javascript):
```javascript
const nextConfig = { poweredByHeader: false };
```

### `sensitive-comments` [content / medium / body-pattern]
**Sensitive Information in HTML Comments**

HTML comments containing potentially sensitive information detected.

**Risk:** HTML comments are visible to anyone viewing page source.

**Why it matters:** Developers often leave TODO notes, debug information, or temporary credentials in HTML comments.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove all HTML comments containing sensitive information.
- Use a build process that strips comments.
- Move debug notes to internal documentation.
- **HTML Minification** (javascript):
```javascript
const htmlnano = require('htmlnano');
htmlnano.process(html, { removeComments: 'all' });
```

### `private-ip-exposure` [content / low / body-pattern]
**Internal/Private IP Addresses Exposed**

Internal or private IP addresses found in the page source.

**Risk:** Internal IP addresses reveal your network topology.

**Why it matters:** Private IP addresses and localhost references in public-facing pages leak information about your internal network structure.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove hardcoded internal IP addresses.
- Use environment-specific configuration.
- Review reverse proxy configurations.
- **Environment config** (typescript):
```typescript
const API_URL = process.env.NODE_ENV === 'production'
  ? 'https://api.yourdomain.com'
  : 'http://localhost:3001';
```

### `debug-indicators` [content / high / combined]
**Debug Mode or Error Information Exposed**

Debug/error indicators that reveal internal application details detected.

**Risk:** Debug output exposes internal file paths, framework versions, database types, and application logic.

**Why it matters:** Debug mode and verbose error messages are invaluable during development but catastrophic in production.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Disable debug mode in production.
- Configure custom error pages.
- Remove fingerprinting headers.
- Set up error monitoring (Sentry).
- **Express.js** (javascript):
```javascript
app.disable('x-powered-by');
app.use((err, req, res, next) => {
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message });
});
```
- **Next.js** (javascript):
```javascript
const nextConfig = { poweredByHeader: false };
```

### `insecure-iframes` [content / medium / combined]
**Insecure Iframe Sources on HTTPS Page**

Iframes loading content over HTTP on an HTTPS page.

**Risk:** HTTP iframes on HTTPS pages create mixed content, allowing MITM attackers to modify iframe content.

**Why it matters:** Browsers display your page as secure but an HTTP iframe can be intercepted and modified by network attackers.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Change all iframe src attributes to use HTTPS.
- Use CSP: frame-src https:.
- Consider using the sandbox attribute.
- **CSP** (text):
```text
Content-Security-Policy: frame-src https: 'self';
```

### `token-exposure` [content / high / body-pattern]
**Authentication Tokens Exposed in Page Source**

Tokens or session identifiers exposed in the HTML source.

**Risk:** Exposed tokens allow session hijacking.

**Why it matters:** Authentication tokens should never appear in HTML source. They can be captured by browser extensions, cached by CDNs, or logged by proxies.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Store tokens in HTTP-only Secure cookies.
- If tokens must be passed to JavaScript, inject them via a secure API call.
- Never pass tokens in URL query parameters.
- **Secure cookie** (typescript):
```typescript
response.cookies.set('session', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 86400, path: '/' });
```

### `autocomplete-sensitive` [content / low / body-pattern]
**Missing Autocomplete Attributes on Sensitive Fields**

Sensitive input fields without proper autocomplete attributes.

**Risk:** Browsers may cache sensitive form data on shared or compromised devices.

**Why it matters:** The autocomplete attribute tells browsers how to handle form autofill.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add autocomplete="new-password" for registration fields.
- Add autocomplete="current-password" for login fields.
- Add appropriate autocomplete values for payment fields.
- **Proper autocomplete** (html):
```html
<input type="password" autocomplete="current-password" />
<input type="password" autocomplete="new-password" />
```

### `form-target-blank` [content / low / body-pattern]
**Forms Targeting New Windows**

Forms with target="_blank" can be abused for phishing via reverse tabnabbing.

**Risk:** Form submissions opening new windows can confuse users and be exploited.

**Why it matters:** Forms that open results in new tabs create the same reverse tabnabbing risk as anchor links.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove target="_blank" from forms unless necessary.
- Consider handling form submission via fetch instead.
- **AJAX submission** (javascript):
```javascript
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await fetch(form.action, { method: 'POST', body: new FormData(form) });
});
```

### `meta-refresh` [content / low / body-pattern]
**Meta Refresh Redirect Detected**

Meta refresh redirects can be abused for open redirect attacks and phishing.

**Risk:** Meta refresh redirects bypass standard navigation controls.

**Why it matters:** Meta refresh tags automatically redirect users after a delay. Unlike server-side redirects, they execute in the browser.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Replace meta refresh with server-side 301/302 redirects.
- Never allow user-controlled input in meta refresh URLs.
- **Server redirect** (typescript):
```typescript
import { redirect } from 'next/navigation';
redirect('/new-page');
```

### `base-tag-insecure` [content / high / body-pattern]
**Insecure Base Tag Detected**

The page uses a <base> tag with an HTTP URL, making all relative URLs resolve insecurely.

**Risk:** All relative links, scripts, images resolve against the insecure base URL.

**Why it matters:** The HTML <base> tag sets the base URL for all relative URLs in the document.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Change the <base> tag to use HTTPS.
- Remove the <base> tag if not needed.
- Implement CSP base-uri directive.
- **CSP restriction** (text):
```text
Content-Security-Policy: base-uri 'self'
```

### `postmessage-no-origin` [content / high / body-pattern]
**postMessage Listener Without Origin Validation**

postMessage event listeners don't appear to validate the message origin.

**Risk:** Any website can send messages to your page via postMessage.

**Why it matters:** If the receiving page doesn't verify event.origin, any malicious page can send crafted messages.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Always check event.origin against a whitelist.
- Validate the structure and type of event.data.
- Use event.source to verify the sender.
- **Safe listener** (javascript):
```javascript
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://trusted-domain.com') return;
  handleMessage(event.data);
});
```

### `sensitive-endpoints` [content / low / body-pattern]
**Sensitive Endpoints Referenced in Page Source**

References to potentially sensitive endpoints in the page source.

**Risk:** References to admin panels, debug endpoints help attackers map your attack surface.

**Why it matters:** Even if endpoints are protected, exposing their paths gives attackers specific targets.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove references to internal/admin endpoints from client-side code.
- Use server-side rendering for admin navigation.
- Move API documentation behind authentication.
- **Conditional render** (tsx):
```tsx
{session?.isAdmin && <Link href="/admin">Admin Panel</Link>}
```

### `dangerous-html-attrs` [content / high / body-pattern]
**Dangerous HTML Attributes Detected**

Potentially dangerous HTML attributes like inline event handlers, javascript: URIs.

**Risk:** Inline event handlers and javascript: URIs are common XSS vectors.

**Why it matters:** Inline event handlers, javascript: protocol links, and data: URIs embedding HTML/JS are all classic XSS injection points.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove all javascript: protocol links.
- Move inline event handlers to external JavaScript files.
- Implement CSP with 'unsafe-inline' disabled.
- **Safe pattern** (html):
```html
<!-- BAD -->
<a href="javascript:void(0)" onclick="doStuff()">Click</a>
<!-- GOOD -->
<button type="button" id="action-btn">Click</button>
```

### `jwt-in-url` [content / critical / body-pattern]
**JWT Token Exposed in URL**

A JSON Web Token was found embedded in a URL within the page HTML.

**Risk:** The token appears in browser history, proxy logs, server logs, and Referer headers.

**Why it matters:** JWTs in URLs persist in numerous locations, creating many avenues for token theft.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Transmit tokens in HTTP headers (Authorization: Bearer) instead of URLs.
- Use HTTP-only secure cookies.
- Implement short-lived single-use tokens.
- **Fetch with header** (javascript):
```javascript
// BAD: Token in URL
fetch('/api/data?token=eyJ...');
// GOOD: Token in header
fetch('/api/data', { headers: { 'Authorization': 'Bearer ' + token } });
```

### `sensitive-meta-tags` [content / low / body-pattern]
**Sensitive Information in Meta Tags**

Meta tags that expose sensitive or unnecessary information.

**Risk:** Meta tag contents are visible in page source.

**Why it matters:** Generator tags reveal exact software versions with known CVEs. CSRF tokens in meta tags are accessible to any script.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove generator meta tags in production.
- Move CSRF tokens to HTTP-only cookies.
- Never store API keys in meta tags.
- **WordPress** (php):
```php
remove_action('wp_head', 'wp_generator');
```

### `storage-api-sensitive` [content / high / body-pattern]
**Sensitive Data Stored in Browser Storage APIs**

JavaScript stores sensitive values (tokens, secrets) in localStorage or sessionStorage.

**Risk:** Any XSS vulnerability allows attackers to steal all data from browser storage.

**Why it matters:** Web Storage APIs are fully accessible to JavaScript. If an attacker exploits any XSS, they can read all stored values.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Move authentication tokens to HTTP-only, Secure, SameSite cookies.
- Never store passwords, API keys, or PII in browser storage.
- Implement CSP to reduce XSS risk.
- **Secure cookie instead** (javascript):
```javascript
// BAD: localStorage.setItem('token', jwt);
// GOOD: Set via server Set-Cookie: session=abc; HttpOnly; Secure; SameSite=Strict
```

### `cdn-no-sri` [content / medium / body-pattern]
**CDN Resources Loaded Without Subresource Integrity**

Scripts loaded from CDNs lack integrity attributes.

**Risk:** A compromised CDN could serve malicious scripts to all your users.

**Why it matters:** SRI lets you provide a cryptographic hash of the expected file content. The browser verifies before executing.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add integrity and crossorigin attributes to all CDN resources.
- Consider self-hosting critical libraries as an alternative.
- **SRI example** (html):
```html
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.min.js" integrity="sha384-..." crossorigin="anonymous"></script>
```

### `opengraph-injection` [content / medium / body-pattern]
**Suspicious Content in Open Graph Tags**

Open Graph meta tags contain suspicious content that could indicate injection.

**Risk:** Malicious OG content can be exploited by link preview services.

**Why it matters:** Some preview renderers process OG values in ways that can be exploited.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Sanitize all Open Graph tag content.
- Validate og:url and og:image point to your own domains.
- Never include user-controlled input in OG tags without encoding.
- **Safe OG tags** (html):
```html
<meta property="og:url" content="https://example.com/page" />
<meta property="og:image" content="https://example.com/image.jpg" />
```

### `service-worker-scope` [content / high / body-pattern]
**Service Worker Registered Over Insecure HTTP**

A service worker is being registered from an HTTP URL.

**Risk:** A MITM attacker could replace the service worker with malicious code that persists.

**Why it matters:** Service workers intercept all network requests. A compromised one gives attackers persistent control.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Serve the service worker file over HTTPS.
- Use relative URLs for registration.
- **Safe registration** (javascript):
```javascript
// BAD: navigator.serviceWorker.register('http://example.com/sw.js');
// GOOD: navigator.serviceWorker.register('/sw.js');
```

### `window-opener-abuse` [content / medium / body-pattern]
**Window.opener Access Detected**

JavaScript accesses window.opener properties, exploitable for reverse tabnabbing.

**Risk:** Can redirect the parent tab to a phishing page without the user noticing.

**Why it matters:** When a page is opened via window.open() or target='_blank', it may have a reference to the opening window.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add rel='noopener noreferrer' to external links.
- Set window.opener = null at the top of pages.
- Use Cross-Origin-Opener-Policy: same-origin.
- **Safe link** (html):
```html
<a href="https://external.com" target="_blank" rel="noopener noreferrer">External</a>
```

### `websocket-insecure` [content / high / body-pattern]
**Insecure WebSocket Connection (ws://)**

WebSocket connections using unencrypted ws:// instead of wss://.

**Risk:** Unencrypted WebSocket connections can be intercepted. WebSocket connections don't enforce same-origin policy.

**Why it matters:** ws:// transmits data in plaintext. WebSocket connections aren't bound by same-origin policy, making them vulnerable to cross-site hijacking.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use wss:// for all WebSocket connections.
- Validate the Origin header on the server.
- Implement CSRF token verification in the handshake.
- **Secure WebSocket** (javascript):
```javascript
// BAD: new WebSocket('ws://example.com/feed');
// GOOD: new WebSocket('wss://example.com/feed');
```

### `document-domain` [content / medium / body-pattern]
**Deprecated document.domain Usage Detected**

The page sets document.domain, a deprecated practice that relaxes same-origin policy.

**Risk:** Setting document.domain weakens same-origin isolation.

**Why it matters:** document.domain was historically used for cross-subdomain communication. Chrome has deprecated it. Use postMessage instead.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Replace document.domain with postMessage().
- Use CORS headers for cross-origin API requests.
- Consider Channel Messaging API.
- **Use postMessage** (javascript):
```javascript
// BAD: document.domain = 'example.com';
// GOOD:
window.parent.postMessage({ type: 'data', payload: result }, 'https://parent.example.com');
```

### `weak-crypto` [content / high / body-pattern]
**Weak or Broken Cryptography Detected**

Weak or broken cryptographic algorithms in client-side JavaScript.

**Risk:** Weak cryptography provides a false sense of security. MD5/SHA-1 can be forged, DES/RC4 broken, Math.random() is predictable.

**Why it matters:** Cryptographic algorithms become weak as computing power increases. MD5 collisions can be generated in seconds.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Replace MD5/SHA-1 with SHA-256 or SHA-3.
- Replace DES/RC4 with AES-256-GCM.
- Use crypto.getRandomValues() instead of Math.random().
- Use the SubtleCrypto API.
- **Web Crypto API** (javascript):
```javascript
// BAD: Math.random().toString(36);
// GOOD:
const array = new Uint8Array(32);
crypto.getRandomValues(array);
const token = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
```

### `password-paste-disabled` [content / low / body-pattern]
**Password Fields Block Pasting**

Password fields have paste functionality disabled, discouraging password manager use.

**Risk:** Users cannot paste from password managers, leading to weaker passwords.

**Why it matters:** Both NCSC (UK) and NIST guidelines explicitly recommend against disabling paste on password fields.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove all onpaste event handlers from password fields.
- Allow paste on all form fields, especially password fields.
- **Allow paste** (html):
```html
<!-- BAD -->
<input type="password" onpaste="return false">
<!-- GOOD -->
<input type="password" autocomplete="current-password">
```

### `verbose-error-messages` [content / medium / body-pattern]
**Application Error Messages Exposed to Users**

Detailed error messages visible in the page HTML.

**Risk:** Detailed errors reveal file paths, database types, library versions.

**Why it matters:** Verbose error messages reveal the technology stack and internal structure.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Configure production to display generic error pages.
- Log detailed errors server-side only.
- Implement custom error handlers.
- **Next.js error handling** (tsx):
```tsx
'use client'
export default function Error() {
  return <div><h1>Something went wrong</h1><p>Please try again later.</p></div>;
}
```

### `xxe-server-xml` [content / medium / body-pattern]
**Server-Side XML Parsing Detected**

Server-side XML parsing library usage found. Ensure external entity processing is disabled.

**Risk:** If external entities are not disabled, XXE attacks can read local files or perform SSRF.

**Why it matters:** Server-side XML parsers can be vulnerable to XXE if not properly configured.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Disable external entity processing.
- Validate that noent: false and nonet: true are set.
- Consider using JSON instead of XML.
- **Safe xml2js config** (javascript):
```javascript
const parser = new xml2js.Parser({ strict: true, normalize: true, xmlns: false });
```

### `ssrf-vectors` [content / high / body-pattern]
**Potential Server-Side Request Forgery (SSRF) Vectors**

User-controlled input may be used in server-side HTTP requests.

**Risk:** SSRF allows attackers to access internal resources, cloud metadata services, or internal networks.

**Why it matters:** SSRF occurs when an application fetches a remote resource without validating the user-supplied URL.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Validate URLs against an allowlist.
- Block requests to private IP ranges.
- Disable redirects or validate redirect destinations.
- **SSRF prevention** (typescript):
```typescript
const ALLOWED = ['api.example.com'];
const url = new URL(userUrl);
if (!ALLOWED.includes(url.hostname)) throw new Error('Invalid URL');
```

### `graphql-introspection` [content / medium / body-pattern]
**GraphQL Introspection Enabled in Production**

GraphQL introspection is enabled, exposing the entire API schema.

**Risk:** Attackers can discover all queries, mutations, types, and fields.

**Why it matters:** Introspection is useful for development but should be disabled in production.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Disable introspection in production.
- Use environment variables to conditionally enable.
- Implement authentication before allowing introspection.
- Consider persisted queries.
- **Disable introspection** (typescript):
```typescript
const server = new ApolloServer({ typeDefs, resolvers, introspection: process.env.NODE_ENV !== 'production' });
```

### `iframe-no-sandbox` [content / low / body-pattern]
**Iframes Missing Sandbox Attribute**

Multiple iframes found without the sandbox attribute, allowing embedded content full capabilities.

**Risk:** Unsandboxed iframes have full access to browser features, forms, scripts, and popups.

**Why it matters:** The sandbox attribute restricts what an iframe can do. Without it, embedded content has nearly the same capabilities as the parent page.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add the sandbox attribute to all iframes.
- Only enable needed capabilities: allow-scripts, allow-same-origin, etc.
- **Sandboxed iframe** (html):
```html
<iframe src="https://embed.example.com" sandbox="allow-scripts allow-same-origin" loading="lazy"></iframe>
```

### `password-input-no-name` [content / low / body-pattern]
**Password Fields Missing Name/Autocomplete Attributes**

Password input fields are missing name or autocomplete attributes, hindering password manager functionality.

**Risk:** Password managers may not correctly identify or fill these fields, discouraging their use.

**Why it matters:** Password managers rely on input name and autocomplete attributes to correctly identify and autofill fields.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add name and autocomplete attributes to all password fields.
- Use autocomplete='current-password' for login and 'new-password' for registration.
- **Proper password field** (html):
```html
<input type="password" name="password" autocomplete="current-password" />
```

### `sensitive-form-no-csrf` [content / medium / body-pattern]
**POST Forms Without CSRF Tokens**

POST form(s) found without apparent CSRF token fields. Note: This check skips framework apps (Next.js, Nuxt) that handle CSRF differently.

**Risk:** Without CSRF tokens, attackers can trick users into submitting forms from malicious sites.

**Why it matters:** CSRF attacks forge requests from authenticated users. CSRF tokens ensure form submissions originate from your site.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add a hidden CSRF token field to all POST forms.
- Validate the token on the server for every form submission.
- Use the SameSite cookie attribute as additional protection.
- **CSRF token** (html):
```html
<form method="POST" action="/submit">
  <input type="hidden" name="csrf_token" value="{{token}}" />
</form>
```

### `api-version-exposed` [content / info / combined]
**API Version Information Exposed**

API version numbers or build identifiers are exposed in headers or page source.

**Risk:** Version numbers help attackers identify specific vulnerabilities for that version.

**Why it matters:** Exposing exact version numbers aids attacker reconnaissance. Remove or obfuscate version info in production.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove version headers like X-API-Version.
- Don't include build IDs in client-facing code.
- Use generic version references if needed.
- **Remove headers** (typescript):
```typescript
// Don't set version headers in production
if (process.env.NODE_ENV !== 'production') {
  response.headers.set('X-API-Version', version);
}
```

### `html-lang-missing` [content / info / body-pattern]
**Missing HTML lang Attribute**

The <html> tag does not include a lang attribute, impacting accessibility and SEO.

**Risk:** Screen readers may not announce content in the correct language. Search engines may misidentify the page language.

**Why it matters:** The lang attribute on <html> tells browsers and assistive technologies the primary language of the page.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add lang attribute to the <html> tag: <html lang="en">.
- Use appropriate BCP 47 language codes.
- **HTML** (html):
```html
<html lang="en">
```

### `form-action-tel-scheme` [content / medium / body-pattern]
**Forms Submitting to External Domains**

Form(s) found that submit data to external third-party domains (excluding known payment providers).

**Risk:** Form data may be sent to untrusted external servers.

**Why it matters:** Forms with external action URLs send user data outside your domain. While legitimate for payment forms, unexpected external submissions may indicate compromise.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Review all external form actions for legitimacy.
- Use server-side proxying for third-party form submissions.
- Add CSP form-action to restrict allowed targets.
- **CSP form-action** (text):
```text
Content-Security-Policy: form-action 'self' https://checkout.stripe.com;
```

### `local-storage-sensitive` [content / high / body-pattern]
**Sensitive Data in Browser Storage**

Sensitive data (tokens, passwords, API keys) being stored in localStorage or sessionStorage.

**Risk:** Any XSS vulnerability allows complete theft of stored sensitive data.

**Why it matters:** Browser storage APIs have no access controls. Any script on the page can read all stored values.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Move tokens to HTTP-only cookies.
- Never store passwords or API keys client-side.
- **Use cookies** (typescript):
```typescript
// Instead of localStorage, use HTTP-only cookies
response.cookies.set('session', token, { httpOnly: true, secure: true, sameSite: 'strict' });
```

### `viewport-user-scalable-no` [content / info / body-pattern]
**Viewport Prevents User Zoom**

The viewport meta tag disables user scaling (user-scalable=no or maximum-scale=1), which is an accessibility issue.

**Risk:** Users with visual impairments cannot zoom the page, violating WCAG accessibility guidelines.

**Why it matters:** Disabling zoom creates an accessibility barrier for users who need to enlarge content.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove user-scalable=no from viewport meta.
- Remove or increase maximum-scale.
- Allow natural pinch-to-zoom behavior.
- **Accessible viewport** (html):
```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

### `internal-ip-exposed` [content / low / body-pattern]
**Hardcoded IP Addresses in Page Source**

Multiple distinct IP addresses found hardcoded in page source (excluding localhost and common non-sensitive IPs).

**Risk:** Hardcoded IPs reveal server infrastructure and network topology.

**Why it matters:** IP addresses in client-facing code suggest hardcoded infrastructure references that should use DNS or environment variables.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Replace hardcoded IPs with domain names.
- Use environment variables for server addresses.
- Configure DNS properly.
- **Use DNS** (typescript):
```typescript
const API = process.env.API_URL; // Not a hardcoded IP
```

### `document-write-usage` [content / low / body-pattern]
**document.write() Usage Detected**

document.write()/document.writeln() usage found. These are deprecated and can be exploited for XSS.

**Risk:** document.write() can be hijacked to inject malicious content if any input is attacker-controlled.

**Why it matters:** document.write() is deprecated, blocks HTML parsing, and is a common XSS vector.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Replace document.write() with DOM APIs (createElement, appendChild).
- Use innerHTML with DOMPurify if HTML insertion is needed.
- **Safe alternative** (javascript):
```javascript
// BAD: document.write('<p>' + text + '</p>');
// GOOD:
const p = document.createElement('p');
p.textContent = text;
document.body.appendChild(p);
```

### `unencrypted-connections` [content / info / body-pattern]
**Excessive Third-Party Domain Connections**

The page connects to a large number of distinct third-party domains (10+), increasing attack surface.

**Risk:** Each third-party domain is a potential attack vector. If any is compromised, it can affect your users.

**Why it matters:** Every external domain you load resources from expands your attack surface. A compromise of any CDN, analytics, or advertising domain can lead to script injection.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Audit all third-party connections and remove unnecessary ones.
- Self-host critical resources where possible.
- Use SRI for all external scripts.
- Implement a strict CSP to limit allowed domains.
- **CSP allowlist** (text):
```text
Content-Security-Policy: script-src 'self' https://trusted-cdn.com;
```

### `input-no-maxlength` [content / info / body-pattern]
**Text Inputs Missing maxlength Attribute**

Multiple text inputs and textareas found without maxlength, allowing unbounded input.

**Risk:** Unbounded input fields can be used for denial-of-service or buffer-based attacks on backend systems.

**Why it matters:** Without maxlength, users (or attackers) can submit extremely long strings that may cause performance issues or exploit backend vulnerabilities.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add maxlength attribute to all text inputs and textareas.
- Validate input length on the server side as well.
- **HTML** (html):
```html
<input type="text" maxlength="255" />
<textarea maxlength="5000"></textarea>
```

### `lazy-loading-missing` [content / info / body-pattern]
**Images Missing Lazy Loading**

Many images found without loading='lazy' attribute, impacting page load performance.

**Risk:** All images load immediately, increasing initial page load time and bandwidth usage.

**Why it matters:** Native lazy loading defers offscreen images until the user scrolls near them, improving initial load performance.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add loading='lazy' to images that are below the fold.
- Keep loading='eager' for above-the-fold images.
- **Lazy loading** (html):
```html
<img src="image.jpg" loading="lazy" alt="Description" />
```

### `sourcemap-reference` [content / low / combined]
**Cookie With Excessively Long Expiration**

Cookie set to expire far in the future (over 1 year).

**Risk:** Long-lived cookies increase the window for session theft.

**Why it matters:** Cookies that persist for years are a security risk.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Set reasonable max-age values; use session cookies where possible.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `aws-metadata-reference` [content / critical / body-pattern]
**AWS Metadata Endpoint Reference**

Reference to AWS metadata endpoint (169.254.169.254) detected.

**Risk:** SSRF to metadata endpoint can steal IAM credentials.

**Why it matters:** The AWS metadata service provides instance credentials.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Block metadata access from applications; use IMDSv2.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `git-directory-exposed` [content / high / body-pattern]
**.git Directory Paths Exposed**

.git directory paths found in page source.

**Risk:** Exposed .git allows downloading entire source code history.

**Why it matters:** If .git is accessible, attackers can reconstruct your entire repository.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Block access to .git directory in web server config.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `env-file-reference` [content / critical / body-pattern]
**.env File Reference Detected**

References to .env file found in page source.

**Risk:** Exposed .env files contain database credentials, API keys, and secrets.

**Why it matters:** .env files should never be web-accessible.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Block .env access in web server config.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `backup-file-reference` [content / medium / body-pattern]
**Backup File References Detected**

References to backup files found.

**Risk:** Backup files may contain source code or database dumps.

**Why it matters:** Backup files on servers can expose previous code versions.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove backup files from production servers.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `phpinfo-exposed` [content / critical / body-pattern]
**phpinfo() Page Exposed**

phpinfo() page or reference detected.

**Risk:** phpinfo() exposes complete server configuration, PHP settings, and environment variables.

**Why it matters:** This diagnostic page should never be accessible in production.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove phpinfo() files from production.
- Block access in web server config.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `discord-webhook-exposed` [content / low / body-pattern]
**WordPress Admin Paths Exposed**

WordPress admin/login page paths exposed.

**Risk:** Reveals WordPress installation and admin panel location.

**Why it matters:** Default WordPress admin paths are common brute-force targets.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use a security plugin to hide or rename wp-login.php.
- Implement rate limiting on login attempts.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `graphql-endpoint-exposed` [content / medium / body-pattern]
**GraphQL Endpoint Exposed**

GraphQL endpoint or introspection references found.

**Risk:** Reveals API structure and available queries.

**Why it matters:** GraphQL introspection lets anyone discover your full API schema.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Disable introspection in production.
- Implement query depth limiting.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `swagger-docs-exposed` [content / medium / body-pattern]
**API Documentation Publicly Accessible**

Swagger/OpenAPI documentation endpoints referenced.

**Risk:** API docs reveal all endpoints, parameters, and data models.

**Why it matters:** Public API documentation helps attackers understand your API surface.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Restrict API docs access to authenticated users.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `spring-boot-actuator` [content / high / body-pattern]
**Spring Boot Actuator Endpoints Exposed**

Spring Boot Actuator endpoints found in page source.

**Risk:** Actuator endpoints expose env vars, beans, mappings, and health status.

**Why it matters:** Spring Boot Actuator provides operational endpoints that should be secured.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Restrict actuator endpoints to internal access only.
- Use Spring Security to protect actuator.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `inline-event-handlers` [content / low / body-pattern]
**Excessive Inline Event Handlers**

Multiple inline event handler attributes found.

**Risk:** Inline handlers bypass CSP and complicate security auditing.

**Why it matters:** Inline event handlers are equivalent to inline scripts for XSS purposes.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use addEventListener() instead of inline handlers.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `document-domain-usage` [content / medium / body-pattern]
**Deprecated document.domain Usage**

document.domain assignment found.

**Risk:** Relaxes same-origin policy between subdomains.

**Why it matters:** document.domain is deprecated and weakens isolation.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use postMessage() for cross-subdomain communication.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `postmessage-star-origin` [content / high / body-pattern]
**postMessage() With Wildcard Origin**

postMessage called with * origin target.

**Risk:** Sensitive data sent to any listening window.

**Why it matters:** Using * as target origin means any page can receive the message.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Specify the exact target origin instead of *.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `jwt-in-html` [content / high / body-pattern]
**JWT Token in Page Source**

JSON Web Token found in HTML source.

**Risk:** Exposed tokens allow session hijacking.

**Why it matters:** JWTs in page source can be stolen by XSS attacks.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Never embed JWTs in HTML; use HttpOnly cookies.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `private-key-in-source` [content / critical / body-pattern]
**Private Key Material Exposed**

Private key found in page source.

**Risk:** Private keys allow impersonation, decryption, and signing.

**Why it matters:** Private keys must never be exposed in client-facing code.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Immediately rotate the exposed key.
- Store keys in secure key management systems.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `base64-credentials` [content / high / body-pattern]
**Base64 Credentials in Page Source**

Basic authentication credentials (Base64) found.

**Risk:** Base64 credentials are trivially decodable.

**Why it matters:** Basic auth headers encode credentials in Base64 which is not encryption.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove hardcoded credentials from page source.
- Use token-based authentication.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `connection-string-exposed` [content / critical / body-pattern]
**Database Connection String Exposed**

Database connection string with credentials found.

**Risk:** Direct database access with leaked credentials.

**Why it matters:** Connection strings contain hostname, username, password, and database name.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Move connection strings to environment variables.
- Rotate exposed credentials immediately.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `s3-bucket-exposed` [content / medium / body-pattern]
**AWS S3 Bucket Reference Exposed**

AWS S3 bucket reference found in page source.

**Risk:** S3 buckets may be publicly accessible or misconfigured.

**Why it matters:** Exposed bucket names can be tested for misconfigured permissions.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use CloudFront or a CDN in front of S3 buckets.
- Ensure proper bucket policies.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `firebase-config-exposed` [content / low / body-pattern]
**Firebase Configuration Exposed**

Firebase configuration object found in page source.

**Risk:** While Firebase keys are designed to be public, exposed config may indicate unsecured backend rules.

**Why it matters:** Firebase config is semi-public but should be paired with security rules.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Ensure Firestore/RTDB security rules are properly configured.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `form-method-get-sensitive` [content / high / body-pattern]
**Password Form Uses GET Method**

Form with password field uses GET method.

**Risk:** Credentials appear in URL, browser history, and server logs.

**Why it matters:** GET requests encode form data in the URL query string.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Change form method to POST for all forms with sensitive data.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `meta-referrer-unsafe` [content / medium / body-pattern]
**Meta Referrer Tag Leaks URLs**

Meta referrer tag set to an unsafe value.

**Risk:** Full URLs including paths and query params leaked as referrer.

**Why it matters:** unsafe-url sends the complete URL to all destinations.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use strict-origin-when-cross-origin or no-referrer.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `exposed-session-id` [content / high / header-value]
**Session Cookie Missing Security Flags**

Session cookie missing HttpOnly, Secure, or SameSite.

**Risk:** Session can be stolen via XSS or sent over HTTP.

**Why it matters:** Security flags protect cookies from common attacks.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add HttpOnly, Secure, and SameSite=Lax to session cookies.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `password-in-get` [content / critical / body-pattern]
**Password in GET Request URL**

Password parameter found in URL.

**Risk:** Credentials exposed in browser history, server logs, referrer.

**Why it matters:** GET parameters appear in URL and are logged everywhere.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use POST for all forms with passwords.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `weak-password-policy` [content / medium / body-pattern]
**Weak Password Length Constraint**

Password field allows very short passwords.

**Risk:** Users can set easily guessable passwords.

**Why it matters:** Short passwords are vulnerable to brute force attacks.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Require minimum 8-12 characters for passwords.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `remember-me-token` [content / medium / body-pattern]
**Remember-Me Token in URL**

Remember-me token exposed in URL.

**Risk:** Persistent auth token leaked in referrer and logs.

**Why it matters:** Remember-me tokens should be in cookies, not URLs.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Store remember-me tokens in secure, HttpOnly cookies.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `oauth-state-missing` [content / high / body-pattern]
**OAuth URL Missing State Parameter**

OAuth authorization URL without state parameter.

**Risk:** Vulnerable to CSRF attacks on OAuth flow.

**Why it matters:** State parameter prevents cross-site request forgery in OAuth.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Always include a cryptographically random state parameter.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `debug-endpoint` [content / high / body-pattern]
**Debug Endpoints Referenced**

Debug or profiler endpoints found in source.

**Risk:** Debug endpoints often expose sensitive information.

**Why it matters:** Debug pages may show configs, stack traces, environment.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove or restrict debug endpoints in production.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `admin-endpoint` [content / medium / body-pattern]
**Admin Endpoints Referenced**

Admin or management endpoints found in source.

**Risk:** Reveals admin panel locations to attackers.

**Why it matters:** Knowing admin URLs helps attackers target them.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use obscure paths, add authentication, IP restrictions.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-enumeration` [content / medium / body-pattern]
**User Enumeration via Email**

Error message reveals email existence.

**Risk:** Attackers can verify which emails are registered.

**Why it matters:** Different messages for valid/invalid emails enable enumeration.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use generic messages like 'If this email exists...'
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cdn-fallback-missing` [content / low / body-pattern]
**CDN Scripts Without Fallback**

CDN-hosted scripts without local fallback.

**Risk:** Site breaks if CDN is unavailable or compromised.

**Why it matters:** SRI helps but local fallback ensures availability.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add onerror fallback to local copy for critical scripts.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `outdated-jquery` [content / medium / body-pattern]
**Potentially Outdated jQuery**

jQuery version may have known vulnerabilities.

**Risk:** Old jQuery versions have XSS vulnerabilities.

**Why it matters:** jQuery < 3.5.0 has known security issues.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Update to latest jQuery version.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `outdated-angular` [content / high / body-pattern]
**AngularJS 1.x Detected**

End-of-life AngularJS framework detected.

**Risk:** No longer receives security updates.

**Why it matters:** AngularJS reached EOL Dec 2021, migrate to Angular.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Migrate to Angular (2+) or another modern framework.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `prototype-js-outdated` [content / medium / body-pattern]
**Prototype.js Detected**

Outdated Prototype.js library detected.

**Risk:** Unmaintained library with known vulnerabilities.

**Why it matters:** Prototype.js is no longer maintained.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove Prototype.js, use modern alternatives.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `mootools-outdated` [content / medium / body-pattern]
**MooTools Detected**

Outdated MooTools library detected.

**Risk:** Unmaintained library with potential security issues.

**Why it matters:** MooTools has limited maintenance.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Migrate to a modern, maintained framework.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `document-cookie-access` [content / low / body-pattern]
**Excessive document.cookie Access**

Multiple document.cookie accesses detected.

**Risk:** Cookies may contain sensitive data accessible to scripts.

**Why it matters:** HttpOnly cookies prevent JavaScript access.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use HttpOnly flag for sensitive cookies.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `credit-card-pattern` [content / critical / body-pattern]
**Credit Card Number Pattern**

Potential credit card number in page source.

**Risk:** PCI DSS violation, data breach.

**Why it matters:** Card numbers should never appear in HTML.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Never display full card numbers, mask or tokenize.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `ssn-pattern` [content / critical / body-pattern]
**SSN Pattern Detected**

Social Security Number pattern in content.

**Risk:** Severe privacy violation, identity theft risk.

**Why it matters:** SSNs should never appear in page content.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Mask SSNs, never display in full.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `phone-number-leak` [content / low / body-pattern]
**Multiple Phone Numbers Exposed**

Many phone numbers found in page source.

**Risk:** Privacy concern, potential data leak.

**Why it matters:** Bulk phone numbers may indicate data exposure.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Review if phone numbers should be displayed.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-address-leak` [content / low / body-pattern]
**Many Email Addresses Exposed**

Large number of email addresses in page.

**Risk:** Privacy concern, spam/phishing target list.

**Why it matters:** Bulk emails may indicate data exposure.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Review if emails should be displayed publicly.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `bearer-token-exposed` [content / critical / body-pattern]
**Bearer Token Exposed in Source**

Bearer token found in page source.

**Risk:** Direct credential exposure.

**Why it matters:** Bearer tokens grant API access.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Never embed tokens in HTML, use secure storage.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `api-key-in-url` [content / high / body-pattern]
**API Key in URL Parameter**

API key found in URL parameter.

**Risk:** Key leaked in referrer, history, logs.

**Why it matters:** API keys in URLs are exposed in many places.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Pass API keys in headers instead of URLs.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `aws-credentials-exposed` [content / critical / body-pattern]
**AWS Credentials Pattern Detected**

AWS access key pattern found in source.

**Risk:** Full AWS account compromise possible.

**Why it matters:** AWS keys grant access to cloud resources.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Rotate exposed credentials immediately.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `private-key-exposed` [content / critical / body-pattern]
**Private Key Detected in Source**

Private key pattern found in page.

**Risk:** Complete compromise of encrypted data.

**Why it matters:** Private keys should never be in HTML.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Rotate keys, investigate how they were exposed.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `stripe-key-exposed` [content / high / body-pattern]
**Stripe Key Exposed**

Stripe API key pattern found.

**Risk:** May allow payment manipulation.

**Why it matters:** Live Stripe keys can process real payments.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Rotate keys, use publishable keys only in frontend.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `twilio-credentials-exposed` [content / high / body-pattern]
**Twilio Credentials Pattern**

Twilio SID/token pattern found.

**Risk:** Unauthorized SMS/calls, billing fraud.

**Why it matters:** Twilio credentials allow API access.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Rotate credentials immediately.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sendgrid-key-exposed` [content / high / body-pattern]
**SendGrid API Key Exposed**

SendGrid API key pattern found.

**Risk:** Email sending abuse, phishing.

**Why it matters:** SendGrid keys allow email sending.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Rotate API key immediately.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `slack-webhook-exposed` [content / medium / body-pattern]
**Slack Webhook URL Exposed**

Slack webhook URL found in source.

**Risk:** Spam messages to Slack channel.

**Why it matters:** Anyone with webhook URL can post messages.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Rotate webhook URL, keep it server-side.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `github-token-exposed` [content / critical / body-pattern]
**GitHub Token Pattern Detected**

GitHub personal access token found.

**Risk:** Repository access, code manipulation.

**Why it matters:** GitHub tokens grant repo access.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Revoke token immediately, use fine-grained tokens.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `google-api-key-exposed` [content / medium / body-pattern]
**Google API Key Exposed**

Google API key found in source.

**Risk:** Quota theft, billing abuse.

**Why it matters:** Unrestricted Google keys can be abused.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Restrict key to specific APIs and referrers.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `mailchimp-key-exposed` [content / high / body-pattern]
**Mailchimp API Key Exposed**

Mailchimp API key pattern found.

**Risk:** Email list access, campaign manipulation.

**Why it matters:** Mailchimp keys grant full account access.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Regenerate API key immediately.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `heroku-api-key-exposed` [content / critical / body-pattern]
**Heroku API Key Exposed**

Heroku API key pattern found.

**Risk:** Full Heroku account control.

**Why it matters:** Heroku keys allow app deployment and deletion.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Regenerate API key immediately.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `npm-token-exposed` [content / high / body-pattern]
**NPM Token Exposed**

NPM authentication token found.

**Risk:** Package publishing, supply chain attack.

**Why it matters:** NPM tokens allow package publishing.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Revoke token, publish with 2FA.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `docker-hub-token-exposed` [content / high / body-pattern]
**Docker Hub Token Exposed**

Docker Hub credentials found.

**Risk:** Container image manipulation.

**Why it matters:** Docker tokens allow image push/pull.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Regenerate token immediately.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `exposed-error-messages` [content / high / body-pattern]
**SQL Error Message Exposed**

SQL error message found in response.

**Risk:** Reveals database structure, aids SQL injection.

**Why it matters:** SQL errors expose schema and query details.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use custom error pages, log errors server-side.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `nosql-error-exposed` [content / high / body-pattern]
**NoSQL Error Message Exposed**

NoSQL/MongoDB error found in response.

**Risk:** Reveals database type and query structure.

**Why it matters:** NoSQL errors aid injection attacks.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use custom error pages, handle errors gracefully.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `ldap-error-exposed` [content / medium / body-pattern]
**LDAP Error Message Exposed**

LDAP error message in response.

**Risk:** Reveals directory structure.

**Why it matters:** LDAP errors may expose user enumeration.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Return generic error messages.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `xml-error-exposed` [content / medium / body-pattern]
**XML Parser Error Exposed**

XML parser error in response.

**Risk:** May reveal XXE vulnerability.

**Why it matters:** XML errors can indicate parser misconfiguration.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Handle XML errors gracefully.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `json-hijacking-vulnerable` [content / medium / body-pattern]
**JSON Array at Top Level**

API returns JSON array as top-level response.

**Risk:** Legacy browsers vulnerable to JSON hijacking.

**Why it matters:** Older browsers could include JSON in script tags.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Wrap array in object, or use CORS properly.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `jsonp-endpoint` [content / medium / body-pattern]
**JSONP Endpoint Detected**

JSONP callback parameter found.

**Risk:** JSONP can leak data cross-origin.

**Why it matters:** JSONP bypasses same-origin policy by design.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Replace JSONP with CORS for cross-origin requests.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dom-clobbering-vulnerable` [content / medium / body-pattern]
**Potential DOM Clobbering**

HTML elements with IDs that could clobber globals.

**Risk:** JavaScript globals can be overwritten.

**Why it matters:** HTML id/name attributes create global variables.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Avoid relying on global variable names from DOM.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `srcdoc-iframe` [content / low / body-pattern]
**Iframe with srcdoc Attribute**

Iframe using srcdoc for inline HTML.

**Risk:** Inline HTML in iframes can be complex to secure.

**Why it matters:** srcdoc allows HTML directly in iframe.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Ensure srcdoc content is properly sanitized.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sandbox-allow-scripts` [content / low / body-pattern]
**Iframe Sandbox Allows Scripts**

Sandboxed iframe with allow-scripts.

**Risk:** Sandboxed content can still execute JavaScript.

**Why it matters:** allow-scripts re-enables JavaScript in sandbox.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Only add allow-scripts if absolutely necessary.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `svg-script-injection` [content / high / body-pattern]
**SVG with Script Content**

SVG containing script elements.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content. Severity reflects the realistic worst-case impact under default configurations.

**Why it matters:** SVG can contain executable JavaScript.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Sanitize SVG uploads, use CSP.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `data-uri-script` [content / high / body-pattern]
**Script with data: URI**

Script tag using data: URI source.

**Risk:** Inline script execution via data URI.

**Why it matters:** data: URIs can embed script content.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Block data: in CSP script-src.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `blob-url-script` [content / medium / body-pattern]
**Script from blob: URL**

Script loaded from blob: URL.

**Risk:** Dynamic script generation.

**Why it matters:** Blob URLs can be used to execute dynamic scripts.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Consider blocking blob: in CSP.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `autocomplete-password` [content / low / body-pattern]
**Password Field Missing autocomplete**

Password field without autocomplete attribute.

**Risk:** Browser may not offer to save password.

**Why it matters:** autocomplete helps password managers.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Set autocomplete='current-password' or 'new-password'.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `form-autocomplete-off` [content / info / body-pattern]
**Form Disables Autocomplete**

Form has autocomplete=off.

**Risk:** Prevents password manager functionality.

**Why it matters:** Users may enter weaker manual passwords.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Allow autocomplete unless there's a specific reason.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `input-maxlength-short` [content / medium / body-pattern]
**Password Field with Short maxlength**

Password input with very short maxlength.

**Risk:** Artificially limits password strength.

**Why it matters:** Short passwords are easier to crack.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Allow at least 64-128 character passwords.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `hidden-password-field` [content / medium / body-pattern]
**Hidden Password Input Field**

Password field with type=hidden.

**Risk:** May expose password in page source.

**Why it matters:** Hidden inputs are visible in HTML source.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Never store passwords in hidden fields.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `password-visible-default` [content / high / body-pattern]
**Password Field Type is Text**

Password stored in text input instead of password type.

**Risk:** Password visible on screen.

**Why it matters:** Password fields should mask input.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use type='password' for password inputs.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `readonly-sensitive-field` [content / low / body-pattern]
**Sensitive Data in Readonly Field**

Sensitive data in readonly input field.

**Risk:** Users can still copy, data in DOM.

**Why it matters:** Readonly doesn't prevent data access.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Consider masking or removing sensitive readonly data.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `file-upload-no-restrictions` [content / medium / body-pattern]
**File Upload Without Type Restrictions**

File input without accept attribute.

**Risk:** Malicious file uploads possible.

**Why it matters:** Accept attribute provides client-side hint.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Set accept attribute and validate on server.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `multiple-file-upload` [content / info / body-pattern]
**Multiple File Upload Enabled**

File input allows multiple files.

**Risk:** DoS via many file uploads.

**Why it matters:** Multiple files increases attack surface.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Limit file count and total size server-side.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sourcemap-exposed` [content / medium / body-pattern]
**Source Map Files Exposed**

JavaScript source maps are publicly accessible.

**Risk:** Reveals original source code.

**Why it matters:** Source maps help reverse-engineer code.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove source maps in production or restrict access.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `todo-fixme-comments` [content / low / body-pattern]
**TODO/FIXME Comments Exposed**

TODO or FIXME comments in page source.

**Risk:** Reveals incomplete security work.

**Why it matters:** May indicate known issues.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Address and remove TODO comments before production.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `iframe-lazy-loading` [content / info / body-pattern]
**Iframe Missing Lazy Loading**

Below-fold iframes without loading=lazy.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content. Severity reflects the realistic worst-case impact under default configurations.

**Why it matters:** Lazy loading defers iframe loading.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add loading='lazy' to non-critical iframes.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `preconnect-missing` [content / info / body-pattern]
**Missing Preconnect for Third-Party**

Third-party resources without preconnect hint.

**Risk:** Slower third-party resource loading.

**Why it matters:** Preconnect establishes early connections.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add preconnect for critical third-party origins.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-prefetch-missing` [content / info / body-pattern]
**Missing DNS Prefetch for Third-Party**

External domains without dns-prefetch.

**Risk:** Slower DNS resolution.

**Why it matters:** DNS prefetch resolves domains early.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add dns-prefetch for third-party domains.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `open-redirect-params` [content / info / header]
**Meta refresh without URL**

<meta http-equiv=refresh content='5'> without url= is informational; with url= it's a redirect.

**Risk:** Use HTTP 301/302 instead of meta refresh

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use HTTP 301/302 instead of meta refresh
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sri-missing-stylesheet` [content / info / header]
**Iframe missing allowfullscreen attribute**

Iframes without allowfullscreen can't fill the viewport on mobile.

**Risk:** Add allowfullscreen attribute

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add allowfullscreen attribute
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `config-file-leaked` [content / medium / body-pattern]
**Configuration file reference detected in body**

The page references a configuration filename (config.yaml, config.json, .env, docker-compose) that often indicates server-side configuration files.

**Risk:** References to sensitive configuration may indicate they are exposed at the URL mentioned.

**Why it matters:** When a page surfaces the names of server-side configuration files, it provides a roadmap for an attacker probing for common misconfiguration paths.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Verify that the referenced paths (e.g. /config.yaml, /.env, /docker-compose.yml) return 404 on the public origin.
- Block access to dotfiles and config files at the reverse proxy (location ~ /\. { deny all; }).
- Remove in-content references unless they are user-facing documentation.
- If these are documentation pages, ensure they are noindexed and not advertised in the sitemap.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `iframe-srcdoc-no-sandbox` [content / medium / header]
**Third-party iframe without sandbox**

Third-party widgets (Stripe, YouTube) loaded without sandbox can run arbitrary scripts.

**Risk:** Add sandbox='allow-scripts allow-same-origin allow-forms' to third-party iframes

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add sandbox='allow-scripts allow-same-origin allow-forms' to third-party iframes
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `autofocus-positive-tabindex` [content / low / body-pattern]
**Autofocus combined with positive tabindex**

Combining autofocus with tabindex > 0 produces confusing focus order for keyboard and screen reader users.

**Risk:** Remove positive tabindex from autofocused elements; let the natural tab order stand

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove positive tabindex from autofocused elements; let the natural tab order stand
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `aria-hidden-focusable-children` [content / medium / body-pattern]
**aria-hidden=true with focusable children**

When aria-hidden=true is applied to a container that still contains focusable elements, keyboard users can tab into invisible controls.

**Risk:** Add tabindex=-1 to focusable descendants, or remove aria-hidden from the parent

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add tabindex=-1 to focusable descendants, or remove aria-hidden from the parent
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `form-formnovalidate-bypass` [content / medium / body-pattern]
**formnovalidate attribute on submit button**

A submit button with formnovalidate bypasses HTML5 input constraints (required, pattern, type=email). Server-side validation must catch this.

**Risk:** Always validate on the server; never rely on browser-side form validation alone

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Always validate on the server; never rely on browser-side form validation alone
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `form-action-javascript-scheme` [content / high / body-pattern]
**Form action uses javascript: scheme**

A <form action="javascript:..."> executes JavaScript on submit and is a classic XSS vector if the action is partially attacker-controlled.

**Risk:** Replace action="javascript:..." with action="/endpoint" and handle submit via JS or server

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Replace action="javascript:..." with action="/endpoint" and handle submit via JS or server
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `form-action-mailto-scheme` [content / low / body-pattern]
**Form action uses mailto: scheme**

A <form action="mailto:..."> opens the user's mail client, leaks the recipient address, and is unreliable for data submission.

**Risk:** Use a server endpoint or contact form instead of mailto: for form submission

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use a server endpoint or contact form instead of mailto: for form submission
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `iframe-allow-scripts-allow-same-origin` [content / high / body-pattern]
**Sandboxed iframe allows both scripts and same-origin**

Combining sandbox='allow-scripts allow-same-origin' removes most of the sandbox protection and lets the iframe access the parent origin.

**Risk:** Drop allow-same-origin (or allow-scripts) - together they fully re-enable same-origin script execution

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Drop allow-same-origin (or allow-scripts) - together they fully re-enable same-origin script execution
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `svg-onload-handler` [content / high / body-pattern]
**SVG with inline onload handler**

An <svg onload="..."> attribute fires JavaScript when the SVG renders and is equivalent to inline script for XSS purposes.

**Risk:** Move event handlers to addEventListener in external JS; sanitize SVG uploads

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Move event handlers to addEventListener in external JS; sanitize SVG uploads
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `svg-external-entity-reference` [content / critical / body-pattern]
**SVG with external entity reference (XXE)**

An <svg> with an external entity reference like <!ENTITY xxe SYSTEM "file:///..."> can leak local files when the SVG is rendered server-side.

**Risk:** Strip DOCTYPE and external entities when ingesting SVG; use a hardened parser

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Strip DOCTYPE and external entities when ingesting SVG; use a hardened parser
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `iframe-sandbox-missing` [content / info / stub]
**Iframe Sandbox Missing**

Security check `iframe-sandbox-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The iframe-sandbox-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `open-form-action` [content / info / stub]
**Open Form Action**

Security check `open-form-action` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The open-form-action check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `autocomplete-sensitive-fields` [content / info / stub]
**Autocomplete Sensitive Fields**

Security check `autocomplete-sensitive-fields` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The autocomplete-sensitive-fields check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `base-tag` [content / info / stub]
**Base Tag**

Security check `base-tag` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The base-tag check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `preconnect-third-party` [content / info / stub]
**Preconnect Third Party**

Security check `preconnect-third-party` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The preconnect-third-party check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `source-maps` [content / info / stub]
**Source Maps**

Security check `source-maps` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The source-maps check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `wp-login-exposed` [content / info / stub]
**Wp Login Exposed**

Security check `wp-login-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The wp-login-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `websocket-unencrypted` [content / info / stub]
**Websocket Unencrypted**

Security check `websocket-unencrypted` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The websocket-unencrypted check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cross-site-websocket` [content / info / stub]
**Cross Site Websocket**

Security check `cross-site-websocket` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The cross-site-websocket check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `postmessage-origin` [content / info / stub]
**Postmessage Origin**

Security check `postmessage-origin` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The postmessage-origin check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dom-xss-sinks` [content / info / stub]
**Dom Xss Sinks**

Security check `dom-xss-sinks` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The dom-xss-sinks check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `exposed-stack-trace` [content / info / stub]
**Exposed Stack Trace**

Security check `exposed-stack-trace` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The exposed-stack-trace check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `stack-trace-exposed` [content / info / stub]
**Stack Trace Exposed**

Security check `stack-trace-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The stack-trace-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sql-error-in-page` [content / info / stub]
**Sql Error In Page**

Security check `sql-error-in-page` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The sql-error-in-page check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `php-error-in-page` [content / info / stub]
**Php Error In Page**

Security check `php-error-in-page` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The php-error-in-page check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `asp-error-in-page` [content / info / stub]
**Asp Error In Page**

Security check `asp-error-in-page` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The asp-error-in-page check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `django-debug-page` [content / info / stub]
**Django Debug Page**

Security check `django-debug-page` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The django-debug-page check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `laravel-debug-page` [content / info / stub]
**Laravel Debug Page**

Security check `laravel-debug-page` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The laravel-debug-page check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `storage-api-usage` [content / info / stub]
**Storage Api Usage**

Security check `storage-api-usage` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The storage-api-usage check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `geolocation-usage` [content / info / stub]
**Geolocation Usage**

Security check `geolocation-usage` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The geolocation-usage check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `clipboard-access` [content / info / stub]
**Clipboard Access**

Security check `clipboard-access` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The clipboard-access check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `webcam-microphone-access` [content / info / stub]
**Webcam Microphone Access**

Security check `webcam-microphone-access` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The webcam-microphone-access check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `html-injection-patterns` [content / info / stub]
**Html Injection Patterns**

Security check `html-injection-patterns` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The html-injection-patterns check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `reflected-input` [content / info / stub]
**Reflected Input**

Security check `reflected-input` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The reflected-input check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `exposed-api-version` [content / info / stub]
**Exposed Api Version**

Security check `exposed-api-version` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The exposed-api-version check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `server-info` [content / info / stub]
**Server Info**

Security check `server-info` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The server-info check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `phishing-lookalike-domain` [content / info / stub]
**Phishing Lookalike Domain**

Security check `phishing-lookalike-domain` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The phishing-lookalike-domain check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `og-injection` [content / info / stub]
**Og Injection**

Security check `og-injection` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The og-injection check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sw-insecure` [content / info / stub]
**Sw Insecure**

Security check `sw-insecure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The sw-insecure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `password-no-paste` [content / info / stub]
**Password No Paste**

Security check `password-no-paste` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The password-no-paste check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `database-connection-string` [content / info / stub]
**Database Connection String**

Security check `database-connection-string` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The database-connection-string check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sql-error-exposed` [content / info / stub]
**Sql Error Exposed**

Security check `sql-error-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The sql-error-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `source-code-comment` [content / info / stub]
**Source Code Comment**

Security check `source-code-comment` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The source-code-comment check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sri-missing-critical` [content / info / stub]
**Sri Missing Critical**

Security check `sri-missing-critical` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The sri-missing-critical check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `hardcoded-ip-addresses` [content / info / stub]
**Hardcoded Ip Addresses**

Security check `hardcoded-ip-addresses` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under content.

**Why it matters:** The hardcoded-ip-addresses check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Category: cookies (30 checks)

### `cookie-path-root` [cookies / info / combined]
**Cookie with Root Path**

Cookie available to entire site via path=/.

**Risk:** Cookie accessible from all paths on the domain.

**Why it matters:** Consider restricting cookie path for isolation.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Set specific path for cookies when appropriate.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-domain-broad` [cookies / medium / combined]
**Cookie with Broad Domain**

Cookie set with leading dot domain (all subdomains).

**Risk:** Cookie shared across all subdomains.

**Why it matters:** Subdomain cookie sharing increases attack surface.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Restrict cookie domain unless sharing is needed.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-secure-missing` [cookies / low / combined]
**Sensitive Cookie Missing __Host- Prefix**

Session cookie could use __Host- prefix.

**Risk:** __Host- ensures cookie is secure, same-domain, path=/.

**Why it matters:** Cookie prefixes provide additional protections.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Rename sensitive cookies with __Host- prefix.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-partitioned-missing` [cookies / info / combined]
**Third-Party Cookie Missing Partitioned**

Third-party cookie missing Partitioned attribute.

**Risk:** Cookie may be blocked in privacy-focused browsers.

**Why it matters:** CHIPS (Partitioned cookies) enable privacy-preserving third-party cookies.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Add Partitioned attribute for third-party cookies.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-host-prefix-not-secure` [cookies / high / header]
**__Host- prefix without Secure**

__Host- prefixed cookies MUST have Secure and Path=/.

**Risk:** Add Secure; SameSite=...; Path=/ to the __Host- cookie

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Add Secure; SameSite=...; Path=/ to the __Host- cookie
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-host-prefix-wrong-path` [cookies / high / header]
**__Host- prefix with non-/ Path**

__Host- prefixed cookies MUST have Path=/.

**Risk:** Set Path=/ on the __Host- cookie

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Set Path=/ on the __Host- cookie
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-secure-prefix-not-secure` [cookies / high / header]
**__Secure- prefix without Secure**

__Secure- prefixed cookies MUST have the Secure attribute.

**Risk:** Add Secure to the __Secure- cookie

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Add Secure to the __Secure- cookie
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-domain-parent-on-subdomain` [cookies / low / header]
**Cookie Domain attribute is too loose**

Cookies with an explicit Domain= attribute are sent to every subdomain. Avoid Domain= when not necessary.

**Risk:** Drop Domain= or scope to the required host only

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Drop Domain= or scope to the required host only
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-expires-too-far` [cookies / low / header]
**Cookie Expires/Max-Age > 1 year**

Cookies that last more than a year violate some privacy regulations and live forever in browser storage.

**Risk:** Limit cookie lifetime to 90 days for sessions, 1 year for persistent preferences

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Limit cookie lifetime to 90 days for sessions, 1 year for persistent preferences
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-name-disclosure` [cookies / info / header]
**Cookie name leaks framework**

Cookies named like express.sid, JSESSIONID, PHPSESSID, ASP.NET_SessionId reveal the server framework to attackers.

**Risk:** Rename the cookie to a generic opaque name (e.g. __Host-id)

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Rename the cookie to a generic opaque name (e.g. __Host-id)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-domain-no-leading-dot` [cookies / low / header]
**Domain attribute without leading dot**

RFC 6265bis deprecated the leading dot in the Domain attribute (e.g. Domain=example.com instead of Domain=.example.com). Modern user agents ignore the leading dot and treat both the same, so a missing dot is purely cosmetic but indicates the application is following older guidance.

**Risk:** Remove the leading dot from Domain= attributes to align with RFC 6265bis and modern browser behavior.

**References:**
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis

**Fix:**
- Drop the leading dot from the Domain= attribute (use example.com, not .example.com).
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-path-cross-app` [cookies / medium / header]
**Cookie Path crosses application boundary**

A cookie Path=/ makes the cookie available to every route on the host, including unrelated apps served from subpaths (e.g. /admin, /api, /internal). This broadens cookie exposure across trust boundaries.

**Risk:** Scope cookies to the smallest path needed (e.g. Path=/app, not Path=/) so unrelated apps cannot read them.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6265#section-5.2.1

**Fix:**
- Set the Path= attribute to the most specific route that requires the cookie.
- Avoid Path=/ unless the cookie truly must be readable by every route.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-expires-in-past` [cookies / info / header]
**Cookie Expires is in the past**

Set-Cookie headers with an Expires value in the past cause immediate deletion by the user agent. This is sometimes intentional (logout) but often indicates a clock-skew bug or leftover debug cookie.

**Risk:** Verify the past Expires is intentional; if it is, send Max-Age=0 instead and confirm it is only used on logout endpoints.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6265#section-4.1.1

**Fix:**
- Confirm the past Expires value is intentional (logout, deletion).
- Prefer Max-Age=0 for explicit cookie deletion.
- Audit cookies served from non-logout paths for stale dates.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-max-age-zero` [cookies / info / header]
**Cookie Max-Age=0 deletion pattern**

Max-Age=0 instructs the browser to delete the named cookie. This is the canonical logout / clear-cookie pattern. Repeated occurrences across the same scan usually indicate a buggy double-delete or a session cookie masquerading as a deletion.

**Risk:** Limit Max-Age=0 Set-Cookie headers to logout endpoints; do not emit them on every authenticated request.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6265#section-4.1.1

**Fix:**
- Restrict Max-Age=0 Set-Cookie emission to logout / reset endpoints.
- Verify the cookie being deleted is not the same one being set in the same response.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-no-samesite-third-party` [cookies / medium / header]
**Third-party cookie without SameSite**

Cookies set in a third-party context (iframe embed, cross-site redirect) without SameSite=None will be blocked by modern browsers and will produce inconsistent behavior across browsers.

**Risk:** Set SameSite=None; Secure on cookies that are intentionally third-party; otherwise set SameSite=Lax or Strict.

**References:**
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-5.3.7

**Fix:**
- If the cookie is intentionally cross-site, add SameSite=None; Secure.
- If the cookie is not needed cross-site, add SameSite=Lax or Strict.
- Audit embedded iframes and cross-site redirect chains for unnecessary third-party cookies.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-partitioned-without-secure` [cookies / high / header]
**Partitioned cookie missing Secure**

Cookies carrying the Partitioned attribute (CHIPS) MUST also carry the Secure attribute, otherwise browsers will reject the cookie.

**Risk:** Add Secure alongside Partitioned on every Set-Cookie that uses the CHIPS attribute.

**References:**
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis

**Fix:**
- Add Secure alongside Partitioned on every cookie that uses CHIPS.
- Validate the host is HTTPS-served before adding Partitioned.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-missing-domain-host-only` [cookies / info / header]
**Cookie is host-only (no Domain attribute)**

When Set-Cookie omits the Domain attribute, the cookie becomes host-only and is not sent to subdomains. This is the recommended setting per RFC 6265bis and the safest default.

**Risk:** Keep the cookie host-only; if subdomain sharing is required, explicitly add a scoped Domain= value.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6265bis

**Fix:**
- Confirm host-only behavior is intended.
- For sensitive cookies, rename with the __Host- prefix to enforce host-only at the user-agent level.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-third-party-no-samesite-none-secure` [cookies / high / header]
**Third-party cookie missing SameSite=None; Secure**

Cross-site cookies MUST be issued with SameSite=None; Secure in order to be accepted by modern browsers. Lacking this combination, the cookie is silently dropped in cross-site contexts.

**Risk:** Emit SameSite=None; Secure on every cookie that is required in a third-party (iframe / cross-site) context.

**References:**
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-5.3.7

**Fix:**
- Add SameSite=None and Secure to every cross-site cookie.
- Verify the response is HTTPS (Secure requires HTTPS).
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-host-prefix-injection-subdomain` [cookies / high / header]
**Cookie injection vector via __Host- / __Secure- prefix misuse**

If an application lets user-controlled values (subdomain names, host headers, redirect targets) flow into a cookie name without validation, an attacker can craft a __Host- or __Secure- prefixed cookie name from a controlled subdomain, enabling fixation-style attacks against __Host- cookie issuance policies.

**Risk:** Reject cookie names that start with __Host- or __Secure- when the value is user-controlled; only the trusted server should set these prefixes.

**References:**
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-4.1.3.2

**Fix:**
- Never let user input flow into the cookie name.
- Hard-code __Host-/__Secure- cookie names on the trusted server only.
- Audit subdomain takeover surface and co-tenanted subdomains.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-httponly-missing` [cookies / info / stub]
**Cookie Httponly Missing**

Security check `cookie-httponly-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under cookies.

**Why it matters:** The cookie-httponly-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-samesite-missing` [cookies / info / stub]
**Cookie Samesite Missing**

Security check `cookie-samesite-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under cookies.

**Why it matters:** The cookie-samesite-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-prefix-invalid` [cookies / info / stub]
**Cookie Prefix Invalid**

Security check `cookie-prefix-invalid` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under cookies.

**Why it matters:** The cookie-prefix-invalid check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-no-secure-prefix` [cookies / info / stub]
**Cookie No Secure Prefix**

Security check `cookie-no-secure-prefix` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under cookies.

**Why it matters:** The cookie-no-secure-prefix check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `set-cookie-samesite-none-no-secure` [cookies / info / stub]
**Set Cookie Samesite None No Secure**

Security check `set-cookie-samesite-none-no-secure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under cookies.

**Why it matters:** The set-cookie-samesite-none-no-secure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-max-age-excessive` [cookies / info / stub]
**Cookie Max Age Excessive**

Security check `cookie-max-age-excessive` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under cookies.

**Why it matters:** The cookie-max-age-excessive check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-path-broad` [cookies / info / stub]
**Cookie Path Broad**

Security check `cookie-path-broad` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under cookies.

**Why it matters:** The cookie-path-broad check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `session-cookie-flags` [cookies / info / stub]
**Session Cookie Flags**

Security check `session-cookie-flags` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under cookies.

**Why it matters:** The session-cookie-flags check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-domain-set-too-loose` [cookies / info / stub]
**Cookie Domain Set Too Loose**

Security check `cookie-domain-set-too-loose` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under cookies.

**Why it matters:** The cookie-domain-set-too-loose check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-no-csrf-token` [cookies / info / stub]
**Cookie No Csrf Token**

Security check `cookie-no-csrf-token` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under cookies.

**Why it matters:** The cookie-no-csrf-token check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-prefix-missing` [cookies / info / stub]
**Cookie Prefix Missing**

Security check `cookie-prefix-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under cookies.

**Why it matters:** The cookie-prefix-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Category: dns (23 checks)

### `dns-caa-record-missing` [dns / info / header]
**DNS A/AAAA Records**

Async check: resolves A and AAAA records for the target hostname and flags private/loopback addresses that should never appear in DNS for a public target.

**Risk:** Private IPs in public DNS can leak internal infrastructure and indicate takeover risk for dangling records.

**Why it matters:** DNS resolution is the first step of every scan. If the resolver returns RFC1918 / loopback / link-local addresses for a hostname the user typed, the target isn't publicly reachable and the scan is blocked.

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Remove A/AAAA records pointing at internal IPs.
- Audit CNAMEs for dangling-takeover risk (cloudfront, heroku, etc.).
- Use split-horizon DNS only where appropriate.
- **dig** (bash):
```bash
dig +short example.com A	dig +short example.com AAAA
```

### `dns-ns-record-count` [dns / high / header]
**Less than 2 authoritative nameservers**

RFC 1035 requires at least two authoritative nameservers for redundancy.

**Risk:** Add a second NS provider (or two SOA records at different subnets)

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Add a second NS provider (or two SOA records at different subnets)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-mx-record-missing` [dns / medium / header]
**MX Record Missing**

Domains that send mail should have an MX record; missing MX means backscatter or rejected mail.

**Risk:** Add an MX record if you send mail from this domain

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Add an MX record if you send mail from this domain
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-mx-backup-record` [dns / low / header]
**No backup MX (priority > 20)**

Backup MX servers (priority > 20) catch mail when the primary is down.

**Risk:** Add a backup MX with priority 20 or 30

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Add a backup MX with priority 20 or 30
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-ds-record-missing` [dns / info / header]
**No SRV records for common services**

SRV records publish service endpoints (_autodiscover._tcp, _sip._udp, etc.).

**Risk:** If you use Exchange / SIP / XMPP, publish the SRV records

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- If you use Exchange / SIP / XMPP, publish the SRV records
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-soa-refresh-high` [dns / low / header]
**SOA refresh > 24h**

SOA refresh > 24h slows propagation when you change NS records.

**Risk:** Lower refresh to 3600-7200 seconds for faster rollovers

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Lower refresh to 3600-7200 seconds for faster rollovers
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-tlsa-record-missing` [dns / info / header]
**TLSA (DANE) Record Missing**

TLSA records pin the certificate for TLS-over-DNS. Optional but defense-in-depth.

**Risk:** Publish a TLSA record at _443._tcp.yourdomain.com if you want DANE

**References:**
- https://datatracker.ietf.org/doc/html/rfc6698

**Fix:**
- Publish a TLSA record at _443._tcp.yourdomain.com if you want DANE
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-open-dns-resolver` [dns / low / header]
**Authoritative DNS exposed on public IPs**

Authoritative nameservers reachable on the public internet can be queried directly, leaking your zone data.

**Risk:** Restrict AXFR to internal IPs only

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Restrict AXFR to internal IPs only
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-dangling-cname` [dns / high / header]
**Dangling CNAME Record (subdomain takeover risk)**

A CNAME pointing to a defunct service (heroku, aws, fastly) lets an attacker register the orphan and serve content on your subdomain.

**Risk:** Audit CNAMEs against the cloud providers you use; remove dangling entries

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Audit CNAMEs against the cloud providers you use; remove dangling entries
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-resolves` [dns / high / header]
**DNS Zone Transfer (AXFR) Allowed**

AXFR responses leak your entire zone. Restrict to authorized secondaries only.

**Risk:** Set allow-transfer { <slave-ips>; }; in BIND, or equivalent in your DNS provider

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Set allow-transfer { <slave-ips>; }; in BIND, or equivalent in your DNS provider
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-recursion-enabled` [dns / medium / header]
**Authoritative DNS Allows Recursion**

Authoritative nameservers shouldn't also be recursive resolvers (open resolver risk).

**Risk:** Set allow-recursion { none; }; or split authoritative and recursive roles

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Set allow-recursion { none; }; or split authoritative and recursive roles
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-nxdomain-hijack-risk` [dns / info / header]
**NXDOMAIN Hijack Risk (ISP NXDOMAIN Replacement)**

Some ISPs replace NXDOMAIN responses with ads. DNSSEC + a validating resolver prevents this.

**Risk:** Enable DNSSEC and use a validating resolver (1.1.1.1, 8.8.8.8)

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Enable DNSSEC and use a validating resolver (1.1.1.1, 8.8.8.8)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-sshfp-record-missing` [dns / info / header]
**SSHFP Records Missing**

SSHFP records publish SSH host-key fingerprints in DNS, enabling DNSSEC-validated TOFU and preventing MITM on SSH.

**Risk:** Without SSHFP + DNSSEC, SSH clients cannot cryptographically verify host identity on first connect.

**References:**
- https://datatracker.ietf.org/doc/html/rfc4255

**Fix:**
- Generate SSHFP records with ssh-keygen -r <hostname>.
- Publish them under <hostname> as SSHFP type 2 (SHA-256).
- Enable DNSSEC and use VerifyHostKeyDNS yes in ssh_config.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-rrsig-record-missing` [dns / medium / header]
**DNSSEC RRSIG Record Missing**

RRSIG records carry the cryptographic signature over a RRset. Without RRSIGs, validating resolvers reject your responses as bogus.

**Risk:** Missing RRSIG causes SERVFAIL for DNSSEC-validating resolvers, breaking reachability for security-conscious users.

**References:**
- https://datatracker.ietf.org/doc/html/rfc4034

**Fix:**
- Re-sign the zone with your DNSSEC-aware authoritative server (BIND, Knot, etc.).
- Verify with dig +dnssec <your domain> and check the ad flag in the response.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-nsec-zone-walking` [dns / medium / header]
**NSEC/NSEC3 Zone Walking Enabled**

NSEC records form a linked list of existing names that can be walked to enumerate every name in the zone. NSEC3 with opt-out partially mitigates but still leaks hashed names.

**Risk:** Attackers can enumerate internal hostnames (admin, staging, dev, vpn) you did not intend to publish.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5155

**Fix:**
- Use NSEC3 with opt-out and a strong, randomly rotated salt.
- Consider NSEC5 or aggressive cache-minimum if your server supports it.
- Avoid NSEC for zones that must hide internal names.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-dangling-cname-cdn-paas` [dns / high / header]
**Dangling CNAME (CDN/PaaS Takeover)**

CNAMEs pointing at GitHub Pages (github.io), Heroku (herokuapp.com), AWS CloudFront, Azure CDN (azurewebsites.net/azureedge.net), Fastly, or Netlify that no longer resolve let attackers register the orphan and serve content from your subdomain.

**Risk:** Subdomain takeover via these providers enables phishing, cookie theft, and bypass of CSP/origin controls.

**References:**
- https://github.com/EdOverflow/can-i-take-over-xyz

**Fix:**
- Inventory all CNAMEs targeting GitHub, Heroku, AWS, Azure, Fastly, and Netlify.
- Remove CNAMEs whose backing service no longer exists.
- Use can-i-take-over-xyz to confirm takeover viability per provider.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-dangling-cname-saas` [dns / high / header]
**Dangling CNAME (SaaS Takeover)**

CNAMEs pointing at Zendesk, HelpScout, Intercom, Drift, statuspage.io, pingdom, Pantheon, Acquia, or WP Engine that no longer resolve let attackers claim the namespace on your subdomain.

**Risk:** SaaS subdomain takeover enables phishing and impersonation of support/help-center pages, eroding customer trust.

**References:**
- https://github.com/EdOverflow/can-i-take-over-xyz

**Fix:**
- Audit all CNAMEs targeting customer-support SaaS providers.
- Remove dangling entries; if the integration is still required, re-register and re-point.
- Monitor for stale CNAMEs with automated tooling (subjack, nuclei, can-i-take-over-xyz).
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-doh-provider-detected` [dns / info / header]
**DNS-over-HTTPS Provider Detected**

DNS-over-HTTPS (DoH) endpoints reachable from your origin (1.1.1.1, 8.8.8.8, 9.9.9.9, dns.quad9.net) indicate upstream resolvers used by your stack and confirm DoH connectivity.

**Risk:** Public DoH providers in your DNS path leak query patterns to third parties; document them in your data-flow diagram.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8484

**Fix:**
- Document which DoH provider your resolvers use in the security policy.
- For sensitive workloads, run a validating recursive resolver (Unbound, Knot Resolver) and only allow egress to your chosen upstream.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-srv-records-missing` [dns / info / stub]
**Dns Srv Records Missing**

Security check `dns-srv-records-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under dns.

**Why it matters:** The dns-srv-records-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-zone-transfer-allowed` [dns / info / stub]
**Dns Zone Transfer Allowed**

Security check `dns-zone-transfer-allowed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under dns.

**Why it matters:** The dns-zone-transfer-allowed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-naptr-record-present` [dns / info / stub]
**Dns Naptr Record Present**

Security check `dns-naptr-record-present` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under dns.

**Why it matters:** The dns-naptr-record-present check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-loc-record-present` [dns / info / stub]
**Dns Loc Record Present**

Security check `dns-loc-record-present` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under dns.

**Why it matters:** The dns-loc-record-present check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dns-dnskey-record-missing` [dns / info / stub]
**Dns Dnskey Record Missing**

Security check `dns-dnskey-record-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under dns.

**Why it matters:** The dns-dnskey-record-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Category: email (28 checks)

### `email-dmarc-ruf-missing` [email / medium / header]
**SPF (Sender Policy Framework)**

Async check: queries TXT records at the apex for `v=spf1` and reports presence, weak mechanisms (+all), and lookup count.

**Risk:** Without SPF, attackers can spoof emails from your domain (phishing / BEC).

**Why it matters:** SPF is the oldest of the three email-authentication mechanisms (SPF, DKIM, DMARC).

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Publish a TXT record at the apex: v=spf1 include:_spf.google.com -all
- Stay under the 10-lookup limit (use ip4/ip6 for static ranges).
- Use -all (hard fail) or ~all (soft fail).
- **DNS TXT** (dns):
```dns
v=spf1 include:_spf.google.com include:sendgrid.net -all
```

### `email-dmarc-rua-missing` [email / medium / header]
**DMARC (Domain-based Message Authentication)**

Async check: queries TXT records at _dmarc.<domain> for `v=DMARC1` and reports the policy (none/quarantine/reject).

**Risk:** Without DMARC, receivers have no policy for handling SPF/DKIM failures.

**Why it matters:** DMARC ties SPF and DKIM together with a policy. p=reject is the gold standard.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Add a TXT record at _dmarc.<domain>: v=DMARC1; p=reject; rua=mailto:...
- Start at p=none to monitor, then move to p=quarantine and finally p=reject.
- **DNS TXT** (dns):
```dns
v=DMARC1; p=reject; rua=mailto:dmarc-reports@yourdomain.com; adkim=s; aspf=s
```

### `mta-sts` [email / medium / header]
**MTA-STS (SMTP Strict Transport Security)**

Async check: probes _mta-sts.<domain> for an `v=STSv1` TXT record and fetches the policy file at mta-sts.<domain>/.well-known/mta-sts.txt.

**Risk:** Without MTA-STS, attackers can downgrade SMTP STARTTLS or intercept mail in transit.

**Why it matters:** MTA-STS tells receiving mail servers to require TLS and refuse downgraded sessions.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Publish _mta-sts.<domain> TXT with v=STSv1; id=<timestamp>
- Serve the policy at https://mta-sts.<domain>/.well-known/mta-sts.txt
- Submit to the TLSRPT reporting address.
- **mta-sts.txt** (text):
```text
version: STSv1
mode: enforce
mx: *.example.com
max_age: 86400
```

### `email-tls-rpt-rua-missing` [email / info / header]
**TLS-RPT (TLS Reporting)**

Async check: probes _smtp._tls.<domain> for a `v=TLSRPTv1` TXT record.

**Risk:** Without TLSRPT you get no telemetry about SMTP TLS failures.

**Why it matters:** TLSRPT is a companion to MTA-STS: it tells receivers where to send aggregate reports.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Publish _smtp._tls.<domain> TXT with v=TLSRPTv1; rua=https://...
- **DNS TXT** (dns):
```dns
v=TLSRPTv1; rua=https://tlsrpt.example.com/v1/report
```

### `email-spf-lookup-count-too-high` [email / high / header]
**SPF Exceeds 10 DNS Lookup Limit**

SPF records that trigger more than 10 DNS lookups fail with a permerror.

**Risk:** Use ip4: / ip6: instead of include: for static ranges; flatten nested includes

**References:**
- https://datatracker.ietf.org/doc/html/rfc7208#section-4.6.4

**Fix:**
- Use ip4: / ip6: instead of include: for static ranges; flatten nested includes
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-spf-redirect-loop` [email / high / header]
**SPF Redirect Loop**

SPF redirect= with a chain that loops back to the original domain fails permerror.

**Risk:** Audit the redirect chain and break the loop

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Audit the redirect chain and break the loop
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-dmarc-pct-not-100` [email / low / header]
**DMARC pct < 100**

DMARC pct= applies the policy to a percentage of traffic. < 100 means some spoofed mail still gets delivered.

**Risk:** Set pct=100 once you're confident in the policy

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Set pct=100 once you're confident in the policy
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-dkim-sig-tag-missing` [email / low / header]
**DKIM Signature (s=) Missing**

DKIM records without s= are not signing anything.

**Risk:** Verify your mail server is signing with s= field

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Verify your mail server is signing with s= field
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-bimi-record-missing` [email / info / header]
**BIMI Record Missing**

BIMI (Brand Indicators for Message Identification) displays your brand logo in supported mail clients.

**Risk:** Publish a BIMI TXT record at default._bimi.yourdomain.com

**References:**
- https://bimigroup.org/

**Fix:**
- Publish a BIMI TXT record at default._bimi.yourdomain.com
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-mta-sts-policy-missing` [email / medium / header]
**MTA-STS Policy File Missing**

MTA-STS tells receivers to require TLS. Without a policy file, mail may be downgraded.

**Risk:** Serve https://mta-sts.yourdomain.com/.well-known/mta-sts.txt with mode: enforce

**References:**
- https://datatracker.ietf.org/doc/html/rfc8461

**Fix:**
- Serve https://mta-sts.yourdomain.com/.well-known/mta-sts.txt with mode: enforce
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-smtp-open-relay` [email / critical / header]
**SMTP Open Relay Detected**

Open SMTP relays are abused by spammers and put you on every RBL.

**Risk:** Require authentication for outbound relay; disable open relay in your MTA

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Require authentication for outbound relay; disable open relay in your MTA
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-smtp-banner-disclosure` [email / low / header]
**SMTP Banner Discloses Version**

SMTP 220 banner includes the daemon and version. Disable the disclosure.

**Risk:** Set smtpd_banner to a generic string in Postfix

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Set smtpd_banner to a generic string in Postfix
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-mta-sts-mode-none` [email / high / header]
**MTA-STS Mode 'none' in Production**

MTA-STS policies with mode: none or mode: testing do not enforce TLS; downgrade attacks remain possible.

**Risk:** Attackers can downgrade or intercept SMTP connections, leading to credential or content disclosure.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8461

**Fix:**
- Move to mode: enforce once you have confirmed TLS is consistently working.
- Monitor TLS-RPT reports before flipping to enforce.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-mta-sts-id-not-rotated` [email / low / header]
**MTA-STS Policy ID Not Rotated**

The MTA-STS id= field must be rotated to invalidate cached policies and force receivers to fetch the new policy.

**Risk:** A stale id prevents you from updating the policy in a timely way during incidents.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8461

**Fix:**
- Update the id= to a fresh timestamp whenever the policy changes (RFC 8461 §3.2).
- Use a UTC timestamp string or counter that increments on each change.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-bimi-without-vmc` [email / low / header]
**BIMI Without VMC Certificate**

BIMI logos are only displayed by Gmail and a few other receivers when accompanied by a Verified Mark Certificate (VMC) issued to the trademark holder.

**Risk:** Without a VMC, BIMI is ignored by major providers; brand display uplift is not realized.

**References:**
- https://bimigroup.org/vmc/

**Fix:**
- Obtain a VMC from DigiCert or Entrust after your trademark is registered.
- Host the VMC PEM at the URL in your BIMI record.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-bimi-evidence-without-hash` [email / low / header]
**BIMI evidence= Without sha256 Hash**

BIMI evidence URLs that omit the hash selector cannot be integrity-checked by receivers, weakening trust in the displayed logo.

**Risk:** An attacker who hijacks the evidence URL can swap the logo and impersonate your brand in recipient inboxes.

**References:**
- https://datatracker.ietf.org/doc/html/draft-ietf-bimi-evidence

**Fix:**
- Append the sha256 fragment to your evidence URL (e.g., logo.svg#sha256=...).
- Compute the hash with openssl dgst -sha256 logo.svg.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-mx-hostname-cname` [email / medium / header]
**MX Hostname Is a CNAME (RFC Violation)**

RFC 5321 §5.1 states MX targets must have A/AAAA records, not CNAMEs. Many relays still violate this; deliverability suffers.

**Risk:** Mail servers that strictly follow RFC 5321 will reject or de-prioritize messages to CNAME MX targets.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5321#section-5.1

**Fix:**
- Resolve any MX CNAMEs to the underlying A/AAAA and publish the A/AAAA directly.
- Update your provider's MX records to point at the IP-shaped hostname.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-mx-no-aaaa-backup` [email / low / header]
**MX Hostname Lacks A/AAAA Fallback**

An MX target that only resolves via CNAME chain or only via AAAA is fragile; if the upstream fails, mail cannot be queued.

**Risk:** Single-stack (IPv4-only or IPv6-only) MX targets cause delayed or failed delivery for clients on the other protocol.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5321#section-5.1

**Fix:**
- Publish both A and AAAA records for every MX hostname.
- Test with dig +short MX, dig +short A, dig +short AAAA for each target.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-spf-include-no-prefix` [email / low / header]
**SPF include: Without Provider _spf Prefix**

Legitimate ESPs publish their SPF records under predictable _spf.* subdomains. Includes that do not match this convention are either misconfigured or impersonating.

**Risk:** Mis-prefixed SPF includes break the lookup chain silently and can let spoofed mail pass.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7208

**Fix:**
- Verify each include: points at a recognized provider (google.com, sendgrid.net, mailgun.org, etc.).
- Replace ad-hoc includes with the provider's documented _spf subdomain.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-smtp-plain-login-auth` [email / high / header]
**PLAIN or LOGIN SMTP AUTH Advertised**

SMTP AUTH mechanisms PLAIN and LOGIN transmit credentials base64-encoded but unencrypted. If STARTTLS isn't enforced, passwords are trivially recoverable.

**Risk:** On a downgrade attack or opportunistic-TLS-fail, attackers capture plaintext credentials for your outbound relay.

**References:**
- https://datatracker.ietf.org/doc/html/rfc4954

**Fix:**
- Disable PLAIN and LOGIN in your MTA; require only CRAM-MD5 or SCRAM-SHA-1 over an enforced TLS channel.
- Pair with MTA-STS mode: enforce so downgrades are rejected.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-smtp-no-starttls` [email / high / header]
**SMTP STARTTLS Not Advertised**

A CAPABILITY response that omits STARTTLS tells clients encryption is unavailable, forcing plaintext SMTP for all traffic to that MX.

**Risk:** All inbound and outbound mail to this MX is sent unencrypted, exposing headers, content, and credentials on the wire.

**References:**
- https://datatracker.ietf.org/doc/html/rfc3207

**Fix:**
- Enable STARTTLS in Postfix (smtpd_tls_security_level = may) or your MTA equivalent.
- Pair with MTA-STS enforce and a modern TLS certificate.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `spf-record` [email / info / stub]
**Spf Record**

Security check `spf-record` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under email.

**Why it matters:** The spf-record check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dmarc-record` [email / info / stub]
**Dmarc Record**

Security check `dmarc-record` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under email.

**Why it matters:** The dmarc-record check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dkim-record` [email / info / stub]
**Dkim Record**

Security check `dkim-record` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under email.

**Why it matters:** The dkim-record check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `dnssec-enabled` [email / info / stub]
**Dnssec Enabled**

Security check `dnssec-enabled` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under email.

**Why it matters:** The dnssec-enabled check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-rpt` [email / info / stub]
**Tls Rpt**

Security check `tls-rpt` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under email.

**Why it matters:** The tls-rpt check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-spf-ptr-mechanism` [email / info / stub]
**Email Spf Ptr Mechanism**

Security check `email-spf-ptr-mechanism` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under email.

**Why it matters:** The email-spf-ptr-mechanism check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-arc-record-missing` [email / info / stub]
**Email Arc Record Missing**

Security check `email-arc-record-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under email.

**Why it matters:** The email-arc-record-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html
- https://datatracker.ietf.org/doc/html/rfc7489

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Category: headers (171 checks)

### `hsts-missing` [headers / high / combined]
**Missing HTTP Strict Transport Security (HSTS)**

The server does not send the Strict-Transport-Security header, which tells browsers to only connect via HTTPS.

**Risk:** Attackers could intercept traffic via man-in-the-middle attacks by downgrading the connection from HTTPS to HTTP.

**Why it matters:** HSTS instructs browsers to only access the site over HTTPS for a specified duration. Without it, users who type the URL without 'https://' or follow an HTTP link are vulnerable to SSL-stripping attacks.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add the Strict-Transport-Security header to all HTTPS responses.
- Set a max-age of at least 31536000 (1 year).
- Consider adding includeSubDomains and preload directives.
- Ensure your entire site works over HTTPS before enabling.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```
- **Apache** (apache):
```apache
Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
```
- **Caddy** (plaintext):
```plaintext
header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
```
- **Express (Node.js)** (javascript):
```javascript
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  next();
});
```
- **Deno (Hono)** (typescript):
```typescript
app.use('*', async (c, next) => {
  await next();
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
});
```
- **Bun (Elysia)** (typescript):
```typescript
app.onAfterHandle(({ set }) => {
  set.headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
});
```

### `csp-missing` [headers / high / header-missing]
**Missing Content Security Policy (CSP)**

No Content-Security-Policy header was found. CSP helps prevent cross-site scripting (XSS) and data injection attacks.

**Risk:** Without CSP, the site is more vulnerable to XSS attacks because browsers have no policy to restrict which scripts and resources can execute.

**Why it matters:** Content Security Policy is a defense-in-depth mechanism that restricts which resources the browser is allowed to load. By defining a strict policy, you prevent attackers from injecting malicious scripts.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Define a Content-Security-Policy header with restrictive defaults.
- Start with a report-only policy to identify issues.
- Use 'self' as the default-src and explicitly allow trusted origins.
- Avoid 'unsafe-inline' and 'unsafe-eval' where possible; use nonces or hashes instead.
- **Next.js** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';" }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;" always;
```
- **Apache** (apache):
```apache
Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
```
- **Caddy** (plaintext):
```plaintext
header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
```
- **Express (Node.js)** (javascript):
```javascript
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
  next();
});
```
- **Deno (Hono)** (typescript):
```typescript
app.use('*', async (c, next) => {
  await next();
  c.header('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
});
```
- **Bun (Elysia)** (typescript):
```typescript
app.onAfterHandle(({ set }) => {
  set.headers['Content-Security-Policy'] =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;";
});
```
- **HTML Meta Tag** (html):
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self';">
```

### `clickjack-missing` [headers / medium / combined]
**Missing Clickjacking Protection**

Neither X-Frame-Options nor CSP frame-ancestors directive is set, leaving the site vulnerable to clickjacking.

**Risk:** Attackers can embed your site in a hidden iframe and trick users into clicking on elements they don't intend to.

**Why it matters:** Clickjacking is an attack where a malicious site embeds your site in a transparent iframe. Users think they're interacting with the visible page but are actually clicking on your site.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add X-Frame-Options: DENY or SAMEORIGIN to your responses.
- Alternatively, use the CSP frame-ancestors directive for more granular control.
- DENY prevents all framing; SAMEORIGIN allows framing only from the same origin.
- **Next.js** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'X-Frame-Options', value: 'DENY' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header X-Frame-Options "DENY" always;
```
- **Apache** (apache):
```apache
Header always set X-Frame-Options "DENY"
```
- **Caddy** (plaintext):
```plaintext
header X-Frame-Options "DENY"
```
- **Express (Node.js)** (javascript):
```javascript
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
```
- **Deno (Hono)** (typescript):
```typescript
app.use('*', async (c, next) => {
  await next();
  c.header('X-Frame-Options', 'DENY');
});
```
- **Bun (Elysia)** (typescript):
```typescript
app.onAfterHandle(({ set }) => {
  set.headers['X-Frame-Options'] = 'DENY';
});
```

### `x-content-type-options-not-nosniff` [headers / low / header-missing]
**Missing X-Content-Type-Options Header**

The X-Content-Type-Options header is not set. This header prevents MIME-type sniffing.

**Risk:** Browsers may interpret files as a different MIME type than declared, which can lead to XSS attacks.

**Why it matters:** MIME sniffing is when browsers try to determine the content type by examining the content rather than trusting the Content-Type header. Setting X-Content-Type-Options to 'nosniff' prevents this.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add the header X-Content-Type-Options: nosniff to all responses.
- Ensure all resources are served with the correct Content-Type header.
- **Next.js** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header X-Content-Type-Options "nosniff" always;
```
- **Apache** (apache):
```apache
Header always set X-Content-Type-Options "nosniff"
```
- **Caddy** (plaintext):
```plaintext
header X-Content-Type-Options "nosniff"
```
- **Express (Node.js)** (javascript):
```javascript
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
```
- **Deno (Hono)** (typescript):
```typescript
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
});
```
- **Bun (Elysia)** (typescript):
```typescript
app.onAfterHandle(({ set }) => {
  set.headers['X-Content-Type-Options'] = 'nosniff';
});
```

### `referrer-policy-missing` [headers / low / header-missing]
**Missing Referrer-Policy Header**

The Referrer-Policy header is not set. This controls how much referrer information is sent with requests.

**Risk:** Sensitive information in URLs (tokens, IDs) may be leaked to third-party sites through the Referer header.

**Why it matters:** By default, browsers send the full URL in the Referer header when navigating between pages. If your URLs contain sensitive data, this data leaks to any external site the user visits next.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Referrer-Policy: strict-origin-when-cross-origin (recommended).
- For maximum privacy, use no-referrer or same-origin.
- Avoid using unsafe-url which sends the full URL to all origins.
- **Next.js** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```
- **Apache** (apache):
```apache
Header always set Referrer-Policy "strict-origin-when-cross-origin"
```
- **Caddy** (plaintext):
```plaintext
header Referrer-Policy "strict-origin-when-cross-origin"
```
- **Express (Node.js)** (javascript):
```javascript
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
```
- **Deno (Hono)** (typescript):
```typescript
app.use('*', async (c, next) => {
  await next();
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});
```
- **Bun (Elysia)** (typescript):
```typescript
app.onAfterHandle(({ set }) => {
  set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
});
```
- **HTML Meta Tag** (html):
```html
<meta name="referrer" content="strict-origin-when-cross-origin">
```

### `permissions-policy-missing` [headers / low / combined]
**Missing Permissions-Policy Header**

The Permissions-Policy (formerly Feature-Policy) header is not set.

**Risk:** Third-party scripts or iframes could access powerful browser APIs like camera, microphone, or geolocation.

**Why it matters:** Permissions-Policy allows you to selectively enable or disable browser features for your page and any embedded iframes.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add a Permissions-Policy header that disables features you don't use.
- Common features to restrict: camera, microphone, geolocation, payment, usb.
- Set features to () (empty) to disable, or self to allow only same-origin.
- **Next.js** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
```
- **Apache** (apache):
```apache
Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
```
- **Caddy** (plaintext):
```plaintext
header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
```
- **Express (Node.js)** (javascript):
```javascript
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});
```
- **Deno (Hono)** (typescript):
```typescript
app.use('*', async (c, next) => {
  await next();
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
});
```
- **Bun (Elysia)** (typescript):
```typescript
app.onAfterHandle(({ set }) => {
  set.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=(), payment=()';
});
```

### `cors-wildcard` [headers / medium / combined]
**Wildcard CORS Policy**

The Access-Control-Allow-Origin header is set to '*', allowing any origin to make cross-origin requests.

**Risk:** Any website can make requests to your API, potentially stealing sensitive data.

**Why it matters:** CORS controls which external domains can access your API. A wildcard '*' means any website can make requests.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Replace the wildcard with specific trusted origins.
- Validate the Origin header against an allowlist.
- Never combine * with Allow-Credentials: true.
- **Next.js CORS** (typescript):
```typescript
const ALLOWED = ['https://yourdomain.com'];
const origin = request.headers.get('origin');
if (ALLOWED.includes(origin)) {
  headers['Access-Control-Allow-Origin'] = origin;
}
```
- **Nginx** (nginx):
```nginx
set $cors_origin '';
if ($http_origin ~* '^https://(www\.)?yourdomain\.com$') {
    set $cors_origin $http_origin;
}
add_header Access-Control-Allow-Origin $cors_origin always;
```
- **Apache** (apache):
```apache
SetEnvIf Origin "^https://(www\.)?yourdomain\.com$" CORS_ORIGIN=$0
Header always set Access-Control-Allow-Origin "%{CORS_ORIGIN}e" env=CORS_ORIGIN
```
- **Express (Node.js)** (javascript):
```javascript
import cors from 'cors';
app.use(cors({
  origin: ['https://yourdomain.com'],
  credentials: true,
}));
```
- **Deno (Hono)** (typescript):
```typescript
import { cors } from 'hono/cors';
app.use('*', cors({
  origin: ['https://yourdomain.com'],
  credentials: true,
}));
```
- **Bun (Elysia)** (typescript):
```typescript
import { cors } from '@elysiajs/cors';
app.use(cors({
  origin: ['https://yourdomain.com'],
  credentials: true,
}));
```

### `xxss-protection-missing` [headers / low / combined]
**Missing X-XSS-Protection Header**

The X-XSS-Protection header is not set and no Content-Security-Policy is present.

**Risk:** Older browsers that still support the XSS auditor won't have it activated.

**Why it matters:** While the XSS auditor is deprecated in modern browsers, having protection headers is still recommended.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Implement a strong Content-Security-Policy (preferred approach).
- Set X-XSS-Protection: 0 (to avoid the buggy auditor).
- Focus on input validation and output encoding.
- **CSP preferred** (text):
```text
Content-Security-Policy: default-src 'self'; script-src 'self'
```

### `cors-credentials-wildcard` [headers / critical / combined]
**Dangerous CORS Configuration**

The server allows credentials with a wildcard origin.

**Risk:** Any website can make authenticated cross-origin requests to your API.

**Why it matters:** When ACAO is * with credentials allowed, any website can make authenticated requests. This completely bypasses the Same-Origin Policy.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Never combine wildcard with Allow-Credentials: true.
- Explicitly list allowed origins.
- Validate the Origin header against an allowlist.
- **Secure CORS** (typescript):
```typescript
const ALLOWED = ['https://yourdomain.com'];
if (ALLOWED.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}
```

### `cross-origin-resource-policy-report-only-missing` [headers / info / header-missing]
**Missing Cross-Origin-Resource-Policy (CORP)**

No Cross-Origin-Resource-Policy header is set.

**Risk:** Your resources can be embedded by any origin.

**Why it matters:** CORP complements COOP and COEP to enable cross-origin isolation.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add 'Cross-Origin-Resource-Policy: same-origin' for maximum protection.
- Use 'same-site' if resources need to be shared across subdomains.
- Use 'cross-origin' only for public CDN assets.
- **Next.js** (javascript):
```javascript
const nextConfig = { async headers() { return [{ source: '/(.*)', headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'same-origin' }] }]; } };
```

### `csp-report-only` [headers / medium / combined]
**CSP Report-Only Without Enforcement**

CSP-Report-Only is set but no enforcing CSP header exists.

**Risk:** The site is logging CSP violations but not actually blocking them.

**Why it matters:** CSP-Report-Only is meant for testing before deployment. Running it without an enforcing CSP means zero protection.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Deploy an enforcing Content-Security-Policy header alongside report-only.
- Start with a restrictive policy and relax based on report-only findings.
- **Both headers** (text):
```text
Content-Security-Policy: default-src 'self'; script-src 'self'
Content-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report
```

### `weak-csp-directives` [headers / medium / combined]
**Content Security Policy Contains Weak Directives**

The CSP header contains weak directives that reduce its effectiveness.

**Risk:** Weak directives create exploitable gaps that allow attackers to bypass the policy.

**Why it matters:** A CSP is only as strong as its weakest directive.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Replace 'unsafe-inline' with nonce-based or hash-based script loading.
- Remove 'unsafe-eval' and refactor code.
- Replace wildcard sources with explicit trusted domains.
- Remove data: from script-src.
- **Strong CSP** (text):
```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{random}'; style-src 'self' 'nonce-{random}'; img-src 'self' data:;
```

### `csp-framework-required` [headers / info / combined]
**CSP Contains Framework-Required Directives**

The CSP includes directives required by the frontend framework. This is expected for Next.js, React, Vue, or Angular applications.

**Risk:** Framework-required directives slightly reduce XSS protection, but are necessary for the framework to function.

**Why it matters:** Modern frameworks require 'unsafe-inline' and/or 'unsafe-eval' for their runtime features. While these weaken CSP, they're necessary trade-offs.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Ensure all user input is properly sanitized.
- Keep framework and dependencies up to date.
- Use strict CSP for other directives.
- Consider strict-dynamic with nonces.
- **Next.js CSP** (javascript):
```javascript
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');
```

### `cors-credentials-with-wildcard` [headers / critical / combined]
**CORS Wildcard Origin with Credentials Allowed**

The server allows any origin (*) to make credentialed cross-origin requests.

**Risk:** Any website can make authenticated requests to your API and read the responses.

**Why it matters:** While browsers should block this specific combination, it indicates a severe CORS misunderstanding.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Never combine wildcard origin with credentials: true.
- Validate the Origin header against an explicit allowlist.
- Reflect the specific requesting origin only if trusted.
- **Node.js / Express** (javascript):
```javascript
const allowedOrigins = ['https://app.example.com'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  next();
});
```

### `dns-prefetch-on` [headers / info / combined]
**DNS Prefetch Explicitly Enabled**

X-DNS-Prefetch-Control is set to 'on', leaking which links exist on the page.

**Risk:** DNS prefetching leaks which links exist to DNS servers and network observers.

**Why it matters:** DNS prefetching resolves domain names for all links before the user clicks them.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set X-DNS-Prefetch-Control: off for pages with sensitive links.
- Leave unset for public pages.
- **Disable** (text):
```text
X-DNS-Prefetch-Control: off
```

### `early-data-header-missing` [headers / info / header]
**Early-Data header (0RTT indicator) not advertised**

The Early-Data response header signals TLS 1.3 0-RTT support. Without it, intermediaries cannot tell whether a request was replayed.

**Risk:** Disable 0-RTT or only enable it for idempotent endpoints — replays of non-idempotent requests with 0-RTT can cause double-submits.

**Why it matters:** TLS 1.3 supports 0-RTT data sent immediately on connection. If the Early-Data response header is missing, downstream caches and reverse proxies cannot apply 0-RTT replay protection.

**References:**
- https://blog.cloudflare.com/optimizing-tls-handshakes/
- https://datatracker.ietf.org/doc/html/rfc8470/

**Fix:**
- If 0-RTT is enabled at the edge, ensure the origin sends Early-Data: 1 on every response so caches can detect replays.
- Disable 0-RTT (ssl_early_data off in NGINX) unless your application is fully idempotent.
- Configure Cloudflare to disable 0-RTT for non-idempotent paths via the Network tab.
- **NGINX** (nginx):
```nginx
ssl_early_data off;
add_header Early-Data $ssl_early_data always;
```
- **Cloudflare** (http):
```http
Early-Data: 1
```

### `csp-frame-ancestors-missing` [headers / medium / combined]
**Missing CSP frame-ancestors Directive**

Neither CSP frame-ancestors nor X-Frame-Options header is present.

**Risk:** Attackers can embed your site in an iframe for clickjacking.

**Why it matters:** CSP frame-ancestors or X-Frame-Options prevents your site from being framed.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add frame-ancestors 'none' or 'self' to your CSP.
- Or add X-Frame-Options: DENY.
- CSP frame-ancestors is preferred.
- **CSP** (text):
```text
Content-Security-Policy: frame-ancestors 'none';
```

### `cors-origin-reflection` [headers / high / combined]
**CORS Origin Reflection with Credentials**

The server reflects the Origin header in Access-Control-Allow-Origin with credentials allowed. This may indicate insecure origin validation.

**Risk:** If the server blindly reflects any Origin, any website can make authenticated cross-origin requests.

**Why it matters:** Some servers reflect the incoming Origin header without validating it against an allowlist. This effectively acts as a wildcard with credentials.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Validate the Origin header against a strict allowlist.
- Never blindly reflect the Origin.
- Log and monitor rejected CORS requests.
- **Validate origin** (typescript):
```typescript
const ALLOWED = ['https://yourdomain.com'];
const origin = request.headers.get('origin');
if (!ALLOWED.includes(origin)) return new Response(null, { status: 403 });
```

### `clear-site-data-missing` [headers / low / combined]
**Logout Page Missing Clear-Site-Data Header**

A logout page was detected but it does not send the Clear-Site-Data header to clear cookies, storage, and cache.

**Risk:** Without Clear-Site-Data, session artifacts may persist after logout on shared devices.

**Why it matters:** The Clear-Site-Data header instructs the browser to clear cookies, storage, and cache. It should be sent on logout to ensure complete session termination.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add 'Clear-Site-Data: "cookies", "storage", "cache"' to logout response headers.
- Ensure the header is only sent on logout, not every page.
- **Logout route** (typescript):
```typescript
return new Response(null, {
  status: 302,
  headers: {
    'Location': '/login',
    'Clear-Site-Data': '"cookies", "storage", "cache"',
  },
});
```

### `csp-unsafe-eval-non-framework` [headers / high / combined]
**CSP Contains unsafe-eval Outside Framework Context**

The CSP includes 'unsafe-eval' but no frontend framework indicators were detected. This is a significant security weakness.

**Risk:** unsafe-eval allows eval(), Function(), and setTimeout with strings, enabling code injection via XSS.

**Why it matters:** While frameworks like Next.js/Vue need unsafe-eval, a non-framework site should never need it.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Remove 'unsafe-eval' from your CSP.
- Refactor code to avoid eval() and new Function().
- Use strict CSP with nonces.
- **Strict CSP** (text):
```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{random}'
```

### `csp-form-action-missing` [headers / medium / combined]
**CSP Missing form-action Directive**

The CSP header exists but does not contain a form-action directive to restrict form submission targets.

**Risk:** Forms can submit data to any URL, enabling form hijacking via injected <form> tags.

**Why it matters:** Without form-action, an attacker who injects HTML can add a <form> that submits to their server, exfiltrating data.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add 'form-action self' to your CSP.
- Explicitly list allowed form action targets.
- **CSP** (text):
```text
Content-Security-Policy: ... form-action 'self';
```

### `csp-base-uri-missing` [headers / medium / combined]
**CSP Missing base-uri Directive**

The CSP header exists but does not contain a base-uri directive.

**Risk:** An attacker who injects a <base> tag can redirect all relative URLs to their server.

**Why it matters:** Without base-uri, injected <base> tags can hijack relative resource loading.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add 'base-uri self' to your CSP.
- **CSP** (text):
```text
Content-Security-Policy: ... base-uri 'self';
```

### `csp-object-src-missing` [headers / medium / combined]
**CSP Missing object-src Directive**

The CSP header exists but does not contain an object-src directive to block plugins.

**Risk:** Flash, Java applets, and other plugins can be loaded, which are known attack vectors.

**Why it matters:** object-src controls the loading of plugins like Flash and Java. These should be blocked in modern websites.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add 'object-src none' to your CSP.
- If default-src is 'none', object-src is implicitly blocked.
- **CSP** (text):
```text
Content-Security-Policy: ... object-src 'none';
```

### `csp-upgrade-insecure-missing` [headers / low / header]
**CSP Missing upgrade-insecure-requests**

Content-Security-Policy does not include the upgrade-insecure-requests directive.

**Risk:** HTTP resources embedded on your HTTPS page may not be automatically upgraded, causing mixed content warnings or insecure resource loading.

**Why it matters:** The upgrade-insecure-requests CSP directive instructs the browser to automatically rewrite HTTP URLs to HTTPS before making requests. This is a safety net for any accidentally hard-coded HTTP resources.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add 'upgrade-insecure-requests' to your CSP header.
- This is safe to add as a first step even before fully auditing all resource URLs.
- **CSP Header** (http):
```http
Content-Security-Policy: upgrade-insecure-requests; default-src 'self';
```

### `coep-credentialless` [headers / info / header]
**COEP Not Using credentialless or require-corp**

Cross-Origin-Embedder-Policy is set but does not use 'credentialless' or 'require-corp'.

**Risk:** Without proper COEP, your page may not achieve cross-origin isolation, which is required for SharedArrayBuffer and high-resolution timers.

**Why it matters:** COEP with 'require-corp' or 'credentialless' enables cross-origin isolation when combined with COOP. This prevents Spectre-style side-channel attacks.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set COEP to 'credentialless' (more compatible) or 'require-corp' (stricter).
- Ensure all cross-origin resources either have CORP headers or use credentialless.
- **Header** (http):
```http
Cross-Origin-Embedder-Policy: credentialless
```

### `csp-report-uri-deprecated` [headers / info / header]
**CSP Uses Deprecated report-uri**

CSP uses the deprecated 'report-uri' directive without the modern 'report-to' directive.

**Risk:** report-uri is deprecated and may be removed from browsers. Your CSP violation reports may stop working.

**Why it matters:** The report-to directive replaces report-uri and integrates with the Reporting API. It supports features like report batching and is the future standard.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add report-to directive alongside report-uri for backward compatibility.
- Configure a Report-To header with your reporting endpoint.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `timing-allow-wildcard` [headers / medium / header-present]
**Timing-Allow-Origin Wildcard**

Timing-Allow-Origin set to wildcard.

**Risk:** Exposes detailed timing data to any origin via the Resource Timing API.

**Why it matters:** This header controls which origins can read performance timing data.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Restrict to trusted domains only.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-unsafe-inline-script` [headers / high / combined]
**CSP Allows unsafe-inline Scripts**

CSP script-src permits inline scripts without nonce or hash.

**Risk:** Inline scripts negate most XSS protections CSP provides.

**Why it matters:** unsafe-inline without nonce/hash allows any inline script to execute.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Use nonce-based or hash-based CSP instead of unsafe-inline.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-unsafe-eval-detected` [headers / high / combined]
**CSP Allows unsafe-eval**

Content Security Policy permits eval().

**Risk:** eval() can execute attacker-injected strings as code.

**Why it matters:** unsafe-eval allows dynamic code execution via eval() and Function().

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Remove unsafe-eval and refactor code to avoid eval().
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-wildcard-source` [headers / medium / combined]
**CSP Uses Wildcard Source**

Content Security Policy uses wildcard (*) as a source.

**Risk:** Any origin can serve content, defeating CSP protections.

**Why it matters:** Wildcard sources allow loading resources from any origin.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Replace * with specific trusted domains.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-no-default-src` [headers / low / combined]
**CSP Missing default-src Fallback**

CSP has no default-src directive.

**Risk:** Undeclared resource types are completely unrestricted.

**Why it matters:** default-src acts as a fallback for all unspecified directives.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add default-src 'self' as a baseline to your CSP.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `timing-allow-origin-wide` [headers / low / header]
**Timing-Allow-Origin wildcard**

Timing-Allow-Origin is set to '*', allowing any origin to read Resource Timing API data exposed via Server-Timing.

**Risk:** Cross-origin pages can fingerprint your backend by reading precise timing data.

**Why it matters:** When Server-Timing is exposed and Timing-Allow-Origin is '*', any cross-origin page can read the timing entries and fingerprint the origin's backend.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Timing-Allow-Origin

**Fix:**
- Remove Timing-Allow-Origin unless Server-Timing is intentionally exposed.
- If Server-Timing is required, set Timing-Allow-Origin to a specific trusted origin.
- **Nginx** (nginx):
```nginx
proxy_hide_header Timing-Allow-Origin;
```
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Timing-Allow-Origin', value: 'https://your-trusted-origin.example' }],
    }];
  },
};
export default nextConfig;
```

### `referrer-policy-unsafe` [headers / medium / header-present]
**Unsafe Referrer-Policy Value**

Referrer-Policy uses a value that leaks full URLs.

**Risk:** Full URLs including query params leaked to third parties.

**Why it matters:** unsafe-url and no-referrer-when-downgrade send full referrer to all destinations.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Use strict-origin-when-cross-origin or no-referrer.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-xss-protection-disabled` [headers / low / header-present]
**X-XSS-Protection Explicitly Disabled**

X-XSS-Protection set to 0.

**Risk:** While deprecated, explicitly disabling XSS filter removes a defense layer in older browsers.

**Why it matters:** Setting X-XSS-Protection to 0 turns off the built-in XSS auditor.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Remove the header entirely or set to 1; mode=block.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-unsafe-hashes` [headers / high / header-value]
**CSP Uses unsafe-hashes**

CSP policy includes unsafe-hashes directive.

**Risk:** Allows inline event handlers which can be exploited for XSS.

**Why it matters:** unsafe-hashes enables specific inline handlers but weakens CSP.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Migrate inline handlers to external scripts with nonces.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-frame-src-missing` [headers / low / combined]
**CSP Missing frame-src Directive**

CSP lacks frame-src directive for iframe sources.

**Risk:** Any content can be loaded in iframes.

**Why it matters:** frame-src controls which origins can be loaded in frames.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add frame-src 'self' or 'none' to CSP.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-object-src-unsafe` [headers / medium / combined]
**CSP Allows Object/Embed Sources**

CSP allows plugins via object-src.

**Risk:** Flash and other plugins can be exploited.

**Why it matters:** object-src should be 'none' unless plugins are required.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set object-src 'none' in CSP.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-script-src-self-only` [headers / info / combined]
**CSP script-src Too Restrictive**

CSP script-src only allows 'self'.

**Risk:** May break functionality if external scripts needed.

**Why it matters:** Very restrictive CSP may require code changes.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Verify site functions correctly with this CSP.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-block-all-mixed-content` [headers / info / combined]
**CSP Should Block Mixed Content**

CSP lacks block-all-mixed-content directive.

**Risk:** HTTP resources may still load on HTTPS pages.

**Why it matters:** This directive blocks all mixed content.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add block-all-mixed-content to CSP.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-frame-ancestors` [headers / medium / combined]
**Clickjacking Protection Header-Only**

Clickjacking protection via header but no JS backup.

**Risk:** Older browsers may not support headers.

**Why it matters:** JavaScript frame busting provides backup.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add JS frame busting for legacy browser support.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-frame-options-invalid` [headers / medium / header-present]
**Invalid X-Frame-Options Value**

X-Frame-Options has invalid value.

**Risk:** Clickjacking protection may not work.

**Why it matters:** Only DENY, SAMEORIGIN, ALLOW-FROM are valid.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Use DENY or SAMEORIGIN for X-Frame-Options.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cache-control-no-store-missing` [headers / medium / combined]
**Sensitive Page Missing no-store**

Page with credentials lacks Cache-Control: no-store.

**Risk:** Sensitive data may be cached.

**Why it matters:** no-store prevents all caching.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Cache-Control: no-store to sensitive pages.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `pragma-no-cache-legacy` [headers / info / header-present]
**Legacy Pragma Header Used**

Pragma: no-cache header present.

**Risk:** Legacy header, HTTP/1.0 only.

**Why it matters:** Cache-Control is preferred for HTTP/1.1+.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Use Cache-Control instead of Pragma.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `expires-past` [headers / info / header-present]
**Expires Header Set to Past**

Expires header set to date in the past.

**Risk:** Signals no caching to legacy proxies.

**Why it matters:** Past expiry prevents legacy caching.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Use Cache-Control for modern caching control.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `accept-ch-missing` [headers / low / header]
**Accept-CH Client Hints Header Missing**

Accept-CH lets servers request Sec-CH-UA / Sec-CH-UA-* hints from the browser to vary responses by client.

**Risk:** Add Accept-CH: Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept-CH

**Fix:**
- Add Accept-CH: Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `accept-ch-lifetime-missing` [headers / info / header]
**Accept-CH-Lifetime Missing**

Accept-CH-Lifetime tells the browser how long to remember the Accept-CH policy.

**Risk:** Add Accept-CH-Lifetime: 86400 (1 day) or longer

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept-CH-Lifetime

**Fix:**
- Add Accept-CH-Lifetime: 86400 (1 day) or longer
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `critical-ch-missing` [headers / info / header]
**Critical-CH Missing**

Critical-CH lets servers require client hints to be present before the response is rendered.

**Risk:** Add Critical-CH: Sec-CH-UA, Sec-CH-UA-Mobile

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Critical-CH: Sec-CH-UA, Sec-CH-UA-Mobile
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `coop-missing` [headers / info / header]
**COOP-Report-Only Header Missing**

COOP-Report-Only lets you preview COOP changes without breaking browsers that lack support.

**Risk:** Add Cross-Origin-Opener-Policy-Report-Only to monitor before enforcing

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Cross-Origin-Opener-Policy-Report-Only to monitor before enforcing
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `corp-missing` [headers / info / header]
**CORP-Report-Only Missing**

CORP-Report-Only lets you monitor CORP violations without breaking the site.

**Risk:** Add Cross-Origin-Resource-Policy-Report-Only: same-site

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Cross-Origin-Resource-Policy-Report-Only: same-site
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `origin-isolation-header-missing` [headers / info / header]
**Origin-Isolation Header Missing (OPUS)**

Origin-Isolation is a Chrome-Origin-Trial that opts into stricter process-per-origin isolation.

**Risk:** Enable the Origin-Isolation origin trial if you're targeting modern Chrome

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Enable the Origin-Isolation origin trial if you're targeting modern Chrome
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `charset-meta-missing` [headers / info / header]
**Sec-Fetch-* Request Headers Not Echoed**

Sec-Fetch-Site / Sec-Fetch-Mode / Sec-Fetch-Dest are sent by modern browsers. Servers can use them to differentiate bots from real users.

**Risk:** Consider logging Sec-Fetch-* headers for anomaly detection

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Consider logging Sec-Fetch-* headers for anomaly detection
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `trigger-header-missing` [headers / info / header]
**Trigger Header Missing**

Trigger lets you chain network requests after the main response (CSP reporting, prefetch, etc.).

**Risk:** Add Trigger: <your-rule> if you want browser-driven background fetches

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Trigger: <your-rule> if you want browser-driven background fetches
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `link-rel-dns-prefetch-missing` [headers / info / header]
**dns-prefetch Link Header Missing**

Link: rel=dns-prefetch hints the browser to resolve external hostnames early.

**Risk:** Add Link: <https://cdn.example.com>; rel=dns-prefetch for known external dependencies

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Link: <https://cdn.example.com>; rel=dns-prefetch for known external dependencies
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `link-rel-preconnect-missing` [headers / info / header]
**preconnect Link Header Missing**

Link: rel=preconnect opens a TCP+TLS connection to a third party before the resource is requested.

**Risk:** Add Link: <https://cdn.example.com>; rel=preconnect for any third-party above-the-fold resource

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Link: <https://cdn.example.com>; rel=preconnect for any third-party above-the-fold resource
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `link-rel-preload-missing` [headers / info / header]
**preload Link Header Missing**

Link: rel=preload hints the browser to fetch a critical resource early.

**Risk:** Consider preload for critical CSS / fonts / above-the-fold images

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Consider preload for critical CSS / fonts / above-the-fold images
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `access-control-allow-headers-wildcard` [headers / medium / header]
**CORS Allow-Headers Wildcard**

ACA-Headers: * lets any browser send any header. Restrict to the headers you actually use.

**Risk:** Replace * with an explicit allowlist

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Replace * with an explicit allowlist
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cors-null-origin-allowed` [headers / info / header]
**COOP unsafe-popups**

COOP: same-origin-allow-popups allows popups opened by your page to share a browsing context group.

**Risk:** Use COOP: same-origin for stricter isolation unless you need popup window references

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Use COOP: same-origin for stricter isolation unless you need popup window references
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-frame-options-allowall` [headers / high / header]
**X-Frame-Options: ALLOWALL**

ALLOWALL (Chromium extension) explicitly disables framing protection. Use CSP frame-ancestors instead.

**Risk:** Remove X-Frame-Options or set DENY/SAMEORIGIN; rely on CSP frame-ancestors for modern browsers

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Remove X-Frame-Options or set DENY/SAMEORIGIN; rely on CSP frame-ancestors for modern browsers
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-incompatible-directives` [headers / low / header]
**CSP contains unsupported / legacy directives**

CSP allow-http (Chrome 41-65), reflected-xss (removed), and others are ignored.

**Risk:** Remove legacy directives like allow-http and reflected-xss

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Remove legacy directives like allow-http and reflected-xss
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-too-long` [headers / low / header]
**CSP Header > 4KB**

CSP headers longer than ~4KB are silently dropped by some browsers.

**Risk:** Split into multiple CSPs via report-to, or use nonces instead of inline source lists

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Split into multiple CSPs via report-to, or use nonces instead of inline source lists
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-geolocation-blocked` [headers / info / header]
**Permissions-Policy geolocation allowed**

Geolocation should default to 'self' unless your app needs it.

**Risk:** Set Permissions-Policy: geolocation=(self) or geolocation=() to block entirely

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set Permissions-Policy: geolocation=(self) or geolocation=() to block entirely
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-camera-blocked` [headers / info / header]
**Permissions-Policy camera allowed**

Camera should default to 'self' or be blocked.

**Risk:** Set Permissions-Policy: camera=() to block entirely

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set Permissions-Policy: camera=() to block entirely
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-microphone-blocked` [headers / info / header]
**Permissions-Policy microphone allowed**

Microphone should default to 'self' or be blocked.

**Risk:** Set Permissions-Policy: microphone=() to block entirely

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set Permissions-Policy: microphone=() to block entirely
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-payment-blocked` [headers / info / header]
**Permissions-Policy payment allowed**

Payment Request API should default to 'self'.

**Risk:** Set Permissions-Policy: payment=(self) to scope to your origin

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set Permissions-Policy: payment=(self) to scope to your origin
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-usb-blocked` [headers / info / header]
**Permissions-Policy USB allowed**

WebUSB should default to 'self'.

**Risk:** Set Permissions-Policy: usb=(self)

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set Permissions-Policy: usb=(self)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-bluetooth-blocked` [headers / info / header]
**Permissions-Policy bluetooth allowed**

Web Bluetooth should default to 'self'.

**Risk:** Set Permissions-Policy: bluetooth=(self)

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set Permissions-Policy: bluetooth=(self)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-serial-blocked` [headers / info / header]
**Permissions-Policy serial allowed**

Web Serial should default to 'self'.

**Risk:** Set Permissions-Policy: serial=(self)

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set Permissions-Policy: serial=(self)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-screen-wake-lock-blocked` [headers / info / header]
**Permissions-Policy wake-lock allowed**

Wake Lock should default to 'self'.

**Risk:** Set Permissions-Policy: screen-wake-lock=(self)

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set Permissions-Policy: screen-wake-lock=(self)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-publickey-credentials-get-blocked` [headers / info / header]
**Permissions-Policy publickey-credentials-get allowed**

Passkey / WebAuthn should default to 'self'.

**Risk:** Set Permissions-Policy: publickey-credentials-get=(self)

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set Permissions-Policy: publickey-credentials-get=(self)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-unload-blocked` [headers / info / header]
**Permissions-Policy unload allowed**

Permissions-Policy: unload=() is recommended to prevent third parties from intercepting the page-unload event.

**Risk:** Set Permissions-Policy: unload=()

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set Permissions-Policy: unload=()
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-clipboard-read-blocked` [headers / info / header]
**Permissions-Policy clipboard-read allowed**

Permissions-Policy does not restrict the clipboard-read feature.

**Risk:** Set Permissions-Policy: clipboard-read=() to fully block clipboard reading

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/clipboard-read

**Fix:**
- Set Permissions-Policy: clipboard-read=() to fully block clipboard reading
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-clipboard-write-blocked` [headers / info / header]
**Permissions-Policy clipboard-write allowed**

Permissions-Policy does not restrict the clipboard-write feature.

**Risk:** Set Permissions-Policy: clipboard-write=(self) to scope clipboard write to your origin

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/clipboard-write

**Fix:**
- Set Permissions-Policy: clipboard-write=(self) to scope clipboard write to your origin
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-accelerometer-blocked` [headers / info / header]
**Permissions-Policy accelerometer allowed**

Permissions-Policy does not restrict the accelerometer sensor.

**Risk:** Set Permissions-Policy: accelerometer=() to block device motion sensors

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/accelerometer

**Fix:**
- Set Permissions-Policy: accelerometer=() to block device motion sensors
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-gyroscope-blocked` [headers / info / header]
**Permissions-Policy gyroscope allowed**

Permissions-Policy does not restrict the gyroscope sensor.

**Risk:** Set Permissions-Policy: gyroscope=() to block orientation sensors

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/gyroscope

**Fix:**
- Set Permissions-Policy: gyroscope=() to block orientation sensors
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-magnetometer-blocked` [headers / info / header]
**Permissions-Policy magnetometer allowed**

Permissions-Policy does not restrict the magnetometer sensor.

**Risk:** Set Permissions-Policy: magnetometer=() to block compass sensors

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/magnetometer

**Fix:**
- Set Permissions-Policy: magnetometer=() to block compass sensors
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-ambient-light-sensor-blocked` [headers / info / header]
**Permissions-Policy ambient-light-sensor allowed**

Permissions-Policy does not restrict the ambient-light-sensor feature.

**Risk:** Set Permissions-Policy: ambient-light-sensor=() to block ambient light sensors

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/ambient-light-sensor

**Fix:**
- Set Permissions-Policy: ambient-light-sensor=() to block ambient light sensors
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-display-capture-blocked` [headers / info / header]
**Permissions-Policy display-capture allowed**

Permissions-Policy does not restrict display-capture (screen capture).

**Risk:** Set Permissions-Policy: display-capture=() to block screen capture

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/display-capture

**Fix:**
- Set Permissions-Policy: display-capture=() to block screen capture
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-fullscreen-blocked` [headers / info / header]
**Permissions-Policy fullscreen allowed**

Permissions-Policy does not restrict the fullscreen feature.

**Risk:** Set Permissions-Policy: fullscreen=(self) to scope fullscreen requests to your origin

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/fullscreen

**Fix:**
- Set Permissions-Policy: fullscreen=(self) to scope fullscreen requests to your origin
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-midi-blocked` [headers / info / header]
**Permissions-Policy midi allowed**

Permissions-Policy does not restrict Web MIDI access.

**Risk:** Set Permissions-Policy: midi=() to block MIDI device access

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/midi

**Fix:**
- Set Permissions-Policy: midi=() to block MIDI device access
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-picture-in-picture-blocked` [headers / info / header]
**Permissions-Policy picture-in-picture allowed**

Permissions-Policy does not restrict the picture-in-picture feature.

**Risk:** Set Permissions-Policy: picture-in-picture=(self) to scope PiP to your origin

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/picture-in-picture

**Fix:**
- Set Permissions-Policy: picture-in-picture=(self) to scope PiP to your origin
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-storage-access-blocked` [headers / info / header]
**Permissions-Policy storage-access allowed**

Permissions-Policy does not restrict the Storage Access API used by third-party iframes.

**Risk:** Set Permissions-Policy: storage-access=() to block third-party storage access requests

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/storage-access

**Fix:**
- Set Permissions-Policy: storage-access=() to block third-party storage access requests
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `permissions-policy-window-management-blocked` [headers / info / header]
**Permissions-Policy window-management allowed**

Permissions-Policy does not restrict the Window Management API for multi-screen layouts.

**Risk:** Set Permissions-Policy: window-management=() to block window placement APIs

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/window-management

**Fix:**
- Set Permissions-Policy: window-management=() to block window placement APIs
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `speculation-rules-missing` [headers / info / header]
**Speculation-Rules header not used**

The Speculation-Rules response header (or <script type=speculationrules>) enables the browser to prerender or prefetch pages for instant navigation, but it is not in use.

**Risk:** Add Speculation-Rules header or <script type=speculationrules> for prerender hints

**References:**
- https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API

**Fix:**
- Add Speculation-Rules header or <script type=speculationrules> for prerender hints
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `server-timing-sensitive-key-leak` [headers / low / header]
**Server-Timing exposes sensitive key**

The Server-Timing response header includes custom keys that may expose internal metrics like db, sql, redis, cache, or query durations.

**Risk:** Drop or sanitize Server-Timing entries with sensitive names in production

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing

**Fix:**
- Drop or sanitize Server-Timing entries with sensitive names in production
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `server-timing-no-allow-origin` [headers / info / header]
**Server-Timing without Timing-Allow-Origin**

Server-Timing without Timing-Allow-Origin is silently restricted by browsers, but the value still appears server-side in logs.

**Risk:** Either pair with Timing-Allow-Origin for debugging or drop Server-Timing entirely in production

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Either pair with Timing-Allow-Origin for debugging or drop Server-Timing entirely in production
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sec-ch-ua-arch-missing` [headers / info / header]
**Sec-CH-UA-Arch client hint not requested**

Sec-CH-UA-Arch lets servers see CPU architecture (e.g. arm, x86). Useful for shipping optimized binaries.

**Risk:** Add Accept-CH: Sec-CH-UA-Arch if you ship per-arch binaries

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-UA-Arch

**Fix:**
- Add Accept-CH: Sec-CH-UA-Arch if you ship per-arch binaries
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sec-ch-ua-bitness-missing` [headers / info / header]
**Sec-CH-UA-Bitness client hint not requested**

Sec-CH-UA-Bitness reports CPU bitness (e.g. 64). Combine with Sec-CH-UA-Arch for binary selection.

**Risk:** Add Accept-CH: Sec-CH-UA-Bitness alongside Sec-CH-UA-Arch if you ship per-arch binaries

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-UA-Bitness

**Fix:**
- Add Accept-CH: Sec-CH-UA-Bitness alongside Sec-CH-UA-Arch if you ship per-arch binaries
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sec-ch-ua-model-missing` [headers / info / header]
**Sec-CH-UA-Model client hint not requested**

Sec-CH-UA-Model reports the device model (e.g. Pixel 7). Useful for mobile-specific fixes.

**Risk:** Add Accept-CH: Sec-CH-UA-Model if you ship device-specific workarounds

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-UA-Model

**Fix:**
- Add Accept-CH: Sec-CH-UA-Model if you ship device-specific workarounds
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sec-ch-ua-platform-version-missing` [headers / info / header]
**Sec-CH-UA-Platform-Version client hint not requested**

Sec-CH-UA-Platform-Version reports the OS version (e.g. 15.1). Pairs with Sec-CH-UA-Platform.

**Risk:** Add Accept-CH: Sec-CH-UA-Platform-Version for OS-version-specific behaviour

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-UA-Platform-Version

**Fix:**
- Add Accept-CH: Sec-CH-UA-Platform-Version for OS-version-specific behaviour
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-host-prefix-attribute-mismatch` [headers / medium / header]
**__Host- cookie prefix with wrong attributes**

A cookie using the __Host- prefix must have Secure, Path=/, and no Domain attribute. Otherwise the browser silently rejects it.

**Risk:** Add Secure and Path=/ and remove Domain from any __Host- prefixed cookie

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies

**Fix:**
- Add Secure and Path=/ and remove Domain from any __Host- prefixed cookie
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `xcto-missing` [headers / info / stub]
**Xcto Missing**

Security check `xcto-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The xcto-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `coep-missing` [headers / info / stub]
**Coep Missing**

Security check `coep-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The coep-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cache-control-missing` [headers / info / stub]
**Cache Control Missing**

Security check `cache-control-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The cache-control-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `nel-missing` [headers / info / stub]
**Nel Missing**

Security check `nel-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The nel-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `document-policy-missing` [headers / info / stub]
**Document Policy Missing**

Security check `document-policy-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The document-policy-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `origin-agent-cluster` [headers / info / stub]
**Origin Agent Cluster**

Security check `origin-agent-cluster` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The origin-agent-cluster check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `report-to-header-missing` [headers / info / stub]
**Report To Header Missing**

Security check `report-to-header-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The report-to-header-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `nel-header-missing` [headers / info / stub]
**Nel Header Missing**

Security check `nel-header-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The nel-header-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `access-control-expose` [headers / info / stub]
**Access Control Expose**

Security check `access-control-expose` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The access-control-expose check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `access-control-expose-broad` [headers / info / stub]
**Access Control Expose Broad**

Security check `access-control-expose-broad` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The access-control-expose-broad check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `access-control-max-age-long` [headers / info / stub]
**Access Control Max Age Long**

Security check `access-control-max-age-long` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The access-control-max-age-long check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-no-upgrade-insecure` [headers / info / stub]
**Csp No Upgrade Insecure**

Security check `csp-no-upgrade-insecure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The csp-no-upgrade-insecure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `csp-data-uri-allowed` [headers / info / stub]
**Csp Data Uri Allowed**

Security check `csp-data-uri-allowed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The csp-data-uri-allowed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `excessive-permissions` [headers / info / stub]
**Excessive Permissions**

Security check `excessive-permissions` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The excessive-permissions check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `feature-policy-deprecated` [headers / info / stub]
**Feature Policy Deprecated**

Security check `feature-policy-deprecated` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The feature-policy-deprecated check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `nosniff-incorrect` [headers / info / stub]
**Nosniff Incorrect**

Security check `nosniff-incorrect` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The nosniff-incorrect check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `hsts-no-preload` [headers / info / stub]
**Hsts No Preload**

Security check `hsts-no-preload` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The hsts-no-preload check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `server-header-disclosure` [headers / info / stub]
**Server Header Disclosure**

Security check `server-header-disclosure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The server-header-disclosure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `server-version-detailed` [headers / info / stub]
**Server Version Detailed**

Security check `server-version-detailed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The server-version-detailed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-powered-by-exposed` [headers / info / stub]
**X Powered By Exposed**

Security check `x-powered-by-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The x-powered-by-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-aspnet-version-exposed` [headers / info / stub]
**X Aspnet Version Exposed**

Security check `x-aspnet-version-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The x-aspnet-version-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-aspnetmvc-version-exposed` [headers / info / stub]
**X Aspnetmvc Version Exposed**

Security check `x-aspnetmvc-version-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The x-aspnetmvc-version-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `via-header-exposed` [headers / info / stub]
**Via Header Exposed**

Security check `via-header-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The via-header-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-runtime-exposed` [headers / info / stub]
**X Runtime Exposed**

Security check `x-runtime-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The x-runtime-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-request-id-exposed` [headers / info / stub]
**X Request Id Exposed**

Security check `x-request-id-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The x-request-id-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-backend-server-exposed` [headers / info / stub]
**X Backend Server Exposed**

Security check `x-backend-server-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The x-backend-server-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `age-header-reveals-cdn` [headers / info / stub]
**Age Header Reveals Cdn**

Security check `age-header-reveals-cdn` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The age-header-reveals-cdn check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-debug-header-exposed` [headers / info / stub]
**X Debug Header Exposed**

Security check `x-debug-header-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The x-debug-header-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-amz-request-id` [headers / info / stub]
**X Amz Request Id**

Security check `x-amz-request-id` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The x-amz-request-id check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cf-ray-header` [headers / info / header]
**Cloudflare CF-Ray request identifier present**

The Cloudflare CF-Ray response header exposes the request identifier that Cloudflare assigns to every proxied request.

**Risk:** CF-Ray alone does not leak sensitive information, but it confirms your origin sits behind Cloudflare and lets attackers correlate request IDs to logs.

**Why it matters:** CF-Ray is informational — it lets support teams trace a specific request through Cloudflare's edge. It does not contain user data, PII, or session tokens.

**References:**
- https://developers.cloudflare.com/fundamentals/reference/http-request-headers/
- https://blog.cloudflare.com/cloudflare-ray-id/

**Fix:**
- CF-Ray cannot be removed from Cloudflare responses. If you want to hide CDN usage, terminate the proxy at the origin (no Cloudflare).
- If you want to keep Cloudflare but reduce fingerprinting, ensure all other Cloudflare-specific headers (cf-ray, cf-cache-status, cf-worker) are also present so attackers cannot easily distinguish them.
- **Cloudflare Transform Rule** (http):
```http
# Disable if you migrate off Cloudflare. Otherwise leave it for traceability.
# In Cloudflare dashboard → Rules → Transform Rules → Modify Response Header
# Action: Remove Header → Name: cf-ray
```

### `x-vercel-id` [headers / info / stub]
**X Vercel Id**

Security check `x-vercel-id` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The x-vercel-id check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-cache-header` [headers / info / stub]
**X Cache Header**

Security check `x-cache-header` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The x-cache-header check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `etag-inode` [headers / info / stub]
**Etag Inode**

Security check `etag-inode` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The etag-inode check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `etag-inode-leak` [headers / info / stub]
**Etag Inode Leak**

Security check `etag-inode-leak` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The etag-inode-leak check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `server-timing-exposure` [headers / info / stub]
**Server Timing Exposure**

Security check `server-timing-exposure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The server-timing-exposure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `date-time-skew` [headers / info / stub]
**Date Time Skew**

Security check `date-time-skew` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The date-time-skew check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-dns-prefetch-control-off` [headers / info / stub]
**X Dns Prefetch Control Off**

Security check `x-dns-prefetch-control-off` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The x-dns-prefetch-control-off check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cache-control-public-sensitive` [headers / info / stub]
**Cache Control Public Sensitive**

Security check `cache-control-public-sensitive` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The cache-control-public-sensitive check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `clickjacking-frameable` [headers / info / stub]
**Clickjacking Frameable**

Security check `clickjacking-frameable` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The clickjacking-frameable check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `deprecated-tls` [headers / info / stub]
**Deprecated Tls**

Security check `deprecated-tls` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The deprecated-tls check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `mixed-content` [headers / info / stub]
**Mixed Content**

Security check `mixed-content` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The mixed-content check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `form-action-http` [headers / info / stub]
**Form Action Http**

Security check `form-action-http` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The form-action-http check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `mixed-content-form-action` [headers / info / stub]
**Mixed Content Form Action**

Security check `mixed-content-form-action` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The mixed-content-form-action check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sri-missing` [headers / info / stub]
**Sri Missing**

Security check `sri-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The sri-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sri-stylesheet-missing` [headers / info / stub]
**Sri Stylesheet Missing**

Security check `sri-stylesheet-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The sri-stylesheet-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `external-script-no-sri` [headers / info / stub]
**External Script No Sri**

Security check `external-script-no-sri` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The external-script-no-sri check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sri-link-stylesheet-missing` [headers / info / stub]
**Sri Link Stylesheet Missing**

Security check `sri-link-stylesheet-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The sri-link-stylesheet-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cookie-security` [headers / info / stub]
**Cookie Security**

Security check `cookie-security` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The cookie-security check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `no-clickjack-protection` [headers / info / stub]
**No Clickjack Protection**

Security check `no-clickjack-protection` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The no-clickjack-protection check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `frame-busting-header-only` [headers / info / stub]
**Frame Busting Header Only**

Security check `frame-busting-header-only` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The frame-busting-header-only check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cors-wildcard-credentials` [headers / info / stub]
**Cors Wildcard Credentials**

Security check `cors-wildcard-credentials` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The cors-wildcard-credentials check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `access-control-allow-credentials-with-wildcard` [headers / info / stub]
**Access Control Allow Credentials With Wildcard**

Security check `access-control-allow-credentials-with-wildcard` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The access-control-allow-credentials-with-wildcard check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cors-methods-too-permissive` [headers / info / stub]
**Cors Methods Too Permissive**

Security check `cors-methods-too-permissive` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The cors-methods-too-permissive check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `access-control-allow-methods-wildcard` [headers / info / stub]
**Access Control Allow Methods Wildcard**

Security check `access-control-allow-methods-wildcard` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The access-control-allow-methods-wildcard check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `rate-limiting-missing` [headers / info / stub]
**Rate Limiting Missing**

Security check `rate-limiting-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The rate-limiting-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `coep-header-missing` [headers / info / stub]
**Coep Header Missing**

Security check `coep-header-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The coep-header-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cross-origin-opener-policy-report-only-missing` [headers / info / stub]
**Cross Origin Opener Policy Report Only Missing**

Security check `cross-origin-opener-policy-report-only-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The cross-origin-opener-policy-report-only-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sec-fetch-version-missing` [headers / info / stub]
**Sec Fetch Version Missing**

Security check `sec-fetch-version-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The sec-fetch-version-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `referrer-policy-no-referrer-strict-origin-when-cross-origin` [headers / info / stub]
**Referrer Policy No Referrer Strict Origin When Cross Origin**

Security check `referrer-policy-no-referrer-strict-origin-when-cross-origin` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The referrer-policy-no-referrer-strict-origin-when-cross-origin check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `strict-transport-security-include-subdomains` [headers / info / stub]
**Strict Transport Security Include Subdomains**

Security check `strict-transport-security-include-subdomains` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The strict-transport-security-include-subdomains check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `password-input-toggle` [headers / info / stub]
**Password Input Toggle**

Security check `password-input-toggle` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The password-input-toggle check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `email-input-no-autocomplete` [headers / info / stub]
**Email Input No Autocomplete**

Security check `email-input-no-autocomplete` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The email-input-no-autocomplete check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cc-input-no-autocomplete` [headers / info / stub]
**Cc Input No Autocomplete**

Security check `cc-input-no-autocomplete` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The cc-input-no-autocomplete check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `search-input-no-type` [headers / info / stub]
**Search Input No Type**

Security check `search-input-no-type` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The search-input-no-type check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tel-input-no-autocomplete` [headers / info / stub]
**Tel Input No Autocomplete**

Security check `tel-input-no-autocomplete` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The tel-input-no-autocomplete check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `img-no-alt` [headers / info / stub]
**Img No Alt**

Security check `img-no-alt` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The img-no-alt check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `link-no-rel` [headers / info / stub]
**Link No Rel**

Security check `link-no-rel` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The link-no-rel check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `form-no-action-https` [headers / info / stub]
**Form No Action Https**

Security check `form-no-action-https` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The form-no-action-https check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `meta-redirect-no-url` [headers / info / stub]
**Meta Redirect No Url**

Security check `meta-redirect-no-url` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The meta-redirect-no-url check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `iframe-missing-allowfullscreen` [headers / info / stub]
**Iframe Missing Allowfullscreen**

Security check `iframe-missing-allowfullscreen` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The iframe-missing-allowfullscreen check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `iframe-missing-loading-lazy` [headers / info / stub]
**Iframe Missing Loading Lazy**

Security check `iframe-missing-loading-lazy` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The iframe-missing-loading-lazy check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `autocomplete-username` [headers / info / stub]
**Autocomplete Username**

Security check `autocomplete-username` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The autocomplete-username check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `image-protocol-relative` [headers / info / stub]
**Image Protocol Relative**

Security check `image-protocol-relative` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The image-protocol-relative check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `open-graph-image-not-https` [headers / info / stub]
**Open Graph Image Not Https**

Security check `open-graph-image-not-https` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The open-graph-image-not-https check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `canonical-link-missing` [headers / info / stub]
**Canonical Link Missing**

Security check `canonical-link-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The canonical-link-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `viewport-meta-missing` [headers / info / stub]
**Viewport Meta Missing**

Security check `viewport-meta-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The viewport-meta-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `doctype-missing` [headers / info / stub]
**Doctype Missing**

Security check `doctype-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The doctype-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `inline-style-attr` [headers / info / body-pattern]
**Excessive inline style attributes**

The page contains 3 or more HTML elements with inline style attributes, which CSP cannot inspect and which complicate theming.

**Risk:** Move inline styles to external stylesheets or design tokens.

**Why it matters:** Inline style attributes cannot be validated against Content-Security-Policy rules like style-src 'self' and they couple layout to markup. External stylesheets or CSS modules make the page easier to theme and audit.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- https://web.dev/articles/style-scoping

**Fix:**
- Move recurring inline styles into the global CSS or component-level CSS modules.
- For dynamic styles (e.g. inline transform values), prefer CSS variables and style={{ '--var': value }} over raw inline rules.
- Set a CSP style-src directive that excludes 'unsafe-inline' once inline styles are eliminated.
- **React with CSS variables** (tsx):
```tsx
<div
  className="card"
  style={{ '--card-width': `<value>px` } as React.CSSProperties}
>
```
- **Nginx CSP** (nginx):
```nginx
add_header Content-Security-Policy "style-src 'self'" always;
```

### `target-blank-no-noopener` [headers / medium / body-pattern]
**Reverse Tabnabbing — target=_blank without rel=noopener**

Anchor tags use target="_blank" without rel="noopener", allowing the opened page to call window.opener.location = '...' and redirect the source page to a phishing site.

**Risk:** Add rel="noopener noreferrer" to every link with target="_blank". Modern browsers (Chrome 88+, Firefox 79+) default rel="noopener" for target="_blank", but explicit is still recommended for older browsers.

**Why it matters:** When a link opens a new tab with target='_blank' and no rel='noopener', the new page receives a reference to window.opener and can navigate the source page to any URL. This is the classic reverse-tabnabbing phishing vector.

**References:**
- https://owasp.org/www-community/attacks/Reverse_Tabnabbing
- https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a#attr-target

**Fix:**
- Add rel="noopener noreferrer" to all <a> tags with target="_blank".
- In Next.js / React, use <Link target="_blank" rel="noopener noreferrer"> for external links.
- Audit third-party embed scripts (analytics, support widgets) that open links in new tabs.
- **Next.js / React** (tsx):
```tsx
<a href="https://github.com/VulnRadar/vulnradar.dev"
   target="_blank"
   rel="noopener noreferrer">
   Star us on GitHub
</a>
```
- **Static HTML** (html):
```html
<a href="https://example.com" target="_blank" rel="noopener noreferrer">Visit</a>
```

### `email-mailto-spam` [headers / info / stub]
**Email Mailto Spam**

Security check `email-mailto-spam` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The email-mailto-spam check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `iframe-third-party-without-sandbox` [headers / info / stub]
**Iframe Third Party Without Sandbox**

Security check `iframe-third-party-without-sandbox` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under headers.

**Why it matters:** The iframe-third-party-without-sandbox check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Category: information-disclosure (35 checks)

### `rails-cookie-httponly` [information-disclosure / medium / body-pattern]
**HTML Comments Contain Sensitive Keywords**

HTML comments containing sensitive keywords (passwords, API keys, TODO notes).

**Risk:** HTML comments are visible to anyone who views page source.

**Why it matters:** Developers often leave comments referencing sensitive systems or credentials.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Remove all comments containing sensitive information.
- Use a build step that strips HTML comments.
- Move developer notes to server-side files.
- **Webpack** (javascript):
```javascript
new TerserPlugin({ terserOptions: { output: { comments: false } }, extractComments: false })
```

### `server-header-truncated` [information-disclosure / info / header]
**Server header truncated**

The Server response header ends with the literal string '(truncated)', which indicates the upstream version was actively hidden but the truncation marker is itself a fingerprint.

**Risk:** Validate that your reverse proxy is not echoing real upstream version

**Why it matters:** Some reverse proxies append '(truncated)' after the version string when server_tokens is configured to mask but not fully strip the value. The marker still confirms a real version is present upstream.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Set server_tokens off; in nginx.conf and remove the Server header entirely with proxy_hide_header Server;.
- In Apache, set ServerTokens Prod and ServerSignature Off.
- At Cloudflare, use a Transform Rule to strip Server before the response leaves the edge.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `php-version-exposed-in-cookie` [information-disclosure / info / header]
**PHP session cookie naming exposes runtime**

PHPSESSID in cookie name reveals PHP.

**Risk:** Rename the session cookie to a generic opaque value

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Rename the session cookie to a generic opaque value
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `config-js-leaked` [information-disclosure / medium / header]
**config.js / settings.js leaked**

Public config.js / settings.js often leaks API keys, environment hints, or feature flags.

**Risk:** Move secrets out of public config files

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Move secrets out of public config files
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `env-js-leaked` [information-disclosure / medium / header]
**env.js / environment.js exposed**

env.js in /public/ exposes environment-level secrets.

**Risk:** Never serve env.js from a public path

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Never serve env.js from a public path
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sitemap-public` [information-disclosure / info / header]
**Sitemap.xml publicly accessible**

Sitemap.xml is publicly accessible by design. Make sure it doesn't reference private endpoints.

**Risk:** Audit sitemap.xml for admin / private paths

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Audit sitemap.xml for admin / private paths
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `robots-txt-allows-all` [information-disclosure / info / header]
**robots.txt allows everything**

robots.txt disallows nothing — that's fine but worth noting.

**Risk:** Add explicit Disallow for paths you don't want crawled

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Add explicit Disallow for paths you don't want crawled
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `open-api-schema-version-leak` [information-disclosure / info / header]
**OpenAPI version in URL**

OpenAPI / Swagger schema version is exposed in the URL.

**Risk:** Move API version into the path prefix, not the version parameter

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Move API version into the path prefix, not the version parameter
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `cdn-cors-exposes-internal` [information-disclosure / low / header]
**CORS exposes internal CDN**

Access-Control-Allow-Origin includes internal CDN hostnames.

**Risk:** Restrict ACAO to the customer-facing origin

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Restrict ACAO to the customer-facing origin
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `recaptcha-key-leaked` [information-disclosure / info / header]
**reCAPTCHA site key exposure**

Google reCAPTCHA site key is exposed in client-side code by design. Site keys are not secret.

**Risk:** This is informational; rotate site keys if you ever suspect abuse

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- This is informational; rotate site keys if you ever suspect abuse
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `ga-tracking-id-leaked` [information-disclosure / info / header]
**Google Analytics tracking ID exposed**

GA tracking ID (UA-XXXX / G-XXXX) is publicly visible. Not a security issue by itself.

**Risk:** This is informational

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- This is informational
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `nginx-version-404-disclosure` [information-disclosure / low / body-pattern]
**nginx version disclosed in 404 / error pages**

Default nginx error pages and the Server response header often expose the exact nginx version (e.g. 'nginx/1.18.0'). Knowing the version lets attackers map CVEs quickly.

**Risk:** Hide the nginx version in server_tokens off; remove or genericize the Server header.

**References:**
- https://nginx.org/en/docs/http/ngx_http_core_module.html#server_tokens

**Fix:**
- Add 'server_tokens off;' to nginx.conf.
- Use a custom error page that does not include the server version.
- Strip the Server header at the reverse proxy or CDN.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `apache-version-404-disclosure` [information-disclosure / low / body-pattern]
**Apache version disclosed in 404 / error pages**

Default Apache error pages expose the full server version, loaded modules, and OS in the footer (e.g. 'Apache/2.4.57 (CentOS) Server at example.com Port 443').

**Risk:** Set ServerTokens Prod and ServerSignature Off in httpd.conf.

**References:**
- https://httpd.apache.org/docs/2.4/mod/core.html#servertokens

**Fix:**
- Set 'ServerTokens Prod' to expose only 'Apache'.
- Set 'ServerSignature Off' to remove the version footer.
- Use a custom ErrorDocument for all 4xx/5xx codes.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `iis-version-404-disclosure` [information-disclosure / low / body-pattern]
**IIS version disclosed in 404 / error pages**

Internet Information Services (IIS) leaks its version in the Server header and in detailed error pages, including the .NET CLR version and machine name.

**Risk:** Hide the IIS version via httpResponseHeader and disable detailed error pages.

**References:**
- https://learn.microsoft.com/en-us/iis/configuration/system.webserver/httpprotocol/

**Fix:**
- Use URL Rewrite or web.config to remove the Server header.
- Set httpErrors mode=Custom to suppress detailed errors.
- Disable 'Send Detailed Error Messages' in IIS Manager.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `mysql-access-denied-error` [information-disclosure / medium / body-pattern]
**Rails default error page disclosed**

Rails in development mode renders the 'Welcome aboard' and detailed exception pages with source code excerpts, routes, and request parameters. In production, exceptions through ActionDispatch::DebugExceptions can still leak similar information if not configured.

**Risk:** Run with RAILS_ENV=production and configure consider_all_requests_local=false.

**References:**
- https://guides.rubyonrails.org/configuring.html#rails-environment-settings

**Fix:**
- Set RAILS_ENV=production.
- Set config.consider_all_requests_local = false in production.rb.
- Configure config.action_dispatch.show_exceptions = :rescuable.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `aws-s3-nosuchbucket-error` [information-disclosure / low / body-pattern]
**AWS S3 NoSuchBucket error pattern exposed**

S3 bucket hosting exposes 'NoSuchBucket' or 'AccessDenied' XML error responses that reveal the bucket name, region, and AWS account ID via the x-amz-request-id header.

**Risk:** Genericize S3 error responses with a CDN/WAF and avoid linking directly to bucket hostnames.

**References:**
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/HostingWebsiteOnS3Setup.html

**Fix:**
- Front S3 with CloudFront or another CDN that rewrites error pages.
- Disable direct bucket hostname access via bucket policies.
- Use a vanity domain for S3-backed static sites.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `privacy-policy-missing` [information-disclosure / info / stub]
**Privacy Policy Missing**

Security check `privacy-policy-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The privacy-policy-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `terms-of-service-missing` [information-disclosure / info / stub]
**Terms Of Service Missing**

Security check `terms-of-service-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The terms-of-service-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sitemap-missing` [information-disclosure / info / stub]
**Sitemap Missing**

Security check `sitemap-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The sitemap-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `html-comment-leaks` [information-disclosure / info / stub]
**Html Comment Leaks**

Security check `html-comment-leaks` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The html-comment-leaks check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sql-error-exposure` [information-disclosure / info / stub]
**Sql Error Exposure**

Security check `sql-error-exposure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The sql-error-exposure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `rails-version-exposure` [information-disclosure / info / stub]
**Rails Version Exposure**

Security check `rails-version-exposure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The rails-version-exposure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `django-csrftoken-cookie-exposed` [information-disclosure / info / stub]
**Django Csrftoken Cookie Exposed**

Security check `django-csrftoken-cookie-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The django-csrftoken-cookie-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `laravel-session-cookie-exposes` [information-disclosure / info / stub]
**Laravel Session Cookie Exposes**

Security check `laravel-session-cookie-exposes` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The laravel-session-cookie-exposes check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `express-cookie-exposes` [information-disclosure / info / stub]
**Express Cookie Exposes**

Security check `express-cookie-exposes` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The express-cookie-exposes check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `express-error-format-disclosure` [information-disclosure / info / stub]
**Express Error Format Disclosure**

Security check `express-error-format-disclosure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The express-error-format-disclosure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `flask-debug-page-exposure` [information-disclosure / info / stub]
**Flask Debug Page Exposure**

Security check `flask-debug-page-exposure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The flask-debug-page-exposure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `django-debug-page-exposure` [information-disclosure / info / stub]
**Django Debug Page Exposure**

Security check `django-debug-page-exposure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The django-debug-page-exposure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `rails-error-page-disclosure` [information-disclosure / info / stub]
**Rails Error Page Disclosure**

Security check `rails-error-page-disclosure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The rails-error-page-disclosure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `spring-boot-actuator-exposed` [information-disclosure / info / stub]
**Spring Boot Actuator Exposed**

Security check `spring-boot-actuator-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The spring-boot-actuator-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `jenkins-version-exposure` [information-disclosure / info / stub]
**Jenkins Version Exposure**

Security check `jenkins-version-exposure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The jenkins-version-exposure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `grafana-version-exposure` [information-disclosure / info / stub]
**Grafana Version Exposure**

Security check `grafana-version-exposure` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The grafana-version-exposure check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `nextjs-app-router-rsc-headers` [information-disclosure / info / stub]
**Nextjs App Router Rsc Headers**

Security check `nextjs-app-router-rsc-headers` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The nextjs-app-router-rsc-headers check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `sveltekit-detection` [information-disclosure / info / stub]
**Sveltekit Detection**

Security check `sveltekit-detection` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The sveltekit-detection check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `vite-client-exposed` [information-disclosure / info / stub]
**Vite Client Exposed**

Security check `vite-client-exposed` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under information-disclosure.

**Why it matters:** The vite-client-exposed check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-logging-cheat-sheet/
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Category: secrets-extended (53 checks)

### `secret-stripe-webhook-endpoint` [secrets-extended / critical / header]
**Stripe webhook signing secret in client bundle**

Stripe whsec_* values must live server-side. If they show up in client code, attackers can forge webhook events.

**Risk:** Move webhook secret to environment variables; never bundle it into client JS

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Move webhook secret to environment variables; never bundle it into client JS
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-google-maps-api-key` [secrets-extended / medium / header]
**Google Maps API key in source**

Google Maps API keys (AIzaSy*) in client code can be abused to bill against your account.

**Risk:** Restrict by HTTP referrer in Google Cloud Console; consider server-side proxy

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Restrict by HTTP referrer in Google Cloud Console; consider server-side proxy
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-google-oauth-client-secret` [secrets-extended / critical / header]
**Google OAuth client_secret in source**

Google client_secret values must never appear in client-side code.

**Risk:** Use the OAuth server-side flow; never ship the client_secret to the browser

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Use the OAuth server-side flow; never ship the client_secret to the browser
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-firebase-api-key-public` [secrets-extended / low / header]
**Firebase API key (public) in source**

Firebase Web API keys (AIzaSy*) are public by design. Security depends on Firestore rules / App Check.

**Risk:** Enable Firebase App Check; review Firestore / RTDB security rules

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Enable Firebase App Check; review Firestore / RTDB security rules
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-aws-secret-key` [secrets-extended / critical / header]
**AWS Secret Access Key in source**

AWS secret access keys (40-char base64) must never be in client code or public buckets.

**Risk:** Rotate the key in IAM immediately; move to short-lived STS credentials

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate the key in IAM immediately; move to short-lived STS credentials
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-docker-hub-token` [secrets-extended / critical / header]
**GitHub PAT in source**

ghp_* / gho_* / ghu_* / ghs_* / ghr_* tokens grant repo / user access.

**Risk:** Revoke via GitHub Settings → Developer Settings → PAT; rotate

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke via GitHub Settings → Developer Settings → PAT; rotate
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-npm-token` [secrets-extended / critical / header]
**NPM auth token in source**

npm_ tokens allow publishing packages as you. Should never be in client code or public repos.

**Risk:** Revoke via npm token list; rotate

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke via npm token list; rotate
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-pypi-token` [secrets-extended / critical / header]
**PyPI token in source**

pypi-AgEIcHlwaS... tokens allow uploading packages.

**Risk:** Revoke via PyPI account settings; rotate

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke via PyPI account settings; rotate
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-cloudflare-api-key` [secrets-extended / high / header]
**Cloudflare API key in source**

Cloudflare API tokens look like 40-char hex strings and grant DNS / WAF / Workers access.

**Risk:** Rotate; restrict by IP and scope to minimum required zones

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate; restrict by IP and scope to minimum required zones
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-tailscale-key` [secrets-extended / high / header]
**Tailscale auth key in source**

tskey-* values allow joining your tailnet. Rotate immediately if exposed.

**Risk:** Revoke via Tailscale admin console

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke via Tailscale admin console
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-algolia-admin-key` [secrets-extended / critical / header]
**Algolia admin API key in source**

Algolia admin keys (long base64 strings) grant full search-index control.

**Risk:** Use the search-only key in client code; rotate the admin key

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Use the search-only key in client code; rotate the admin key
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-mapbox-secret-token` [secrets-extended / high / header]
**Mapbox secret token in source**

sk.* Mapbox tokens grant upload / dataset access. Use pk.* for client.

**Risk:** Rotate; restrict by URL

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate; restrict by URL
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-pagerduty-key` [secrets-extended / high / header]
**PagerDuty REST API key in source**

PD keys grant incident / on-call rotation control.

**Risk:** Rotate; restrict by IP

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate; restrict by IP
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-twilio-account-sid` [secrets-extended / low / header]
**Twilio Account SID in source**

Twilio Account SIDs (AC*) are not strictly secret but should not be public.

**Risk:** This is informational

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- This is informational
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-datadog-api-key` [secrets-extended / high / header]
**Datadog API key in source**

Datadog API keys grant metric ingestion. Restrict by hostname tag.

**Risk:** Rotate; scope to host tag

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate; scope to host tag
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-huggingface-write-token` [secrets-extended / high / header]
**HuggingFace write token in source**

hf_* tokens grant model / dataset upload access.

**Risk:** Use read-only tokens for inference; revoke write tokens in source

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Use read-only tokens for inference; revoke write tokens in source
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-pinecone-api-key` [secrets-extended / high / header]
**Pinecone API key in source**

Pinecone keys grant vector-DB control.

**Risk:** Restrict by environment; rotate

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Restrict by environment; rotate
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-supabase-service-role` [secrets-extended / critical / header]
**Supabase service_role JWT in source**

The service_role JWT bypasses Row Level Security. Should NEVER be in client code.

**Risk:** Use anon key + RLS in client code; service_role only on server

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Use anon key + RLS in client code; service_role only on server
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-supabase-anon-key` [secrets-extended / info / header]
**Supabase anon key in source**

Supabase anon keys are public by design. Security depends on RLS policies.

**Risk:** Review RLS policies; enable Postgres RLS on every table

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Review RLS policies; enable Postgres RLS on every table
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-aws-access-key-id` [secrets-extended / medium / header]
**AWS Access Key ID in source**

AKIA* keys are not secrets by themselves but pair with secret keys.

**Risk:** Check for the matching SecretAccessKey; rotate via IAM if both are present

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Check for the matching SecretAccessKey; rotate via IAM if both are present
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-private-key-pem` [secrets-extended / critical / header]
**PEM private key in source**

-----BEGIN ... PRIVATE KEY----- blocks grant signing/decryption access.

**Risk:** Move to a KMS or hardware-backed signer; rotate the key

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Move to a KMS or hardware-backed signer; rotate the key
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-jwt-in-config` [secrets-extended / high / header]
**JWT in client-side config**

JWTs in source are at minimum replayable; if signed with HS256 and the secret is also leaked, attackers forge tokens.

**Risk:** Don't store JWTs in client config; use HttpOnly session cookies

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Don't store JWTs in client config; use HttpOnly session cookies
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-oracle-cloud-credentials` [secrets-extended / critical / header]
**Oracle Cloud Infrastructure (OCI) credentials in source**

Oracle config files (.oci/config), user OCIDs, tenancy OCIDs, and API signing keys (PEM) grant full tenancy access.

**Risk:** Rotate the API key in OCI console, revoke the user, and move config to instance principals.

**References:**
- https://docs.oracle.com/en-us/iaas/Content/API/Concepts/sdkconfig.htm

**Fix:**
- Rotate the API key in OCI console, revoke the user, and move config to instance principals.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-ibm-cloud-iam-key` [secrets-extended / critical / header]
**IBM Cloud IAM API key in source**

IBM IAM API keys (32+ char strings) grant access to the entire IBM Cloud account - Kubernetes, databases, Object Storage.

**Risk:** Delete the key via ibmcloud iam api-key-delete and rotate downstream credentials.

**References:**
- https://cloud.ibm.com/iam/apikeys

**Fix:**
- Delete the key via ibmcloud iam api-key-delete and rotate downstream credentials.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-digitalocean-pat` [secrets-extended / critical / header]
**DigitalOcean PAT in source**

dop_v1_* tokens allow full control over droplets, databases, spaces, and Kubernetes clusters.

**Risk:** Revoke via DigitalOcean control panel -> API -> Tokens/Revoke.

**References:**
- https://docs.digitalocean.com/reference/api/digitalocean/

**Fix:**
- Revoke via DigitalOcean control panel -> API -> Tokens/Revoke.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-linode-api-key` [secrets-extended / critical / header]
**Linode API token in source**

Linode personal access tokens (64-char hex) grant Linode account takeover including instance termination.

**Risk:** Revoke via cloud.linode.com -> Profile -> API Tokens.

**References:**
- https://www.linode.com/docs/api/

**Fix:**
- Revoke via cloud.linode.com -> Profile -> API Tokens.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-vultr-api-key` [secrets-extended / critical / header]
**Vultr API key in source**

Vultr API keys grant instance, DNS, and billing control on the Vultr account.

**Risk:** Revoke via my.vultr.com -> Account -> API.

**References:**
- https://www.vultr.com/api/

**Fix:**
- Revoke via my.vultr.com -> Account -> API.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-rubygems-api-key` [secrets-extended / critical / header]
**RubyGems API key in source**

RubyGems API keys (rubygems_* / older 32-hex) allow publishing gems as the user, enabling supply-chain takeover.

**Risk:** Revoke via rubygems.org -> Edit Profile -> API Keys; enable MFA on the account.

**References:**
- https://guides.rubygems.org/api-key-scopes/

**Fix:**
- Revoke via rubygems.org -> Edit Profile -> API Keys; enable MFA on the account.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-nuget-api-key` [secrets-extended / critical / header]
**NuGet API key in source**

NuGet API keys (oy2_*) allow pushing new package versions to nuget.org under the user's identity - direct supply-chain attack.

**Risk:** Revoke via nuget.org -> Account -> API Keys; consider yanking compromised packages.

**References:**
- https://learn.microsoft.com/en-us/nuget/nuget-org/scoped-api-keys

**Fix:**
- Revoke via nuget.org -> Account -> API Keys; consider yanking compromised packages.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-jfrog-api-key` [secrets-extended / critical / header]
**JFrog Artifactory API key in source**

Artifactory access tokens and encrypted passwords grant upload, delete, and admin over artifact repositories.

**Risk:** Revoke via JFrog Platform -> Administration -> User Management -> Access Tokens.

**References:**
- https://jfrog.com/help/r/jfrog-platform-administration-documentation/access-tokens

**Fix:**
- Revoke via JFrog Platform -> Administration -> User Management -> Access Tokens.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-newrelic-browser-key` [secrets-extended / medium / header]
**New Relic browser key in source**

New Relic browser license keys (NRBR-*) are shipped in client JS to report RUM data. They are scoped by allowlist but still leak account info.

**Risk:** Restrict the browser key by hostname allowlist; use ingest keys for server-side and rotate.

**References:**
- https://docs.newrelic.com/docs/browser/browser-monitoring/getting-started/browser-agent-licenses/

**Fix:**
- Restrict the browser key by hostname allowlist; use ingest keys for server-side and rotate.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-honeycomb-write-key` [secrets-extended / high / header]
**Honeycomb write key in source**

Honeycomb events API keys grant ingest to specific datasets; long-lived classic keys can also read.

**Risk:** Rotate the key in the Honeycomb UI and switch to environment-scoped keys with shorter TTLs.

**References:**
- https://docs.honeycomb.io/api/authentication/

**Fix:**
- Rotate the key in the Honeycomb UI and switch to environment-scoped keys with shorter TTLs.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-datadog-client-token` [secrets-extended / low / header]
**Datadog client token in source**

Datadog client tokens (pub_*) are intentionally shipped in browser bundles for RUM. They are read-only / ingest-only but leak account.

**Risk:** Restrict the client token by service and origin; rotate periodically.

**References:**
- https://docs.datadoghq.com/account_management/api-app-keys/

**Fix:**
- Restrict the client token by service and origin; rotate periodically.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-gitlab-deploy-token` [secrets-extended / high / header]
**GitLab deploy token in source**

GitLab deploy tokens grant push/pull to the project registry and package registry. Long-lived and project-scoped - very useful to attackers.

**Risk:** Revoke via Settings -> Repository -> Deploy tokens; switch to CI/CD job tokens (per-job TTL).

**References:**
- https://docs.gitlab.com/ee/user/project/deploy_tokens/

**Fix:**
- Revoke via Settings -> Repository -> Deploy tokens; switch to CI/CD job tokens (per-job TTL).
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-gitlab-runner-registration` [secrets-extended / critical / header]
**GitLab runner registration token in source**

Runner registration tokens allow anyone to attach a malicious runner and exfiltrate CI secrets and source from every job.

**Risk:** Rotate immediately and switch to runner registration via group-runner auth-token workflow.

**References:**
- https://docs.gitlab.com/ee/security/reset_user_password.html

**Fix:**
- Rotate immediately and switch to runner registration via group-runner auth-token workflow.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-bitbucket-app-password` [secrets-extended / critical / header]
**Bitbucket app password in source**

Bitbucket app passwords (with associated username) grant repo, project, and account API access. Easy to misuse because they look like strings.

**Risk:** Revoke via Bitbucket Settings -> App passwords; migrate to API tokens with workspace scopes.

**References:**
- https://support.atlassian.com/bitbucket-cloud/docs/app-passwords/

**Fix:**
- Revoke via Bitbucket Settings -> App passwords; migrate to API tokens with workspace scopes.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-paypal-client-secret` [secrets-extended / critical / header]
**PayPal OAuth client secret in source**

PayPal client secrets are paired with a client ID and grant order/refund/payout operations on the merchant account.

**Risk:** Rotate via developer.paypal.com -> My Apps & Credentials; move to server-side only.

**References:**
- https://developer.paypal.com/api/rest/

**Fix:**
- Rotate via developer.paypal.com -> My Apps & Credentials; move to server-side only.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-braintree-token` [secrets-extended / critical / header]
**Braintree API token in source**

Braintree access tokens (production + sandbox) grant full payment processing, refund, and customer data access.

**Risk:** Rotate via Braintree Control Panel -> Account -> API Keys; enable IP allowlist.

**References:**
- https://developer.paypal.com/braintree/docs/guides/extend/api

**Fix:**
- Rotate via Braintree Control Panel -> Account -> API Keys; enable IP allowlist.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-square-webhook-signature` [secrets-extended / critical / header]
**Square webhook signature key in source**

Square HMAC signature keys let attackers forge webhook events (payments.created, refund.updated). Must live server-side only.

**Risk:** Move signature key to environment variables; never bundle into client JS.

**References:**
- https://developer.squareup.com/docs/webhooks/validate-signatures

**Fix:**
- Move signature key to environment variables; never bundle into client JS.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-twilio-api-key-sk` [secrets-extended / critical / header]
**Twilio API Key (SK prefix) in source**

Twilio API keys (SK*) with their secret allow programmatic SMS, voice, and account access - different from the Account SID (AC*) which is public-ish.

**Risk:** Delete via console.twilio.com -> Account -> API keys & tokens; rotate immediately.

**References:**
- https://www.twilio.com/docs/iam/api-keys

**Fix:**
- Delete via console.twilio.com -> Account -> API keys & tokens; rotate immediately.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-messagebird-access-key` [secrets-extended / critical / header]
**MessageBird access key in source**

MessageBird access keys grant SMS, voice, WhatsApp, and contact-list access on the business account.

**Risk:** Revoke via dashboard.messagebird.com -> Developers -> API access.

**References:**
- https://developers.messagebird.com/api/access-keys/

**Fix:**
- Revoke via dashboard.messagebird.com -> Developers -> API access.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-vonage-nexmo-key` [secrets-extended / critical / header]
**Vonage / Nexmo API key + secret in source**

Vonage (formerly Nexmo) API key/secret pairs grant SMS, voice, verify, and conversation API access.

**Risk:** Rotate via dashboard.nexmo.com -> Settings -> API settings.

**References:**
- https://developer.vonage.com/en/getting-started/credentials

**Fix:**
- Rotate via dashboard.nexmo.com -> Settings -> API settings.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-replicate-api-token` [secrets-extended / high / header]
**Replicate API token in source**

Replicate API tokens (r8_*) grant inference and model upload access; can be abused for huge GPU bills.

**Risk:** Revoke via replicate.com -> Account -> API tokens; set billing alerts.

**References:**
- https://replicate.com/docs/reference/http

**Fix:**
- Revoke via replicate.com -> Account -> API tokens; set billing alerts.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-cohere-api-key` [secrets-extended / high / header]
**Cohere API key in source**

Cohere trial/production keys grant access to generate, embed, and classify endpoints with billable usage.

**Risk:** Revoke via dashboard.cohere.com -> API Keys; rotate immediately.

**References:**
- https://docs.cohere.com/reference/authentication

**Fix:**
- Revoke via dashboard.cohere.com -> API Keys; rotate immediately.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-mistral-api-key` [secrets-extended / high / header]
**Mistral AI API key in source**

Mistral API keys grant chat/completion/embedding access on the La Plateforme and can incur significant cost.

**Risk:** Revoke via console.mistral.ai -> API Keys; set usage limits.

**References:**
- https://docs.mistral.ai/api/

**Fix:**
- Revoke via console.mistral.ai -> API Keys; set usage limits.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-groq-api-key` [secrets-extended / high / header]
**Groq API key in source**

Groq API keys (gsk_*) grant high-throughput inference on Groq LPU hardware - attractive to attackers because of speed.

**Risk:** Revoke via console.groq.com -> API Keys; rotate.

**References:**
- https://console.groq.com/docs/api-reference

**Fix:**
- Revoke via console.groq.com -> API Keys; rotate.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-meilisearch-master-key` [secrets-extended / critical / header]
**Meilisearch master key in source**

The Meilisearch master key grants full control: index/document CRUD, tenant creation, and key issuance.

**Risk:** Rotate via /keys endpoint with a fresh admin key; use tenant tokens for scoped access.

**References:**
- https://www.meilisearch.com/docs/learn/security/master_api_keys

**Fix:**
- Rotate via /keys endpoint with a fresh admin key; use tenant tokens for scoped access.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-typesense-admin-key` [secrets-extended / critical / header]
**Typesense admin API key in source**

Typesense admin keys grant full schema, document, and key-management control on the cluster.

**Risk:** Rotate via the Typesense cluster /keys endpoint; ship only search-only keys to clients.

**References:**
- https://typesense.org/docs/latest/api/keys.html

**Fix:**
- Rotate via the Typesense cluster /keys endpoint; ship only search-only keys to clients.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-planetscale-password` [secrets-extended / critical / header]
**PlanetScale database password in source**

PlanetScale service-token JWTs and DB passwords grant full MySQL access including branch databases and deploy-requests.

**Risk:** Revoke via app.planetscale.com -> Settings -> Passwords; rotate the branch passwords.

**References:**
- https://planetscale.com/docs/concepts/service-tokens

**Fix:**
- Revoke via app.planetscale.com -> Settings -> Passwords; rotate the branch passwords.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-auth0-client-secret` [secrets-extended / critical / header]
**Auth0 client secret in source**

Auth0 client secrets paired with client IDs let attackers exchange authorization codes for tokens against any Auth0 application.

**Risk:** Rotate via Auth0 Dashboard -> Applications -> Settings; require PKCE for public clients.

**References:**
- https://auth0.com/docs/secure/application-credentials

**Fix:**
- Rotate via Auth0 Dashboard -> Applications -> Settings; require PKCE for public clients.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-okta-api-token` [secrets-extended / critical / header]
**Okta API token (SSWS) in source**

Okta SSWS tokens grant full admin access to the org - user CRUD, app assignments, factor reset. Treat like a root password.

**Risk:** Revoke via Okta Admin -> API -> Tokens; rotate and switch to OAuth2 service apps with scoped grants.

**References:**
- https://developer.okta.com/docs/reference/api/

**Fix:**
- Revoke via Okta Admin -> API -> Tokens; rotate and switch to OAuth2 service apps with scoped grants.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-keycloak-realm-key` [secrets-extended / critical / header]
**Keycloak realm signing key in source**

Keycloak realm RSA/EC private keys sign every JWT issued by the realm. A leaked key lets attackers mint valid tokens for any user.

**Risk:** Rotate via Realm Keys -> Active -> Regenerate; immediately re-issue and revoke outstanding tokens.

**References:**
- https://www.keycloak.org/docs/latest/server_admin/index.html#realm-keys

**Fix:**
- Rotate via Realm Keys -> Active -> Regenerate; immediately re-issue and revoke outstanding tokens.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `secret-github-personal-access-token` [secrets-extended / info / stub]
**Secret Github Personal Access Token**

Security check `secret-github-personal-access-token` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under secrets-extended.

**Why it matters:** The secret-github-personal-access-token check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Category: ssl (11 checks)

### `ssl-https-only-cookie-on-http` [ssl / high / url-check]
**Site Accessible Over Unencrypted HTTP**

The site was scanned over plain HTTP. All traffic is transmitted without encryption.

**Risk:** All data transmitted between the user and server can be intercepted, read, and modified by anyone on the network path.

**Why it matters:** HTTP transmits data in plaintext, making it trivial for attackers to intercept credentials, session tokens, personal data.

**References:**
- https://datatracker.ietf.org/doc/html/rfc2818
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Obtain and install an SSL/TLS certificate.
- Configure your server to redirect all HTTP traffic to HTTPS.
- Update all internal links to HTTPS.
- Enable HSTS.
- **HTTPS redirect** (nginx):
```nginx
server { listen 80; return 301 https://domain.com$request_uri; }
```

### `unencrypted-connection` [ssl / critical / url-check]
**Site Served Over Unencrypted HTTP**

The site is accessible over plain HTTP without TLS encryption.

**Risk:** All data including credentials are transmitted in plaintext.

**Why it matters:** HTTP transmits everything in cleartext. On any shared network, attackers can passively read all traffic.

**References:**
- https://datatracker.ietf.org/doc/html/rfc2818
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Obtain and install a TLS certificate.
- Configure HTTPS.
- Set up HTTP to HTTPS redirects.
- Enable HSTS.
- **Nginx redirect** (nginx):
```nginx
server { listen 80; server_name example.com; return 301 https://$server_name$request_uri; }
```

### `expect-ct-missing` [ssl / info / header]
**Missing Expect-CT Header**

Expect-CT header is not present. This header helps detect misissued certificates.

**Risk:** Without Expect-CT, the browser won't enforce Certificate Transparency, meaning misissued certificates could go undetected.

**Why it matters:** Expect-CT allows sites to opt-in to Certificate Transparency enforcement before it becomes mandatory. It helps detect certificates that were not logged in public CT logs.

**References:**
- https://datatracker.ietf.org/doc/html/rfc2818
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Expect-CT header with enforce and max-age directives.
- Include a report-uri for monitoring before enforcing.
- **Header** (http):
```http
Expect-CT: max-age=86400, enforce, report-uri="https://example.com/ct-report"
```

### `ssl-http-and-https-both` [ssl / medium / header]
**Site accessible on both HTTP and HTTPS**

Without HSTS or auto-redirect, the HTTP version is reachable and exploitable for SSL stripping.

**Risk:** 301 redirect HTTP→HTTPS; enable HSTS with includeSubDomains; preload

**References:**
- https://datatracker.ietf.org/doc/html/rfc2818
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- 301 redirect HTTP→HTTPS; enable HSTS with includeSubDomains; preload
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `https-unusual-port` [ssl / low / url-check]
**HTTPS served on non-standard port**

HTTPS endpoints served on ports other than 443 are common for internal / staging services but should never be the public-facing entry point. Mixed-port services confuse users and bypass default HSTS / preload expectations.

**Risk:** Front non-443 HTTPS with a reverse proxy on 443, or document the port in user-facing URLs.

**References:**
- https://datatracker.ietf.org/doc/html/rfc2818

**Fix:**
- Move public HTTPS endpoints to port 443 behind a reverse proxy.
- Keep non-standard ports bound to internal-only listeners.
- If a non-standard port must be exposed, add explicit HSTS for that hostname.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `x-forwarded-method-override` [ssl / medium / header]
**HTTP method override via X-Forwarded-Method / X-HTTP-Method-Override**

Proxies that honor X-Forwarded-Method or X-HTTP-Method-Override allow clients to silently rewrite the HTTP method of a forwarded request. Combined with a TLS-terminating load balancer, this can bypass upstream method-based authorization.

**Risk:** Strip method-override headers at the load balancer; reject any request that overrides the originally-observed method.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7231#section-4

**Fix:**
- Configure the reverse proxy to strip X-Forwarded-Method and X-HTTP-Method-Override from inbound requests.
- Reject any inbound request whose body or path claims a different method than the wire-level method.
- Document allowed method-override behavior in your API gateway.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `http3-alt-svc-header` [ssl / info / header]
**HTTP/3 advertised via Alt-Svc header**

An Alt-Svc response header advertising h3 or h3-29 indicates the server supports HTTP/3 over QUIC. The presence of Alt-Svc is informational but should be validated against your actual deployment.

**Risk:** No action required if HTTP/3 is intended; otherwise strip the header to avoid advertising an unsupported protocol.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7838

**Fix:**
- Confirm HTTP/3 is actually deployed end-to-end (CDN, origin, certificates).
- If HTTP/3 is not yet ready, disable Alt-Svc emission at the proxy.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `ssl-strip-detected` [ssl / info / header]
**OCSP stapling response present**

TLS servers can staple the OCSP response for their certificate inside the TLS handshake. When present, browsers do not need to make a separate OCSP request, preserving privacy and reducing handshake latency.

**Risk:** No action required; this is informational. If stapling is missing, enable ssl_stapling on nginx / equivalent on your server.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6960

**Fix:**
- Verify ssl_stapling on; ssl_stapling_verify on; (nginx) or equivalent.
- Ensure the certificate chain includes the intermediate so stapling works.
- Monitor the OCSP responder URL for outages that disable stapling.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `mixed-protocol-content` [ssl / medium / body-pattern]
**Mixed-protocol content (HTTPS page loading HTTP resources)**

Pages served over HTTPS that include subresources (scripts, images, iframes, XHR) loaded over plain HTTP trigger mixed-content blocking in browsers and expose the page to MITM downgrade of those subresources.

**Risk:** Upgrade every internal subresource to HTTPS and add a CSP with upgrade-insecure-requests.

**References:**
- https://www.w3.org/TR/mixed-content/

**Fix:**
- Replace http:// URLs in templates with protocol-relative or https:// URLs.
- Add a Content-Security-Policy header with 'upgrade-insecure-requests'.
- Audit third-party widgets and ad tags for HTTP-only assets.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `http-no-redirect` [ssl / info / stub]
**Http No Redirect**

Security check `http-no-redirect` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under ssl.

**Why it matters:** The http-no-redirect check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://datatracker.ietf.org/doc/html/rfc2818
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `ocsp-stapling-enabled` [ssl / info / stub]
**Ocsp Stapling Enabled**

Security check `ocsp-stapling-enabled` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under ssl.

**Why it matters:** The ocsp-stapling-enabled check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://datatracker.ietf.org/doc/html/rfc2818
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Category: tls (20 checks)

### `tls-certificate-expiry` [tls / high / header]
**TLS Certificate Expiry**

Async check: opens a TLS connection to :443 and reports the certificate validity window, expiry, self-signing, and incomplete chains.

**Risk:** An expired or self-signed certificate breaks HTTPS trust and exposes users to MITM attacks.

**Why it matters:** TLS certificates are short-lived by design. The scan opens a TLS connection (not just an HTTP request) so it can inspect the leaf certificate and chain directly.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Renew the certificate via your CA (Let's Encrypt is free).
- Enable auto-renewal (certbot, Caddy, or hosting-provider automation).
- Verify the chain: openssl s_client -connect example.com:443 -showcerts.
- **OpenSSL verification** (bash):
```bash
openssl s_client -connect example.com:443 -showcerts < /dev/null | openssl x509 -noout -dates -subject -issuer
```

### `tls-protocol-version` [tls / high / header]
**Weak TLS Protocol Version**

Async check: reports whether the negotiated TLS protocol is TLS 1.2+ or older (TLS 1.0/1.1/SSLv3).

**Risk:** Older TLS versions have known attacks (POODLE, BEAST, ROBOT) and lack modern cipher suites.

**Why it matters:** TLS 1.0 and 1.1 have been deprecated by IETF (RFC 8996). Most browsers and APIs no longer support them.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Disable TLS 1.0 and 1.1 on the server.
- Keep TLS 1.2 and 1.3 enabled.
- Prefer AEAD ciphers (AES-GCM, ChaCha20-Poly1305).
- **Nginx** (nginx):
```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305;
```

### `tls-cert-key-size-rsa` [tls / medium / header]
**RSA Key Size < 2048 bits**

Modern TLS certs should use RSA ≥ 2048 bits (≥ 3072 recommended).

**Risk:** Reissue the certificate with RSA 2048 or 3072

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Reissue the certificate with RSA 2048 or 3072
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cert-self-signed` [tls / high / header]
**Self-Signed Certificate in Production**

Self-signed certs are fine for dev but break trust in production.

**Risk:** Use a publicly trusted CA (Let's Encrypt, DigiCert, etc.)

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Use a publicly trusted CA (Let's Encrypt, DigiCert, etc.)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-ocsp-stapling-missing` [tls / info / header]
**OCSP Stapling Not Enabled**

OCSP stapling avoids leaking browsing activity to the CA's responder.

**Risk:** Enable OCSP stapling in your web server config

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Enable OCSP stapling in your web server config
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cert-must-staple-missing` [tls / info / header]
**Certificate Transparency Log Missing**

CAs submit public certs to CT logs. Submitting detects mis-issuance.

**Risk:** Submit your cert to CT logs (most CAs do this automatically)

**References:**
- https://certificate.transparency.dev/

**Fix:**
- Submit your cert to CT logs (most CAs do this automatically)
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-hpkp-deprecated` [tls / info / header]
**HPKP Header Present**

Public Key Pinning is deprecated and dangerous if misconfigured.

**Risk:** Remove HPKP; rely on CA / CT log instead

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Remove HPKP; rely on CA / CT log instead
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-tls-1-3-not-supported` [tls / low / header]
**TLS 1.3 Not Supported**

TLS 1.3 reduces handshake latency and improves forward secrecy. Negotiation fails back to 1.2 if 1.3 isn't enabled.

**Risk:** Enable TLS 1.3 in your server config

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Enable TLS 1.3 in your server config
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-hsts-preload-status` [tls / info / header]
**HSTS Preload List Status**

Even with Strict-Transport-Security set, browsers are not bound by it on first visit. Submitting to the HSTS preload list guarantees TLS-only from the very first request.

**Risk:** Without preload, the first request to your domain can be downgraded by an attacker who strips the HSTS header.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6797

**Fix:**
- Set Strict-Transport-Security with includeSubDomains and a long max-age (>= 31536000).
- Submit to https://hstspreload.org once stable.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cert-san-missing` [tls / high / header]
**Subject Alternative Name (SAN) Missing**

Modern browsers and APIs only trust certificates that include Subject Alternative Name (SAN). The legacy CN field is ignored.

**Risk:** A certificate without SAN is treated as untrusted by current browsers, breaking HTTPS for end users.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5280#section-4.2.1.6

**Fix:**
- Reissue the certificate with all required hostnames listed in the SAN extension.
- Use acme.sh or certbot with -d flags to ensure SAN is populated.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cert-key-usage-wrong` [tls / high / header]
**Key Usage Extension Wrong or Absent**

X.509 certificates must carry the Key Usage extension declaring digitalSignature and keyEncipherment for TLS server certs. Wrong or absent KU is rejected by strict verifiers.

**Risk:** Browsers and libraries that enforce KU may refuse to negotiate, breaking HTTPS for users.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5280#section-4.2.1.3

**Fix:**
- Regenerate the CSR so the CA includes digitalSignature and keyEncipherment.
- Inspect with: openssl x509 -in cert.pem -noout -ext keyUsage,extendedKeyUsage.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cipher-3des-offered` [tls / high / header]
**3DES Cipher Suite Offered**

Triple DES (3DES / DES-CBC3) is slow and broken by SWEET32. Modern clients should never negotiate it.

**Risk:** Attackers can recover plaintext from long-lived TLS sessions using the SWEET32 birthday-bound attack on 3DES.

**References:**
- https://sweet32.info/

**Fix:**
- Remove all ECDHE-RSA-DES-CBC3-SHA / RSA-DES-CBC3-SHA cipher strings.
- Use only AEAD ciphers (AES-GCM, ChaCha20-Poly1305).
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cipher-rc4-offered` [tls / critical / header]
**RC4 Cipher Suite Offered**

RC4 is cryptographically broken and prohibited by RFC 7465. Any server still offering RC4 should be reconfigured immediately.

**Risk:** Long-term plaintext recovery attacks on RC4 are practical; credentials and session cookies can be exfiltrated.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Delete any ECDHE-RSA-RC4-SHA / RC4-SHA cipher string from your config.
- Force-prefer AES-GCM and ChaCha20-Poly1305.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cipher-null-offered` [tls / critical / header]
**NULL Cipher Suite Offered (No Encryption)**

NULL cipher suites (e.g., TLS_RSA_WITH_NULL_SHA) provide authentication but zero encryption. They are catastrophic in production.

**Risk:** All traffic is sent in cleartext, exposing credentials, session tokens, and user data to any on-path adversary.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246#appendix-A.5

**Fix:**
- Disable any NULL cipher in your server config (e.g., ssl_ciphers HIGH:!aNULL:!eNULL:!NULL).
- Verify with: nmap --script ssl-enum-ciphers -p 443 <host>.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cipher-export-offered` [tls / critical / header]
**EXPORT-Grade Cipher Suite Offered**

EXPORT cipher suites (40/56-bit keys) are intentionally weak and exploitable by FREAK/Logjam. Any server still offering them is misconfigured.

**Risk:** Attackers can downgrade sessions to a 512-bit key and recover session secrets within hours.

**References:**
- https://datatracker.ietf.org/doc/html/rfc4346#appendix-A

**Fix:**
- Strip EXPORT from your cipher list (ssl_ciphers ... !EXPORT).
- Ensure DHE parameters are at least 2048 bits to also close Logjam.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cipher-anonymous-dh` [tls / critical / header]
**Anonymous DH Key Exchange Offered**

Anonymous cipher suites (ADH / AECDH) provide no server authentication, allowing trivial MITM attacks.

**Risk:** An attacker can intercept the session without detection, defeating the entire purpose of TLS.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246#appendix-A

**Fix:**
- Disable anonymous KEX: ssl_ciphers ... !aNULL:!eNULL.
- Require server certificates and ECDHE/ DHE-RSA key exchange.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cert-key-size-ecdsa` [tls / info / stub]
**Tls Cert Key Size Ecdsa**

Security check `tls-cert-key-size-ecdsa` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under tls.

**Why it matters:** The tls-cert-key-size-ecdsa check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cert-sha1-sig` [tls / info / stub]
**Tls Cert Sha1 Sig**

Security check `tls-cert-sha1-sig` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under tls.

**Why it matters:** The tls-cert-sha1-sig check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-ct-log-missing` [tls / info / stub]
**Tls Ct Log Missing**

Security check `tls-ct-log-missing` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under tls.

**Why it matters:** The tls-ct-log-missing check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### `tls-cert-expired-ca-chain` [tls / info / stub]
**Tls Cert Expired Ca Chain**

Security check `tls-cert-expired-ca-chain` evaluates whether the target meets the expected configuration. Auto-generated stub.

**Risk:** If exploited, this finding exposes the target to category-specific risks under tls.

**Why it matters:** The tls-cert-expired-ca-chain check verifies that the server does not expose the weakness represented by this category.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Investigate the evidence string for the actual offending value.
- Apply the recommended configuration in the code examples below.
- Verify the fix by re-running the scan and confirming the finding is gone.
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---
