# VulnRadar Scanner Checks: AI Knowledge

_Auto-compiled from `lib/scanner/checks-data/*.json` on 2026-08-12._

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

- **Total checks:** 712
- **Categories:** 18 (active-probes, api, client-side, code, configuration, content, cookies, dns, email, headers, host-validation, information-disclosure, reputation, secrets-extended, ssl, supply-chain, tls, vibe-code)
- **By severity:**
  - high: 203
  - medium: 186
  - low: 125
  - info: 104
  - critical: 94
- **By type:**
  - body-pattern: 400
  - header: 177
  - header-missing: 55
  - combined: 52
  - url-check: 10
  - header-value: 10
  - header-present: 8

---

## Category: active-probes (1 checks)

### `reflected-input-xss` [active-probes / critical / url-check]
**Reflected Cross-Site Scripting (XSS)**

A form on this page was submitted with a unique canary value, and that value came back in the response unescaped, exactly as submitted, instead of HTML-encoded. This proves the application reflects user input into the page without sanitizing it, the definition of reflected XSS.

**Risk:** An attacker who gets a victim to click a crafted link (or submit a crafted form) can run arbitrary JavaScript in that victim's browser, in the context of this site: stealing session cookies, performing actions as the victim, or redirecting them to a phishing page.

**Why it matters:** This is a confirmed, active finding, not a pattern match: the scanner actually submitted a test value through the form and observed it reflected unescaped in the live response. The active-probing category that produced it is opt-in and off by default, since submitting real requests to a target is a materially different action than reading its responses.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://portswigger.net/web-security/cross-site-scripting/reflected

**Fix:**
- HTML-encode all user-controlled output at the point it's inserted into a page (encode on output, not just on input).
- Use your framework's auto-escaping template engine (React JSX, Vue templates, Django/Jinja2 autoescape, Rails ERB <%= %>) instead of building HTML strings by concatenation.
- Add a Content-Security-Policy that disallows inline scripts as defense in depth, so even a missed escaping bug can't execute.
- Re-run this scan after the fix to confirm the canary no longer reflects unescaped.
- **Encode on output, not just on input** (typescript):
```typescript
// Bad: string concatenation drops straight into HTML
res.send(`<p>Results for: <value></p>`);

// Good: let the templating engine escape it
res.send(renderTemplate('results', { query: req.query.q }));
// React/JSX, Vue, and most modern template engines escape
// interpolated values by default -- the bug is almost always
// a raw string concatenation or a dangerouslySetInnerHTML-style
// escape hatch bypassing that default.
```

---

## Category: api (32 checks)

### `api-rest-allow-methods-trace` [api / medium / header]
**REST endpoint allows TRACE method**

HTTP TRACE reflects the request body and is exploitable for Cross-Site Tracing (XST).

**Risk:** Cross-Site Tracing (XST) lets an attacker reflect a victim's cookies and Authorization headers, including HttpOnly cookies, back through the browser, bypassing the HttpOnly restriction and enabling session theft.

**References:**
- https://owasp.org/www-community/attacks/Cross_Site_Tracing
- https://httpwg.org/specs/rfc9110.html#TRACE

**Fix:**
- Disable TRACE on the server or reverse proxy
- In Nginx: return 405 for TRACE requests
- In Apache: add TraceEnable Off to httpd.conf
- In Express: reject TRACE at the middleware layer before routing
- **Nginx: disable TRACE** (nginx):
```nginx
# In your server block
if ($request_method = TRACE) {
    return 405;
}
```
- **Apache: disable TRACE** (apache):
```apache
# In httpd.conf or .htaccess
TraceEnable Off
```
- **Express.js: reject TRACE** (javascript):
```javascript
app.use((req, res, next) => {
  if (req.method === 'TRACE') {
    return res.status(405).end();
  }
  next();
});
```

### `api-rest-allow-methods-delete` [api / info / header]
**REST endpoint allows DELETE**

REST endpoint exposes DELETE without authentication.

**Risk:** Unauthenticated DELETE endpoints allow any internet-reachable client to permanently destroy resources, enabling data-loss attacks or cascading failures in downstream systems that depend on those records.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/
- https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

**Fix:**
- Require authentication on all state-changing verbs (DELETE, PATCH, PUT, POST)
- Return 401 for missing tokens and 403 for insufficient scope
- Use middleware to enforce auth before any route handler runs
- **Express.js: auth guard middleware** (javascript):
```javascript
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Apply before DELETE route
router.delete('/resource/:id', requireAuth, deleteHandler);
```
- **Next.js Route Handler: auth check** (typescript):
```typescript
import { getSession } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ... delete logic
}
```

### `api-graphql-suggestions-enabled` [api / low / combined]
**GraphQL introspection field suggestions**

Field suggestions on error responses let attackers enumerate the schema.

**Risk:** Field suggestions in GraphQL error messages let attackers enumerate valid field names one request at a time, reconstructing the schema even when introspection is disabled, exposing internal data models and admin-only fields.

**References:**
- https://www.apollographql.com/docs/apollo-server/security/errors/
- https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/

**Fix:**
- Disable field suggestions using Apollo's formatError hook in production
- In Yoga, configure maskedErrors to replace suggestion text with a generic message
- Log full errors server-side only; return a generic message to clients
- **Apollo Server 4: disable suggestions** (javascript):
```javascript
import { ApolloServer } from '@apollo/server';

const server = new ApolloServer({
  typeDefs,
  resolvers,
  formatError(formattedError) {
    if (process.env.NODE_ENV === 'production') {
      return { message: 'Internal server error' };
    }
    return formattedError;
  },
});
```
- **GraphQL Yoga: masked errors** (javascript):
```javascript
import { createYoga, maskError } from 'graphql-yoga';

const yoga = createYoga({
  schema,
  maskedErrors: {
    maskError(error, message) {
      return maskError(error, 'Unexpected error');
    },
  },
});
```

### `api-graphql-no-rate-limit` [api / medium / header]
**GraphQL endpoint has no rate-limit headers**

GraphQL POST endpoints need rate-limiting because one query can touch many resolvers.

**Risk:** A single GraphQL request can fan out to dozens of resolvers, consuming database connections and CPU far beyond what a per-request IP limit catches, letting attackers exhaust server resources with a small number of cheap HTTP calls.

**References:**
- https://github.com/teamplanes/graphql-rate-limit
- https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/

**Fix:**
- Rate-limit by query cost and depth, not just request count
- Use graphql-rate-limit or a token-bucket middleware keyed on the authenticated user
- Return 429 with Retry-After when limits are exceeded
- **graphql-rate-limit: per-user rate limit** (javascript):
```javascript
import { createRateLimitDirective, defaultKeyGenerator } from 'graphql-rate-limit';

const rateLimitDirective = createRateLimitDirective({
  keyGenerator: (directiveArgs, obj, args, context) =>
    `<value>:<value>`,
});

// In SDL:
// type Query {
//   searchUsers(q: String!): [User] @rateLimit(window: "1m", max: 20)
// }
```
- **Express: global rate limit for GraphQL endpoint** (javascript):
```javascript
import rateLimit from 'express-rate-limit';

const gqlLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { errors: [{ message: 'Too many requests' }] },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/graphql', gqlLimiter);
```

### `api-openapi-server-url-leak` [api / low / body-pattern]
**OpenAPI server URL leaks internal host**

swagger.json often contains the internal / staging host in the 'servers' array.

**Risk:** Internal hostnames in public OpenAPI documents reveal network topology, staging infrastructure, and internal DNS naming conventions, information that aids targeted reconnaissance and phishing attacks against internal services.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/
- https://spec.openapis.org/oas/v3.1.0#server-object

**Fix:**
- Generate environment-specific OpenAPI documents; exclude internal hosts from the public document
- Use relative server URLs (/ or /api) in the public-facing document
- Strip servers[] from public docs using a build-time transform or swagger-combine
- **OpenAPI 3.0: relative server URL (safe)** (yaml):
```yaml
openapi: '3.0.3'
info:
  title: My API
  version: '1.0'
servers:
  - url: /api/v1
    description: Current deployment
```
- **Node.js: strip internal servers at runtime** (javascript):
```javascript
import swaggerDoc from './openapi.json';

const publicDoc = {
  ...swaggerDoc,
  servers: swaggerDoc.servers?.filter(
    (s) => !s.url.includes('internal') && !s.url.includes('staging')
  ) ?? [{ url: '/api/v1' }],
};
```

### `api-cors-preflight-cache-missing` [api / low / header]
**CORS preflight result not cached**

Missing Access-Control-Max-Age forces browsers to send preflight OPTIONS on every cross-origin request.

**Risk:** Without preflight caching, every cross-origin API call from browser clients triggers an extra OPTIONS round-trip, doubling perceived latency for API consumers and increasing server load under heavy traffic.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age
- https://fetch.spec.whatwg.org/#http-cors-protocol

**Fix:**
- Add Access-Control-Max-Age: 600 (10 minutes) for stable CORS configs
- Do not set it above 86400 (24 hours); a stale policy can block legitimate requests after a config change
- **Express cors(): set max age** (javascript):
```javascript
import cors from 'cors';

app.use(cors({
  origin: ['https://app.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 600,
}));
```
- **Nginx: CORS preflight with max age** (nginx):
```nginx
location /api/ {
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin  'https://app.example.com';
        add_header Access-Control-Allow-Methods 'GET, POST, PUT, DELETE';
        add_header Access-Control-Allow-Headers 'Authorization, Content-Type';
        add_header Access-Control-Max-Age       600;
        return 204;
    }
}
```

### `api-bearer-header-leak` [api / high / url-check]
**Bearer token in URL or cookie**

Authorization: Bearer is fine, but Bearer tokens in URL or cookies can leak via logs.

**Risk:** Tokens in URLs appear in server access logs, browser history, Referer headers, and CDN logs, any of which may be accessible to third parties. A single log export or shoulder-surf leaks all active sessions.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6750#section-2.3
- https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/

**Fix:**
- Send Bearer tokens only in the Authorization header
- Never accept tokens as query parameters (?token=...) in production endpoints
- If cookies are used, set Secure; HttpOnly; SameSite=Strict and add CSRF protection
- **Correct: Authorization header** (javascript):
```javascript
const response = await fetch('/api/resource', {
  headers: {
    Authorization: `Bearer <value>`,
    'Content-Type': 'application/json',
  },
});
```
- **Server: reject token in query string** (javascript):
```javascript
app.use((req, res, next) => {
  if (req.query.token || req.query.access_token) {
    return res.status(400).json({
      error: 'Tokens must be sent in the Authorization header, not the URL.',
    });
  }
  next();
});
```

### `api-jsonp-callback` [api / medium / combined]
**JSONP callback parameter accepted**

JSONP allows arbitrary JS to be loaded in the victim's origin. Prefer CORS.

**Risk:** JSONP endpoints can be embedded as <script src> from any origin, letting attackers steal response data by overriding the callback. They also bypass Content Security Policy and cannot be protected by SameSite cookies.

**References:**
- https://portswigger.net/web-security/cors/same-origin-policy
- https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

**Fix:**
- Disable JSONP support and serve standard JSON with CORS headers instead
- If legacy clients require JSONP, validate the callback name against an allowlist of safe identifiers
- Never allow arbitrary JavaScript identifiers as the callback value
- **Migrate from JSONP to CORS (Express)** (javascript):
```javascript
import cors from 'cors';

// Before (JSONP: insecure):
// app.get('/data', (req, res) => {
//   const cb = req.query.callback;
//   res.send(`<value>(<value>)`);
// });

// After (CORS: secure):
app.use(cors({ origin: 'https://yourapp.com' }));
app.get('/data', (req, res) => {
  res.json(data);
});
```

### `api-rest-allow-methods-put-no-auth` [api / high / header]
**REST endpoint allows PUT without authentication**

PUT changes server state. Without authentication, anyone reachable to the endpoint can overwrite resources (config, user profiles, files).

**Risk:** Unauthenticated PUT endpoints allow attackers to overwrite arbitrary resources: user profiles, configuration files, permissions, without any proof of identity. A single request can corrupt data for all users.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/
- https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

**Fix:**
- Require authentication on PUT and reject anonymous writes at the proxy or framework layer
- Validate that the authenticated user owns the resource being updated
- Use an allowlist of updatable fields to prevent mass assignment
- **Express: authenticated PUT with ownership check** (javascript):
```javascript
router.put('/users/:id', requireAuth, async (req, res) => {
  if (req.user.id !== req.params.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { name, email, bio } = req.body;
  await db.users.update(req.params.id, { name, email, bio });
  res.json({ success: true });
});
```

### `api-rest-allow-methods-patch-no-auth` [api / high / header]
**REST endpoint allows PATCH without authentication**

PATCH partially mutates a resource. Unauthenticated PATCH endpoints allow attackers to flip boolean fields, escalate privileges, or change ownership markers.

**Risk:** Unauthenticated PATCH endpoints let attackers flip boolean fields (isAdmin, isActive, isVerified), change ownership IDs, or modify billing state, privilege escalation with no brute-force required.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/
- https://datatracker.ietf.org/doc/html/rfc7396

**Fix:**
- Require authentication on PATCH at the middleware layer before any routing
- Validate the JSON merge patch against an explicit allowlist of mutable fields
- Reject patches to privilege fields (role, isAdmin, isVerified) for non-admin callers
- **Express: safe PATCH with field allowlist** (javascript):
```javascript
const PATCHABLE_FIELDS = new Set(['name', 'bio', 'avatarUrl']);

router.patch('/users/:id', requireAuth, async (req, res) => {
  if (req.user.id !== req.params.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const patch = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => PATCHABLE_FIELDS.has(k))
  );

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update.' });
  }

  await db.users.patch(req.params.id, patch);
  res.json({ success: true });
});
```

### `api-rest-allow-methods-options-exposed` [api / low / header]
**OPTIONS response exposes full method allowlist**

A verbose OPTIONS response (Allow: GET, POST, PUT, PATCH, DELETE) leaks the entire verb surface to attackers, simplifying endpoint enumeration.

**Risk:** A verbose Allow header tells attackers exactly which HTTP methods are active, reducing the effort needed to map the API and craft targeted attacks against PUT, PATCH, or DELETE handlers.

**References:**
- https://httpwg.org/specs/rfc9110.html#OPTIONS
- https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

**Fix:**
- Restrict Allow to only the verbs you actually serve on that specific path
- Disable unused HTTP methods at the web server or reverse proxy level
- Return 405 for any method not explicitly handled
- **Express: explicit method list per route** (javascript):
```javascript
router.route('/items')
  .get(listItems)
  .post(createItem);

// Catch unsupported methods
router.all('/items', (req, res) => {
  res.set('Allow', 'GET, POST').status(405).json({ error: 'Method not allowed' });
});
```
- **Nginx: restrict methods** (nginx):
```nginx
location /api/items {
    limit_except GET POST OPTIONS {
        deny all;
    }
}
```

### `api-graphql-introspection-enabled` [api / medium / combined]
**GraphQL introspection enabled in production**

__schema / __type queries dump the entire schema, including internal fields, admin-only mutations, and deprecation hints that aid targeted attacks.

**Risk:** Introspection in production gives attackers a complete blueprint of your data model: every type, field, mutation, and subscription, eliminating the recon phase and exposing internal-only operations that untrusted clients should never call.

**References:**
- https://graphql.org/learn/introspection/
- https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/

**Fix:**
- Disable introspection in production (Apollo: introspection: false, GraphQL.NET: ExposeMetadata = false)
- Allow introspection only for authenticated admin users if needed for internal tooling
- Use persisted queries to give clients what they need without exposing the full schema
- **Apollo Server 4: disable introspection in production** (javascript):
```javascript
import { ApolloServer } from '@apollo/server';

const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: process.env.NODE_ENV !== 'production',
});
```
- **GraphQL Yoga: NoSchemaIntrospectionCustomRule** (javascript):
```javascript
import { createYoga } from 'graphql-yoga';
import { NoSchemaIntrospectionCustomRule } from 'graphql';

const yoga = createYoga({
  schema,
  plugins: [
    {
      onValidate({ addValidationRule }) {
        if (process.env.NODE_ENV === 'production') {
          addValidationRule(NoSchemaIntrospectionCustomRule);
        }
      },
    },
  ],
});
```

### `api-graphql-batch-queries` [api / medium / body-pattern]
**GraphQL batch (array) queries accepted**

Accepting an array of queries lets a single HTTP request fan out to N independent operations, multiplying rate-limit cost and bypassing per-request throttles.

**Risk:** A single batched HTTP request containing 100 queries executes 100 independent resolver trees while consuming only 1 unit of any per-request rate limit: a cheap amplification attack that can exhaust database connections and CPU without triggering throttling.

**References:**
- https://www.apollographql.com/blog/batching-client-graphql-queries/
- https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/

**Fix:**
- Disable batching if not required by clients
- If batching is needed, cap the array size (e.g., max 10 items) and charge each item against the rate-limit budget
- In Apollo Server: set allowBatchedHttpRequests: false in the HTTP handler options
- **Apollo Server: disable batching** (javascript):
```javascript
import { expressMiddleware } from '@apollo/server/express4';

app.use('/graphql', expressMiddleware(server, {
  allowBatchedHttpRequests: false,
}));
```
- **Custom batch size limit middleware** (javascript):
```javascript
app.use('/graphql', (req, res, next) => {
  if (Array.isArray(req.body) && req.body.length > 10) {
    return res.status(400).json({
      errors: [{ message: 'Batch size limit exceeded (max 10).' }],
    });
  }
  next();
});
```

### `api-graphql-error-stack-trace` [api / medium / combined]
**GraphQL error response leaks stack trace**

Stack traces in error.extensions.stacktrace expose file paths, framework versions, and SQL fragments to any unauthenticated caller.

**Risk:** Stack traces embedded in API responses reveal internal file system paths, framework versions, database schema details, and SQL fragments, giving attackers the reconnaissance needed to craft targeted injection or path traversal attacks.

**References:**
- https://www.apollographql.com/docs/apollo-server/security/errors/
- https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/

**Fix:**
- Use Apollo's formatError hook to strip stack traces in production
- Log full errors server-side and return only a generic message to clients
- Gate stack traces on NODE_ENV: development only
- **Apollo Server: strip stack traces in production** (javascript):
```javascript
const server = new ApolloServer({
  typeDefs,
  resolvers,
  formatError(formattedError, error) {
    console.error(error);

    if (process.env.NODE_ENV === 'production') {
      return {
        message: formattedError.message,
        extensions: { code: formattedError.extensions?.code },
      };
    }
    return formattedError;
  },
});
```

### `api-openapi-security-scheme-weak` [api / high / combined]
**OpenAPI security scheme is weak or missing**

An OpenAPI document with no securitySchemes, or one that lists only apiKey in header, signals that the API does not enforce real authentication.

**Risk:** Missing or weak security schemes mean operations are undocumented from an access-control perspective. SDK generators produce unauthenticated clients, and automated scanners treat every endpoint as public.

**References:**
- https://swagger.io/docs/specification/authentication/
- https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/

**Fix:**
- Declare a strong securityScheme (OAuth2 + JWT or mTLS) in the OpenAPI document
- Apply the scheme globally and override per-operation only for truly public endpoints
- Use spectral in CI to validate security scheme coverage
- **OpenAPI 3.0: JWT bearer scheme applied globally** (yaml):
```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

# Apply globally: all operations require auth by default
security:
  - bearerAuth: []

paths:
  /users:
    get:
      summary: List users
      # Inherits global bearerAuth requirement
      responses:
        '200':
          description: OK
  /health:
    get:
      summary: Health check
      security: []  # Override: public endpoint
      responses:
        '200':
          description: OK
```

### `api-openapi-default-values-sensitive` [api / medium / body-pattern]
**OpenAPI schema declares defaults for sensitive fields**

Defaults such as isAdmin: false, role: user, or apiKey: REPLACE_ME teach attackers the shape of state and embed credentials in client SDKs.

**Risk:** Default values for privilege fields in a public OpenAPI document tell attackers the exact property names and expected values used for access control, enabling targeted mass-assignment attacks to escalate privileges with a single crafted HTTP request.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/
- https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html

**Fix:**
- Remove default values from any field whose name contains token, password, key, role, admin, or secret
- Use writeOnly: true to mark privilege fields so SDKs exclude them from generated models
- Run spectral in CI to enforce no-defaults on sensitive properties
- **OpenAPI: remove defaults from privilege fields** (yaml):
```yaml
# Bad: exposes privilege structure
# UserCreate:
#   properties:
#     role:
#       type: string
#       default: user      # remove this
#     isAdmin:
#       type: boolean
#       default: false     # remove this

# Good: no defaults on privilege fields
UserCreate:
  required:
    - email
    - password
  properties:
    email:
      type: string
      format: email
    password:
      type: string
      format: password
      writeOnly: true
```

### `api-jwt-alg-none` [api / critical / header]
**JWT verifier accepts alg=none**

A token with alg=none carries no signature. Verifiers that accept it let attackers forge any subject, role, or expiry they want.

**Risk:** An attacker can sign any payload, including admin roles, extended expiry, and arbitrary user IDs, using alg=none. The server accepts it as valid, granting full access to any account or privilege level with no credentials.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8725#section-3.1
- https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/

**Fix:**
- Explicitly pin the accepted algorithm to RS256 or ES256; never accept alg=none
- Use a JWT library that rejects the none algorithm by default (e.g., jose in Node.js)
- Rotate all existing tokens and signing keys immediately if this has been exploited
- **Node.js jose: pin algorithm, reject none** (javascript):
```javascript
import { jwtVerify } from 'jose';

async function verifyToken(token, publicKey) {
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: 'https://auth.example.com',
    audience: 'https://api.example.com',
  });
  return payload;
}
```
- **jsonwebtoken: pinned algorithm** (javascript):
```javascript
import jwt from 'jsonwebtoken';

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_PUBLIC_KEY, {
    algorithms: ['RS256'],  // Whitelist: rejects none and anything else
  });
}
```

### `api-jwt-hs256-weak-secret` [api / critical / body-pattern]
**JWT HS256 signed with weak or hard-coded secret**

HS256 trusts a shared secret. If the secret is short, default, or checked into source, attackers can sign forged tokens offline.

**Risk:** A weak HS256 secret (under 256 bits, or a known default like 'secret') can be cracked offline using hashcat in minutes. Once the secret is known, attackers can forge any JWT: impersonating any user, extending expiry, or granting admin access indefinitely.

**References:**
- https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/
- https://datatracker.ietf.org/doc/html/rfc8725

**Fix:**
- Use at least 256 bits (32 bytes) of random entropy for HS256 secrets
- Prefer asymmetric algorithms (RS256, ES256) so the signing key never leaves the server
- Rotate secrets and invalidate all existing tokens if a weak or exposed secret is discovered
- **Generate a strong HS256 secret** (bash):
```bash
# Generate a 256-bit (32 byte) random secret
openssl rand -base64 32

# Store as an environment variable: never hard-code it
export JWT_SECRET="$(openssl rand -base64 32)"
```
- **Switch to RS256 (recommended)** (javascript):
```javascript
import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';

// Sign with private key: only the server has this
const privateKey = await importPKCS8(process.env.JWT_PRIVATE_KEY, 'RS256');
const token = await new SignJWT({ sub: userId, role: 'user' })
  .setProtectedHeader({ alg: 'RS256' })
  .setExpirationTime('1h')
  .setIssuedAt()
  .sign(privateKey);

// Verify with public key: safe to distribute
const publicKey = await importSPKI(process.env.JWT_PUBLIC_KEY, 'RS256');
const { payload } = await jwtVerify(token, publicKey, { algorithms: ['RS256'] });
```

### `api-jwt-missing-exp-claim` [api / high / header]
**JWT issued without exp claim**

Tokens without an explicit expiry live forever once stolen. Replay attacks succeed indefinitely and revocation is impossible.

**Risk:** A stolen JWT with no expiry is a permanent credential. An attacker who intercepts it, through a log leak, XSS, or MITM, retains access indefinitely with no way to revoke it short of rotating the signing key and invalidating every active session.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7519#section-4.1.4
- https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/

**Fix:**
- Always include an exp claim; keep access tokens short-lived (15 min to 1 hour)
- Validate exp server-side on every request
- Issue refresh tokens separately with longer lifetimes and implement rotation
- **jsonwebtoken: mandatory expiry** (javascript):
```javascript
import jwt from 'jsonwebtoken';

function issueAccessToken(userId, role) {
  return jwt.sign(
    { sub: userId, role },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '1h',
      issuer: 'api.example.com',
    }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ['HS256'],
    ignoreExpiration: false,  // must be false (the default)
  });
}
```

### `api-cors-preflight-cache-over-24h` [api / low / header]
**CORS preflight cache exceeds 24 hours**

Access-Control-Max-Age above 86400 pins browsers to a stale allowlist. New disallowed headers or origins take up to Max-Age seconds to take effect.

**Risk:** An excessively long preflight cache means CORS policy changes, such as revoking an origin's access or removing a method, take days to propagate to browsers. Previously approved origins continue to receive cached preflight approval even after the server policy changes.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age
- https://fetch.spec.whatwg.org/#http-cors-protocol

**Fix:**
- Cap Max-Age at 600 (10 minutes) for most APIs
- Use shorter windows (60s) during active CORS policy rollouts
- Most browsers cap Max-Age at 86400 (Chrome) or 600 (Firefox) regardless of what you set
- **Express cors(): safe max age** (javascript):
```javascript
import cors from 'cors';

app.use(cors({
  origin: ['https://app.example.com'],
  maxAge: 600,
}));
```

### `api-rate-limit-per-ip-no-auth` [api / medium / header]
**Rate-limit keyed only on client IP, no auth required**

Per-IP throttling is fine for anonymous traffic, but auth-less endpoints behind a shared NAT or proxy can be exhausted by one noisy neighbour.

**Risk:** IP-based rate limiting can be exhausted by a single user behind a corporate NAT or Tor exit node, blocking all users sharing that IP. Conversely, an attacker rotating IPs or using botnets can bypass it entirely for brute-force or scraping attacks.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/
- https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html

**Fix:**
- Require authentication on sensitive endpoints and key rate limits on the authenticated principal (user ID)
- Layer rate limits: per-IP for anonymous endpoints, per-user for authenticated endpoints
- Use Redis for distributed rate limiting across multiple server instances
- **express-rate-limit: per-user after auth** (javascript):
```javascript
import rateLimit from 'express-rate-limit';

const authRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply after auth middleware so req.user is available
router.use(requireAuth, authRateLimit);
```

### `api-rate-limit-headers-not-enforced-on-paths` [api / medium / header]
**Rate-limit headers present but only enforced on some paths**

Returning X-RateLimit-* headers without enforcing the cap is theatre. Callers see budgets they cannot exceed in the response but can hammer the server anyway.

**Risk:** Advertising rate limits that are not enforced creates a false sense of security. Automated scanners and attackers will ignore the headers and keep sending requests, while the server has no actual protection against abuse or DoS.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/
- https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers

**Fix:**
- Ensure every endpoint that emits X-RateLimit-* headers actually enforces the limit
- Test rate limiting in CI by sending requests above the stated limit and verifying 429 responses
- Apply rate limit middleware globally before route handlers rather than per-route to avoid gaps
- **Express: global rate limit applied before all routes** (javascript):
```javascript
import rateLimit from 'express-rate-limit';

// Apply globally so no route can slip through
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Routes come after: rate limit is always applied
app.use('/api', apiRouter);
```

### `api-soap-soapaction-injection` [api / high / header]
**SOAPAction header injection / SSRF**

If the SOAPAction header is passed verbatim to a downstream HTTP call without validation, attackers can pivot the request to internal services.

**Risk:** An unvalidated SOAPAction header passed to outbound HTTP calls can redirect requests to internal services, cloud metadata endpoints (169.254.169.254), or other hosts the server can reach but the attacker cannot: a Server-Side Request Forgery (SSRF) attack.

**References:**
- https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
- https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

**Fix:**
- Strict-allowlist the SOAPAction value against known operation names
- Never concatenate SOAPAction or any user-supplied string into outbound URLs
- Use a pre-built SOAP client library that validates operations against the WSDL
- **Node.js: allowlist SOAPAction values** (javascript):
```javascript
const ALLOWED_SOAP_ACTIONS = new Set([
  'http://example.com/GetUserInfo',
  'http://example.com/UpdateProfile',
]);

app.post('/soap', (req, res) => {
  const action = req.headers['soapaction']?.replace(/"/g, '');

  if (!action || !ALLOWED_SOAP_ACTIONS.has(action)) {
    return res.status(400).send(
      '<soap:Fault><faultcode>Client</faultcode>' +
      '<faultstring>Unknown SOAPAction</faultstring></soap:Fault>'
    );
  }
  // Process the allowed action
});
```

### `api-soap-xxe-enabled` [api / critical / body-pattern]
**SOAP/XML parser has external entities enabled (XXE)**

XML parsers with DOCTYPE / external entity processing enabled allow attackers to read local files, hit SSRF endpoints, and exfiltrate via DTD.

**Risk:** XML External Entity (XXE) attacks can read arbitrary files from the server filesystem (/etc/passwd, .env files, application configs), trigger SSRF against internal networks, and in some parsers enable remote code execution via Java serialization gadgets.

**References:**
- https://owasp.org/www-community/vulnerabilities/XML_External_Entity_Processing
- https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html

**Fix:**
- Disable DOCTYPE declarations and external entity processing in every XML parser
- Use a hardened DocumentBuilderFactory / SAXParserFactory with all external features off
- In Node.js, use fast-xml-parser with processEntities: false
- **Java: hardened JAXP parser (no XXE)** (java):
```java
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
dbf.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
dbf.setXIncludeAware(false);
dbf.setExpandEntityReferences(false);
```
- **Node.js fast-xml-parser: disable entity processing** (javascript):
```javascript
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  processEntities: false,
  htmlEntities: false,
});

const result = parser.parse(xmlBody);
```

### `api-soap-wsdl-publicly-accessible` [api / medium / combined]
**WSDL publicly accessible**

Auto-published WSDL files enumerate every operation, parameter type, and binding - a blueprint for crafting SOAP-level attacks.

**Risk:** A publicly accessible WSDL gives attackers a complete catalog of every SOAP operation, parameter name, type, and service binding, reducing the effort to discover injection points, craft malformed requests, and understand internal service architecture.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/
- https://cheatsheetseries.owasp.org/cheatsheets/Web_Service_Security_Cheat_Sheet.html

**Fix:**
- Restrict ?wsdl behind authentication or IP allowlisting
- Remove auto-publishing of WSDL from production endpoints; distribute via authenticated developer portals
- Consider whether external clients need WSDL at all, or if a static copy can be distributed out-of-band
- **Nginx: restrict WSDL access to internal network** (nginx):
```nginx
location ~* \?wsdl {
    allow 10.0.0.0/8;
    allow 192.168.0.0/16;
    deny all;
    proxy_pass http://soap-backend;
}
```
- **Apache CXF: disable WSDL auto-publishing** (xml):
```xml
<jaxws:endpoint id="myService"
    implementor="com.example.MyServiceImpl"
    address="/MyService">
  <jaxws:properties>
    <entry key="publish-wsdl-information" value="false"/>
    <entry key="org.apache.cxf.service.list.enabled" value="false"/>
  </jaxws:properties>
</jaxws:endpoint>
```

### `api-websocket-no-origin-validation` [api / high / combined]
**WebSocket upgrade does not validate Origin**

A WebSocket handshake that ignores the Origin header lets any malicious site open an authenticated WS connection and stream events to the victim.

**Risk:** Without Origin validation, any malicious website a victim visits can silently open an authenticated WebSocket connection using the victim's session cookies, then subscribe to their real-time events: a CSRF equivalent that is invisible to the user.

**References:**
- https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking
- https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/

**Fix:**
- Validate the Origin header against an allowlist during the HTTP upgrade handshake
- Reject the connection with HTTP 403 if Origin is not in the allowlist
- Additionally require a CSRF token in the initial WS message for critical endpoints
- **ws library: Origin validation on upgrade** (javascript):
```javascript
import { WebSocketServer } from 'ws';

const ALLOWED_ORIGINS = new Set(['https://app.example.com']);

const wss = new WebSocketServer({
  server: httpServer,
  verifyClient({ origin }, callback) {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      callback(false, 403, 'Forbidden: origin not allowed');
    } else {
      callback(true);
    }
  },
});
```
- **Socket.IO: built-in CORS origin check** (javascript):
```javascript
import { Server } from 'socket.io';

const io = new Server(httpServer, {
  cors: {
    origin: ['https://app.example.com'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
```

### `api-rest-mass-assignment-risk` [api / low / body-pattern]
**REST endpoint response exposes privileged fields**

A response body contains privileged field names (role, isAdmin) that, if the same names are also accepted as unvalidated input, would let clients escalate privileges. Detected from response content only; this does not confirm the fields are writable.

**Risk:** Mass assignment lets an attacker send unexpected fields (role: 'admin', isVerified: true, creditBalance: 99999) in a JSON body and have them persisted directly to the database record, privilege escalation requiring only a crafted HTTP request.

**Why it matters:** Endpoints that bind a request body directly to a model (e.g., user.role, isAdmin, internalId) without an explicit allowlist let clients escalate privileges.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
- https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/

**Fix:**
- Use explicit DTOs or field allowlists; never spread req.body directly onto ORM models
- Mark internal fields (role, isAdmin, isVerified) as non-writable in the schema
- Validate and strip unknown properties at the boundary using Zod, Joi, or similar
- **Zod: strict DTO with unknown field rejection** (javascript):
```javascript
import { z } from 'zod';

const UpdateUserDto = z.object({
  name:      z.string().min(1).max(100).optional(),
  bio:       z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
  // role, isAdmin, isVerified are intentionally absent
}).strict();  // .strict() rejects any extra fields

router.put('/users/:id', requireAuth, async (req, res) => {
  const parsed = UpdateUserDto.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.issues });
  }
  await db.users.update(req.params.id, parsed.data);
  res.json({ success: true });
});
```

### `rate-limiting` [api / medium / header]
**API endpoint has no rate limiting**

The API endpoint does not enforce rate limiting, allowing unlimited requests from a single client.

**Risk:** Without rate limiting, attackers can send unlimited requests to brute-force authentication, scrape all data, enumerate resources, or trigger denial of service, all without any server-side throttling.

**Why it matters:** Rate limiting protects APIs from abuse by capping the number of requests a client can make in a time window. Without it, automated attacks against authentication, search, or data endpoints are unconstrained.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/
- https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers

**Fix:**
- Apply a rate-limit middleware to all API endpoints
- Key limits on the authenticated user ID for authed endpoints, or IP for anonymous ones
- Return 429 with Retry-After and RateLimit-* headers when the limit is hit
- **express-rate-limit: basic setup** (javascript):
```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);
```
- **Nginx: rate limiting with burst** (nginx):
```nginx
http {
    limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;

    server {
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            limit_req_status 429;
        }
    }
}
```

### `options-method-exposed` [api / info / header]
**OPTIONS method exposes verbose method list**

The OPTIONS method is available and returns a verbose Allow header listing all enabled HTTP methods.

**Risk:** A verbose Allow header tells attackers exactly which HTTP verbs are active on the endpoint, reducing the reconnaissance effort needed to identify PUT, PATCH, or DELETE handlers for targeted attacks.

**Why it matters:** An HTTP OPTIONS request returns the Allow header listing all methods the server accepts on that path. This is useful for CORS preflight but also useful for attackers mapping the API surface.

**References:**
- https://httpwg.org/specs/rfc9110.html#OPTIONS
- https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/

**Fix:**
- Restrict the Allow header to only methods that endpoint actually serves
- Disable OPTIONS on endpoints that do not need CORS
- Return 405 for any method not in the Allow list
- **Express: explicit Allow header per route** (javascript):
```javascript
router.all('/resource', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.set('Allow', 'GET, POST').status(204).end();
  }
  next();
});
```
- **Nginx: restrict HTTP methods** (nginx):
```nginx
location /api/resource {
    limit_except GET POST OPTIONS {
        deny all;
    }
}
```

### `soap-endpoint` [api / info / body-pattern]
**SOAP endpoint detected**

A SOAP/XML web service endpoint was detected. SOAP services have a unique attack surface including XXE, SSRF via SOAPAction, and schema enumeration via WSDL.

**Risk:** SOAP endpoints are susceptible to XML External Entity (XXE) attacks, SOAPAction injection leading to SSRF, and schema enumeration via publicly accessible WSDL files: attacks that can exfiltrate files, pivot to internal networks, or reveal internal service architecture.

**Why it matters:** SOAP services use XML for messages and are susceptible to a class of vulnerabilities distinct from REST APIs: XXE, SOAPAction injection, WSDL enumeration, and WS-Security misconfigurations.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Web_Service_Security_Cheat_Sheet.html

**Fix:**
- Disable DOCTYPE and external entity processing in the XML parser
- Restrict ?wsdl access to authenticated or internal clients only
- Validate SOAPAction against a strict allowlist of known operations
- Enable WS-Security for authentication and message integrity
- **Java: XXE-safe SAX parser factory** (java):
```java
SAXParserFactory spf = SAXParserFactory.newInstance();
spf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
spf.setFeature("http://xml.org/sax/features/external-general-entities", false);
spf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
spf.setNamespaceAware(true);
```

### `xml-rpc` [api / medium / body-pattern]
**XML-RPC endpoint exposed**

An XML-RPC endpoint is publicly accessible. In WordPress and similar CMSes, xmlrpc.php enables brute-force amplification attacks and remote method invocation.

**Risk:** WordPress xmlrpc.php allows an attacker to test thousands of username/password combinations in a single HTTP request using system.multicall: a brute-force amplification attack. It also enables pingback-based SSRF and DDoS amplification against third-party hosts.

**Why it matters:** XML-RPC is a legacy remote procedure call protocol used by WordPress for the mobile app and Jetpack. When left publicly accessible it enables brute-force amplification (one request = thousands of auth attempts), pingback SSRF, and remote content modification.

**References:**
- https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/10-Business_Logic_Testing/
- https://wordpress.org/documentation/article/xml-rpc-support/

**Fix:**
- In WordPress: disable xmlrpc.php unless specifically required by a plugin or mobile app
- Block xmlrpc.php at the web server or WAF level for non-WordPress applications
- Use a security plugin (Wordfence, iThemes Security) to block XML-RPC at the application level
- **Nginx: block xmlrpc.php** (nginx):
```nginx
location = /xmlrpc.php {
    deny all;
    return 403;
}
```
- **Apache: block xmlrpc.php** (apache):
```apache
<Files xmlrpc.php>
    Order Deny,Allow
    Deny from all
</Files>
```
- **WordPress: disable XML-RPC via filter** (php):
```php
// In functions.php or a must-use plugin
add_filter('xmlrpc_enabled', '__return_false');

add_filter('xmlrpc_methods', function($methods) {
    unset($methods['pingback.ping']);
    unset($methods['pingback.extensions.getPingbacks']);
    return $methods;
});
```

### `trace-method-enabled` [api / medium / header]
**HTTP TRACE method enabled**

HTTP TRACE method is enabled on the server. TRACE reflects the full request including headers, enabling Cross-Site Tracing (XST) attacks.

**Risk:** Cross-Site Tracing (XST) exploits TRACE to reflect the victim's cookies and Authorization headers, including HttpOnly cookies that JavaScript cannot read, back through the browser in a cross-origin context, enabling session theft even when HttpOnly is correctly set.

**Why it matters:** HTTP TRACE is intended for diagnostic loop-back testing but is rarely needed in production. When enabled, it can be exploited via XST to steal credentials from authenticated users.

**References:**
- https://owasp.org/www-community/attacks/Cross_Site_Tracing
- https://httpwg.org/specs/rfc9110.html#TRACE

**Fix:**
- Disable TRACE at the web server or reverse proxy level
- In Apache: add TraceEnable Off to httpd.conf
- In Nginx: return 405 for TRACE requests
- In Express: reject TRACE in a global middleware before routing
- **Nginx: disable TRACE** (nginx):
```nginx
server {
    if ($request_method = TRACE) {
        return 405;
    }
}
```
- **Apache: TraceEnable Off** (apache):
```apache
# In httpd.conf
TraceEnable Off
```
- **Express.js: reject TRACE globally** (javascript):
```javascript
app.use((req, res, next) => {
  if (req.method === 'TRACE') {
    return res.status(405).set('Allow', 'GET, POST, PUT, DELETE').end();
  }
  next();
});
```

---

## Category: client-side (22 checks)

### `cs-csp-unsafe-inline-script` [client-side / high / header-value]
**CSP Allows 'unsafe-inline' Scripts**

The Content-Security-Policy header contains 'unsafe-inline' in the script-src directive. This negates most XSS protection the CSP provides, since inline scripts injected by an attacker will be allowed.

**Risk:** Any XSS payload that injects an inline <script> tag or event handler (onclick, onerror, etc.) will execute despite the CSP. The attacker only needs to find an injection point; the browser will happily run the payload.

**Why it matters:** CSP's main defense against XSS is blocking inline script execution. 'unsafe-inline' turns that defense off. The correct fix is to remove inline scripts from the codebase and use nonces or hashes for the remaining legitimate ones.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src
- https://csp.withgoogle.com/docs/strict-csp.html

**Fix:**
- Remove 'unsafe-inline' from script-src.
- Move all inline scripts to external .js files.
- For unavoidable inline scripts (e.g., Next.js hydration), add a per-request nonce: script-src 'nonce-{random}'.
- Use 'strict-dynamic' with a nonce to allow dynamically-loaded scripts while blocking inline injection.
- **Nonce-based CSP (Next.js middleware)** (typescript):
```typescript
const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
const csp = [
  `script-src 'nonce-<value>' 'strict-dynamic'`,
  `style-src 'nonce-<value>'`,
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');
response.headers.set('Content-Security-Policy', csp);
```

### `csp-unsafe-eval-script` [client-side / medium / header-value]
**CSP Allows 'unsafe-eval'**

The CSP header includes 'unsafe-eval', which permits eval(), Function(), setTimeout(string), and setInterval(string). These functions execute strings as code and are primary targets for XSS attacks.

**Risk:** With 'unsafe-eval', any XSS payload that can reach eval() or Function() will execute arbitrary JavaScript. This is a requirement for some older libraries and bundlers but should be eliminated from modern applications.

**Why it matters:** 'unsafe-eval' is needed by some older code patterns and frameworks (older AngularJS, some Webpack configurations). Modern alternatives exist for all of them.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src#unsafe_eval_expressions
- https://content-security-policy.com/unsafe-eval/

**Fix:**
- Identify what requires unsafe-eval: run the browser console with a strict CSP to see violations.
- For AngularJS: upgrade to Angular 2+ or use a JIT-free build.
- For Webpack: use the 'eval-source-map' devtool only in development, not production.
- Replace any direct eval() calls with safe alternatives.
- **Webpack production config** (javascript):
```javascript
module.exports = {
  mode: 'production',
  devtool: 'source-map', // Not 'eval-source-map': does NOT require unsafe-eval
};
```

### `postmessage-no-origin-check` [client-side / high / body-pattern]
**postMessage Without Origin Validation**

A window.addEventListener('message', ...) handler was found without an origin check. Without validating the sender's origin, any webpage can send arbitrary messages to your page and have them processed.

**Risk:** A malicious page that can embed your page in an iframe (or communicate cross-window) can send crafted messages that trigger privileged actions: authentication, navigation, data submission, or DOM manipulation.

**Why it matters:** postMessage is designed for cross-origin communication. The receiver must always validate event.origin against an expected value to prevent malicious pages from sending commands.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#security_concerns
- https://portswigger.net/web-security/dom-based/controlling-the-web-message-source

**Fix:**
- Always check event.origin at the top of your message handler.
- Maintain a whitelist of allowed origins rather than using a boolean flag.
- Also validate event.source if you expect messages from a specific window.
- Treat event.data as untrusted input: validate its structure with a schema.
- **Safe postMessage handler** (javascript):
```javascript
const ALLOWED_ORIGINS = new Set(['https://parent.example.com']);

window.addEventListener('message', (event) => {
  if (!ALLOWED_ORIGINS.has(event.origin)) return; // Ignore unknown senders
  const { type, payload } = event.data ?? {};
  if (type === 'AUTH_TOKEN') {
    handleToken(payload); // payload is still untrusted, validate it
  }
});
```

### `localstorage-sensitive-data` [client-side / high / body-pattern]
**Sensitive Data Stored in localStorage**

The page stores authentication tokens, JWTs, or other sensitive values in localStorage. localStorage is accessible to any JavaScript on the page (including XSS payloads) and persists across sessions.

**Risk:** Unlike HttpOnly cookies, localStorage is fully readable by JavaScript. Any XSS vulnerability on the page can read the stored token and exfiltrate it. A compromised CDN script, third-party chat widget, or analytics library can silently steal tokens from localStorage.

**Why it matters:** Storing JWTs or session tokens in localStorage is a common pattern promoted by SPA tutorials. The security trade-off is that HttpOnly cookies are invisible to JavaScript (protecting against XSS) while localStorage is always accessible.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage
- https://portswigger.net/web-security/dom-based/dom-data-manipulation

**Fix:**
- Store session tokens in HttpOnly, Secure, SameSite=Strict cookies instead of localStorage.
- If cookies are not feasible (e.g., cross-origin API), use sessionStorage (cleared on tab close) with a tight CSP to reduce the attack window.
- Never store refresh tokens in localStorage.
- Consider the BFF (Backend for Frontend) pattern: keep tokens server-side, use session cookies.
- **Move from localStorage to HttpOnly cookie** (typescript):
```typescript
// Bad (common SPA pattern)
localStorage.setItem('auth_token', token);

// Good: set via server response
// Server sets: Set-Cookie: auth=...; HttpOnly; Secure; SameSite=Strict
// Client just checks if API calls succeed, no token handling in JS
```

### `dom-xss-location-hash` [client-side / high / body-pattern]
**DOM XSS via location.hash Assignment**

The page reads from location.hash and assigns it to innerHTML or document.write without sanitization. location.hash is attacker-controlled (the # part of the URL) and enables XSS without any server-side injection.

**Risk:** DOM-based XSS via location.hash requires no server vulnerability. An attacker sends a crafted URL (target.com/page#<img src=x onerror=alert(1)>) and the JavaScript assigns it directly to innerHTML, executing the payload in the victim's browser.

**Why it matters:** The fragment identifier (#) is never sent to the server. It exists only in the browser. Client-side code that reads window.location.hash or document.location.hash and renders it without sanitization is a DOM XSS sink.

**References:**
- https://portswigger.net/web-security/cross-site-scripting/dom-based
- https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html

**Fix:**
- Never assign location.hash, location.search, or location.href directly to innerHTML.
- Use textContent for plain text display of URL-derived values.
- Sanitize with DOMPurify before innerHTML assignment.
- Add a CSP to block inline scripts as defense-in-depth.
- **Safe URL fragment handling** (javascript):
```javascript
// Bad
document.getElementById('content').innerHTML = location.hash.slice(1);

// Good: use textContent for plain text
document.getElementById('content').textContent = decodeURIComponent(location.hash.slice(1));

// Or sanitize with DOMPurify if HTML is needed
import DOMPurify from 'dompurify';
document.getElementById('content').innerHTML = DOMPurify.sanitize(location.hash.slice(1));
```

### `cs-document-write-usage` [client-side / high / body-pattern]
**document.write() Usage Detected**

document.write() was found in the page scripts. This function is dangerous because it can overwrite the entire page document, is a primary DOM XSS sink, and is deprecated in modern browsers.

**Risk:** If any attacker-controlled data reaches document.write(), it results in DOM XSS. Additionally, document.write() called after page load rewrites the entire document, destroying all event listeners and breaking React/Vue/Angular hydration.

**Why it matters:** document.write() is a legacy API from the early web. Modern JavaScript has safe alternatives for all of its use cases. Browsers have started restricting it (Chrome warns in console), and it's likely to be removed eventually.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/API/Document/write
- https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html

**Fix:**
- Replace document.write('<script>...') with dynamic script element creation: const s = document.createElement('script'); s.src = url; document.head.appendChild(s).
- Replace document.write('<div>text</div>') with element.textContent = 'text' or element.appendChild(...).
- Audit all uses of document.writeln() as well, same issue.
- **Safe script injection alternative** (javascript):
```javascript
// Bad
document.write('<script src="' + url + '"><\/script>');

// Good
const script = document.createElement('script');
script.src = url;
script.async = true;
document.head.appendChild(script);
```

### `eval-in-client-script` [client-side / high / body-pattern]
**eval() in Client-Side JavaScript**

eval() or the Function() constructor was found in client-side JavaScript. These functions execute strings as code and are a top DOM XSS sink.

**Risk:** If any attacker-controlled data reaches eval() or new Function(), it results in arbitrary JavaScript execution. This is rated as one of the most dangerous DOM XSS sinks because it can bypass CSP 'unsafe-inline' in some browsers.

**Why it matters:** eval() and new Function(string) convert strings into executable code. When combined with user input; URL parameters, postMessage data, or third-party data; they enable arbitrary code execution.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval#never_use_eval!
- https://portswigger.net/web-security/cross-site-scripting/dom-based

**Fix:**
- Remove all eval() and new Function(string) calls.
- Replace eval(jsonString) with JSON.parse(jsonString).
- Replace eval(mathExpression) with a safe math parser library.
- Enable the CSP 'unsafe-eval' restriction to block these at the browser level.
- **Replace eval with safe alternatives** (javascript):
```javascript
// Bad
const data = eval('(' + serverResponse + ')');

// Good
const data = JSON.parse(serverResponse);

// Bad: dynamic function creation
const fn = new Function('x', 'return x * ' + userInput);

// Good: explicit safe computation
const multiplier = Number(userInput);
if (isNaN(multiplier)) throw new Error('Invalid multiplier');
const fn = (x) => x * multiplier;
```

### `third-party-script-no-sri` [client-side / medium / body-pattern]
**External Script Without Subresource Integrity**

One or more external JavaScript files are loaded from CDNs or third-party domains without an integrity attribute. If the CDN is compromised, the script can be replaced with malicious code that runs in all users' browsers.

**Risk:** Supply-chain attacks via compromised CDNs have affected millions of websites. Without SRI, the browser has no way to verify that the script content matches what you tested. A single CDN compromise silently injects malicious code into your site.

**Why it matters:** Subresource Integrity (SRI) allows browsers to verify that fetched resources haven't been altered. The integrity attribute contains a cryptographic hash of the expected script content: if the served content doesn't match, the browser refuses to execute it.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity
- https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html

**Fix:**
- Generate SRI hashes: openssl dgst -sha384 -binary script.js | openssl base64 -A.
- Add integrity='sha384-...' and crossorigin='anonymous' to external script tags.
- Use the SRI Hash Generator at https://www.srihash.org/.
- Pin to a specific version of the CDN resource (not 'latest') so the hash remains valid.
- **Script tag with SRI** (html):
```html
<!-- Bad -->
<script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>

<!-- Good -->
<script
  src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"
  integrity="sha384-..."
  crossorigin="anonymous"
></script>
```

### `source-map-exposed-production` [client-side / medium / body-pattern]
**JavaScript Source Map Exposed in Production**

A source map reference (//# sourceMappingURL=) was found in production JavaScript, pointing to a non-data-URI location. Source maps expose original, un-minified source code to anyone who fetches them.

**Risk:** Source maps expose the complete, readable, un-minified source code of your application to anyone with browser dev tools. This reveals business logic, proprietary algorithms, internal API endpoints, and can make finding vulnerabilities significantly easier.

**Why it matters:** Bundlers generate source maps for debugging. Production builds should either exclude source maps entirely or use a private source map server that requires authentication (Sentry, DataDog, etc.).

**References:**
- https://developer.mozilla.org/en-US/docs/Tools/Debugger/How_to/Use_a_source_map
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

**Fix:**
- Disable source map generation for production builds in Webpack: devtool: false.
- In Vite: build.sourcemap: false.
- If source maps are needed for error tracking: upload them to your error tracking service, then delete or restrict access to the .map files.
- Use hidden-source-map in Webpack to omit the reference comment while keeping the .map file for internal upload.
- **Disable source maps in Vite production** (javascript):
```javascript
// vite.config.ts
export default {
  build: {
    sourcemap: false, // No source maps in production
    // Or: sourcemap: 'hidden', generates .map but no reference comment
  }
};
```

### `jsonp-callback-endpoint` [client-side / medium / body-pattern]
**JSONP Callback Pattern Detected**

A JSONP endpoint was detected that wraps JSON data in a function call controlled by a URL parameter (callback=myFunction). JSONP is an obsolete cross-origin technique that creates security vulnerabilities.

**Risk:** JSONP endpoints bypass the Same-Origin Policy entirely. Any website can load the endpoint as a script tag and exfiltrate the response data. If the endpoint returns user-specific data, it's a cross-site data theft vulnerability.

**Why it matters:** JSONP was invented before CORS existed as a cross-origin workaround. It works by wrapping JSON in a function call: callback({ 'data': 'value' }). Since there is no origin validation, any page can call your endpoint and access the data.

**References:**
- https://portswigger.net/web-security/cors/same-origin-policy#relaxation-of-the-same-origin-policy
- https://owasp.org/www-pdf-archive/Your_Browser_Is_Not_a_Secure_Application_Platform.pdf

**Fix:**
- Remove JSONP endpoints and replace with proper CORS configuration.
- If cross-origin access is needed, use CORS with explicit origin allowlist.
- Never expose user-specific data over JSONP.
- If JSONP must remain for legacy clients: only expose public, non-sensitive data.
- **Replace JSONP with CORS** (typescript):
```typescript
// Bad: JSONP endpoint (any site can read this)
export function GET(req: Request) {
  const callback = new URL(req.url).searchParams.get('callback');
  return new Response(`<value>(<value>)`);
}

// Good: CORS with allowlist
export function GET(req: Request) {
  const origin = req.headers.get('origin');
  const allowed = ALLOWED_ORIGINS.has(origin ?? '') ? origin : '';
  return Response.json(data, {
    headers: { 'Access-Control-Allow-Origin': allowed ?? '' },
  });
}
```

### `open-redirect-client-js` [client-side / medium / body-pattern]
**Client-Side Open Redirect via location Assignment**

A window.location or document.location assignment was found using URL parameters or hash values without validation. Client-side open redirects are exploitable for phishing even without server-side participation.

**Risk:** Attackers craft URLs that appear to be from your trusted domain but redirect users to malicious sites: yoursite.com/login#next=http://evil.com. The redirect happens in the browser after visiting your legitimate URL.

**Why it matters:** Client-side redirects using location.href = someUrlFromTheCurrentPage are open redirect vulnerabilities. The target.com URL in the browser bar gives the victim confidence they are on a legitimate site before being redirected.

**References:**
- https://portswigger.net/web-security/dom-based/open-redirection
- https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html

**Fix:**
- Validate redirect targets are relative paths or match your domain.
- Reject any value starting with http://, https://, or //.
- For post-auth redirects: store the intended destination in sessionStorage or server-side session, not in the URL.
- Never redirect to a location.hash value without validation.
- **Validate redirect URL** (javascript):
```javascript
function safeRedirect(url) {
  // Only allow relative paths (no protocol)
  if (!/^\/[a-z0-9\-\/]/i.test(url)) {
    url = '/dashboard'; // fallback
  }
  window.location.href = url;
}

const next = new URLSearchParams(location.search).get('next');
safeRedirect(next ?? '/dashboard');
```

### `angular-bypass-security` [client-side / high / body-pattern]
**Angular bypassSecurityTrust* Usage**

An Angular bypassSecurityTrust* function was found in the page. These functions explicitly opt out of Angular's built-in XSS protection and must only be used with fully sanitized, trusted content.

**Risk:** bypassSecurityTrust* tells Angular 'trust this value completely, do not sanitize it'. If user-controlled data reaches these functions, it results in XSS. Misuse is extremely common in AI-generated and tutorial Angular code.

**Why it matters:** Angular sanitizes all dynamic HTML, URLs, and styles by default. bypassSecurityTrust* is an escape hatch for embedding trusted HTML (like a CMS-provided rich-text body). It must never be used with user-generated or attacker-influenced content.

**References:**
- https://angular.io/guide/security#trusting-safe-values
- https://cheatsheetseries.owasp.org/cheatsheets/Angular_Cheat_Sheet.html

**Fix:**
- Audit every bypassSecurityTrust* call to verify the data is truly from a trusted, sanitized source.
- For user-generated rich text: sanitize with DOMPurify first, then bypassSecurityTrustHtml.
- Prefer Angular pipes and built-in sanitization over bypassing it.
- Remove any bypassSecurityTrust* calls where the data source is user input.
- **Safe usage with DOMPurify** (typescript):
```typescript
import DOMPurify from 'dompurify';

@Component({
  template: `<div [innerHTML]="trustedHtml"></div>`
})
export class RichTextComponent {
  constructor(private sanitizer: DomSanitizer) {}

  get trustedHtml(): SafeHtml {
    // Only bypass AFTER sanitizing with DOMPurify
    const clean = DOMPurify.sanitize(this.userContent);
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }
}
```

### `vue-v-html-directive` [client-side / high / body-pattern]
**Vue v-html Directive with Dynamic Content**

The Vue v-html directive was found in the page with a dynamic binding. v-html renders raw HTML without Vue's template escaping, creating XSS risk if the bound value includes any user-controlled content.

**Risk:** v-html bypasses Vue's HTML escaping. If the bound variable contains user-generated content, the browser will render it as HTML, executing any injected script tags, event handlers, or javascript: URLs.

**Why it matters:** Vue's template system escapes HTML by default: {{ userContent }} is always rendered as text. v-html explicitly renders HTML, which is safe only for fully trusted content (e.g., pre-sanitized CMS content).

**References:**
- https://vuejs.org/guide/best-practices/security.html#html-injection
- https://cheatsheetseries.owasp.org/cheatsheets/Vue.js_Cheat_Sheet.html

**Fix:**
- Avoid v-html with user-generated content.
- If HTML rendering is needed, sanitize with DOMPurify before binding: :v-html='sanitize(content)'.
- Prefer {{ content }} (text interpolation) which always escapes HTML.
- Consider a component-based rich text renderer instead of raw HTML.
- **Safe v-html with DOMPurify** (html):
```html
<!-- Bad -->
<div v-html="userContent"></div>

<!-- Good -->
<div v-html="sanitized(userContent)"></div>

<!-- In script -->
import DOMPurify from 'dompurify';
const sanitized = (html) => DOMPurify.sanitize(html);
```

### `api-key-hardcoded-in-js` [client-side / high / body-pattern]
**API Key or Secret Hardcoded in Client JavaScript**

An API key, secret, or credential pattern was found embedded directly in client-side JavaScript. Any secret in client JavaScript is fully visible to anyone who visits the page.

**Risk:** API keys in client JavaScript are trivially extractable. Press F12 in any browser and view the network tab or page source. Exposed keys enable attackers to abuse third-party services at your cost: OpenAI API, AWS, Stripe, Twilio, etc.

**Why it matters:** Client-side JavaScript is delivered to every visitor's browser. There is no effective way to 'hide' a secret in frontend code. Any key embedded in client JS should be treated as compromised.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- https://owasp.org/www-community/vulnerabilities/Key_Management_Cheat_Sheet

**Fix:**
- Move all API calls to your server side. The browser calls your API, your server calls the third party.
- Use environment variables on the server. Never use NEXT_PUBLIC_ prefix for secrets.
- For browser-SDK APIs (Firebase, Stripe publishable key): these are designed to be public but should be origin-restricted in the provider's dashboard.
- Rotate any key that has been in client JavaScript immediately.
- **Server-side API proxy** (typescript):
```typescript
// Bad: secret in client code
const openai = new OpenAI({ apiKey: 'sk-...', dangerouslyAllowBrowser: true });

// Good: proxy through your server
// Client:
const response = await fetch('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message }) });

// Server (API route):
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

### `debug-info-in-page-js` [client-side / low / body-pattern]
**Debug Information Embedded in Page JavaScript**

Debug information such as internal server paths, configuration values, or environment details was found in page-embedded JavaScript (window.__NEXT_DATA__, __NUXT__, etc.).

**Risk:** Internal paths, configuration keys, database names, internal service URLs, and deployment details accelerate reconnaissance for an attacker mapping your infrastructure.

**Why it matters:** Server-side rendering frameworks (Next.js, Nuxt) serialize server-side props into the page HTML for hydration. If server-side code accidentally includes internal configuration in these props, it reaches every browser.

**References:**
- https://nextjs.org/docs/pages/api-reference/functions/get-server-side-props#serializing-dates-and-other-non-json-data
- https://cheatsheetseries.owasp.org/cheatsheets/Information_Exposure_Through_an_Error_Message_Cheat_Sheet.html

**Fix:**
- Audit what data is included in getServerSideProps / getStaticProps return values.
- Never pass process.env, database config, or internal service details to the frontend.
- Use a strict serialization allowlist: only pass the exact fields the UI needs.
- Check window.__NEXT_DATA__ or __NUXT__ in browser dev tools to see what's exposed.
- **Safe server-side props** (typescript):
```typescript
// Bad: leaks server config
export async function getServerSideProps() {
  return { props: { config: process.env, dbUrl: DB_URL } };
}

// Good: only UI data
export async function getServerSideProps(ctx) {
  const user = await getUser(ctx.req);
  return { props: { userName: user.name, plan: user.plan } };
}
```

### `prototype-pollution-client` [client-side / high / body-pattern]
**Client-Side Prototype Pollution Risk**

A client-side prototype pollution pattern was detected. Deep merge operations, recursive object assignment, or direct __proto__ manipulation with user-controlled keys can corrupt the JavaScript prototype chain.

**Risk:** Client-side prototype pollution can bypass security checks (if (user.isAdmin) checks become if (true) after pollution), corrupt application state, and in some cases enable XSS through gadget chains in popular libraries.

**Why it matters:** When user-controlled data is merged into objects without key filtering, attackers can set the __proto__ property to inject values into all objects. Libraries like lodash, jQuery, and many others have had prototype pollution CVEs.

**References:**
- https://portswigger.net/web-security/prototype-pollution
- https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html

**Fix:**
- Use Object.create(null) for objects with user-controlled keys.
- Filter __proto__, constructor, and prototype from all user-supplied keys.
- Upgrade lodash to 4.17.21+ (patched against prototype pollution in merge/set).
- Use Map instead of plain objects for user-keyed data.
- **Key filtering** (javascript):
```javascript
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function safeMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (BLOCKED_KEYS.has(key)) continue;
    target[key] = value;
  }
  return target;
}
```

### `cs-hardcoded-localhost-api-url` [client-side / medium / body-pattern]
**Client Script Hardcodes a Localhost API URL**

A client-side script assigns an API base URL / endpoint variable to a literal http://localhost or 127.0.0.1 address.

**Risk:** In production, every API call built from this base URL fails outright (or, worse, silently targets whatever happens to be listening on the visitor's own machine at that port), and it signals the deploy pipeline never swapped in environment-specific configuration.

**Why it matters:** This is a common artifact of AI-scaffolded or quickly-prototyped apps: the assistant generates a working local dev config, and it ships unchanged because there was no environment-variable indirection for the API base URL.

**References:**
- https://12factor.net/config

**Fix:**
- Read the API base URL from a build-time environment variable, never a literal string.
- Fail the production build if the environment variable resolves to localhost/127.0.0.1.
- Add an end-to-end smoke test against the deployed environment that would catch a broken API base URL.
- **Use an environment variable instead** (typescript):
```typescript
const apiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!apiUrl) throw new Error('NEXT_PUBLIC_API_URL is not set');
```

### `cs-unsanitized-markdown-render` [client-side / high / body-pattern]
**Markdown Rendered to innerHTML Without Sanitization**

Markdown renderer output (marked()/markdown-it) is assigned directly to innerHTML or dangerouslySetInnerHTML with no visible DOMPurify/sanitize-html call nearby.

**Risk:** Markdown renderers pass raw HTML embedded in the source straight through by default, so any user-controlled markdown (comments, bios, README content) becomes a stored or reflected XSS vector.

**Why it matters:** Libraries like marked() and markdown-it render Markdown to an HTML string, but they do not sanitize that HTML unless explicitly configured to. AI-generated code frequently produces the 'render markdown to HTML, inject into the DOM' pattern without the accompanying sanitization step, since the happy-path demo works fine either way.

**References:**
- https://github.com/cure53/DOMPurify
- https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

**Fix:**
- Pipe the renderer's output through DOMPurify.sanitize() (or an equivalent) before assigning it to innerHTML.
- Alternatively, render Markdown to React elements/AST nodes instead of raw HTML strings, avoiding the sink entirely.
- Add an automated test asserting that a markdown payload containing <script> or an event handler attribute does not execute.
- **Sanitize before rendering** (javascript):
```javascript
import DOMPurify from 'dompurify';
el.innerHTML = DOMPurify.sanitize(marked(userMarkdown));
```

### `cs-websocket-token-in-query` [client-side / medium / body-pattern]
**WebSocket URL Carries Auth Token in Query String**

A client-side WebSocket connection is opened with an auth token, API key, or JWT passed as a URL query parameter.

**Risk:** URLs (including WebSocket connection URLs) are commonly logged by reverse proxies, load balancers, CDNs, and browser history, so a token passed this way ends up persisted in plaintext across systems that have no business seeing it.

**Why it matters:** The WebSocket handshake is an HTTP request, and its full URL, query string included, is subject to the same logging exposure as any other HTTP URL. Auth material belongs in a header or an initial post-connection message, not the URL.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#web-sockets

**Fix:**
- Send the auth token as the first message after the WebSocket connection opens, rather than in the URL.
- If the server framework supports it, pass a subprotocol-encoded or header-based token instead.
- Rotate any tokens that may already have been logged via this pattern.
- **Authenticate after connecting** (javascript):
```javascript
const ws = new WebSocket('wss://api.example.com/ws');
ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
```

### `cs-client-only-role-gate` [client-side / low / body-pattern]
**UI Visibility Gated by Client-Side Role Check Only**

An element's visibility is toggled based on a client-side role/permission check (e.g. user.role === 'admin') with no indication the underlying action is also enforced server-side.

**Risk:** Any user can open devtools, flip the condition, or call the underlying API directly, bypassing a UI gate that isn't backed by a server-side authorization check.

**Why it matters:** Hiding an 'Admin' button when user.role !== 'admin' is fine for UX, but AI-scaffolded apps sometimes treat this as the entire access control mechanism and skip re-checking the role on the server endpoint the button calls.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

**Fix:**
- Treat every client-side role check as a UX convenience only, never as the authorization boundary.
- Re-validate the user's role/permission on the server for every state-changing request the gated UI can trigger.
- Add an authorization test that calls the underlying endpoint directly as a non-privileged user and asserts it is rejected.
- **Server-side check is the real gate** (typescript):
```typescript
// UI hides the button for non-admins (nice-to-have)
// but the endpoint MUST re-check on every request:
export async function DELETE(req: Request) {
  const session = await getSession(req);
  if (session?.role !== 'admin') return new Response('Forbidden', { status: 403 });
  // ...
}
```

### `cs-dev-tunnel-script-reference` [client-side / high / body-pattern]
**Script Loaded From a Development Tunnel Domain**

A <script> tag loads code from a development tunneling domain (ngrok, localtunnel, Cloudflare Tunnel trycloudflare.com, or serveo.net).

**Risk:** Dev tunnels are ephemeral, unauthenticated by default, and not designed to serve production traffic; if the tunnel expires or is reassigned, the script reference can start resolving to someone else's tunnel entirely, a supply-chain takeover with zero effort required from the attacker.

**Why it matters:** Developer tunneling tools are meant for temporarily exposing a local dev server for testing (webhooks, mobile device testing, demos). A production page referencing one almost always means a temporary URL was pasted in during development and never replaced with the real deployed asset URL.

**References:**
- https://ngrok.com/docs/

**Fix:**
- Replace the tunnel URL with the script's real, permanently-hosted production URL.
- Add a CI check that fails the build if any bundled/rendered output references a known tunneling domain.
- Rotate/kill the exposed tunnel once confirmed unnecessary.
- **Use the real deployed asset URL** (html):
```html
<!-- BAD -->
<script src="https://a1b2c3d4.ngrok-free.app/bundle.js"></script>

<!-- GOOD -->
<script src="https://cdn.example.com/bundle.js"></script>
```

### `cs-clipboard-writetext-hardcoded-secret` [client-side / high / body-pattern]
**Clipboard writeText() Contains a Hardcoded Credential**

A navigator.clipboard.writeText() call contains a literal, credential-shaped string (an OpenAI/Google/GitHub/Slack token pattern) rather than a variable.

**Risk:** The exact secret value is shipped in the client bundle and readable by anyone who views the page source, not merely referenced or proxied.

**Why it matters:** This pattern typically comes from a debug 'copy my API key to clipboard' convenience button that was wired up against a real key during development and never parameterized before shipping, a classic AI-assisted prototyping leftover.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

**Fix:**
- Treat the exposed credential as compromised: revoke and reissue it immediately.
- Remove the hardcoded value and source it from a runtime-fetched, per-user value if the copy-to-clipboard feature is still needed.
- Add a pre-commit/CI secret scanner so credential-shaped literals never reach a client bundle.
- **Fetch the value at runtime instead of hardcoding it** (javascript):
```javascript
button.addEventListener('click', async () => {
  const { apiKey } = await fetch('/api/me/key').then(r => r.json());
  navigator.clipboard.writeText(apiKey);
});
```

---

## Category: code (121 checks)

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
- **Replace eval() with safe alternatives** (javascript):
```javascript
// BAD
eval(userInput);

// GOOD: use JSON.parse for data
const data = JSON.parse(input);

// GOOD: use a function map instead of eval for dynamic dispatch
const ops = { add: (a, b) => a + b, sub: (a, b) => a - b };
const fn = ops[userOp];
if (!fn) throw new Error("Unknown op");
const result = fn(a, b);
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
- **Use textContent instead of innerHTML** (javascript):
```javascript
// BAD: executes scripts in user content
element.innerHTML = userInput;

// GOOD: text only, no script execution
element.textContent = userInput;

// If you need HTML, sanitize with DOMPurify
import DOMPurify from "dompurify";
element.innerHTML = DOMPurify.sanitize(userInput);
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
- **Avoid outerHTML with user content** (javascript):
```javascript
// BAD
element.outerHTML = userContent;

// GOOD: use replaceWith() with a safe text node
const text = document.createTextNode(userContent);
element.replaceWith(text);
// Or create structured elements programmatically
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
- **Never use document.write with user content** (javascript):
```javascript
// BAD
document.write(userInput);

// GOOD: use DOM APIs to insert content safely
const el = document.createElement("p");
el.textContent = userInput;
document.body.appendChild(el);
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
- **Avoid insertAdjacentHTML with user content** (javascript):
```javascript
// BAD
element.insertAdjacentHTML("beforeend", userInput);

// GOOD: use insertAdjacentText for text-only
element.insertAdjacentText("beforeend", userInput);

// Or if HTML is needed, sanitize first
import DOMPurify from "dompurify";
element.insertAdjacentHTML("beforeend", DOMPurify.sanitize(userInput));
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
- **Validate attributes set from user input** (javascript):
```javascript
// BAD: event handler injection via attribute
element.setAttribute("onclick", userInput);
element.setAttribute("href", userInput); // javascript: scheme

// GOOD: validate URL schemes before setting href
const url = new URL(userInput, location.href);
if (!["http:", "https:"].includes(url.protocol)) throw new Error("Bad scheme");
element.setAttribute("href", url.href);

// Never set event handler attributes from user input
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
- **Block path traversal sequences** (typescript):
```typescript
function sanitizePath(input: string): string {
  // Reject null bytes and traversal sequences
  if (input.includes("\0") || /\.\./u.test(input)) {
    throw new Error("Invalid path");
  }
  // Confine to a base directory
  const base = path.resolve("/safe/base");
  const full = path.resolve(base, path.basename(input));
  if (!full.startsWith(base)) throw new Error("Path traversal blocked");
  return full;
}
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
- **Never pass user input directly to template engines** (typescript):
```typescript
// BAD: user controls the template string
const result = template.render(userInput, context);

// GOOD: user input goes into the data, not the template
const tmpl = "Hello {{ name }}!";
const result = template.render(tmpl, { name: userInput }); // name is escaped

// For Nunjucks, Handlebars, etc.: always escape output by default
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
- **Escape user content in template literals** (typescript):
```typescript
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
// Use escapeHtml(userInput) in template literals that go into innerHTML
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
- **Validate and reject shell metacharacters** (typescript):
```typescript
const SAFE_PATTERN = /^[a-zA-Z0-9_\-\.]+$/;

if (!SAFE_PATTERN.test(userInput)) {
  throw new Error("Invalid characters in input");
}
// Then use execFile with argument array, never exec() or shell=true
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
- **Replace eval with a safe function map** (javascript):
```javascript
// Instead of: eval(userOp + "(data)")
// Build an explicit dispatch table:
const handlers = {
  process: processData,
  validate: validateData,
  transform: transformData,
};
const fn = handlers[userOp];
if (typeof fn !== "function") throw new Error("Unknown operation");
fn(data);
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
- **Avoid new Function() with user input** (javascript):
```javascript
// BAD: equivalent to eval()
const fn = new Function("x", userInput);

// GOOD: define functions statically
const validators = {
  email: (x) => /^[^@]+@[^@]+$/.test(x),
  number: (x) => !isNaN(Number(x)),
};
const validate = validators[userType];
if (!validate) throw new Error("Unknown type");
validate(input);
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
- **Pass a function reference, not a string** (javascript):
```javascript
// BAD: string form evaluates code like eval()
setTimeout("doSomething()", 1000);

// GOOD: pass a function reference
setTimeout(doSomething, 1000);
setTimeout(() => doSomethingWith(arg), 1000);
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
- **Use execFile with argument arrays** (typescript):
```typescript
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// BAD: exec(`ls <value>`), shell injection possible
// GOOD: argument array, no shell
const { stdout } = await execFileAsync("ls", ["-la", userPath], {
  shell: false,  // never true with user input
  timeout: 5000,
});
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
- **Store tokens in HttpOnly cookies, not localStorage** (typescript):
```typescript
// BAD: tokens in localStorage are readable by any JS (XSS)
// localStorage.setItem("auth_token", token);

// GOOD: server sets an HttpOnly cookie
res.setHeader("Set-Cookie",
  `session=<value>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`
);
// HttpOnly cookies cannot be read by JavaScript at all
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
- **Prefer HttpOnly cookies over sessionStorage for tokens** (typescript):
```typescript
// BAD: sessionStorage is still accessible to XSS
// sessionStorage.setItem("token", jwt);

// GOOD: server-side session with HttpOnly cookie
res.setHeader("Set-Cookie",
  `session=<value>; HttpOnly; Secure; SameSite=Strict; Path=/`
);
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
- **Encrypt sensitive data before storing in IndexedDB** (typescript):
```typescript
// If you must use IndexedDB for sensitive data, encrypt it first
const key = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  false, // not extractable
  ["encrypt", "decrypt"]
);
const iv = crypto.getRandomValues(new Uint8Array(12));
const encrypted = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  key,
  new TextEncoder().encode(sensitiveData)
);
// Store encrypted bytes only, not plaintext
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
- **Avoid window.name for cross-origin data passing** (javascript):
```javascript
// BAD: window.name persists across same-tab navigation and is readable cross-origin
// window.name = JSON.stringify(sensitiveData);

// GOOD: use postMessage with explicit targetOrigin
targetWindow.postMessage({ type: "data", value }, "https://target.example.com");
// Receiver validates the origin:
window.addEventListener("message", (e) => {
  if (e.origin !== "https://source.example.com") return;
  // handle e.data
});
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
- **Restrict Service Worker scope + add CSP** (javascript):
```javascript
// Register with minimal scope
navigator.serviceWorker.register("/sw.js", { scope: "/app/" });

// In the Service Worker, validate response integrity:
self.addEventListener("fetch", (event) => {
  // Only intercept same-origin requests
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request) || fetch(event.request));
});
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
- **Require explicit user permission for Push API** (javascript):
```javascript
async function subscribePush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.subscribe({
    userVisibleOnly: true, // must be true, prevents silent push
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
}
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
- **Payment Request API: always verify server-side** (javascript):
```javascript
const req = new PaymentRequest(methods, details);
const response = await req.show();

// Never trust the browser response alone
// Always verify the payment server-side:
const serverVerify = await fetch("/api/verify-payment", {
  method: "POST",
  body: JSON.stringify({ paymentId: response.requestId }),
  headers: { "Content-Type": "application/json" },
});
if (!serverVerify.ok) throw new Error("Payment verification failed");
await response.complete("success");
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
- **Credential Management: store only after explicit login** (javascript):
```javascript
if ("credentials" in navigator) {
  // Store credentials only after successful authentication
  const cred = new PasswordCredential({
    id: email,
    password: password,
  });
  await navigator.credentials.store(cred);
}
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
- **WebAuthn: verify attestation server-side** (typescript):
```typescript
// Client: create credential
const credential = await navigator.credentials.create({ publicKey: options });

// Send to server for attestation verification
const res = await fetch("/api/auth/register", {
  method: "POST",
  body: JSON.stringify(credential),
});
// Server MUST verify the attestation using a library like SimpleWebAuthn
// Never skip server-side verification
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
- **Web Crypto API: use secure algorithms** (typescript):
```typescript
// Use AES-GCM (authenticated encryption), not AES-CBC without MAC
const key = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt", "decrypt"]
);
const iv = crypto.getRandomValues(new Uint8Array(12)); // unique per message
const encrypted = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  key,
  plaintext
);
// Prepend iv to ciphertext for storage/transmission
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
- **Validate WASM origin and use CSP wasm-unsafe-eval policy** (typescript):
```typescript
// Only load WASM from your own origin
const response = await fetch("/wasm/module.wasm");
const { instance } = await WebAssembly.instantiateStreaming(response);
// CSP: add wasm-unsafe-eval only if required by the module
// Never load WASM from user-supplied URLs
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
- **Strip console.log in production builds** (javascript):
```javascript
// vite.config.ts or next.config.mjs
export default {
  esbuild: {
    drop: process.env.NODE_ENV === "production" ? ["console", "debugger"] : [],
  },
};
// Or use a logger that respects log levels:
import log from "loglevel";
log.setLevel(process.env.NODE_ENV === "production" ? "warn" : "debug");
log.debug("only in dev"); // silent in production
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
- **Remove debugger statements from production code** (bash):
```bash
# Find all debugger statements
grep -rn "debugger" src/ --include="*.ts" --include="*.js"

# Remove them via ESLint rule no-debugger (errors in CI)
# .eslintrc: { "rules": { "no-debugger": "error" } }
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
- **Set credentials mode explicitly** (typescript):
```typescript
// BAD: credentials defaults to "same-origin"
fetch("/api/data");

// GOOD: explicit, omit for cross-origin API calls
fetch("https://api.example.com/data", {
  credentials: "omit", // no cookies sent cross-origin
});

// Or "include" only when you explicitly need cookies cross-origin
fetch("/api/protected", {
  credentials: "include", // requires CORS allow-credentials
});
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
- **Set baseURL to a specific origin** (typescript):
```typescript
import axios from "axios";

// BAD: base URL constructed from user input
// axios.defaults.baseURL = userInput + "/api";

// GOOD: hard-coded origin
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "https://api.yoursite.com",
  timeout: 10_000,
  withCredentials: false, // only enable if needed with explicit CORS
});
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
- **Pass function reference to setInterval** (javascript):
```javascript
// BAD: string form is eval()
setInterval("updateClock()", 1000);

// GOOD: function reference
setInterval(updateClock, 1000);
setInterval(() => fetchData(endpoint), 5000);
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
- **Block prototype pollution in Object.assign** (typescript):
```typescript
function safeAssign<T extends object>(target: T, source: Record<string, unknown>): T {
  const banned = new Set(["__proto__", "constructor", "prototype"]);
  for (const [k, v] of Object.entries(source)) {
    if (!banned.has(k)) (target as Record<string, unknown>)[k] = v;
  }
  return target;
}
// Never: Object.assign(config, req.body) without validation
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
- **Validate spread sources before merging into globals** (typescript):
```typescript
// BAD: { ...globalConfig, ...req.body } allows overwriting any key

// GOOD: allowlist only known, safe keys
const ALLOWED_KEYS: Set<keyof typeof defaultConfig> = new Set(["theme", "locale", "pageSize"]);
const userPrefs = Object.fromEntries(
  Object.entries(req.body).filter(([k]) => ALLOWED_KEYS.has(k as any))
);
const merged = { ...defaultConfig, ...userPrefs };
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
- **Always set HttpOnly on session cookies** (typescript):
```typescript
res.setHeader("Set-Cookie",
  `session=<value>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`
);
// HttpOnly prevents JavaScript from reading the cookie
// Do NOT set HttpOnly=false on session, auth, or CSRF cookies
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
- **Set the Secure flag on all cookies** (typescript):
```typescript
res.setHeader("Set-Cookie",
  `session=<value>; HttpOnly; Secure; SameSite=Strict; Path=/`
);
// Secure: cookie is only sent over HTTPS connections
// Without Secure, cookie can be stolen over HTTP (SSL-stripping attack)
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
- **Set SameSite on all cookies** (typescript):
```typescript
// SameSite=Strict: cookie never sent cross-site (most secure for auth)
res.setHeader("Set-Cookie", `session=<value>; SameSite=Strict; HttpOnly; Secure`);

// SameSite=Lax: sent on top-level navigations (safe for most cases)
res.setHeader("Set-Cookie", `theme=<value>; SameSite=Lax`);

// Never SameSite=None without Secure flag (blocked by browsers)
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
- **Always add noopener noreferrer to window.open** (javascript):
```javascript
// BAD: opener can access window.opener to modify the parent page
window.open("https://example.com");

// GOOD
window.open("https://example.com", "_blank", "noopener,noreferrer");

// In React, use rel="noopener noreferrer" on <a target="_blank">:
// <a href="..." target="_blank" rel="noopener noreferrer">Link</a>
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
- **Avoid .html() with user content in jQuery** (javascript):
```javascript
// BAD: .html() with user input executes scripts
$("#content").html(userInput);

// GOOD: .text() for plain text
$("#content").text(userInput);

// If HTML is needed, sanitize first
import DOMPurify from "dompurify";
$("#content").html(DOMPurify.sanitize(userInput));
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
- **Scope event handlers to specific elements** (javascript):
```javascript
// BAD: global event listeners can be triggered by any element
$(document).on("click", userDefinedSelector, handler);

// GOOD: scope to a specific container you control
$("#app-container").on("click", ".btn-action", handler);
// Never let user input define the selector string
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
- **Avoid storing PII in localStorage** (typescript):
```typescript
// BAD: PII readable by any same-origin script (XSS risk)
// localStorage.setItem("user_email", email);

// GOOD: store only non-sensitive identifiers client-side
localStorage.setItem("theme", "dark"); // preferences: OK
localStorage.setItem("userId", hashedId); // non-sensitive ID: OK

// PII (email, name, SSN) should stay server-side
// Use session cookie to identify the user server-side
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
- **Add Content-Security-Policy to Service Worker scope** (typescript):
```typescript
// In your server headers, apply CSP to the service worker script itself
// next.config.mjs or middleware:
res.setHeader("Content-Security-Policy",
  "default-src 'self'; script-src 'self'"
);
// The SW registration scope should also be restricted
navigator.serviceWorker.register("/sw.js", { scope: "/app/" });
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
- **Set cookies with Secure and HttpOnly via server** (typescript):
```typescript
// BAD: JavaScript can only set cookies without HttpOnly
// $.cookie("session", token, { secure: true });
// This CANNOT set HttpOnly, XSS can still steal it

// GOOD: set session cookies server-side only
res.setHeader("Set-Cookie",
  `session=<value>; HttpOnly; Secure; SameSite=Strict; Path=/`
);
// Server-set cookies with HttpOnly cannot be read by JS
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
- **Stripe publishable key is safe in browser (verify server-side)** (typescript):
```typescript
// pk_live_* and pk_test_* are intentionally public, used in browser
import { loadStripe } from "@stripe/stripe-js";
const stripe = await loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

// The SECRET key (sk_live_*) must NEVER appear in client code
// Create PaymentIntents server-side only:
// stripe.paymentIntents.create(...): in an API route with the secret key
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
- **Sanitize before setting innerHTML via ref** (tsx):
```tsx
import { useRef, useEffect } from "react";
import DOMPurify from "dompurify";

export function SafeHtml({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = DOMPurify.sanitize(content);
    }
  }, [content]);
  return <div ref={ref} />;
}
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
- **Use Angular interpolation safely: avoid innerHTML binding** (typescript):
```typescript
// Angular auto-escapes interpolation: {{ userInput }} is safe
// BAD: bypasses Angular's sanitization
// <div [innerHTML]="userHtml"></div>  // only safe if sanitized

// GOOD: use {{ }} for text content (auto-escaped)
// <p>{{ userName }}</p>  // safe, Angular escapes this

// For HTML: use DomSanitizer.sanitize() before binding
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
- **Validate element type before insertAdjacentElement** (javascript):
```javascript
// BAD: inserting user-controlled elements
element.insertAdjacentElement("afterend", userElement);

// GOOD: create elements programmatically from safe data
const el = document.createElement("span");
el.textContent = userText; // not innerHTML
element.insertAdjacentElement("afterend", el);
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
- **Sanitize before createContextualFragment** (javascript):
```javascript
// BAD: executes scripts in the fragment
const range = document.createRange();
const fragment = range.createContextualFragment(userHtml);

// GOOD: sanitize first
import DOMPurify from "dompurify";
const clean = DOMPurify.sanitize(userHtml);
const fragment = range.createContextualFragment(clean);
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
- **Never write parsed JSON into the document** (javascript):
```javascript
// BAD: parsed JSON value written into the DOM
const data = JSON.parse(serverResponse);
document.write(data.htmlContent);

// GOOD: use DOM APIs with textContent
const el = document.getElementById("output");
el.textContent = data.textContent;
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
- **Sanitize dynamic content before dangerouslySetInnerHTML** (tsx):
```tsx
import DOMPurify from "dompurify";

function DynamicContent({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "strong", "em", "a"],
    ALLOWED_ATTR: ["href"],
  });
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}
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
- **Always sanitize dynamic v-html bindings** (vue):
```vue
<script setup lang="ts">
import DOMPurify from "dompurify";
import { computed, type PropType } from "vue";
const props = defineProps({ html: String });
const safe = computed(() => DOMPurify.sanitize(props.html ?? ""));
</script>
<template>
  <div v-html="safe" />
</template>
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
- **Use SecurityContext.HTML sanitization for dynamic binding** (typescript):
```typescript
import { DomSanitizer, SecurityContext } from "@angular/platform-browser";

@Component({ template: `<div [innerHTML]="safeHtml"></div>` })
export class SafeHtmlComponent {
  safeHtml: string;
  constructor(private sanitizer: DomSanitizer) {
    this.safeHtml = this.sanitizer.sanitize(
      SecurityContext.HTML,
      dynamicHtmlInput
    ) ?? "";
  }
}
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
- **DOMParser is safe for XML parsing but not HTML injection** (javascript):
```javascript
// DOMParser.parseFromString(html, "text/html") creates a document,
// safe for parsing, dangerous if you then inject the result into the live DOM.

const doc = parser.parseFromString(userHtml, "text/html");
// Never do: document.body.appendChild(doc.body) without sanitization

// GOOD: extract only text content
const text = doc.body.textContent;
// Or sanitize with DOMPurify before appending
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
- **Set shell: false in spawn options** (typescript):
```typescript
import { spawn } from "child_process";

// BAD: shell: true, user input can inject shell commands
spawn("convert", [userInput], { shell: true });

// GOOD: shell: false (default) with argument array
spawn("convert", ["-resize", "100x100", validatedInputPath, outputPath], {
  shell: false, // no shell expansion
  timeout: 10_000,
});
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
- **Use subprocess.run with list args (no shell=True)** (python):
```python
import subprocess

# BAD: shell=True with user input, shell injection possible
subprocess.run(f"convert {user_input} output.png", shell=True)

# GOOD: list of args, shell=False (default)
subprocess.run(
    ["convert", "-resize", "100x100", validated_input, "output.png"],
    shell=False,
    timeout=10,
    check=True,
)
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
- **Never concatenate user input into shell strings** (typescript):
```typescript
// BAD: string concatenation into /bin/sh
exec(`/bin/sh -c "convert <value> output.jpg"`);

// GOOD: execFile with separate args
execFile("/usr/bin/convert", [filename, "output.jpg"], {
  shell: false,
  timeout: 5_000,
});
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
- **Use subprocess.run list form instead of popen string** (python):
```python
# BAD: string command passed to popen is shell-injectable
import subprocess
subprocess.Popen(f"ls {user_dir}", shell=True)

# GOOD: list form with explicit args
subprocess.Popen(["ls", "-la", validated_dir], shell=False)
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
- **Validate arguments before process.spawn** (typescript):
```typescript
import { spawn } from "child_process";

// Allowlist: only known-safe filenames
const ALLOWED_EXT = /^[a-zA-Z0-9_-]+\.(png|jpg|webp)$/;
if (!ALLOWED_EXT.test(filename)) throw new Error("Invalid filename");

spawn("convert", [filename, "output.png"], { shell: false });
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
- **Avoid $where with user input in MongoDB** (typescript):
```typescript
// BAD: $where executes arbitrary JS on the server
db.collection.find({ $where: `this.name === "<value>"` });

// GOOD: use standard query operators, never $where
db.collection.findOne({ name: userInput }); // parameterized
// Or with Mongoose:
User.findOne({ name: { $eq: userInput } });
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
- **Escape or validate regex patterns from user input** (typescript):
```typescript
// BAD: user controls the regex pattern, ReDoS possible
collection.find({ email: new RegExp(userInput) });

// GOOD: escape the user input before using as regex
function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
collection.find({ email: new RegExp("^" + escapeRegex(userInput) + "$") });
// Or use a plain equality match instead of regex
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
- **Use parameterized queries** (typescript):
```typescript
import pool from "./db";

// BAD: string concatenation, SQL injection
const result = await pool.query(`SELECT * FROM users WHERE email = '<value>'`);

// GOOD: parameterized query
const result = await pool.query(
  "SELECT * FROM users WHERE email = $1",
  [email]
);
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
- **Never use template literals for SQL** (typescript):
```typescript
// BAD
const q = `SELECT * FROM orders WHERE user_id = <value>`;

// GOOD: parameter placeholder
const q = "SELECT * FROM orders WHERE user_id = $1";
const result = await pool.query(q, [userId]);
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
- **Use Mongoose with strict equality, not raw where** (typescript):
```typescript
// BAD: using $where with user input
User.findOne({ $where: `this.name == "<value>"` });

// GOOD: standard Mongoose query (auto-escaped)
User.findOne({ name: name, active: true });
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
- **Avoid Sequelize.literal with user input** (typescript):
```typescript
// BAD: literal() bypasses escaping
User.findAll({ where: Sequelize.literal(`name = '<value>'`) });

// GOOD: use Sequelize where clauses
User.findAll({ where: { name: name } });
// Or with Op:
import { Op } from "sequelize";
User.findAll({ where: { name: { [Op.eq]: name } } });
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
- **Use YAML safeLoad / yaml.parse instead of load** (typescript):
```typescript
import yaml from "js-yaml";

// BAD: yaml.load can execute arbitrary JS (!!js/function tag)
const data = yaml.load(userYaml);

// GOOD: safeLoad rejects dangerous YAML types
const data = yaml.safeLoad(userYaml);
// Or with the newer js-yaml API:
const data = yaml.load(userYaml, { schema: yaml.JSON_SCHEMA }); // JSON-only types
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
- **Never unpickle data from untrusted sources** (python):
```python
# BAD: pickle.loads executes arbitrary Python code
import pickle
data = pickle.loads(user_input)

# GOOD: use JSON or a safe format for untrusted data
import json
data = json.loads(user_input)
# Validate with a schema (e.g., pydantic):
from pydantic import BaseModel
class Payload(BaseModel):
    name: str
    value: int
payload = Payload(**data)
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
- **Verify and parse base64 safely: never eval** (typescript):
```typescript
// BAD: decoding user-supplied base64 then eval-ing it
eval(atob(userBase64));

// GOOD: decode only for known safe formats
const decoded = Buffer.from(userBase64, "base64").toString("utf8");
const data = JSON.parse(decoded); // parse as JSON, not eval
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
- **Use JSON.parse, not new Function for JSON** (javascript):
```javascript
// BAD: new Function is eval in disguise
const data = (new Function("return " + jsonString))();

// GOOD: use the built-in JSON parser
const data = JSON.parse(jsonString);
// Validate with a schema library for extra safety
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
- **Avoid node-serialize: use JSON.parse instead** (typescript):
```typescript
// BAD: node-serialize.unserialize() is vulnerable to RCE
import serialize from "node-serialize";
const data = serialize.unserialize(userInput); // RCE if input contains IIFE

// GOOD: use JSON.parse or a safe serialization library
const data = JSON.parse(userInput);
// Validate the parsed object against a schema
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
- **Avoid unserialize with untrusted data in PHP** (php):
```php
<?php
// BAD: unserialize() with user input can lead to object injection / RCE
$data = unserialize($userInput);

// GOOD: use json_decode() for data from users
$data = json_decode($userInput, true);
// Validate the parsed array before using it
if (!isset($data["id"]) || !is_int($data["id"])) {
    throw new InvalidArgumentException("Invalid input");
}
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
- **Block private IPs and non-standard ports** (typescript):
```typescript
import { isIP } from "net";

async function safeRequest(url: string) {
  const parsed = new URL(url);
  const BLOCKED_PORTS = new Set(["22", "3306", "5432", "6379", "8080"]);
  if (BLOCKED_PORTS.has(parsed.port)) throw new Error("Port not allowed");
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("Loopback not allowed");
  }
  return fetch(url, { signal: AbortSignal.timeout(5_000) });
}
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
- **Allowlist permitted hosts for outbound fetch** (typescript):
```typescript
const ALLOWED_HOSTS = new Set(["api.stripe.com", "api.sendgrid.com"]);

async function safeFetch(url: string, options?: RequestInit) {
  const { hostname, protocol } = new URL(url);
  if (protocol !== "https:") throw new Error("HTTPS only");
  if (!ALLOWED_HOSTS.has(hostname)) throw new Error("Host not allowed");
  return fetch(url, { ...options, signal: AbortSignal.timeout(5_000) });
}
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
- **Validate URL before axios request** (typescript):
```typescript
import axios from "axios";

const ALLOWED = new Set(["api.example.com"]);

export async function proxyRequest(url: string) {
  const parsed = new URL(url);
  if (!ALLOWED.has(parsed.hostname)) throw new Error("Host blocked");
  if (parsed.protocol !== "https:") throw new Error("HTTPS only");
  return axios.get(parsed.href, { timeout: 5_000 });
}
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
- **Validate URL before XHR** (javascript):
```javascript
function safeXhr(url) {
  const parsed = new URL(url, location.origin);
  if (parsed.origin !== location.origin) {
    throw new Error("Cross-origin XHR blocked");
  }
  const xhr = new XMLHttpRequest();
  xhr.open("GET", parsed.href, true);
  xhr.timeout = 5000;
  xhr.send();
}
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
- **Restrict got to an allowlisted prefixUrl** (typescript):
```typescript
import got from "got";

// Use prefixUrl to confine all requests to a known origin
const api = got.extend({
  prefixUrl: "https://api.trusted.com/v1",
  timeout: { request: 5_000 },
});
// api.get("resource") always goes to api.trusted.com, not arbitrary URLs
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
- **Validate URL before setting location.href** (typescript):
```typescript
function safeNavigate(url: string) {
  const parsed = new URL(url, window.location.origin);
  // Block javascript: and data: schemes
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsafe redirect target");
  }
  // Only allow same-origin redirects from user input
  if (parsed.origin !== window.location.origin) {
    throw new Error("Cross-origin redirect not allowed");
  }
  window.location.href = parsed.href;
}
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
- **Validate before location.replace** (typescript):
```typescript
function safeReplace(url: string) {
  const parsed = new URL(url, window.location.origin);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsafe redirect");
  }
  window.location.replace(parsed.href);
}
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
- **Validate before redirecting top frame** (javascript):
```javascript
// BAD: top.location.href = userInput; // redirects parent frame to arbitrary URL

// GOOD: validate and restrict
function frameRedirect(url) {
  const parsed = new URL(url, top.location.origin);
  if (parsed.origin !== top.location.origin) throw new Error("Cross-origin blocked");
  top.location.href = parsed.href;
}
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
- **Protect deep merge against prototype pollution** (typescript):
```typescript
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>) {
  const blocked = new Set(["__proto__", "constructor", "prototype"]);
  for (const [k, v] of Object.entries(source)) {
    if (blocked.has(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      target[k] = deepMerge((target[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
    } else {
      target[k] = v;
    }
  }
  return target;
}
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
- **Use lodash.mergeWith to block prototype keys** (typescript):
```typescript
import mergeWith from "lodash/mergeWith";

const BLOCKED = new Set(["__proto__", "constructor", "prototype"]);

function safeMerge<T>(a: T, b: Record<string, unknown>): T {
  return mergeWith(a, b, (objVal: unknown, srcVal: unknown, key: string) => {
    if (BLOCKED.has(key)) return objVal; // keep existing, ignore source
  });
}
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
- **Strip prototype keys before Object.assign** (typescript):
```typescript
function safeAssign<T>(target: T, ...sources: Record<string, unknown>[]): T {
  const blocked = new Set(["__proto__", "constructor", "prototype"]);
  for (const source of sources) {
    for (const [k, v] of Object.entries(source)) {
      if (!blocked.has(k)) (target as Record<string, unknown>)[k] = v;
    }
  }
  return target;
}
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
- **Freeze Object.prototype in tests to catch pollution** (typescript):
```typescript
// In tests, freeze Object.prototype to catch pollution
beforeEach(() => Object.freeze(Object.prototype));
afterEach(() => Object.isFrozen(Object.prototype) && /* nothing to restore */ null);

// In production code: use Object.create(null) for user-data maps
const userMap = Object.create(null); // no prototype chain
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
- **Always pass a secret/key to jwt.verify()** (typescript):
```typescript
import jwt from "jsonwebtoken";

// BAD: verifying without a secret allows alg:none attacks
// jwt.verify(token, null);

// GOOD: always supply the secret and restrict algorithms
const payload = jwt.verify(token, process.env.JWT_SECRET!, {
  algorithms: ["HS256"],   // reject RS256, none, etc.
}) as { sub: string; role: string };
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
- **Use a strong random secret for HS256** (bash):
```bash
# Generate a strong HS256 secret (256 bits = 32 bytes)
openssl rand -base64 32
# Store in environment: JWT_SECRET="the-output-above"
# Never use short or predictable secrets like "secret", "password", or < 32 chars
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
- **Reject alg:none in JWT verification** (typescript):
```typescript
import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

// jose library rejects alg:none by default when you pass a key
const { payload } = await jwtVerify(token, secret, {
  algorithms: ["HS256"], // explicit allowlist: rejects "none", "RS256", etc.
});
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
- **Add Trusted Types to CSP** (typescript):
```typescript
// Add require-trusted-types-for to your CSP
// next.config.mjs:
headers: [{ key: "Content-Security-Policy",
  value: "default-src 'self'; require-trusted-types-for 'script';" }]

// Then define a Trusted Types policy:
const policy = trustedTypes.createPolicy("default", {
  createHTML: (s) => DOMPurify.sanitize(s),
  createScript: (s) => { throw new Error("Scripts must be static"); },
  createScriptURL: (url) => {
    if (new URL(url).origin !== location.origin) throw new Error("Cross-origin script");
    return url;
  },
});
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
- **Add Trusted Types directive to CSP** (javascript):
```javascript
// CSP should include:
// Content-Security-Policy: ...; require-trusted-types-for 'script'; trusted-types default
// This prevents direct string assignment to innerHTML and other XSS sinks
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
- **Store auth tokens in HttpOnly cookies, not localStorage** (typescript):
```typescript
// BAD: tokens in localStorage are XSS-accessible
// localStorage.setItem("access_token", token);

// GOOD: server sets HttpOnly cookie on login
res.setHeader("Set-Cookie",
  `access_token=<value>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`
);
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
- **Never store passwords in sessionStorage** (typescript):
```typescript
// NEVER store passwords in sessionStorage: they survive page reloads
// and are accessible to any same-origin XSS
// sessionStorage.setItem("password", password);

// Submit the password directly to the server:
const res = await fetch("/api/login", {
  method: "POST",
  body: JSON.stringify({ email, password }),
  headers: { "Content-Type": "application/json" },
});
// Server returns a session cookie: password never stored client-side
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
- **SameSite=None requires Secure flag** (typescript):
```typescript
// SameSite=None without Secure is rejected by modern browsers
// and sends cookies over HTTP (insecure)

// BAD:
// Set-Cookie: session=abc; SameSite=None

// GOOD (if cross-site cookie is required):
res.setHeader("Set-Cookie",
  `session=<value>; SameSite=None; Secure; HttpOnly; Path=/`
);
// Only use SameSite=None for legitimate cross-site scenarios (e.g., embedded widgets)
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
- **Always set Secure flag on cookies** (typescript):
```typescript
// Without Secure, cookies are sent over HTTP connections
// making them vulnerable to interception on the network

res.setHeader("Set-Cookie",
  `session=<value>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`
);
// In development (HTTP), you may need to omit Secure, use NODE_ENV check:
const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
res.setHeader("Set-Cookie", `session=<value>; HttpOnly<value>; SameSite=Strict; Path=/`);
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
- **Add rel="noopener noreferrer" to target=_blank links** (javascript):
```javascript
// BAD: window.opener is accessible from the new tab
window.open(url, "_blank");

// GOOD: noopener prevents opener access
window.open(url, "_blank", "noopener,noreferrer");

// In HTML:
// <a href="..." target="_blank" rel="noopener noreferrer">Link</a>
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
- **Add X-Frame-Options or CSP frame-ancestors** (typescript):
```typescript
// Prevent your site from being embedded in iframes
res.setHeader("X-Frame-Options", "DENY");
// Or use CSP frame-ancestors (more flexible):
res.setHeader("Content-Security-Policy", "frame-ancestors 'none';");
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
- **Use crypto.timingSafeEqual for token comparison** (typescript):
```typescript
import { timingSafeEqual, createHmac } from "crypto";

function verifyToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Lengths must match before timing-safe comparison
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
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
- **Use timingSafeEqual for HMAC verification** (typescript):
```typescript
import { createHmac, timingSafeEqual } from "crypto";

function verifyHmac(payload: string, receivedSig: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(receivedSig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b); // not ===
}
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
- **Use IAM roles instead of hard-coded credentials** (typescript):
```typescript
import { S3Client } from "@aws-sdk/client-s3";

// BAD: hard-coded credentials in source
// const s3 = new S3Client({ credentials: { accessKeyId: "AKIA...", secretAccessKey: "..." } });

// GOOD: SDK reads credentials from environment / IAM role automatically
const s3 = new S3Client({ region: "us-east-1" });
// On EC2/Lambda/ECS: attach an IAM role, no credentials needed in code
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
- **Set explicit ACL or bucket policy for S3 uploads** (typescript):
```typescript
import { PutObjectCommand } from "@aws-sdk/client-s3";

await s3.send(new PutObjectCommand({
  Bucket: process.env.S3_BUCKET!,
  Key: objectKey,
  Body: fileBuffer,
  // Explicitly deny public access, never omit ACL on user-uploaded files
  ACL: "private",
  ContentType: mimeType,
}));
// Also enable "Block Public Access" at the bucket and account level
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
- **Upload Azure blobs with private access only** (typescript):
```typescript
import { BlobServiceClient } from "@azure/storage-blob";

const client = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING!
);
const container = client.getContainerClient("uploads");
// Container must be created with private access
await container.createIfNotExists({ access: undefined }); // no public access
const blob = container.getBlockBlobClient(blobName);
await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimeType } });
```

### `insecure-crypto` [code / high / body-pattern]
**Weak or broken cryptography detected**

The code uses deprecated or broken cryptographic algorithms (MD5, SHA1, DES, RC4) that are no longer considered secure.

**Risk:** MD5 and SHA1 are broken for security purposes. Attackers can forge hashes via collision attacks. DES/RC4 ciphers have been cryptanalyzed and can be brute-forced. Using them for passwords, signatures, or encryption provides false security and actual exposure.

**Why it matters:** Deprecated algorithms like MD5 and SHA1 are vulnerable to collision attacks. Use SHA-256 or higher for hashing, AES-256-GCM for encryption, and bcrypt/argon2 for password hashing.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Replace MD5/SHA1 with SHA-256 or SHA-3 for integrity checks
- Replace DES/3DES with AES-256-GCM
- Replace RC4 with AES-GCM for stream encryption
- Use bcrypt, argon2, or scrypt for password hashing
- **Use modern algorithms instead of MD5/SHA1/DES** (typescript):
```typescript
import { createHash, randomBytes, createHmac } from "crypto";

// BAD: MD5 / SHA1 are broken for security use
// createHash("md5").update(data).digest("hex");

// GOOD: SHA-256 for hashing
const hash = createHash("sha256").update(data).digest("hex");

// For passwords: use bcrypt / argon2
import bcrypt from "bcryptjs";
const hash2 = await bcrypt.hash(password, 12);

// For symmetric encryption: AES-256-GCM
import { createCipheriv } from "crypto";
const key = randomBytes(32);
const iv  = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
```

### `sql-injection-patterns` [code / critical / body-pattern]
**SQL injection pattern in source**

String concatenation or template literals used to build SQL queries with what appears to be user-controlled input.

**Risk:** SQL injection allows an attacker to read arbitrary data from the database, bypass authentication, modify or delete records, and in some configurations execute OS-level commands, a complete database compromise.

**Why it matters:** Directly concatenating user input into SQL queries allows injection of arbitrary SQL syntax. Always use parameterized queries or prepared statements.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Replace string concatenation with parameterized queries ($1, $2 placeholders)
- Use an ORM (Drizzle, Prisma, Sequelize) with its query builders
- Apply a Web Application Firewall (WAF) as a defense-in-depth layer
- **Use parameterized queries for all DB operations** (typescript):
```typescript
// BAD: string interpolation into SQL
const q = `SELECT * FROM users WHERE id = <value>`;

// GOOD: parameterized query
const result = await pool.query(
  "SELECT * FROM users WHERE id = $1 AND active = $2",
  [id, true]
);

// With an ORM:
import { eq } from "drizzle-orm";
const user = await db.select().from(users).where(eq(users.id, id));
```

### `ssrf-vulnerability` [code / high / body-pattern]
**Server-Side Request Forgery (SSRF) indicators**

Code fetches URLs that may be derived from user-controlled input, potentially enabling SSRF attacks.

**Risk:** SSRF allows an attacker to make your server fetch internal URLs: cloud metadata endpoints (169.254.169.254), internal databases, or admin interfaces not exposed to the internet, potentially leaking credentials or enabling further privilege escalation.

**Why it matters:** When user-supplied URLs are passed directly to server-side HTTP clients, attackers can redirect requests to internal infrastructure.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Allowlist permitted hosts and validate the URL before fetching
- Block RFC 1918 and RFC 5735 private IP ranges
- Use a dedicated egress proxy that enforces an allowlist
- **Allowlist outbound hosts + block private IPs** (typescript):
```typescript
const ALLOWED = new Set(["api.github.com", "api.stripe.com"]);

async function safeFetch(url: string) {
  const { hostname, protocol } = new URL(url);
  if (protocol !== "https:") throw new Error("HTTPS only");
  if (!ALLOWED.has(hostname)) throw new Error("Host blocked");
  return fetch(url, { signal: AbortSignal.timeout(5_000) });
}
```

### `xml-external-entity` [code / high / body-pattern]
**XML external entity (XXE) risk**

XML is being parsed without explicit external entity restrictions.

**Risk:** An XXE attack using a crafted XML payload can read server-side files, make SSRF requests, or cause denial-of-service via recursive entity expansion (billion laughs attack).

**Why it matters:** XML parsers that allow SYSTEM/PUBLIC entities can be abused to load external content at the server level.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Set processEntities: false in fast-xml-parser
- Disable DOCTYPE declarations at the parser level
- Validate XML against a strict schema before parsing
- **Harden XML parsing against XXE** (typescript):
```typescript
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  processEntities: false,
  ignoreDeclaration: true,
});
// Never pass user-controlled XML to parsers with external entity support enabled
```

### `ldap-injection-indicators` [code / high / body-pattern]
**LDAP injection indicators**

LDAP filter strings may be constructed from user input without proper escaping.

**Risk:** LDAP injection allows an attacker to modify the LDAP filter logic, bypassing authentication (e.g., making any password valid), enumerating directory contents, and accessing attributes of arbitrary users in the directory.

**Why it matters:** LDAP filter special characters (* \ ( ) NUL) must be escaped before including user input in filters.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Escape all LDAP filter special characters from user input
- Use an LDAP library with built-in parameterization
- Validate user input format before using in any LDAP operation
- **Escape LDAP filter special characters** (typescript):
```typescript
function escapeLdap(str: string): string {
  return str
    .replace(/\\/g, "\\5c")
    .replace(/\*/g, "\\2a")
    .replace(/\(/g, "\\28")
    .replace(/\)/g, "\\29")
    .replace(/\0/g, "\\00");
}

const filter = `(uid=<value>)`;
// Always escape user input before including in LDAP filters
```

### `hardcoded-credentials` [code / critical / body-pattern]
**Hard-coded credentials in source**

Username/password or key/secret pairs are hard-coded directly in the source code.

**Risk:** Hard-coded credentials are trivially extracted from the source file by anyone with read access, including other developers, CI systems, and anyone who decompiles the bundle. They also cannot be rotated without a code change and redeployment.

**Why it matters:** Credentials in source code become part of version history and distribution artifacts.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Move credentials to environment variables
- Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, Doppler)
- Rotate any credentials that have appeared in source code immediately
- **Move credentials to environment variables** (typescript):
```typescript
// BAD: hard-coded credentials in source
// const DB_PASS = "super_secret";

// GOOD: read from environment
const dbPass = process.env.DB_PASSWORD;
if (!dbPass) throw new Error("DB_PASSWORD is required");

// In production: use a secrets manager (AWS Secrets Manager, Vault)
// Never commit .env files, add to .gitignore
```

### `default-credentials` [code / high / body-pattern]
**Default credentials may be in use**

Vendor default usernames or passwords detected in configuration or source.

**Risk:** Default credentials (admin/admin, root/root, admin/password) are the first thing attackers try. They are published in vendor documentation and widely known, making any system using them trivially compromised.

**Why it matters:** Software shipped with default credentials must have them changed before first exposure to any network.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Change all default credentials immediately on installation
- Disable default admin accounts and create named service accounts
- Add credential-change verification to your deployment checklist
- **Change default credentials on first deployment** (bash):
```bash
# Change default admin credentials immediately on install
# For databases:
psql -U postgres -c "ALTER USER postgres PASSWORD 'new_strong_password';"

# For services: disable default users and create named service accounts
# Never deploy with vendor default passwords
# Use a password manager or secrets manager for all credentials
```

### `hardcoded-secrets` [code / critical / body-pattern]
**Hard-coded secret values in source**

API keys, tokens, or secret strings are embedded directly in the source code.

**Risk:** Secrets embedded in source code are committed to version history, included in build artifacts, and potentially exposed in client-side bundles, giving anyone with the code or the deployed JS file access to your third-party services, databases, and APIs.

**Why it matters:** Secrets in source are nearly impossible to fully remove once committed: use environment variables and rotate immediately.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Remove the secret from source code and git history (BFG Repo Cleaner)
- Move to environment variables or a secrets manager
- Rotate the exposed secret immediately
- **Remove secrets from source and use environment variables** (bash):
```bash
# Scan for secrets before committing
npx gitleaks detect --source . --no-git

# Or use git-secrets:
git secrets --scan

# Move secrets to environment:
# .env.local (git-ignored)
API_KEY="your-actual-key-here"

# Rotate any keys already committed to history:
# git filter-branch or BFG Repo Cleaner to remove from history
```

### `hardcoded-secrets-high-risk` [code / high / body-pattern]
**Hard-coded secret in source (elevated-risk key)**

A real server-side credential (legacy Firebase Cloud Messaging server key, HuggingFace write token, or Replicate API token) is embedded directly in the source code. Unlike the critical tier, abuse is bounded to a single third-party service rather than full account or infrastructure takeover.

**Risk:** An exposed HuggingFace or Replicate token lets anyone run inference billed to your account or push content under your identity. An exposed legacy FCM server key lets anyone send spoofed push notifications to every user of your app. Neither grants broader account or database access.

**Why it matters:** These formats are real, sensitive credentials with no legitimate client-side use, but the blast radius of a leak is narrower than an AWS or database credential, so they are rated high rather than critical.

**References:**
- https://firebase.google.com/docs/cloud-messaging/auth-server
- https://huggingface.co/docs/hub/security-tokens

**Fix:**
- Move the credential to a server-side environment variable
- Proxy the API call through your own backend instead of calling the vendor API from the client
- Rotate the exposed credential immediately
- **Move a vendor API token to a server-side proxy** (typescript):
```typescript
// BAD: token shipped to the browser
// const res = await fetch('https://api-inference.huggingface.co/...', {
//   headers: { Authorization: `Bearer <value>` }
// });

// GOOD: client calls your own route, token stays server-side
export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch('https://api-inference.huggingface.co/...', {
    headers: { Authorization: `Bearer <value>` },
    method: 'POST',
    body: JSON.stringify(body),
  });
  return Response.json(await res.json());
}
```

### `hardcoded-secrets-client-exposed` [code / medium / body-pattern]
**Hard-coded secret in source (client-exposed key)**

A Discord webhook URL, Sentry DSN, or Mapbox public token is embedded in the source. These formats are designed by their vendors to be used from client-side code and are secured through restrictions (URL allowlists, write-only scopes) rather than secrecy, so presence alone is expected, not a leak.

**Risk:** A leaked Discord webhook lets anyone post messages to the target channel (spam or impersonation). An unrestricted Sentry DSN or Mapbox token can be abused to exhaust your event or request quota. None of these expose stored data or grant account access on their own.

**Why it matters:** These are the same category of finding this codebase already scores as medium elsewhere (google-api-key-exposed, secret-google-maps-api-key): a client-exposed-by-design identifier, not a secret whose security model depends on staying hidden.

**References:**
- https://docs.sentry.io/product/sentry-basics/concepts/dsn-explainer/
- https://docs.mapbox.com/help/getting-started/access-tokens/

**Fix:**
- Restrict the credential where the vendor supports it (Mapbox URL restrictions, Sentry allowed origins)
- Rotate the Discord webhook if it is receiving unexpected traffic
- Move the credential server-side if your usage does not actually require client-side access
- **Proxy a Discord webhook through your own backend instead of exposing it client-side** (typescript):
```typescript
// Client posts to your own API, never the Discord webhook URL directly
export async function POST(req: Request) {
  const payload = await req.json();
  await fetch(process.env.DISCORD_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return Response.json({ ok: true });
}
```

### `hardcoded-secrets-low-risk` [code / low / body-pattern]
**Hard-coded secret in source (low-risk identifier)**

A Firebase Realtime Database URL is present in the source. This is a hostname, not a credential: it contains no key or token material.

**Risk:** The URL alone grants no access. The actual exposure to watch for is whether the database's security rules allow unauthenticated read/write: the hostname just confirms which project to check.

**Why it matters:** Flagged as informational-level so it is visible in a review without inflating the scan's overall severity: knowing a site uses Firebase RTDB is useful context, not evidence of a leak.

**References:**
- https://firebase.google.com/docs/rules

**Fix:**
- Review Firestore/RTDB security rules to confirm they require authentication
- Enable Firebase App Check if the database is publicly reachable
- **Firestore rules: require authentication** (javascript):
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### `postmessage-wildcard` [code / medium / body-pattern]
**postMessage with wildcard targetOrigin**

postMessage() is called with "*" as the targetOrigin, sending the message to any origin.

**Risk:** Using "*" as the targetOrigin allows any malicious page in the same browser session to receive the message, leaking tokens, authentication data, or application state to attacker-controlled frames.

**Why it matters:** When a postMessage call uses "*", any window open in the browser (including cross-origin malicious pages) can receive the message payload.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://owasp.org/www-community/attacks/SQL_Injection

**Fix:**
- Replace "*" with the exact expected target origin (e.g., "https://partner.example.com")
- Validate event.origin in the message receiver before processing
- **Always specify targetOrigin in postMessage** (typescript):
```typescript
// BAD: wildcard targetOrigin leaks data to any origin
window.parent.postMessage({ token: authToken }, "*");

// GOOD: specify exact target origin
window.parent.postMessage({ token: authToken }, "https://trusted.example.com");

// Receiver: always validate event.origin
window.addEventListener("message", (e) => {
  if (e.origin !== "https://trusted.example.com") return;
  // handle e.data safely
});
```

### `code-eval-vm-module` [code / critical / body-pattern]
**Node.js vm Module Executed With Request Data**

Node's vm module (runInNewContext, runInThisContext, runInContext, or vm.Script) is invoked with request-derived source code.

**Risk:** The vm module provides only a partial sandbox: numerous documented escapes exist, and untrusted code run through it can access the host process, read environment variables, and often achieve full remote code execution.

**Why it matters:** vm.runInNewContext and related APIs are frequently mistaken for a true sandbox because they run code in a separate V8 context, but Node's own documentation is explicit that they are not a security mechanism against malicious code.

**References:**
- https://nodejs.org/api/vm.html#vm-executing-javascript
- https://owasp.org/www-community/attacks/Code_Injection

**Fix:**
- Never pass request-derived strings to the vm module.
- If arbitrary user code execution is a real product requirement, use a properly isolated environment (a separate process with OS-level sandboxing, or a vetted third-party sandboxing service), not vm.
- Validate and reject any input path that reaches this sink.
- **Never eval request data via vm** (javascript):
```javascript
// BAD
const vm = require('vm');
vm.runInNewContext(req.body.expression);

// GOOD: use a fixed allowlist of operations instead of executing arbitrary code
const ALLOWED_OPS = { add: (a, b) => a + b, sub: (a, b) => a - b };
const fn = ALLOWED_OPS[req.body.op];
if (!fn) throw new Error('Unsupported operation');
```

### `code-eval-groovyshell` [code / critical / body-pattern]
**GroovyShell.evaluate() Called With Request Data**

A GroovyShell instance's evaluate() method is called directly with request data.

**Risk:** Groovy scripting engines execute arbitrary JVM code with the permissions of the host application; this has been the root cause of numerous real-world RCE vulnerabilities in Java applications and CMS plugin systems.

**Why it matters:** GroovyShell.evaluate() compiles and runs the given string as a full Groovy script with no sandboxing by default, equivalent in severity to eval() in JavaScript but with direct access to the JVM's class loader and reflection APIs.

**References:**
- https://owasp.org/www-community/attacks/Code_Injection

**Fix:**
- Never pass request-derived data to GroovyShell.evaluate() or any scripting-engine eval method.
- If dynamic scripting is a genuine requirement, use a properly configured SecureASTCustomizer allowlist and run under a restrictive SecurityManager or separate sandboxed process.
- Prefer a fixed set of supported operations over arbitrary script execution.
- **Avoid evaluating request-controlled Groovy** (java):
```java
// BAD
GroovyShell shell = new GroovyShell();
shell.evaluate(request.getParameter("script"));

// GOOD: dispatch to a fixed, reviewed set of operations instead
switch (request.getParameter("op")) {
  case "add": return a + b;
  default: throw new IllegalArgumentException("Unsupported operation");
}
```

### `code-eval-php-assert-string` [code / critical / body-pattern]
**PHP assert()/create_function() Code Execution Risk**

PHP's assert() is called with user-controlled input, or the deprecated create_function() (which internally uses eval()) is present.

**Risk:** In PHP versions before 8, assert() evaluates a string argument as PHP code, identical in effect to eval(); passing user input to it is a direct remote code execution vector.

**Why it matters:** assert() was historically documented as accepting either a boolean expression or a string to be eval()'d, a design PHP itself later reversed (PHP 8 removed string evaluation) precisely because of how often it was exploited. create_function() has the same underlying eval()-based implementation and was removed entirely in PHP 8.

**References:**
- https://www.php.net/manual/en/function.assert.php
- https://www.php.net/manual/en/function.create-function.php

**Fix:**
- Never pass request-derived data to assert().
- Replace create_function() with a native anonymous function or arrow function.
- Upgrade to PHP 8+, where assert() no longer evaluates string arguments as code.
- **Replace unsafe patterns** (php):
```php
// BAD
assert($_GET['check']);
$fn = create_function('$a', 'return $a + 1;');

// GOOD
if (!isSomeCondition($validatedInput)) { throw new InvalidArgumentException(); }
$fn = function ($a) { return $a + 1; };
```

### `code-deser-dotnet-binaryformatter` [code / critical / body-pattern]
**.NET BinaryFormatter Deserialization**

The .NET BinaryFormatter class is instantiated or used to deserialize data.

**Risk:** BinaryFormatter deserializes untrusted data into arbitrary .NET types with no built-in type restriction, a pattern that has produced numerous public gadget-chain RCE exploits (e.g. via ysoserial.net).

**Why it matters:** Microsoft's own documentation states BinaryFormatter is 'insecure and cannot be made secure', and the type has been marked obsolete and is being removed from .NET entirely for this exact reason.

**References:**
- https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-security-guide

**Fix:**
- Replace BinaryFormatter with a safe, schema-constrained serializer such as System.Text.Json or protobuf.
- If migration is not immediately possible, restrict BinaryFormatter to trusted, non-network-derived data only.
- Audit all deserialization entry points for the same underlying risk (NetDataContractSerializer, LosFormatter, SoapFormatter share similar issues).
- **Use a safe serializer instead** (csharp):
```csharp
// BAD
var formatter = new BinaryFormatter();
var obj = formatter.Deserialize(untrustedStream);

// GOOD
var obj = JsonSerializer.Deserialize<MyDto>(untrustedStream);
```

### `code-deser-java-objectinputstream` [code / critical / body-pattern]
**Java ObjectInputStream Deserializes Request Data**

An ObjectInputStream is constructed directly from request data and readObject() is called on it.

**Risk:** Java deserialization of untrusted data via readObject() is one of the most exploited server-side vulnerability classes in the JVM ecosystem, with public gadget chains (Commons Collections, and others) enabling remote code execution against many common libraries already on the classpath.

**Why it matters:** readObject() reconstructs arbitrary Java objects from the byte stream, invoking their readObject()/readResolve() methods along the way. If any class on the classpath has an exploitable method reachable from deserialization, an attacker-controlled stream can trigger it without needing any other vulnerability.

**References:**
- https://owasp.org/www-community/vulnerabilities/Deserialization_of_untrusted_data

**Fix:**
- Avoid Java native serialization for any data that crosses a trust boundary; use JSON or protobuf instead.
- If native deserialization is unavoidable, use a strict class allowlist via ObjectInputFilter (Java 9+) or a validating ObjectInputStream subclass.
- Keep dependencies patched and remove unused libraries that could contribute gadget chains.
- **Restrict deserialization with ObjectInputFilter** (java):
```java
ObjectInputStream ois = new ObjectInputStream(request.getInputStream());
ois.setObjectInputFilter(ObjectInputFilter.Config.createFilter("com.example.dto.*;!*"));
Object obj = ois.readObject();
```

### `code-deser-ruby-marshal-load` [code / critical / body-pattern]
**Ruby Marshal.load() Called With Request Data**

Ruby's Marshal.load() is called directly with params/request data.

**Risk:** Marshal.load can instantiate arbitrary Ruby objects and invoke their initializer/finalizer methods during reconstruction, a documented gadget-chain RCE vector similar to Python pickle and Java native deserialization.

**Why it matters:** Marshal is Ruby's native, non-schema-constrained object serialization format. Ruby's own documentation warns against calling Marshal.load on data from an untrusted source for exactly this reason.

**References:**
- https://docs.ruby-lang.org/en/master/Marshal.html
- https://owasp.org/www-community/vulnerabilities/Deserialization_of_untrusted_data

**Fix:**
- Never call Marshal.load on request-derived or otherwise untrusted data.
- Use JSON (JSON.parse) or another schema-constrained format for any data crossing a trust boundary.
- If Marshal must be used for trusted internal caching, ensure the storage backend cannot be written to by external input.
- **Use JSON instead of Marshal for untrusted data** (ruby):
```ruby
# BAD
data = Marshal.load(params[:payload])

# GOOD
data = JSON.parse(params[:payload])
```

---

## Category: configuration (24 checks)

### `ratelimit-policy-missing` [configuration / medium / combined]
**No Rate-Limit Policy Detected**

No rate-limiting headers (X-RateLimit-Limit, RateLimit-Limit, Retry-After) or a 429 response were observed. Without rate-limiting, brute-force, credential stuffing, and scraping attacks can run unchecked.

**Risk:** Attackers can brute-force credentials, scrape all content, or exhaust backend resources with no request budget enforced. APIs without rate-limiting are a primary target for enumeration and DoS.

**Why it matters:** Rate-limiting controls how many requests a client can make within a time window. Without it, malicious actors can submit thousands of authentication attempts, harvest user data, or trigger expensive server operations at will.

**References:**
- https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429

**Fix:**
- Add rate-limiting middleware (e.g., upstash/ratelimit, express-rate-limit, nginx limit_req).
- Return 429 Too Many Requests with a Retry-After header when the limit is exceeded.
- Return X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers on every response.
- **Next.js API route (upstash/ratelimit)** (typescript):
```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, '1 m'),
});

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? '127.0.0.1';
  const { success, limit, remaining, reset } = await ratelimit.limit(ip);

  if (!success) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
      },
    });
  }

  return Response.json({ ok: true });
}
```
- **Nginx (limit_req)** (nginx):
```nginx
http {
  limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;

  server {
    location /api/ {
      limit_req zone=api burst=10 nodelay;
      limit_req_status 429;
    }
  }
}
```

### `vary-header-cookie` [configuration / medium / header]
**Vary: Cookie Present on Cacheable Response**

The Vary: Cookie header is set on a response that should be cacheable. This causes shared caches (CDN, reverse proxy) to store a separate copy per distinct Cookie value, effectively defeating caching and potentially leaking personalized content between users.

**Risk:** If a CDN or shared cache does not correctly handle Vary: Cookie, personalized responses (with session data, user preferences, or PII) may be served to other users from cache, causing data leakage.

**Why it matters:** Vary: Cookie tells caches that the response content varies based on the Cookie header value. While correct for dynamic pages, it defeats caching entirely for static assets and may cause some buggy intermediary caches to serve the wrong user's content to another user.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Vary
- https://datatracker.ietf.org/doc/html/rfc7234

**Fix:**
- Remove Vary: Cookie from static assets (JS, CSS, images) that do not depend on cookie values.
- For dynamic content that varies by cookie, prefer cache-busting via URL parameters or use Cache-Control: private.
- Audit CDN and proxy cache behavior: ensure Vary: Cookie is not present on public/shared resources.
- **Nginx: remove Vary: Cookie from static** (nginx):
```nginx
location ~* \.(js|css|png|jpg|woff2)$ {
  add_header Cache-Control "public, max-age=31536000, immutable";
  # Do NOT set Vary: Cookie for static assets
}
```
- **Next.js headers config** (javascript):
```javascript
// In next.config.mjs: strip Vary: Cookie for API responses that should be public
export default {
  async headers() {
    return [{
      source: '/api/public/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, s-maxage=60' },
        // Do not add Vary: Cookie here
      ],
    }];
  },
};
```

### `cookie-too-large` [configuration / low / header]
**Set-Cookie Header Exceeds 4 KB**

A Set-Cookie header is larger than 4 KB. Browsers silently drop cookies that exceed this limit, causing unpredictable session behavior.

**Risk:** When the browser drops an oversized cookie, the user loses their session and may be redirected to login unexpectedly. If the cookie carries signed state, its loss may bypass security checks that rely on the cookie being present.

**Why it matters:** Browsers enforce a 4 KB limit on individual cookie size. Exceeding this limit causes the browser to silently discard the cookie. If the session or authentication state lives in the cookie, the user appears logged out even though the server issued a valid session.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265#section-5.3

**Fix:**
- Move large payloads (e.g., user profile data, permissions) to server-side session storage.
- Store only the session ID in the cookie; look up the rest server-side on every request.
- Use a signed, encrypted session token (JWE) only for data that must survive across server restarts.
- **Server-side session (Node.js/Express)** (javascript):
```javascript
import session from 'express-session';
import RedisStore from 'connect-redis';

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  name: '__Host-sid',
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));
```

### `vary-header-missing` [configuration / low / header]
**Vary Header Missing on Compressed Responses**

A compressed response (Content-Encoding: gzip/br) is missing the Vary: Accept-Encoding header. Without it, a shared cache can serve a compressed response to a client that does not support compression.

**Risk:** A caching intermediary that stores the compressed response without Vary: Accept-Encoding may serve garbled content to clients that do not support gzip/brotli, causing pages to display as binary garbage or fail to render entirely.

**Why it matters:** When a server returns content-encoded responses (gzip, brotli), it must include Vary: Accept-Encoding. This tells caches to store separate copies per Accept-Encoding value and serve the right one to each client. Without this, compressed responses can be served to clients that declared they cannot decompress them.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Vary
- https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.4

**Fix:**
- Add Vary: Accept-Encoding to every response that uses Content-Encoding: gzip or br.
- Most frameworks (Express, nginx with gzip_vary on) handle this automatically.
- **Nginx** (nginx):
```nginx
gzip on;
gzip_vary on;  # automatically adds Vary: Accept-Encoding
```
- **Next.js (via headers config)** (javascript):
```javascript
// Next.js adds Vary: Accept-Encoding automatically for compressed responses.
// Verify it is present:
// curl -I -H 'Accept-Encoding: gzip' https://example.com/
```

### `content-disposition-inline` [configuration / info / header]
**Downloadable Content Served as inline**

PDFs, Office documents, or other downloadable files are served with Content-Disposition: inline, causing them to render in the browser rather than download. Inline rendering exposes them to iframe-based data exfiltration.

**Risk:** An attacker who can embed your site in an iframe can extract text content from inline-rendered PDFs or documents via scroll-to-text-fragment attacks or timing side-channels.

**Why it matters:** Content-Disposition: inline tells the browser to render the file in the viewport. For sensitive documents, Content-Disposition: attachment forces a download instead, preventing browser rendering and reducing iframe-based exfiltration risk.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition
- https://datatracker.ietf.org/doc/html/rfc6266

**Fix:**
- Set Content-Disposition: attachment; filename="document.pdf" for sensitive downloads.
- Set Content-Disposition: inline only for content intended to render in the browser (e.g., images served in img tags).
- **Next.js API route** (typescript):
```typescript
return new Response(pdfBuffer, {
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="report.pdf"',
  },
});
```

### `x-xss-protection-block` [configuration / info / header]
**X-XSS-Protection Header Is Deprecated**

X-XSS-Protection is set to '1; mode=block'. The browser XSS auditor this header controlled has been removed from Chrome/Edge and was never supported in Firefox. The header is obsolete.

**Risk:** The header has no protective effect in modern browsers. Including it adds noise and may give false confidence that XSS is mitigated when it is not.

**Why it matters:** The X-XSS-Protection header was introduced for IE8's XSS filter and Chrome's XSS auditor. Both have been removed (Chrome 78+, Edge). The header is ignored by Firefox, Safari (post-Mojave), and all modern browsers. CSP is the correct replacement for XSS mitigation.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-XSS-Protection
- https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

**Fix:**
- Remove X-XSS-Protection from all response headers.
- Implement Content-Security-Policy with a restrictive script-src policy instead.
- **Next.js (next.config.mjs)** (javascript):
```javascript
export default {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        // Remove X-XSS-Protection: it is obsolete
        // Use CSP instead:
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
      ],
    }];
  },
};
```
- **Nginx: remove X-XSS-Protection** (nginx):
```nginx
# Remove the obsolete header
proxy_hide_header X-XSS-Protection;
# Add CSP instead:
add_header Content-Security-Policy "default-src 'self'; script-src 'self'" always;
```

### `server-timing-cache-timings` [configuration / low / header-value]
**Server-Timing Exposes Cache Timings**

Server-Timing values such as cache;dur=12 or edge;dur=4 expose internal cache hit/miss timing to the client and to any cross-origin page with a Timing-Allow-Origin grant.

**Risk:** Cache timing data reveals whether a URL is in the cache, which can be used to infer which users have visited a page (cache probing attack) and to fingerprint backend architecture (Varnish, Redis, CDN HIT/MISS patterns).

**Why it matters:** Server-Timing carries per-request performance metrics. Cache duration entries (cache;dur=..., hit;dur=0, miss;dur=200) reveal the caching topology. An attacker with access to timing data can infer user browsing patterns by checking whether a URL is cached.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing
- https://owasp.org/www-project-secure-headers/

**Fix:**
- Strip Server-Timing at the edge for public responses.
- If you need Server-Timing for monitoring, gate it behind Timing-Allow-Origin with a specific trusted origin, not '*'.
- In Nginx: proxy_hide_header Server-Timing;
- **Nginx: strip Server-Timing** (nginx):
```nginx
proxy_hide_header Server-Timing;
proxy_hide_header Timing-Allow-Origin;
```

### `vary-cookie-on-static-resource` [configuration / low / combined]
**Vary: Cookie on Static Resource**

A static asset (image, JS, CSS) is served with Vary: Cookie. This forces shared caches to store a separate copy for each unique cookie value, defeating caching entirely for that asset.

**Risk:** All users fetch the same static file on every request without benefiting from CDN or browser caching, causing unnecessary origin load and slow page loads at scale.

**Why it matters:** Vary: Cookie instructs caches to key stored copies by Cookie header value. For static assets that do not change per user (CSS, JS, images), this is always wrong: it prevents caching and dramatically increases origin bandwidth usage.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Vary
- https://datatracker.ietf.org/doc/html/rfc7234#section-4.1

**Fix:**
- Remove Vary: Cookie from static asset responses.
- Configure the CDN or web server to strip Vary: Cookie for assets at /static/, /_next/static/, /public/ paths.
- **Nginx: static asset cache config** (nginx):
```nginx
location ~* \.(js|css|png|jpg|webp|woff2|ico)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
  # No Vary: Cookie here
}
```

### `vary-origin-missing-cors` [configuration / medium / combined]
**CORS Endpoint Missing Vary: Origin**

An endpoint returns a dynamic Access-Control-Allow-Origin header (reflecting the request's Origin) without including Vary: Origin. Caches that store this response may serve one origin's response to a different origin.

**Risk:** A shared cache that stores the response for origin A (with Access-Control-Allow-Origin: https://a.example.com) without a Vary: Origin instruction may then serve that cached response to origin B. Origin B's browser reads the ACAO header and may erroneously believe it has cross-origin access.

**Why it matters:** When a server reflects the request's Origin value in Access-Control-Allow-Origin, caches need Vary: Origin to know they must store separate copies per Origin. Without it, one origin's allowed-response may be returned to a different origin, bypassing the CORS allowlist.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Vary
- https://fetch.spec.whatwg.org/#cors-protocol-and-http-caches

**Fix:**
- Add Vary: Origin to every response that dynamically sets Access-Control-Allow-Origin based on the request's Origin.
- Alternatively, use a fixed ACAO value (not reflected) or set Access-Control-Allow-Origin: * for fully public endpoints.
- **Node.js (express/cors)** (javascript):
```javascript
import cors from 'cors';

app.use(cors({
  origin: ['https://app.example.com', 'https://admin.example.com'],
  credentials: true,
}));
// express-cors automatically adds Vary: Origin when using an allowlist
```
- **Nginx manual CORS** (nginx):
```nginx
if ($http_origin ~* 'https://(app|admin)\.example\.com') {
  add_header Access-Control-Allow-Origin $http_origin;
  add_header Vary Origin;  # Required
}
```

### `x-amz-cf-id` [configuration / info / header-value]
**X-Amz-Cf-Id CloudFront Request ID Exposed**

The X-Amz-Cf-Id header exposes an AWS CloudFront request identifier on every response, confirming that CloudFront is in use and leaking request correlation IDs.

**Risk:** Reveals that the site uses AWS CloudFront, which aids attackers in targeting CloudFront-specific misconfigurations (cache poisoning, path-based routing bypass, S3 origin disclosure).

**Why it matters:** X-Amz-Cf-Id is added by CloudFront to every response for request tracing. While useful for debugging, it leaks CDN infrastructure details to attackers.

**References:**
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-response-headers.html

**Fix:**
- Strip X-Amz-Cf-Id using a CloudFront Response Headers Policy.
- Or use a Lambda@Edge function to delete the header before sending to the client.
- **CloudFront Response Headers Policy (Terraform)** (hcl):
```hcl
resource "aws_cloudfront_response_headers_policy" "security" {
  name = "strip-internal-headers"
  remove_headers_config {
    items {
      header = "X-Amz-Cf-Id"
    }
  }
}
```

### `x-vercel-cache` [configuration / info / header-value]
**X-Vercel-Cache Reveals Edge Cache State**

Vercel's X-Vercel-Cache header exposes HIT/MISS/BYPASS/PRERENDER status on every response, confirming Vercel infrastructure usage.

**Risk:** Confirms Vercel as the hosting platform and reveals cache behavior, which aids attackers targeting Vercel-specific cache poisoning or static file serving bugs.

**Why it matters:** X-Vercel-Cache is set by Vercel's edge network to indicate how a response was served. In production, this header leaks infrastructure details without providing value to end users.

**References:**
- https://vercel.com/docs/edge-network/headers

**Fix:**
- Add a rewrite rule or middleware to strip X-Vercel-Cache before the response reaches the client.
- Set Cache-Control: private on sensitive endpoints to force BYPASS, then strip the header.
- **Next.js middleware (strip header)** (typescript):
```typescript
// middleware.ts
import { NextResponse } from 'next/server';

export function middleware(req) {
  const res = NextResponse.next();
  res.headers.delete('x-vercel-cache');
  return res;
}
```

### `x-nextjs-cache` [configuration / info / header-value]
**X-Nextjs-Cache Reveals Next.js ISR Cache State**

Next.js sets X-Nextjs-Cache: HIT | MISS | STALE | BYPASS to indicate ISR/SSG cache state. This leaks framework architecture details to any client.

**Risk:** Confirms that the application uses Next.js and reveals ISR/SSG cache configuration, helping attackers target Next.js-specific vulnerabilities (e.g., SSRF via getStaticProps, path traversal in ISR routes).

**Why it matters:** X-Nextjs-Cache is a Next.js-specific response header that was added for debugging ISR behavior. It has no user-facing benefit and should be removed in production.

**References:**
- https://nextjs.org/docs/app/building-your-application/caching
- https://owasp.org/www-project-secure-headers/

**Fix:**
- Strip X-Nextjs-Cache in next.config.js headers config or via middleware.
- Use an env guard to only emit it in development.
- **Next.js middleware (strip header)** (typescript):
```typescript
// middleware.ts
import { NextResponse } from 'next/server';

export function middleware(req) {
  const res = NextResponse.next();
  res.headers.delete('x-nextjs-cache');
  return res;
}
```

### `x-netlify-cache` [configuration / info / header-value]
**X-Netlify-Cache Exposes CDN Cache State**

Netlify's X-Netlify-Cache header exposes HIT/MISS/PASS/REVALIDATE cache status on responses, confirming Netlify infrastructure usage.

**Risk:** Confirms Netlify as the hosting platform, helping attackers target Netlify-specific misconfigurations (redirect rules, identity misconfiguration, function endpoint enumeration).

**Why it matters:** X-Netlify-Cache is added by Netlify's CDN layer for debugging purposes. In production, it provides no user value and leaks CDN infrastructure identity.

**References:**
- https://docs.netlify.com/routing/headers/

**Fix:**
- Add a custom response header rule in netlify.toml or the Netlify UI to strip X-Netlify-Cache.
- Use a Netlify Edge Function to delete the header.
- **netlify.toml** (toml):
```toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Netlify-Cache = ""
    # Note: Netlify does not support header deletion via toml; use an edge function instead
```

### `x-cache-hits` [configuration / info / header-value]
**X-Cache-Hits Exposes Cache Hit Count**

Some CDNs (Cloudflare, Fastly) include X-Cache-Hits to indicate how many times an asset was served from cache. This leaks traffic patterns and caching topology.

**Risk:** X-Cache-Hits lets attackers count how many times a resource has been fetched, revealing relative popularity of resources and potentially enabling cache-timing attacks to infer user activity.

**Why it matters:** X-Cache-Hits is a CDN diagnostic header that counts cache hits per resource per edge node. It has no value for end users and leaks CDN behavior and request popularity data.

**References:**
- https://developer.fastly.com/reference/vcl/
- https://owasp.org/www-project-secure-headers/

**Fix:**
- Strip X-Cache-Hits using a CDN response header transform rule.
- In Cloudflare: use Transform Rules to remove the header. In Fastly: use VCL to unset resp.http.X-Cache-Hits.
- **Fastly VCL** (vcl):
```vcl
sub vcl_deliver {
  unset resp.http.X-Cache-Hits;
  unset resp.http.X-Cache;
  return(deliver);
}
```

### `vary-header-missing-user-agent` [configuration / info / header]
**Vary Header Missing User-Agent on UA-Dependent Responses**

A response appears to vary by User-Agent (e.g., serving different HTML to mobile vs. desktop) but does not include Vary: User-Agent. Caches may serve the wrong variant to the wrong device.

**Risk:** A shared cache may serve a desktop HTML response to a mobile client (or vice versa), causing layout breakage and potentially exposing functionality not intended for that user-agent.

**Why it matters:** When a server returns different response content based on the User-Agent (adaptive serving for mobile/desktop), it must include Vary: User-Agent so caches store separate copies per user-agent group. Without it, the first visitor's device variant is cached and served to all subsequent visitors.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Vary
- https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.4

**Fix:**
- Add Vary: User-Agent to responses that return different HTML or assets based on the user-agent.
- Prefer client-side responsive design (CSS media queries) to avoid server-side UA detection entirely.
- If adaptive serving is required, use a CDN with UA grouping/normalization support.
- **Nginx** (nginx):
```nginx
# If you serve different content per UA group:
add_header Vary "User-Agent" always;
```
- **Prefer responsive CSS over UA detection** (css):
```css
/* Use media queries instead of server-side UA detection */
@media (max-width: 768px) {
  .desktop-only { display: none; }
}
```

### `server-timing-allow-origin-public` [configuration / low / header]
**Server-Timing Exposed Without Timing-Allow-Origin Gate**

Server-Timing is exposed publicly without a Timing-Allow-Origin restriction, allowing any cross-origin page to read performance data.

**Risk:** Cross-origin attackers can read precise timing data and fingerprint the backend stack, infer database query counts, and mount cache-probing attacks to detect which pages a user has visited.

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
- **Restrict to trusted origin** (http):
```http
Timing-Allow-Origin: https://monitoring.internal.example.com
```

### `debug-via-cookie` [configuration / medium / header]
**Debug Mode Toggled via Cookie**

A cookie named debug=true (or similar) was detected that enables debug behavior in the application. Debug cookies are an easy way for an attacker to trigger verbose error output, disable security checks, or access debug endpoints.

**Risk:** An attacker who sets debug=true in their browser can trigger verbose error pages containing stack traces, SQL queries, and internal configuration. This can expose credentials, architecture details, and exploitable code paths.

**Why it matters:** Using a cookie to toggle debug mode is common during development but frequently leaks to production. Unlike environment variables, cookies are client-controlled, so any user can set debug=true and receive verbose application output.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html

**Fix:**
- Remove debug cookie detection entirely from production code.
- Use environment variables (NODE_ENV=development) gated in the deployment pipeline instead.
- If developer-only debug output is needed, gate it behind an internal-IP check or a signed admin token, not a plain cookie.
- **Correct: environment-variable based debug gate** (typescript):
```typescript
// Never use cookies for debug flags
const isDebug = process.env.NODE_ENV === 'development';

if (isDebug) {
  console.error(err.stack);
} else {
  console.error('[ERROR]', err.message);
}
```

### `x-cache-status-cloudflare` [configuration / info / header]
**CF-Cache-Status Exposes Cloudflare Cache State**

The CF-Cache-Status header (HIT/MISS/DYNAMIC/BYPASS/EXPIRED/REVALIDATED) is present on responses, confirming Cloudflare usage and revealing edge cache behavior.

**Risk:** Confirms Cloudflare as the CDN provider, helping attackers target Cloudflare-specific misconfigurations. Cache state values can also assist in cache poisoning reconnaissance (identifying which paths are cached vs. dynamic).

**Why it matters:** CF-Cache-Status is added by Cloudflare to every response to indicate how it was served from the edge cache. While useful for operators debugging cache behavior, it provides no value to end users and reveals infrastructure details.

**References:**
- https://developers.cloudflare.com/cache/about/default-cache-behavior/
- https://owasp.org/www-project-secure-headers/

**Fix:**
- Add a Cloudflare Transform Rule to remove CF-Cache-Status from responses.
- In Cloudflare Workers, delete the header: response.headers.delete('cf-cache-status')
- **Cloudflare Worker (strip header)** (javascript):
```javascript
export default {
  async fetch(request, env) {
    const response = await fetch(request);
    const newResponse = new Response(response.body, response);
    newResponse.headers.delete('cf-cache-status');
    return newResponse;
  },
};
```

### `nextjs-dev-mode-exposed` [configuration / medium / body-pattern]
**Next.js Development Build Running in Production**

The response contains Next.js development-mode build artifacts ('/_next/static/development/' paths or a 'development' buildId), indicating the app is running 'next dev' instead of a production build.

**Risk:** Dev-mode Next.js ships unminified source, verbose error overlays with stack traces and source snippets, and disables several production hardening defaults, all reachable by anyone who can reach the URL.

**Why it matters:** 'next dev' is meant for local development only: it compiles on demand, keeps source maps and readable module names in the client bundle, and renders full error overlays instead of generic error pages. Running it as the production server (instead of 'next build' + 'next start') leaks internal implementation detail with every request.

**References:**
- https://nextjs.org/docs/pages/api-reference/cli/next#next-build-options

**Fix:**
- Run 'next build' followed by 'next start' (or deploy the standalone output) instead of 'next dev' in any publicly reachable environment.
- Verify NODE_ENV=production is set for the running process.
- Confirm the deployment platform is not accidentally invoking the dev script from package.json.
- **Correct production start command** (bash):
```bash
npm run build
npm run start
# package.json: "start": "next start", never "next dev" in production
```

### `dotenv-file-content-leaked` [configuration / critical / body-pattern]
**Raw .env File Content Served**

The response body looks like raw .env file content (APP_DEBUG/APP_KEY/DB_PASSWORD-style KEY=VALUE lines) rather than rendered application output.

**Risk:** A leaked .env file typically contains database credentials, API keys, encryption keys, and session secrets in plaintext, giving an attacker everything needed for full application and data compromise in a single request.

**Why it matters:** .env files are meant to be read by the server process at startup and never served over HTTP. A response that consists of literal KEY=VALUE lines means either the web root includes the .env file directly, or an endpoint is echoing its contents (e.g. a debug/info route left enabled).

**References:**
- https://owasp.org/www-project-top-ten/2017/A6_2017-Security_Misconfiguration

**Fix:**
- Remove .env from the web-accessible document root immediately and rotate every credential it contained.
- Add a web-server rule that denies access to dotfiles (Nginx: 'location ~ /\.'; Apache: '<FilesMatch "^\.">').
- Audit for any debug/info endpoint that dumps environment variables and remove it from production.
- **Nginx: deny dotfiles** (nginx):
```nginx
location ~ /\. {
  deny all;
  return 404;
}
```

### `debug-toolbar-assets-exposed` [configuration / high / body-pattern]
**Debug Toolbar Active on Public Page**

Django Debug Toolbar or Laravel Debugbar/PHP Debug Bar static assets were found referenced in a publicly reachable page.

**Risk:** These toolbars render executed SQL queries, request/session data, environment variables, and internal timing information directly in the page for anyone who loads it.

**Why it matters:** Debug toolbars are development conveniences that should never load outside a local/staging environment restricted to trusted developers. Their presence on any publicly reachable page means the application is running with debug mode enabled in production.

**References:**
- https://django-debug-toolbar.readthedocs.io/en/latest/installation.html
- https://github.com/barryvdh/laravel-debugbar#installation

**Fix:**
- Disable the debug toolbar in production configuration (DEBUG=False for Django; APP_DEBUG=false and remove the debugbar package for Laravel).
- Gate any debug tooling behind an environment check that cannot be overridden by a request parameter.
- Confirm no debug middleware is registered when the app is deployed.
- **Django settings.py** (python):
```python
DEBUG = False
INSTALLED_APPS = [a for a in INSTALLED_APPS if a != 'debug_toolbar']
```

### `apache-htaccess-content-leaked` [configuration / high / body-pattern]
**Raw Apache .htaccess File Served**

The response body looks like a raw Apache .htaccess file (RewriteEngine/Options/<Files> directives) being served as a document instead of being processed as server configuration.

**Risk:** A leaked .htaccess file discloses internal rewrite rules, access restrictions, and directory structure, giving an attacker a map of paths and protections that were meant to stay server-side.

**Why it matters:** .htaccess is meant to be read and applied by Apache itself, never delivered as response content. Its presence in a response body means either the web server isn't configured to protect dotfiles, or a misconfigured static file handler is serving it.

**References:**
- https://httpd.apache.org/docs/current/howto/htaccess.html

**Fix:**
- Add an explicit deny rule for .htaccess and other dotfiles in the web server configuration.
- Verify the file is not reachable at any path after the fix.
- Review .htaccess for any sensitive information it disclosed and rotate/adjust as needed.
- **Apache: deny access to .htaccess** (apache):
```apache
<Files ".htaccess">
  Require all denied
</Files>
```

### `spring-boot-h2-console-exposed` [configuration / critical / body-pattern]
**Spring Boot H2 Database Console Reachable**

The Spring Boot H2 in-memory/file database web console is reachable, providing direct SQL query access to the application's database.

**Risk:** The H2 console lets anyone who can reach it run arbitrary SQL against the application's database, and in many configurations can be abused to achieve remote code execution via H2's JNDI/alias functions.

**Why it matters:** Spring Boot's H2 console (spring.h2.console.enabled=true) is intended strictly for local development against an embedded database. Leaving it enabled in a deployed environment exposes a full SQL interface with no application-level access control in front of it.

**References:**
- https://www.h2database.com/html/tutorial.html#console_settings

**Fix:**
- Set spring.h2.console.enabled=false in production configuration profiles.
- If the console must be reachable for a specific environment, restrict it to localhost or an authenticated, IP-allowlisted path.
- Rotate any credentials visible in the database if the console was reachable publicly.
- **application-prod.properties** (properties):
```properties
spring.h2.console.enabled=false
```

### `phpmyadmin-login-exposed` [configuration / high / body-pattern]
**phpMyAdmin Login Page Publicly Reachable**

The phpMyAdmin login page renders directly for unauthenticated requests, with no network-level access restriction in front of it.

**Risk:** A public phpMyAdmin login page is a well-known target for credential stuffing and CVE exploitation, and any successful compromise gives an attacker direct SQL access to the database.

**Why it matters:** phpMyAdmin is an administrative tool intended for trusted operators only. Publishing its login form to the open internet, even with strong credentials, exposes it to brute-force attempts and any un-patched authentication-bypass or RCE vulnerabilities in the installed version.

**References:**
- https://docs.phpmyadmin.net/en/latest/setup.html#securing-your-phpmyadmin-installation

**Fix:**
- Restrict access to phpMyAdmin by source IP allowlist or place it behind a VPN.
- Add a second layer of authentication (HTTP Basic Auth at the web-server level) in front of the phpMyAdmin path.
- Keep the phpMyAdmin installation patched to the latest version.
- **Nginx: restrict by IP** (nginx):
```nginx
location /phpmyadmin {
  allow 203.0.113.10;
  deny all;
}
```

---

## Category: content (143 checks)

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

### `service-worker-scope` [content / low / body-pattern]
**Service Worker Registered Without a Narrow Scope**

A service worker is registered without an explicit narrow 'scope' option, so it defaults to controlling the entire origin. This is standard, expected behavior for most PWAs -- not itself a vulnerability -- but worth confirming was intentional.

**Risk:** A broadly-scoped service worker controls every page on the origin. If any single path under that scope is ever compromised (stored XSS, an uploaded file served from the same origin), the impact extends site-wide instead of being contained to one subpath.

**Why it matters:** Most sites intentionally register their service worker with the default (whole-origin) scope -- this is fine for the common case of a single-page app or PWA that wants offline support everywhere. Consider a narrower scope only if the service worker should not control unrelated subpaths (e.g. a docs subsection, a third-party-embeddable widget path).

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- If the service worker is only meant to control a specific section of the site, pass an explicit scope: navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).
- No action needed if whole-origin control is intentional, which is the common case.
- **Explicit scope for a partial-site service worker** (javascript):
```javascript
// Whole-origin (default) -- fine for most PWAs:
navigator.serviceWorker.register('/sw.js');

// Narrower scope -- only if the SW should not control the rest of the site:
navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' });
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

### `graphql-introspection` [content / low / body-pattern]
**GraphQL Introspection Query Reference Found**

The page's client-side bundle contains a reference to a GraphQL introspection query string. This is bundled by nearly every GraphQL client library (Apollo, Relay, graphql-request) for fragment matching and codegen, whether or not the server actually has introspection enabled -- this check cannot confirm the server accepts introspection queries, only that the client code mentions them.

**Risk:** No confirmed impact from this signal alone. If the GraphQL server also has introspection genuinely enabled in production, an attacker could discover the entire schema -- verify separately by sending an introspection query directly to the API endpoint.

**Why it matters:** Client-side GraphQL tooling routinely ships introspection query text as part of normal operation (schema-aware caching, fragment matching, dev tooling support). Treat this as a prompt to verify server-side introspection is disabled in production, not as confirmation that it is enabled.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Verify whether the server actually accepts an introspection query in production (send a __schema query directly to the GraphQL endpoint).
- If it does, disable introspection in production and use environment variables to conditionally enable it.
- Implement authentication before allowing introspection.
- Consider persisted queries.
- **Disable introspection** (typescript):
```typescript
const server = new ApolloServer({ typeDefs, resolvers, introspection: process.env.NODE_ENV !== 'production' });
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

### `form-action-tel-scheme` [content / low / body-pattern]
**Form action uses tel: scheme**

A <form action="tel:..."> opens the device's phone dialer instead of submitting data anywhere, which is usually a mistake for a form that has input fields.

**Risk:** Not itself an injection vector, but a tel: action silently discards any form data instead of submitting it, which can hide a broken contact/callback form from users.

**Why it matters:** A <form action="tel:..."> triggers the device dialer on submit. It's usually intended for a plain "call us" link, not an actual form with fields, and should be a <a href="tel:..."> instead.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Use a plain <a href="tel:+1..."> link for click-to-call instead of wrapping it in a <form>.
- If the form collects data, point action at a real endpoint and trigger the call separately.
- **Use a tel: link instead of a tel: form action** (html):
```html
<!-- BAD: form data is discarded, only the dialer opens -->
<!-- <form action="tel:+15551234567"><input name="note"><button>Call</button></form> -->

<!-- GOOD: click-to-call as a link -->
<a href="tel:+15551234567">Call us</a>

<!-- If you need to submit data, use a real endpoint -->
<form action="/api/callback-request" method="post">...</form>
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

### `sourcemap-reference` [content / low / body-pattern]
**JavaScript Source Map Reference Found**

A //# sourceMappingURL comment pointing to a .map file was found in the page's JavaScript, indicating a source map may be deployed alongside the production bundle.

**Risk:** If the referenced .map file is publicly fetchable, anyone can reconstruct the original, un-minified source: business logic, internal endpoint names, and code comments.

**Why it matters:** Bundlers emit a sourceMappingURL comment by default. The comment alone isn't a vulnerability -- the risk depends on whether the referenced .map file is actually served publicly.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Verify whether the referenced .map file is publicly fetchable; if not, this is informational only.
- Disable source map generation for production builds, or use a 'hidden' mode that omits the reference comment.
- If source maps are needed for error tracking, upload them to your error-tracking service and keep them off the public web server.
- **Disable source maps in production** (typescript):
```typescript
// next.config.mjs: disable source maps in production builds
export default {
  productionBrowserSourceMaps: false,
};

// Vite:
// build: { sourcemap: false }

// If source maps are needed for error tracking, upload to Sentry
// and exclude them from the public web server
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
- **Block access to AWS metadata endpoint** (typescript):
```typescript
// Ensure no user-controlled URLs can reach 169.254.169.254
const BLOCKED_HOSTS = [
  "169.254.169.254", // AWS/GCP/Azure metadata
  "fd00:ec2::254",   // IPv6 AWS metadata
  "metadata.google.internal",
];

async function safeFetch(url: string) {
  const { hostname } = new URL(url);
  if (BLOCKED_HOSTS.includes(hostname)) throw new Error("Blocked host");
  return fetch(url);
}
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
- **Block access to .git directory** (nginx):
```nginx
# Block .git and other VCS directories
location ~ /\.git {
  deny all;
  return 404;
}

# Apache:
# <DirectoryMatch "^\.git">
#   Require all denied
# </DirectoryMatch>
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
- **Block access to .env files via web server** (nginx):
```nginx
# Block .env and related files from being served
location ~* /\.env {
  deny all;
  return 404;
}

# Store .env files outside the web root
# In Next.js: .env.local is never served, but verify your web server config
# For Docker: use ARG/ENV in Dockerfile or a secrets manager, not .env files
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
- **Remove phpinfo() from production servers** (php):
```php
<?php
// NEVER leave phpinfo() in production, it exposes:
// PHP version, loaded extensions, server config, environment vars

// Remove the file entirely, or protect with authentication:
if (!defined("ADMIN_ACCESS")) {
    http_response_code(403);
    exit;
}
phpinfo();

// Also block the URL via Nginx/Apache if the file cannot be deleted
```

### `discord-webhook-exposed` [content / medium / body-pattern]
**Discord Webhook URL Exposed**

A Discord incoming webhook URL was found in page source.

**Risk:** Anyone with the webhook URL can post arbitrary messages (spam, phishing links, impersonation) to the Discord channel it's bound to.

**Why it matters:** Discord webhook URLs are bearer credentials -- possession of the URL is sufficient to post to the channel, with no further authentication.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Delete and regenerate the webhook in Discord's Integrations settings.
- Move webhook calls server-side behind your own API endpoint instead of calling Discord directly from the browser.
- **Move Discord webhook URL to a server-side environment variable** (typescript):
```typescript
// BAD: webhook URL in client-side code or source
// fetch("https://discord.com/api/webhooks/ID/TOKEN", ...)

// GOOD: proxy through your own API endpoint
// Client:
await fetch("/api/notify", { method: "POST", body: JSON.stringify({ message }) });

// Server route (uses env var, not exposed to client):
export async function POST(req: Request) {
  await fetch(process.env.DISCORD_WEBHOOK_URL!, {
    method: "POST",
    body: JSON.stringify({ content: (await req.json()).message }),
    headers: { "Content-Type": "application/json" },
  });
  return Response.json({ ok: true });
}
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
- **Restrict Swagger/OpenAPI docs to internal access** (typescript):
```typescript
// Disable public Swagger UI in production
if (process.env.NODE_ENV === "production") {
  // Do not mount Swagger UI routes
} else {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(spec));
}

// Or require authentication for /api-docs:
app.use("/api-docs", requireAdminAuth, swaggerUi.serve, swaggerUi.setup(spec));
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
- **Restrict Spring Boot Actuator endpoints** (yaml):
```yaml
# application.yml: expose only health endpoint publicly
management:
  endpoints:
    web:
      exposure:
        include: "health"
  endpoint:
    health:
      show-details: never
  server:
    port: 8081  # separate internal port, not exposed to internet
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
- **Replace inline event handlers with addEventListener** (javascript):
```javascript
<!-- BAD: inline handlers violate CSP and mix HTML with logic -->
<!-- <button onclick="handleClick()">Click</button> -->

// GOOD: addEventListener in external script
document.getElementById("submit-btn")?.addEventListener("click", handleClick);

// Enables CSP without "unsafe-inline" and separates concerns
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
- **Replace document.domain with postMessage** (javascript):
```javascript
// BAD: document.domain relaxes same-origin policy and is deprecated
// document.domain = "example.com";

// GOOD: use postMessage for cross-subdomain communication
// Sender:
window.parent.postMessage({ type: "auth", token }, "https://parent.example.com");

// Receiver:
window.addEventListener("message", (e) => {
  if (e.origin !== "https://child.example.com") return;
  // handle e.data.token safely
});
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
- **Replace "*" targetOrigin with explicit origin** (typescript):
```typescript
// BAD: "*" sends to any origin
// window.parent.postMessage(data, "*");

// GOOD: explicit trusted origin
window.parent.postMessage(data, "https://partner.example.com");

// Receiver: always validate origin
window.addEventListener("message", (e) => {
  if (e.origin !== "https://trusted.example.com") return;
  handleMessage(e.data);
});
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
- **Remove JWTs from HTML: use HttpOnly cookies** (typescript):
```typescript
// JWTs embedded in HTML are visible in source view and accessible to XSS
// BAD: <script>window.__TOKEN__ = "eyJ..."</script>

// GOOD: server sets HttpOnly cookie on authentication
res.setHeader("Set-Cookie",
  `session=<value>; HttpOnly; Secure; SameSite=Strict; Path=/`
);
// Token is invisible to JavaScript; sent automatically with all requests
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
- **Remove base64-encoded credentials from source** (typescript):
```typescript
// Base64 is encoding, not encryption, trivially decoded:
// atob("dXNlcjpwYXNzd29yZA==") => "user:password"

// Store credentials in environment variables:
const basicAuth = Buffer.from(
  `<value>:<value>`
).toString("base64");

fetch(url, { headers: { Authorization: `Basic <value>` } });
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
- **Block public access to S3 buckets** (bash):
```bash
# Enable Block Public Access on the bucket
aws s3api put-public-access-block \
  --bucket your-bucket-name \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Remove any bucket policies that grant public read
aws s3api delete-bucket-policy --bucket your-bucket-name
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
- **Firebase config is public by design: secure with App Check + RLS** (typescript):
```typescript
// Firebase web config (apiKey, projectId, etc.) is INTENTIONALLY public
// Security depends on Firestore Security Rules and App Check

// Enable App Check:
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_RECAPTCHA_KEY!),
  isTokenAutoRefreshEnabled: true,
});

// Ensure Firestore rules require authentication:
// match /{doc=**} { allow read, write: if request.auth != null; }
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
- **Use POST for forms that handle sensitive data** (html):
```html
<!-- BAD: GET puts form data in the URL (logged, cached, shared) -->
<!-- <form method="GET" action="/search-private"> -->

<!-- GOOD: POST for forms with sensitive data -->
<form method="POST" action="/api/submit">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}" />
  <input type="password" name="password" autocomplete="current-password" />
  <button type="submit">Submit</button>
</form>
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
- **Set a safe Referrer-Policy meta tag** (html):
```html
<!-- BAD: unsafe-url sends full URL including query strings to third parties -->
<!-- <meta name="referrer" content="unsafe-url"> -->

<!-- GOOD: strict-origin-when-cross-origin (browser default since 2021) -->
<meta name="referrer" content="strict-origin-when-cross-origin" />

<!-- Or via HTTP header (preferred over meta):
     Referrer-Policy: strict-origin-when-cross-origin -->
```

### `exposed-session-id` [content / high / body-pattern]
**Session ID Exposed in URL**

A session identifier (session_id, sid, PHPSESSID, JSESSIONID, or ASP.NET_SessionId) was found as a URL query parameter in the page.

**Risk:** Session IDs in URLs are logged by servers, proxies, and browser history, and leak via the Referer header to any linked third party -- letting anyone who obtains the URL hijack the session.

**Why it matters:** Session identifiers belong exclusively in HttpOnly cookies. A session ID that also appears as a URL parameter is exposed everywhere URLs are recorded, and enables session fixation if the server accepts an attacker-supplied ID.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Never pass session identifiers as URL query parameters.
- Rely solely on HttpOnly, Secure, SameSite cookies for session state.
- **Remove session IDs from URLs and response bodies** (typescript):
```typescript
// BAD: session ID in URL, logged by servers, proxies, and browsers
// /dashboard?session=abc123

// GOOD: session ID in HttpOnly cookie only
res.setHeader("Set-Cookie",
  `session=<value>; HttpOnly; Secure; SameSite=Strict; Path=/`
);

// Also: never include session IDs in JSON response bodies
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
- **Use POST for password submission, never GET** (html):
```html
<!-- BAD: password in GET request URL appears in server logs and history -->
<!-- <form method="GET" action="/login"> -->

<!-- GOOD: always POST credentials -->
<form method="POST" action="/api/login">
  <input type="email" name="email" autocomplete="email" />
  <input type="password" name="password" autocomplete="current-password" />
  <button type="submit">Log in</button>
</form>
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
- **Enforce strong password requirements** (typescript):
```typescript
function validatePassword(pw: string): string | null {
  if (pw.length < 12) return "Password must be at least 12 characters";
  if (!/[A-Z]/.test(pw)) return "Include at least one uppercase letter";
  if (!/[0-9]/.test(pw)) return "Include at least one number";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Include at least one special character";
  return null; // valid
}

// On server: hash with bcrypt (cost 12+)
import bcrypt from "bcryptjs";
const hashed = await bcrypt.hash(password, 12);
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
- **Secure remember-me tokens in HttpOnly cookies** (typescript):
```typescript
// Remember-me tokens must be:
// 1. Cryptographically random (not predictable)
// 2. Stored in HttpOnly+Secure cookie (not localStorage)
// 3. Single-use or rotated on each use
import { randomBytes } from "crypto";

const rememberToken = randomBytes(32).toString("hex");
// Store hash of token in DB, not plaintext
await db.rememberTokens.create({ userId, tokenHash: sha256(rememberToken) });

res.setHeader("Set-Cookie",
  `remember=<value>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`
);
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
- **Always use and validate OAuth state parameter** (typescript):
```typescript
import { randomBytes } from "crypto";

// Generate state before redirecting to OAuth provider
export async function GET() {
  const state = randomBytes(16).toString("hex");
  // Store state in session
  const res = new Response(null, { status: 302 });
  res.headers.set("Set-Cookie", `oauth_state=<value>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  res.headers.set("Location",
    `https://provider.com/oauth/authorize?client_id=...&state=<value>&redirect_uri=...`
  );
  return res;
}

// Validate state in callback
export async function callbackGET(req: Request) {
  const url = new URL(req.url);
  const returnedState = url.searchParams.get("state");
  const cookieState = getCookie(req, "oauth_state");
  if (!returnedState || returnedState !== cookieState) {
    return Response.json({ error: "Invalid state" }, { status: 400 });
  }
}
```

### `debug-endpoint` [content / low / body-pattern]
**Debug Endpoints Referenced**

Debug or profiler endpoints found in source.

**Risk:** Debug endpoints often expose sensitive information.

**Why it matters:** Debug pages may show configs, stack traces, environment.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove or restrict debug endpoints in production.
- **Remove or protect debug endpoints in production** (typescript):
```typescript
// Guard debug routes behind environment checks
export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 404 });
  }
  // debug info
}

// Or require admin authentication:
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ env: process.env.NODE_ENV, uptime: process.uptime() });
}
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
- **Require admin authentication on admin endpoints** (typescript):
```typescript
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });
  // admin data
}

// Also: restrict admin routes to specific IPs at the network/load balancer level
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
- **Use consistent responses to prevent email enumeration** (typescript):
```typescript
// BAD: "Email not found" vs "Wrong password" reveals valid emails

// GOOD: always return the same message regardless of whether email exists
export async function POST(req: Request) {
  const { email, password } = await req.json();
  const user = await db.users.findByEmail(email);
  const valid = user && await bcrypt.compare(password, user.passwordHash);
  // Same response either way:
  if (!valid) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }
  // issue session
}
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
- **Add SRI and a local fallback for CDN resources** (html):
```html
<script
  src="https://cdn.example.com/jquery.min.js"
  integrity="sha384-HASH"
  crossorigin="anonymous"
></script>
<script>
  // Fallback if CDN fails
  if (typeof jQuery === "undefined") {
    document.write('<script src="/libs/jquery.min.js"><\/script>');
  }
</script>
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
- **Update jQuery to the latest version** (bash):
```bash
npm install jquery@latest
# Check for known vulnerabilities:
npm audit
# Better: migrate away from jQuery to modern browser APIs:
# document.querySelector() instead of $()
# fetch() instead of $.ajax()
# classList instead of $.addClass()
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
- **Update AngularJS / Angular to a supported version** (bash):
```bash
# AngularJS (1.x) is end-of-life since 2021, migrate to Angular 17+
# For Angular version updates:
ng update @angular/core @angular/cli

# Check for breaking changes:
# https://angular.dev/update-guide
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
- **Replace Prototype.js with modern browser APIs** (javascript):
```javascript
// Prototype.js is abandoned, replace with modern equivalents:

// $("id") => document.getElementById("id")
// $$(".class") => document.querySelectorAll(".class")
// Element.insert() => el.insertAdjacentHTML("beforeend", html)
// Ajax.Request => fetch(url, { method, body, headers })
// Object.extend => Object.assign or spread: { ...a, ...b }
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
- **Replace MooTools with modern browser APIs** (javascript):
```javascript
// MooTools is abandoned, replace with modern equivalents:

// $("id") => document.getElementById("id")
// $$(".class") => document.querySelectorAll(".class")
// new Request({ url }).send() => fetch(url)
// new Element("div") => document.createElement("div")
// Array.each() => [].forEach()
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
- **Prefer HttpOnly cookies over document.cookie for secrets** (typescript):
```typescript
// document.cookie is readable by any same-origin JavaScript (XSS risk)
// Only use document.cookie for non-sensitive preferences

// BAD: document.cookie = "session=abc123; Secure"
// Without HttpOnly, any XSS can read the session cookie

// GOOD: set HttpOnly cookies server-side
res.setHeader("Set-Cookie",
  `session=<value>; HttpOnly; Secure; SameSite=Strict; Path=/`
);
// HttpOnly cookies are NOT accessible via document.cookie
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
- **Never store raw card numbers: use a payment processor** (typescript):
```typescript
// NEVER store raw credit card numbers: PCI DSS violation
// Use a tokenization service:

// Stripe: card number goes directly to Stripe servers
import { loadStripe } from "@stripe/stripe-js";
const stripe = await loadStripe(process.env.NEXT_PUBLIC_STRIPE_KEY!);
const { paymentMethod } = await stripe!.createPaymentMethod({
  type: "card",
  card: cardElement, // card number never touches your server
});
// Store paymentMethod.id (a token), not the card number
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
- **Encrypt SSNs at rest and in transit** (typescript):
```typescript
// SSNs are PII, never log, expose in APIs, or store unencrypted
// Mask in display:
function maskSsn(ssn: string) { return "***-**-" + ssn.slice(-4); }

// Store encrypted:
import { createCipheriv, randomBytes } from "crypto";
const key = Buffer.from(process.env.ENCRYPTION_KEY!, "base64");
const iv  = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([cipher.update(ssn, "utf8"), cipher.final()]);
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
- **Mask phone numbers in API responses** (typescript):
```typescript
// Mask phone numbers before sending to clients
function maskPhone(phone: string) {
  return phone.replace(/\d(?=\d{4})/g, "*"); // ***-***-1234
}

// In API response:
return Response.json({
  user: {
    id: user.id,
    phone: maskPhone(user.phone), // masked, not full number
  },
});
```

### `bearer-token-exposed` [content / high / body-pattern]
**Bearer Token Exposed in Source**

Bearer token found in page source.

**Risk:** Direct credential exposure.

**Why it matters:** Bearer tokens grant API access.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Never embed tokens in HTML, use secure storage.
- **Remove bearer tokens from HTML and client-visible locations** (typescript):
```typescript
// Bearer tokens embedded in HTML or JS bundles are readable by any script
// BAD: window.__BEARER_TOKEN__ = "abc123" in HTML

// GOOD: fetch tokens from a secure API endpoint when needed
const res = await fetch("/api/token", { credentials: "include" });
const { token } = await res.json();
// Or better: use HttpOnly cookies so the token is never accessible to JS
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
- **Move API keys out of URLs into request headers** (typescript):
```typescript
// BAD: API key in URL, logged by servers, proxies, and browser history
// fetch("https://api.example.com/data?api_key=abc123")

// GOOD: API key in Authorization or X-API-Key header
fetch("https://api.example.com/data", {
  headers: {
    "X-API-Key": process.env.API_KEY!,
    // or
    Authorization: `Bearer <value>`,
  },
});
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
- **Rotate exposed AWS credentials immediately** (bash):
```bash
# 1. Deactivate the exposed key
aws iam update-access-key --access-key-id AKIA... --status Inactive --user-name USER

# 2. Create a new key
aws iam create-access-key --user-name USER

# 3. Check CloudTrail for unauthorized usage
aws cloudtrail lookup-events --lookup-attributes AttributeKey=AccessKeyId,AttributeValue=AKIA...

# 4. Move to IAM roles (no long-lived keys needed on AWS compute)
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
- **Revoke and replace exposed private keys** (bash):
```bash
# For TLS certificates: contact your CA to revoke the cert immediately
# openssl genrsa -out new_private.key 4096
# Then reissue the certificate with the new key

# For JWT signing keys: rotate and invalidate all existing tokens
# For SSH keys: remove from authorized_keys on all servers

# Store new private keys in a KMS or secrets manager, never in source
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
- **Rotate exposed Stripe keys** (bash):
```bash
# Rotate at: https://dashboard.stripe.com/apikeys
# 1. Create a new secret key
# 2. Update all environments with the new key
# 3. Roll the old key (revoke it)

# Only sk_live_* (secret keys) need rotation
# pk_live_* (publishable keys) are intentionally public and safe in browsers

# Store the secret key in environment variables only:
# STRIPE_SECRET_KEY=sk_live_...
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
- **Rotate exposed Twilio credentials** (bash):
```bash
# Rotate Auth Token: console.twilio.com > Settings > API Keys
# Or rotate the Account SID secondary auth token

# Check for unauthorized SMS/calls:
# GET /2010-04-01/Accounts/ACXXXXXX/Messages

# Store credentials server-side only:
# TWILIO_ACCOUNT_SID=AC...
# TWILIO_AUTH_TOKEN=your_token
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
- **Rotate exposed SendGrid API key** (bash):
```bash
# Revoke at: app.sendgrid.com > Settings > API Keys
# Create a new key with minimum required permissions (Mail Send only)

# Never expose the SendGrid key in client-side code
# Proxy email sending through your own API route:
# POST /api/send-email (server-side, uses SENDGRID_API_KEY env var)
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
- **Rotate exposed Slack webhook URL** (bash):
```bash
# Revoke at: api.slack.com > Your Apps > Incoming Webhooks > Revoke
# Create a new webhook URL

# Proxy Slack notifications through your own server:
# Client -> POST /api/notify -> Server uses SLACK_WEBHOOK_URL env var
# Never expose the webhook URL in client-side code or source
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
- **Revoke exposed GitHub token immediately** (bash):
```bash
# Revoke at: github.com/settings/tokens
# Check recent activity:
curl -H "Authorization: token TOKEN" https://api.github.com/user
curl -H "Authorization: token TOKEN" https://api.github.com/users/OWNER/events

# Replace with a fine-grained token scoped to specific repos
# Or use GitHub Actions GITHUB_TOKEN (auto-scoped, expires after run)
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
- **Restrict Google API key by referrer and API scope** (bash):
```bash
# Restrict in Google Cloud Console > APIs & Services > Credentials
# 1. Set API restrictions: only the APIs you actually use
# 2. Set application restrictions: HTTP referrers (your domain only)

gcloud services api-keys update KEY_ID \
  --allowed-referrers="https://yoursite.com/*"

# For server-side use: restrict by IP instead of referrer
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
- **Rotate exposed Mailchimp API key** (bash):
```bash
# Revoke at: Mailchimp Account > Extras > API Keys
# Create a new key

# Keep Mailchimp API calls server-side only
# Never expose API keys in browser bundles
# Store in environment: MAILCHIMP_API_KEY=your_key
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
- **Revoke exposed Heroku API key** (bash):
```bash
# Revoke at: dashboard.heroku.com > Account Settings > API Key > Reveal + Regenerate
# Or via CLI:
heroku auth:whoami
heroku auth:logout
# Log in again to get a new session token

# For CI: use Heroku API keys as env vars in your CI platform
# Never commit them to source code
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
- **Revoke exposed npm token** (bash):
```bash
# List tokens:
npm token list

# Revoke the compromised token:
npm token revoke <token-id>

# Create a new scoped token:
npm token create --read-only  # for CI install
npm token create              # for publishing

# Check for unauthorized publishes:
npm view your-package versions --json
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
- **Revoke exposed Docker Hub token** (bash):
```bash
# Revoke at: hub.docker.com > Account Settings > Security > Access Tokens
# Create a new token with minimum required permissions (Read-only for pull)

# In CI: use DOCKER_HUB_TOKEN as a secret env var
docker login -u "$DOCKER_HUB_USER" -p "$DOCKER_HUB_TOKEN"

# For private registries, consider ECR or GHCR with OIDC (no long-lived tokens)
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
- **Return generic errors to clients** (typescript):
```typescript
try {
  const result = await riskyOperation();
  return Response.json(result);
} catch (err) {
  console.error("Operation failed:", err); // detailed log server-side
  return Response.json(
    { error: "An unexpected error occurred" },
    { status: 500 }
  );
  // Never return err.message, stack traces, or SQL errors to the client
}
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
- **Catch and mask NoSQL errors** (typescript):
```typescript
try {
  const result = await db.collection.findOne({ _id: id });
  return Response.json(result);
} catch (err) {
  console.error("MongoDB error:", err); // log server-side only
  return Response.json({ error: "Database error" }, { status: 500 });
  // Never expose: MongoServerError, collection names, or query details
}
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
- **Catch and mask LDAP errors** (typescript):
```typescript
try {
  const result = await ldapClient.search(dn, opts);
  return Response.json(result);
} catch (err) {
  console.error("LDAP error:", err);
  return Response.json({ error: "Authentication failed" }, { status: 401 });
  // Never expose LDAP DNs, error codes, or server details to clients
}
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
- **Catch and mask XML parsing errors** (typescript):
```typescript
try {
  const data = parser.parse(xmlBody);
  return Response.json(data);
} catch (err) {
  console.error("XML parse error:", err);
  return Response.json({ error: "Invalid request format" }, { status: 400 });
  // Never return parser error messages that may reveal schema details
}
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
- **Wrap JSON arrays in objects; set X-Content-Type-Options** (typescript):
```typescript
// BAD: returning a bare JSON array (exploitable in old browsers)
// return Response.json([...items]);

// GOOD: wrap in an object
return Response.json({ items });

// Also set X-Content-Type-Options: nosniff
return new Response(JSON.stringify({ items }), {
  headers: {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
  },
});
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
- **Replace JSONP with CORS** (typescript):
```typescript
// JSONP is dangerous: the callback parameter executes arbitrary code
// BAD: /api/data?callback=someFunction

// GOOD: use CORS instead
return new Response(JSON.stringify(data), {
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://trusted-partner.com",
  },
});

// JSONP endpoints cannot be protected with CSRF tokens or SameSite cookies
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
- **Use getElementById instead of relying on named globals** (javascript):
```javascript
// BAD: window.myForm or document.myForm can be clobbered by attacker HTML
// <form name="myForm"> clobbers window.myForm

// GOOD: use explicit DOM methods
const form = document.getElementById("my-form");
if (!(form instanceof HTMLFormElement)) throw new Error("Form not found");

// Also: set Content-Security-Policy to block attacker HTML injection
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
- **Sanitize srcdoc content and add sandbox** (html):
```html
<!-- BAD: srcdoc from user input without sandbox -->
<!-- <iframe srcdoc="{{ userHtml }}"></iframe> -->

<!-- GOOD: sanitize srcdoc content and restrict with sandbox -->
<iframe
  srcdoc="<!-- sanitized HTML only -->
  <p>Safe content</p>"
  sandbox=""
  title="Safe frame"
></iframe>
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
- **Minimize sandbox permissions on iframes** (html):
```html
<!-- Start with most restrictive and add only what the iframe needs -->
<iframe
  src="https://widget.example.com"
  sandbox="allow-scripts"
  title="Widget"
></iframe>
<!-- Avoid combining allow-scripts + allow-same-origin: this effectively removes sandboxing -->
<!-- Use allow-same-origin only for same-origin trusted content -->
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
- **Block SVG script execution and sanitize SVG content** (typescript):
```typescript
import DOMPurify from "dompurify";

// Sanitize SVG before rendering:
const cleanSvg = DOMPurify.sanitize(userSvg, {
  USE_PROFILES: { svg: true, svgFilters: true },
});

// Or serve user SVGs as images (disables script execution):
// <img src="/api/user-svg/123" alt="User avatar" />
// (img tag does not execute SVG scripts)
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
- **Block data: URI script execution via CSP** (typescript):
```typescript
// Add to Content-Security-Policy:
// script-src 'self' -- blocks data: URIs for scripts by default
// Explicitly: script-src 'self'; object-src 'none';

// Never allow data: in script-src or object-src
// CSP example:
res.setHeader("Content-Security-Policy",
  "default-src 'self'; script-src 'self'; object-src 'none'; data: in img-src only";
);
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
- **Restrict blob: URL script execution via CSP** (typescript):
```typescript
// CSP: restrict blob: in script-src
res.setHeader("Content-Security-Policy",
  "script-src 'self'; worker-src 'self' blob:; object-src 'none';"
);
// worker-src blob: is needed for Web Workers but limits blob URL scripts

// Never create blob: URLs from user content for script execution
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
- **Remove autocomplete="off" from forms** (html):
```html
<!-- autocomplete="off" prevents password manager autofill
     and is ignored by most modern browsers for passwords -->

<!-- BAD -->
<!-- <form autocomplete="off"> -->

<!-- GOOD: allow autocomplete at form level,
     set specific autocomplete values on each field -->
<form>
  <input type="email" name="email" autocomplete="email" />
  <input type="password" name="password" autocomplete="current-password" />
</form>
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
- **Set appropriate maxlength values on inputs** (html):
```html
<!-- NIST recommends allowing passwords up to 64+ characters -->
<input type="password" name="password" maxlength="128" autocomplete="current-password" />
<input type="email" name="email" maxlength="254" autocomplete="email" />

<!-- Set generous limits that do not frustrate users or break password managers -->
<!-- Validate length server-side as well -->
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
- **Avoid storing passwords in hidden form fields** (html):
```html
<!-- BAD: password in a hidden field is visible in source and form data -->
<!-- <input type="hidden" name="password" value="{{ password }}"> -->

<!-- GOOD: request the password again for re-authentication flows -->
<input type="password" name="password" autocomplete="current-password" />
<!-- Never pass passwords through hidden fields across multiple form steps -->
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
- **Default password fields to type="password" (hidden)** (html):
```html
<!-- Password fields must default to hidden (type="password") -->
<div class="password-wrapper">
  <input type="password" id="password" name="password" autocomplete="current-password" />
  <button type="button" aria-label="Show password" onclick="togglePasswordVisibility()">
    <!-- eye icon -->
  </button>
</div>

<script>
function togglePasswordVisibility() {
  const input = document.getElementById("password");
  input.type = input.type === "password" ? "text" : "password";
}
</script>
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
- **Do not make sensitive fields readonly as a security measure** (html):
```html
<!-- readonly only prevents editing in the UI, values are still submitted -->
<!-- Attackers can remove readonly via browser devtools and change the value -->

<!-- GOOD: validate all field values server-side regardless of readonly state -->
export async function POST(req: Request) {
  const { accountId } = await req.json();
  // Verify the user has permission for this accountId server-side
  const session = await getSession();
  if (session.userId !== accountId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
}
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
- **Validate file type, size, and content on upload** (typescript):
```typescript
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) return Response.json({ error: "No file" }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) return Response.json({ error: "Invalid file type" }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ error: "File too large" }, { status: 400 });

  // Also verify content with a magic-bytes check (file type can be spoofed)
  const buffer = await file.arrayBuffer();
  const header = new Uint8Array(buffer.slice(0, 4));
  const isJpeg = header[0] === 0xFF && header[1] === 0xD8;
  // ...
}
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
- **Block config file access via web server** (nginx):
```nginx
# Block common config file extensions
location ~* \.(conf|config|cfg|ini|yaml|yml|toml|json)$ {
  deny all;
  return 404;
}
# Ensure web root does not include application config directory
```

### `iframe-srcdoc-no-sandbox` [content / medium / body-pattern]
**srcdoc iframe without sandbox attribute**

An <iframe srcdoc="..."> embeds inline HTML directly in the page without a sandbox attribute, giving that inline content full same-origin privileges.

**Risk:** Add sandbox='allow-scripts allow-same-origin allow-forms' to srcdoc iframes, or sandbox="" if no scripting is needed

**Why it matters:** Unlike a regular src= iframe loading a separate document, srcdoc content is embedded inline -- without sandbox, it runs with the same privileges as the parent page, which matters if the srcdoc value is ever built from dynamic or user-influenced data.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add sandbox='allow-scripts allow-same-origin allow-forms' to third-party iframes
- **Add sandbox to srcdoc iframes** (html):
```html
<iframe
  srcdoc="<p>Safe static content</p>"
  sandbox=""
  title="Safe frame"
></iframe>
<!-- sandbox="" is maximally restrictive
     Add permissions only as needed:
     sandbox="allow-scripts" for JS-only iframes -->
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
- **Always validate server-side regardless of formnovalidate** (typescript):
```typescript
// formnovalidate only skips browser-level validation (for save/draft buttons)
// ALWAYS validate server-side regardless

export async function POST(req: Request) {
  const data = await req.json();
  // Server-side validation is mandatory
  if (!data.email || !/^[^@]+@[^@]+\.[^@]+$/.test(data.email)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }
  // process
}
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
- **Never use javascript: in form action** (html):
```html
<!-- BAD: form action with javascript: scheme executes arbitrary JS -->
<!-- <form action="javascript:void(0)" onsubmit="handle()"> -->

<!-- GOOD: use a real action URL or submit via JavaScript -->
<form id="myForm" action="/api/submit" method="POST">
  <!-- ... -->
</form>
<script>
document.getElementById("myForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await fetch("/api/submit", { method: "POST", body: new FormData(e.target) });
});
</script>
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
- **Replace mailto: form actions with a server-side form handler** (typescript):
```typescript
// BAD: <form action="mailto:user@example.com">, exposes email, client-dependent

// GOOD: handle form submission server-side
export async function POST(req: Request) {
  const formData = await req.formData();
  const name = formData.get("name") as string;
  const message = formData.get("message") as string;
  // Send email server-side with your email service
  await sendEmail({ to: process.env.CONTACT_EMAIL!, subject: `Contact: <value>`, body: message });
  return Response.json({ success: true });
}
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
- **Avoid combining allow-scripts and allow-same-origin in sandbox** (html):
```html
<!-- DANGEROUS: combining these two effectively removes sandbox protection -->
<!-- The iframe can remove its own sandbox via script -->
<!-- BAD: sandbox="allow-scripts allow-same-origin" for cross-origin content -->

<!-- GOOD: use allow-scripts only for cross-origin untrusted content -->
<iframe src="https://untrusted.example.com" sandbox="allow-scripts" title="Widget"></iframe>
<!-- Only combine allow-scripts + allow-same-origin for your own trusted, same-origin content -->
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
- **Strip onload and event handlers from SVG before rendering** (typescript):
```typescript
import DOMPurify from "dompurify";

// SVG onload handlers execute on insertion into the DOM
const cleanSvg = DOMPurify.sanitize(userSvg, {
  USE_PROFILES: { svg: true },
  FORBID_ATTR: ["onload", "onerror", "onclick", "onmouseover"],
});

document.getElementById("svg-container")!.innerHTML = cleanSvg;
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
- **Disable external entity references in SVG parsing** (typescript):
```typescript
// When parsing SVG server-side, disable external references
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  processEntities: false,
  ignoreDeclaration: true,
});
// Never load external ENTITY references from user-supplied SVG
```

### `iframe-sandbox-missing` [content / medium / body-pattern]
**Missing sandbox attribute on iframe**

An iframe element is present without a sandbox attribute, giving the embedded content full access to the same privileges as the parent page.

**Risk:** Without sandbox, an iframe has the same-origin privileges as the parent page, third-party content can access parent DOM, cookies, and run scripts with no restrictions.

**Why it matters:** The sandbox attribute restricts iframe capabilities by default and allows adding back only the required permissions.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add sandbox="" to the iframe element
- Add specific permissions as needed: allow-scripts, allow-forms, allow-same-origin
- Never combine allow-scripts with allow-same-origin for cross-origin untrusted content
- **Add sandbox attribute** (html):
```html
<!-- Unsafe: no sandbox -->
<iframe src="https://third-party.com"></iframe>

<!-- Safe: sandboxed -->
<iframe src="https://third-party.com" sandbox="allow-scripts allow-forms"></iframe>
```

### `open-form-action` [content / medium / body-pattern]
**Form action points to an insecure or external URL**

A form action attribute uses HTTP or points to an external domain, risking credential submission to an untrusted destination.

**Risk:** Forms that submit to HTTP URLs expose credentials in transit. Forms targeting external domains may submit user data to attacker-controlled servers, a common phishing vector.

**Why it matters:** Form actions should always point to HTTPS endpoints on your own domain.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Change all form actions to HTTPS URLs
- Ensure the action domain is your own, not a third-party or user-controlled value
- Validate the action URL server-side if it is dynamically generated
- **Restrict form action to known paths** (html):
```html
<!-- Unsafe: accepts any action value from user input -->
<form action="<?= $_GET['redirect'] ?>">...</form>

<!-- Safe: hardcoded action -->
<form action="/api/v1/login" method="post">...</form>
```

### `base-tag` [content / medium / body-pattern]
**Base tag with insecure or dynamic href**

The HTML base element sets the base URL for all relative links. A user-controlled or HTTP base tag enables base tag hijacking attacks.

**Risk:** An attacker who can inject a base tag pointing to their server can redirect all relative resource requests, loading attacker-controlled scripts, images, and forms while keeping the original domain in the address bar.

**Why it matters:** The base tag should be set to a fixed HTTPS absolute URL and never derived from user input.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Set base href to an absolute HTTPS URL you control
- Never derive the base href from query parameters or cookies
- Validate base tag values as part of your template security review
- **Remove or restrict base tag** (html):
```html
<!-- Risky: dynamic base tag can redirect all relative URLs -->
<base href="<?= $userInput ?>">

<!-- Safe: use absolute URLs instead of base tag -->
<a href="https://example.com/page">Link</a>
```

### `wp-login-exposed` [content / info / body-pattern]
**WordPress login page publicly accessible**

The WordPress admin login page (/wp-login.php or /wp-admin/) is publicly accessible, exposing it to brute-force attacks.

**Risk:** Publicly accessible WordPress login pages are continuously attacked by automated bots attempting credential stuffing and brute-force attacks. A weak admin password will be compromised quickly.

**Why it matters:** While hiding the login URL provides only obscurity, combining it with rate limiting, 2FA, and IP allowlisting significantly reduces attack surface.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Enable login rate limiting and CAPTCHA
- Require two-factor authentication for all admin accounts
- Restrict /wp-admin/ access to specific IP ranges at the server level
- Keep WordPress and all plugins updated
- **Block wp-login.php in nginx** (nginx):
```nginx
# nginx.conf: restrict wp-login.php to known admin IPs
location = /wp-login.php {
    allow 203.0.113.0/24;
    deny all;
}
```

### `websocket-unencrypted` [content / high / body-pattern]
**WebSocket connection uses unencrypted ws:// protocol**

The page opens a WebSocket connection using the unencrypted ws:// protocol instead of the secure wss:// protocol.

**Risk:** An unencrypted WebSocket connection can be intercepted and read by any network observer or man-in-the-middle attacker, exposing all messages including authentication tokens, user data, and session information sent over the connection.

**Why it matters:** WebSocket connections should always use wss:// (WebSocket over TLS) in the same way that HTTP should be served over HTTPS.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Change all ws:// WebSocket URLs to wss://
- Derive the protocol from the page protocol: location.protocol === "https:" ? "wss:" : "ws:"
- Configure your WebSocket server with a valid TLS certificate
- **Use wss:// instead of ws://** (javascript):
```javascript
// Unsafe: unencrypted WebSocket
const ws = new WebSocket('ws://example.com/socket');

// Safe: TLS-encrypted WebSocket
const ws = new WebSocket('wss://example.com/socket');
```

### `cross-site-websocket` [content / high / body-pattern]
**WebSocket connection without origin validation**

A WebSocket endpoint does not validate the Origin header, allowing connections from any website.

**Risk:** Without Origin validation, any website can open a WebSocket connection to your server using the victim's cookies, a cross-site WebSocket hijacking attack that gives attackers full access to any WebSocket API the user can reach.

**Why it matters:** WebSocket connections bypass CORS restrictions. The server must check the Origin header and reject connections from unexpected origins.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Check the Origin header on WebSocket upgrade requests
- Reject connections from origins not in your allowlist
- Use a CSRF token in the WebSocket connection URL or initial handshake message
- **Validate WebSocket origin server-side** (javascript):
```javascript
// Node.js WebSocket server: reject unexpected origins
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({
  verifyClient({ origin }) {
    return origin === 'https://example.com';
  },
});
```

### `postmessage-origin` [content / high / body-pattern]
**postMessage receiver does not validate origin**

A message event listener processes messages without checking event.origin, accepting messages from any window.

**Risk:** Without origin validation, any malicious page in the same browser can send postMessage events to your page and have them processed, potentially triggering privileged actions, passing tokens, or modifying application state.

**Why it matters:** Every postMessage receiver must validate event.origin against a trusted allowlist before processing the message.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Add an origin check: if (event.origin !== "https://trusted.example.com") return;
- Use a Set of allowed origins for multiple trusted partners
- Never use "*" as targetOrigin when sending sensitive data
- **Validate origin in postMessage handler** (javascript):
```javascript
// Unsafe: accepts messages from any origin
window.addEventListener('message', (event) => {
  processMessage(event.data);
});

// Safe: check origin before processing
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://trusted.example.com') return;
  processMessage(event.data);
});
```

### `dom-xss-sinks` [content / high / body-pattern]
**DOM XSS sinks with user-controlled input**

User-controlled data is assigned to XSS-prone DOM sinks such as innerHTML, document.write, or eval without sanitization.

**Risk:** DOM-based XSS allows attackers to inject and execute arbitrary JavaScript in the victim's browser, stealing session cookies, redirecting the user, making authenticated API requests on their behalf, or completely taking over their session.

**Why it matters:** DOM XSS occurs when user-controlled data flows into dangerous browser APIs without sanitization. Use safe DOM APIs and sanitize when HTML is required.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Replace innerHTML/outerHTML with textContent for plain text
- Use DOMPurify.sanitize() when HTML rendering is required
- Implement a Content Security Policy to limit script execution
- **Use textContent instead of innerHTML** (javascript):
```javascript
// Unsafe: innerHTML with user-controlled data
element.innerHTML = userInput;

// Safe: use textContent for plain text
element.textContent = userInput;

// Or use DOMPurify for HTML content
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(userInput);
```

### `exposed-stack-trace` [content / medium / body-pattern]
**Stack trace exposed in HTTP response**

A server error response contains a full stack trace, revealing file paths, line numbers, framework versions, and application structure.

**Risk:** Exposed stack traces reveal internal file paths, function names, dependency versions, and server architecture, information attackers use to identify known CVEs, craft targeted exploits, and understand application structure before attacking.

**Why it matters:** Stack traces should be logged server-side and never included in HTTP responses to clients.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Catch all errors and return generic messages to clients
- Log full stack traces to a server-side logging system (Datadog, Sentry)
- Set production error handling to never expose internal details
- **Suppress stack traces in production** (javascript):
```javascript
// Express.js: generic error handler in production
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({
    message: isDev ? err.message : 'Internal server error',
    stack: isDev ? err.stack : undefined,
  });
});
```

### `sql-error-in-page` [content / high / body-pattern]
**SQL error message in page content**

The page contains an SQL error message that reveals database type, query structure, or table names.

**Risk:** SQL error messages expose database type (MySQL, PostgreSQL, MSSQL), query structure, column names, and table names, giving attackers direct feedback for SQL injection probing without needing blind techniques.

**Why it matters:** Database errors must be caught server-side and never exposed to users.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Wrap all database calls in try/catch blocks
- Return only generic error messages (status 500) to the client
- Log the full SQL error server-side with a correlation ID for debugging
- **Catch database errors before they reach the response** (javascript):
```javascript
// Unsafe: SQL error leaks table/column names
try {
  const result = await db.query(sql);
} catch (err) {
  // err.message may contain table names, column names
  res.send(err.message); // NEVER do this
}

// Safe: log internally, return generic message
catch (err) {
  logger.error({ err }, 'DB query failed');
  res.status(500).json({ error: 'Database error' });
}
```

### `php-error-in-page` [content / medium / body-pattern]
**PHP error/warning in page content**

A PHP error, warning, or notice is displayed in the page output, revealing file paths and internal application details.

**Risk:** PHP errors reveal absolute file paths (e.g., /var/www/html/app/...), PHP version, and internal application logic, helping attackers map the server filesystem and identify vulnerabilities.

**Why it matters:** PHP display_errors should be disabled in production; errors should be logged, not displayed.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Set display_errors = Off in php.ini or .htaccess
- Set log_errors = On and log_errors to a server-side file
- Set error_reporting to E_ALL in development only
- **Disable error display in PHP production config** (php):
```php
// php.ini (production)
display_errors = Off
log_errors = On
error_log = /var/log/php/error.log

// Or in code:
ini_set('display_errors', '0');
error_reporting(E_ALL);
ini_set('log_errors', '1');
```

### `asp-error-in-page` [content / medium / body-pattern]
**ASP.NET error details in page content**

ASP.NET error details including stack traces or YSOD (Yellow Screen of Death) are shown to end users.

**Risk:** ASP.NET YSOD pages expose .NET version, file paths, source code lines, and method signatures, information attackers use to identify patched vulnerabilities and target specific versions.

**Why it matters:** Enable custom error pages in production and disable detailed ASP.NET error output.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Set <customErrors mode="On"> in Web.config
- Implement a global exception handler to log and return generic responses
- Disable debug mode in production: <compilation debug="false">
- **Use custom errors in ASP.NET web.config** (xml):
```xml
<!-- web.config: suppress detailed errors in production -->
<configuration>
  <system.web>
    <customErrors mode="On" defaultRedirect="/error">
      <error statusCode="404" redirect="/not-found"/>
    </customErrors>
  </system.web>
</configuration>
```

### `django-debug-page` [content / critical / body-pattern]
**Django debug mode enabled in production**

Django's DEBUG = True is enabled in production, exposing detailed error pages with source code, local variables, and settings.

**Risk:** Django debug pages expose full source code at the error location, all local variables at every stack frame, all installed apps and middleware, and Django settings (including SECRET_KEY if it appears in a traceback), a critical information disclosure.

**Why it matters:** DEBUG = True is appropriate only in development. Production deployments must have DEBUG = False.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Set DEBUG = False in production settings
- Set ALLOWED_HOSTS to your actual domain names
- Configure a proper error logging backend (Sentry, logging module)
- **Disable DEBUG mode in production** (python):
```python
# settings.py: never set DEBUG=True in production
DEBUG = os.environ.get('DJANGO_DEBUG', 'False') == 'True'

# ALLOWED_HOSTS must be set when DEBUG=False
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', '').split(',')
```

### `laravel-debug-page` [content / critical / body-pattern]
**Laravel debug mode enabled in production**

Laravel's APP_DEBUG=true is enabled in production, showing detailed error pages with application code, stack traces, and environment variables.

**Risk:** Laravel debug mode exposes full stack traces, local variables, all configuration values (including database credentials if they appear in traces), and can allow code execution via the Ignition debug interface on older versions.

**Why it matters:** APP_DEBUG must be false in production environments.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Set APP_DEBUG=false in .env for production
- Set APP_ENV=production
- Configure error logging to a server-side handler only
- **Set APP_DEBUG=false in production** (bash):
```bash
# .env (production)
APP_DEBUG=false
APP_ENV=production

# config/app.php
'debug' => env('APP_DEBUG', false),
```

### `storage-api-usage` [content / medium / body-pattern]
**Sensitive data in Web Storage API**

The page stores potentially sensitive data in localStorage or sessionStorage, which is accessible to all same-origin JavaScript.

**Risk:** Data in localStorage and sessionStorage is accessible to any JavaScript running on the same origin, an XSS attack can exfiltrate all stored tokens, user data, and application state without the user's knowledge.

**Why it matters:** Web Storage should not contain authentication tokens, session identifiers, or PII. Use HttpOnly cookies for sensitive session state.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Move session tokens to HttpOnly cookies
- Encrypt sensitive data before storing if Web Storage is unavoidable
- Limit Web Storage to non-sensitive preferences only
- **Avoid storing sensitive data in localStorage** (javascript):
```javascript
// Unsafe: tokens in localStorage are accessible to XSS
localStorage.setItem('auth_token', token);

// Better: use httpOnly cookies set by the server
// res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'strict' })

// If localStorage is required, never store secrets,
// use a short-lived session ID that maps to server state
```

### `geolocation-usage` [content / low / body-pattern]
**Geolocation API used without explicit user intent**

The page accesses the Geolocation API. Ensure it is requested in response to a clear user action, not automatically on page load.

**Risk:** Automatically prompting for location permission on page load is poor UX and may violate GDPR/CCPA. Geolocation data collected without clear user consent or legitimate purpose is a privacy violation.

**Why it matters:** Geolocation should only be requested when the user initiates an action that clearly requires it.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Request geolocation only in response to an explicit user action (e.g., "Use my location" button)
- Explain why location is needed before requesting permission
- Do not store precise geolocation data without explicit consent
- **Request geolocation only when needed** (javascript):
```javascript
// Only request geolocation on explicit user gesture
document.querySelector('#find-me').addEventListener('click', () => {
  navigator.geolocation.getCurrentPosition(
    (pos) => handleLocation(pos),
    (err) => console.warn('Geolocation denied:', err),
    { maximumAge: 60000, timeout: 5000 }
  );
});
```

### `clipboard-access` [content / low / body-pattern]
**Clipboard API accessed without user gesture**

The page reads from or writes to the clipboard, which requires user permission and should only happen in response to user interaction.

**Risk:** Reading clipboard without user intent violates privacy: the clipboard may contain passwords, 2FA codes, or other sensitive data. Browsers require explicit user permission, but prompt fatigue may cause users to grant it without understanding the risk.

**Why it matters:** Clipboard read/write must be triggered by user gesture and clearly communicate why it needs clipboard access.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Only call navigator.clipboard.readText() in response to an explicit user gesture
- Explain to users why clipboard access is needed
- Prefer clipboard.write() over read() where possible
- **Request clipboard access with user gesture** (javascript):
```javascript
// Always request clipboard inside a user gesture handler
document.querySelector('#copy-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.warn('Clipboard access denied:', err);
  }
});
```

### `webcam-microphone-access` [content / medium / body-pattern]
**Camera or microphone access requested**

The page accesses the camera or microphone via getUserMedia. Ensure this is user-initiated and clearly communicated.

**Risk:** If getUserMedia is called without clear user intent or context, users may not understand that recording has begun, a significant privacy violation. Malicious use could enable covert surveillance if combined with XSS.

**Why it matters:** Camera and microphone access must be requested in response to explicit user action with a clear UI indicator showing when recording is active.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Show a clear recording indicator when camera/mic is active
- Stop tracks immediately when the user closes the feature
- Only request access in response to an explicit user action
- **Request media access on explicit user action** (javascript):
```javascript
// Request only the permissions you need
const stream = await navigator.mediaDevices.getUserMedia({
  video: true,  // false if audio-only
  audio: false, // false if video-only
});

// Always stop tracks when done
stream.getTracks().forEach(track => track.stop());
```

### `html-injection-patterns` [content / high / body-pattern]
**HTML injection pattern detected**

User-controlled input appears to be reflected in the HTML response without proper encoding, enabling HTML injection.

**Risk:** HTML injection allows attackers to insert arbitrary HTML content into the page: creating fake login forms (phishing), modifying page appearance, injecting links, or redirecting users, and may escalate to XSS if script tags can be injected.

**Why it matters:** All user-controlled values that appear in HTML output must be HTML-encoded to prevent injection.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- HTML-encode all user-controlled values before inserting into HTML context
- Use a templating engine that auto-escapes by default
- Implement Content Security Policy to limit script execution
- **Escape user input before rendering** (javascript):
```javascript
// Unsafe: user input rendered as HTML
div.innerHTML = req.query.name;

// Safe: escape before inserting
function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
div.textContent = req.query.name; // or use textContent
```

### `reflected-input` [content / high / body-pattern]
**User input reflected in response without encoding**

A query parameter or form field value is reflected back in the response body without HTML encoding, creating a reflected XSS or HTML injection vulnerability.

**Risk:** Reflected user input allows an attacker to craft a URL that, when visited by a victim, injects arbitrary HTML or JavaScript into the page in the context of the victim's session, a reflected XSS attack.

**Why it matters:** All values from query strings, form fields, and headers must be HTML-encoded before being rendered in the response body.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- HTML-encode all reflected values using your templating engine's auto-escape
- Implement a Content Security Policy to block unauthorized scripts
- Test with payloads like "><script>alert(1)</script> to verify encoding
- **Escape reflected values in server-side templates** (javascript):
```javascript
// Express.js with EJS: use <%- for raw HTML (dangerous), <%= for escaped
// Unsafe:
res.send(`<p>Hello <value></p>`);

// Safe (escaping):
const name = escapeHtml(req.query.name ?? '');
res.send(`<p>Hello <value></p>`);
```

### `exposed-api-version` [content / low / body-pattern]
**Internal API version exposed in response**

The API response includes an internal version string or build number that reveals implementation details.

**Risk:** Exposed API version strings allow attackers to look up known CVEs for that specific version and target unpatched vulnerabilities. Version enumeration is often the first step in a targeted attack.

**Why it matters:** API responses should not include internal version numbers or build identifiers.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove version strings from API response bodies
- Remove X-Powered-By, X-Version, X-Build-Number headers
- Use semantic versioning in URL paths (/api/v2/) without exposing internal build numbers
- **Remove API version from response headers** (javascript):
```javascript
// Remove version information from response headers
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  // Don't expose: res.setHeader('X-API-Version', '2.1.0');
  next();
});
```

### `server-info` [content / low / body-pattern]
**Server information disclosed in response**

The HTTP response reveals server software name and/or version in the Server, X-Powered-By, or similar headers.

**Risk:** Knowing the exact server software and version allows attackers to look up known vulnerabilities and CVEs for that specific version, reducing the effort needed to find an exploitable weakness.

**Why it matters:** Server identification headers should be removed or set to generic values.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Nginx: add "server_tokens off;" to your server block
- Apache: set "ServerTokens Prod" and "ServerSignature Off"
- Next.js: set poweredByHeader: false in next.config.mjs
- Remove X-Powered-By, X-AspNet-Version, and X-Runtime headers
- **Suppress server version information** (nginx):
```nginx
# nginx.conf: hide server version
server_tokens off;

# Apache .htaccess
# ServerTokens Prod
# ServerSignature Off
```

### `phishing-lookalike-domain` [content / medium / body-pattern]
**Potential phishing lookalike domain detected in links**

Outgoing links or redirects reference domains that closely resemble known trusted brands via typosquatting or homoglyph substitution.

**Risk:** Links to phishing lookalike domains can redirect users to malicious sites that steal credentials or install malware, especially dangerous if these links appear in official pages and users assume they are legitimate.

**Why it matters:** Outbound links should be audited to ensure they do not reference typosquatted or lookalike domains.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Audit all outbound links for lookalike domains
- Use rel="noopener noreferrer" on all external links
- Consider monitoring your brand name for lookalike domain registrations
- **Register lookalike domains defensively** (text):
```text
// Register common typosquatting variants of your domain:
// examp1e.com, exarnple.com, example.co, example.net
// Then redirect all variants to your canonical domain.

// nginx: redirect lookalike to canonical
server {
  server_name examp1e.com;
  return 301 https://example.com$request_uri;
}
```

### `sw-insecure` [content / medium / body-pattern]
**Service Worker with insecure fetch handler**

The Service Worker intercepts all requests but does not validate origins or enforce HTTPS, potentially caching insecure responses.

**Risk:** An insecure Service Worker can cache and serve HTTP responses, downgrade HTTPS connections, and intercept all network traffic for the origin, extending the impact of any compromise beyond the page lifetime.

**Why it matters:** Service Workers should only intercept requests to known origins, enforce HTTPS, and not cache sensitive data.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Limit fetch interception to same-origin requests
- Do not cache responses from HTTP origins
- Avoid caching responses with authentication data (Authorization headers)
- **Register service worker only on HTTPS** (javascript):
```javascript
// Service workers require HTTPS (except localhost)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js')
    .catch(err => console.error('SW registration failed:', err));
}
```

### `password-no-paste` [content / low / body-pattern]
**Paste disabled on password field**

The password input field has JavaScript that prevents pasting, making password manager use difficult.

**Risk:** Blocking paste on password fields forces users to type passwords manually, discouraging the use of password managers and leading to shorter, weaker passwords that are easier to type. This increases the risk of account compromise.

**Why it matters:** NCSC and NIST recommend allowing paste on password fields to encourage password manager use.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove any onpaste="return false;" or paste event listeners from password fields
- Allow paste on all password, email, and username fields
- Consider allowing browsers to autofill credentials via autocomplete="current-password"
- **Remove paste prevention from password fields** (javascript):
```javascript
// Remove any paste-blocking code:
// BAD: never block paste on password fields
// document.querySelector('[type=password]').addEventListener('paste', e => e.preventDefault());

// Password managers use paste. Blocking it forces weak, memorable passwords.
// Simply allow default browser behavior.
```

### `database-connection-string` [content / critical / body-pattern]
**Database connection string in source**

A database connection string containing credentials is visible in client-accessible source or configuration files.

**Risk:** An exposed database connection string gives an attacker direct access to your database, bypassing all application-level security controls and allowing them to read, modify, or delete all data.

**Why it matters:** Connection strings must be stored in environment variables or a secrets manager, never in source code or public-facing files.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Immediately rotate the database credentials
- Move the connection string to an environment variable or secrets manager
- Ensure .env files are in .gitignore and not served by the web server
- **Store connection strings in environment variables** (javascript):
```javascript
// Unsafe: hardcoded connection string
const pool = new Pool({ connectionString: 'postgresql://user:pass@host/db' });

// Safe: read from environment
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

### `source-code-comment` [content / medium / body-pattern]
**Sensitive source code comment in response**

An HTML comment in the response contains potentially sensitive information such as file paths, credentials, or developer notes.

**Risk:** HTML comments are visible to anyone who views source, revealing internal paths, developer notes about security weaknesses, API endpoints, or occasionally credentials that were left during development.

**Why it matters:** Production HTML responses should not contain developer comments.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Remove all HTML comments from production templates
- Use build-time comment stripping in your bundler
- Audit HTML output for <!-- comments --> before deploying
- **Remove sensitive comments before deploying** (javascript):
```javascript
// Remove or replace sensitive comments before production:
// BAD:
// TODO: remove hardcoded API key: sk_live_abc123
// FIXME: SQL injection vulnerability on line 42
// NOTE: admin password is 'hunter2'

// Use a linter rule (e.g. eslint no-warning-comments) to catch TODOs in CI
```

### `hardcoded-ip-addresses` [content / low / body-pattern]
**Hard-coded IP addresses in source**

Private or public IP addresses are hard-coded in the client-side source, potentially revealing internal infrastructure.

**Risk:** Hard-coded private IP addresses reveal internal network topology. Hard-coded public IPs reveal backend server locations that may be protected only by hostname-based firewall rules, and prevent easy infrastructure migration.

**Why it matters:** IP addresses should be read from configuration, not embedded in source code.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

**Fix:**
- Replace hard-coded IPs with hostnames resolved from environment variables
- Ensure private/internal IP addresses are never sent to client-side code
- For internal service communication, use service discovery or environment variables
- **Move hardcoded IPs to environment variables** (javascript):
```javascript
// Unsafe: hardcoded IP in source code
const DB_HOST = '10.0.0.5';
const REDIS_HOST = '192.168.1.20';

// Safe: read from environment
const DB_HOST = process.env.DB_HOST;
const REDIS_HOST = process.env.REDIS_HOST;
```

### `subdomain-takeover-fingerprint` [content / high / body-pattern]
**Subdomain Takeover Fingerprint Detected**

The response body matches a known 'unclaimed service' error page (GitHub Pages, Heroku, Fastly, Pantheon, Shopify, Squarespace, or Netlify), which typically means a DNS record still points at a service that no longer has a claim on this hostname.

**Risk:** An attacker who registers the same service and claims the unclaimed name can serve arbitrary content, steal cookies scoped to the parent domain, and phish users who trust the hostname.

**Why it matters:** Subdomain takeover happens when a DNS record (typically a CNAME) still points at a third-party service (GitHub Pages, Heroku, S3, Shopify, etc.) after the corresponding resource there was deleted or renamed. The hosting provider serves a distinctive 'not found' page until someone else claims that name on their platform, at which point they control the content served under your domain.

**References:**
- https://github.com/EdOverflow/can-i-take-over-xyz
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/07-Test_Defenses_Against_Application_Misuse

**Fix:**
- Remove the DNS record if the third-party resource is no longer in use.
- Re-provision the resource on the third-party service under the same name if it is still needed.
- Audit all CNAME/ALIAS records pointing at third-party platforms on a recurring basis.
- **Audit dangling CNAMEs** (bash):
```bash
# List CNAME records and check each target still resolves to a claimed resource
dig CNAME sub.example.com
curl -sI https://sub.example.com | head -5
```

### `session-replay-unmasked-sensitive-field` [content / high / combined]
**Session-Replay Script Near Unmasked Sensitive Field**

A session-replay/analytics script (Hotjar, FullStory, LogRocket, Clarity) was detected alongside a sensitive-looking input field (SSN, credit card) that lacks the vendor's data-exclusion attribute.

**Risk:** The session-replay vendor's servers receive a recording of the raw field value, including any PII or payment data the user types, outside of your own infrastructure and audit boundary.

**Why it matters:** Session-replay tools record DOM mutations and (depending on configuration) keystrokes to reconstruct a video of the user's session for support/analytics purposes. They mask password-type inputs by default, but do not know which of your custom-named fields hold SSNs or card numbers unless you mark them explicitly.

**References:**
- https://help.hotjar.com/hc/en-us/articles/115011789248
- https://help.fullstory.com/hc/en-us/articles/360020828173

**Fix:**
- Add the vendor's exclusion attribute (e.g. data-hj-suppress, fs-exclude, data-clarity-mask) to every field that can contain PII or payment data.
- Prefer an allowlist-based masking configuration over a denylist so newly added fields are masked by default.
- Route payment collection through an iframe-hosted vendor field (Stripe Elements, etc.) that the replay script cannot read into.
- **Exclude a sensitive field from Hotjar recordings** (html):
```html
<input type="text" name="credit_card_number" data-hj-suppress />
```

### `third-party-tracker-on-login-page` [content / low / body-pattern]
**Ad-Tech Tracking Pixel on Login Page**

An ad-tech tracking pixel (Meta, TikTok, Snap, or LinkedIn) was detected on a page that also contains a login form, increasing the third-party attack surface on a credential-entry page.

**Risk:** Any of these third-party scripts (or a compromised/malicious ad served through their network) executes in the same origin as the login form and can read or tamper with it, since the page grants them full script access.

**Why it matters:** Marketing pixels are designed to run on public marketing pages, not credential-entry surfaces. Every third-party script included on a login page is a script that, if compromised, can read the password field, inject a fake form, or exfiltrate credentials.

**References:**
- https://owasp.org/www-project-top-10-privacy-risks/

**Fix:**
- Remove marketing/ad pixels from login, signup, and password-reset pages.
- If conversion tracking on signup is required, fire it from a post-login confirmation page instead.
- Restrict third-party script origins on auth pages via a strict Content-Security-Policy.
- **Keep tracking pixels off auth routes** (typescript):
```typescript
// Only load marketing pixels on public marketing routes,
// never on /login, /signup, or /reset-password
if (!pathname.startsWith('/login') && !pathname.startsWith('/signup')) {
  loadMarketingPixels();
}
```

### `wordpress-plugin-version-disclosed` [content / medium / body-pattern]
**WordPress Plugin Version Disclosed via Asset Query String**

One or more WordPress plugin asset URLs include a '?ver=X.Y.Z' query string that discloses the exact installed plugin version.

**Risk:** Attackers can match the disclosed plugin and version directly against the WPScan vulnerability database or CVE feeds to find a known exploit, skipping the reconnaissance step entirely.

**Why it matters:** WordPress appends the plugin's declared version as a cache-busting query string to every enqueued script and stylesheet by default. This is convenient for cache invalidation but also hands an attacker a precise, per-plugin version fingerprint without needing to guess.

**References:**
- https://wpscan.com/
- https://developer.wordpress.org/reference/functions/wp_enqueue_script/

**Fix:**
- Strip or randomize the ?ver= query string on enqueued assets (several 'remove version query strings' plugins/snippets do this).
- Keep the plugin itself up to date regardless of whether the version string is hidden.
- Consider a WAF rule that strips query strings from static asset requests at the edge.
- **Remove version query strings (functions.php)** (php):
```php
function remove_asset_version($src) {
    if (strpos($src, 'ver=')) {
        $src = remove_query_arg('ver', $src);
    }
    return $src;
}
add_filter('style_loader_src', 'remove_asset_version', 9999);
add_filter('script_loader_src', 'remove_asset_version', 9999);
```

### `script-loaded-from-raw-ip` [content / high / body-pattern]
**Script Loaded From Raw IP Address**

A <script> tag loads code from a raw IP address instead of a domain name, which is unusual for legitimate first- or third-party scripts and is a common malvertising/compromise indicator.

**Risk:** Scripts served from bare IPs have no domain reputation, no TLS certificate bound to a hostname in most cases, and are commonly used by injected skimmers (e.g. Magecart-style attacks) to avoid domain-based blocklists.

**Why it matters:** Legitimate CDNs, analytics vendors, and payment providers serve JavaScript from a named, certificate-bound domain. A script src pointing at a bare IP address is very rarely intentional and is a pattern seen in both malvertising and post-compromise script injection.

**References:**
- https://owasp.org/www-community/attacks/Magecart

**Fix:**
- Identify who added the script and confirm it is expected; if unexplained, treat it as a compromise indicator and investigate immediately.
- Replace the reference with the vendor's documented domain-based CDN URL.
- Add Subresource Integrity and a restrictive script-src CSP so an unexpected script host cannot execute even if re-injected.
- **Restrict script sources via CSP** (text):
```text
Content-Security-Policy: script-src 'self' https://cdn.trusted-vendor.com;
```

### `clipboard-hijack-pattern` [content / high / body-pattern]
**Clipboard-Hijacking Pattern Detected**

A 'copy' event listener was found that rewrites the clipboard contents via clipboardData.setData(), matching a pattern used by clipboard-hijacking (clipping/cryptojacking) scripts.

**Risk:** If reachable by an attacker (via a compromised third-party script or stored XSS), this pattern lets them silently replace anything a user copies from the page, most commonly used to swap a copied cryptocurrency wallet address for the attacker's own.

**Why it matters:** Clipboard-hijacking scripts listen for the browser's 'copy' event and call setData() to overwrite what actually gets placed on the clipboard, so the user sees the text they intended to copy but pastes something else entirely. This pattern has been documented in both malicious ad injections and compromised legitimate sites.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API

**Fix:**
- Confirm the copy listener is first-party and intentional (e.g. a 'copy code snippet' button); if not, remove it and audit for a supply-chain or XSS compromise.
- Never silently rewrite clipboard content without explicit user-visible confirmation (a 'Copied!' toast is fine; changing the value is not).
- Add a Content-Security-Policy and Subresource Integrity to reduce the chance of a third-party script being able to inject this behavior.
- **Legitimate copy-to-clipboard (no silent rewrite)** (javascript):
```javascript
button.addEventListener('click', () => {
  navigator.clipboard.writeText(codeSnippet);
  showToast('Copied!');
});
// Avoid overriding the native 'copy' event to swap in different content
```

---

## Category: cookies (30 checks)

### `cookie-domain-broad` [cookies / low / combined]
**Cookie Domain Attribute Is Too Broad**

A cookie is set with an explicit Domain= attribute that covers all subdomains (e.g., Domain=.example.com). This makes the cookie accessible from every subdomain, including potentially untrusted or third-party-hosted ones. Per RFC 6265, a leading dot is stripped and has no effect on browser behavior: Domain=example.com and Domain=.example.com are equally subdomain-wide, hence the same severity as cookie-domain-no-leading-dot.

**Risk:** A subdomain that is vulnerable to XSS, or that is under attacker control via subdomain takeover, can read or overwrite cookies scoped to the parent domain. Session cookies shared across all subdomains are particularly high-risk.

**Why it matters:** An explicit Domain= attribute (with or without leading dot) causes the browser to send the cookie to all subdomains of the specified domain. Omitting Domain entirely makes the cookie host-only, which is the safer default per RFC 6265bis.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265#section-4.1.2.3

**Fix:**
- Omit the Domain= attribute entirely to make the cookie host-only.
- If cross-subdomain sharing is required, explicitly enumerate the subdomains that need access and audit them for XSS.
- Use the __Host- prefix on session cookies to enforce host-only at the browser level.
- **Host-only cookie (omit Domain)** (http):
```http
Set-Cookie: session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
# Omitting Domain= makes this cookie host-only
```
- **__Host- prefix enforces host-only** (http):
```http
Set-Cookie: __Host-session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```

### `cookie-secure-missing` [cookies / low / combined]
**Cookie Missing Secure Attribute**

A cookie was set without the Secure attribute. Without Secure, the browser will send the cookie over both HTTP and HTTPS connections, exposing it to network interception.

**Risk:** An on-path attacker who can intercept plain HTTP traffic (Wi-Fi eavesdropping, SSRF, HTTP downgrade) receives the cookie in cleartext and can hijack the user's session.

**Why it matters:** The Secure attribute instructs the browser to transmit the cookie only over HTTPS connections. Without it, the cookie is also sent over plain HTTP. Even if the site enforces HTTPS via HSTS, mixed-content resources or HTTP redirects before HSTS kicks in can expose the cookie.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#restrict_access_to_cookies
- https://datatracker.ietf.org/doc/html/rfc6265#section-4.1.2.5

**Fix:**
- Add the Secure attribute to all cookies that carry session or authentication data.
- Prefer the __Host- or __Secure- prefix to enforce Secure at the browser level.
- Ensure the site is fully HTTPS and HSTS is configured.
- **Set-Cookie with Secure** (http):
```http
Set-Cookie: session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```
- **Node.js response.cookie()** (javascript):
```javascript
res.cookie('session', token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
});
```

### `cookie-partitioned-missing` [cookies / info / combined]
**Third-Party Cookie Missing Partitioned Attribute**

A third-party cookie is set without the Partitioned attribute (CHIPS). Browsers are phasing out third-party cookies without Partitioned, which will break this cookie's functionality in Chrome and other browsers.

**Risk:** Unpartitioned third-party cookies will be blocked by Chrome and other browsers. Services relying on them for embed functionality (widgets, analytics, support chat) will silently stop working for users in these browsers.

**Why it matters:** CHIPS (Cookies Having Independent Partitioned State) is a privacy-preserving third-party cookie mechanism. Partitioned cookies are keyed by both the cookie name and the top-level site, preventing cross-site tracking while allowing legitimate embed use cases.

**References:**
- https://developer.chrome.com/docs/privacy-sandbox/chips/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes

**Fix:**
- Add the Partitioned attribute alongside SameSite=None; Secure to all third-party cookies.
- Test in Chrome with Privacy Sandbox settings enabled to confirm the cookie is set correctly.
- **Partitioned Set-Cookie** (http):
```http
Set-Cookie: embed-session=xyz; SameSite=None; Secure; Partitioned; Path=/
```

### `cookie-host-prefix-not-secure` [cookies / high / header]
**__Host- Prefix Cookie Missing Secure Attribute**

__Host- prefixed cookies MUST carry the Secure attribute. Browsers reject __Host- cookies without Secure, and any server that sets one signals a misconfigured security control.

**Risk:** A __Host- cookie missing Secure will be silently rejected by the browser. If the application depends on this cookie for session management, users will be unexpectedly logged out or the security control it enforces will not function.

**Why it matters:** __Host- is a cookie prefix that enforces three requirements: Secure must be present, no Domain attribute allowed, and Path must be '/'. If any of these are absent, the browser ignores the __Host- semantics and may reject the cookie entirely.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-4.1.3.2

**Fix:**
- Add Secure; Path=/ to the __Host- cookie.
- Remove any Domain= attribute; __Host- cookies are always host-only.
- **Correct __Host- cookie** (http):
```http
Set-Cookie: __Host-session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```

### `cookie-host-prefix-wrong-path` [cookies / high / header]
**__Host- Prefix Cookie with Non-Root Path**

__Host- prefixed cookies MUST have Path=/. A __Host- cookie with a non-root path violates the cookie prefix requirements and will be rejected by compliant browsers.

**Risk:** The browser will reject a __Host- cookie with a non-root path. If the application depends on this cookie for session management, users will be unexpectedly logged out.

**Why it matters:** The __Host- prefix requires Path=/ to prevent the cookie from being scoped to a specific path. This ensures the cookie is usable by every route on the host, which is the security intent of __Host-.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-4.1.3.2

**Fix:**
- Change the Path attribute to Path=/ on any __Host- cookie.
- **Correct __Host- cookie** (http):
```http
Set-Cookie: __Host-session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```

### `cookie-secure-prefix-not-secure` [cookies / high / header]
**__Secure- Prefix Cookie Missing Secure Attribute**

__Secure- prefixed cookies MUST carry the Secure attribute. A __Secure- cookie without Secure will be rejected by compliant browsers.

**Risk:** The browser will reject a __Secure- cookie without Secure, silently breaking any functionality that depends on the cookie being set. If used for session management, users will be logged out.

**Why it matters:** The __Secure- prefix guarantees that the cookie was set over a secure connection and will only be transmitted over HTTPS. Without the Secure attribute, the prefix requirement is violated and the cookie is rejected.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-4.1.3.1

**Fix:**
- Add the Secure attribute to the __Secure- cookie.
- Ensure the page is served over HTTPS before setting the cookie.
- **Correct __Secure- cookie** (http):
```http
Set-Cookie: __Secure-token=abc123; HttpOnly; Secure; SameSite=Strict; Path=/account
```

### `cookie-expires-too-far` [cookies / low / header]
**Cookie Expires/Max-Age Exceeds 1 Year**

A cookie is set with an Expires or Max-Age value more than 1 year in the future. Long-lived cookies remain in browser storage indefinitely, increasing exposure from browser theft and reducing the effectiveness of logout.

**Risk:** A session cookie that persists for years can be stolen from a compromised device months after the original session ended. Long-lived cookies also violate GDPR and other privacy regulations requiring user data to not be retained longer than necessary.

**Why it matters:** Browser storage (including cookies) can be extracted from devices. Shorter cookie lifetimes limit the window during which a stolen cookie remains usable. Most privacy regulations recommend not storing tracking or session data beyond necessity.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#define_the_lifetime_of_a_cookie
- https://datatracker.ietf.org/doc/html/rfc6265#section-4.1.2.2

**Fix:**
- Limit session cookies to 7-30 days with idle timeout (invalidate server-side on inactivity).
- Limit preference/remember-me cookies to 90-365 days maximum.
- Implement server-side session rotation so long-lived cookies do not equal long-lived sessions.
- **Session cookie (7-day max)** (http):
```http
Set-Cookie: __Host-session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800
```

### `cookie-name-disclosure` [cookies / info / header]
**Cookie Name Leaks Framework or Language**

A cookie named PHPSESSID, JSESSIONID, express.sid, ASP.NET_SessionId, or similar reveals the server-side framework or language to any observer.

**Risk:** Knowing the server framework allows attackers to target known framework-specific CVEs, default configuration weaknesses, and deserialization vulnerabilities specific to PHP, Java, .NET, or Express.

**Why it matters:** Framework-specific cookie names are set by default in many web frameworks. Renaming them to generic identifiers removes one fingerprinting vector and slightly raises the bar for automated exploitation tooling that looks for specific cookie names.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

**Fix:**
- Configure your session middleware to use a custom, generic cookie name.
- Prefer the __Host- prefix for session cookies to gain both host-only enforcement and name opacity.
- **Express (custom session name)** (javascript):
```javascript
import session from 'express-session';

app.use(session({
  name: '__Host-sid', // Not 'express.sid' or 'connect.sid'
  secret: process.env.SESSION_SECRET,
  cookie: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
}));
```
- **PHP (custom session name)** (php):
```php
session_name('__Host-sid');
session_start();
```

### `cookie-domain-no-leading-dot` [cookies / low / header]
**Domain Attribute Without Leading Dot (RFC 6265bis)**

The Domain= attribute is set without a leading dot (e.g., Domain=example.com instead of Domain=.example.com). RFC 6265bis deprecates the leading dot, and modern browsers treat both forms identically. This is informational.

**Risk:** The presence of a leading dot has no practical difference in modern browsers: both forms enable subdomain sharing. The real risk is that any explicit Domain= attribute at all shares the cookie with all subdomains.

**Why it matters:** RFC 6265bis clarified that the leading dot in Domain= has no special meaning; user agents already treat Domain=.example.com and Domain=example.com identically. The important security consideration is whether any Domain= attribute is needed at all.

**References:**
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis

**Fix:**
- Drop the leading dot from Domain= attributes to align with RFC 6265bis.
- Consider removing Domain= entirely to make the cookie host-only.
- **Without leading dot (RFC 6265bis)** (http):
```http
Set-Cookie: session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=example.com
```

### `cookie-path-cross-app` [cookies / medium / header]
**Cookie Path Crosses Application Boundary**

A cookie with Path=/ is accessible to every route on the host, including routes served by different applications (e.g., /admin, /api, /blog). This broadens the cookie's exposure across trust boundaries.

**Risk:** An XSS vulnerability in a low-privilege application route (e.g., /blog) can steal session cookies intended only for /admin because all routes share the same cookie jar with Path=/.

**Why it matters:** Path=/ makes the cookie available to every route on the host. When a server runs multiple applications under different path prefixes, this means a cookie from one application is sent to all others, widening the XSS blast radius.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6265#section-5.2.1

**Fix:**
- Set the narrowest Path that the application actually needs.
- Use Path=/admin for admin-only cookies, Path=/api for API tokens, etc.
- For cookies that genuinely must be site-wide, ensure all paths enforce the same security controls.
- **Narrowly scoped path** (http):
```http
Set-Cookie: admin-session=abc123; HttpOnly; Secure; SameSite=Strict; Path=/admin
```

### `cookie-expires-in-past` [cookies / info / header]
**Cookie Expires Is in the Past**

A Set-Cookie header has an Expires value in the past, causing the browser to delete the cookie immediately. This is usually intentional on logout but may indicate a clock-skew bug on other pages.

**Risk:** If unintentional, an Expires value in the past causes the cookie to be deleted immediately, logging out the user or disabling functionality. On logout, it is correct behavior but should use Max-Age=0 which is more reliable across browsers.

**Why it matters:** A past Expires date causes user agents to delete the named cookie. Per RFC 6265, Max-Age takes precedence over Expires when both are present, so Max-Age=0 is the more portable mechanism for cookie deletion.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6265#section-4.1.1

**Fix:**
- Use Max-Age=0 instead of a past Expires date for explicit cookie deletion.
- If a past Expires is intentional (logout flow), confirm it only appears on logout endpoints.
- Audit for server clock skew if the past Expires appears on non-logout routes.
- **Correct logout cookie deletion** (http):
```http
Set-Cookie: __Host-session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0
```

### `cookie-max-age-zero` [cookies / info / header]
**Cookie Max-Age=0 Deletion Pattern**

Max-Age=0 instructs the browser to delete the named cookie immediately. This is the canonical cookie deletion pattern used on logout. Repeated occurrences outside logout endpoints may indicate a double-delete bug.

**Risk:** If Max-Age=0 is emitted on non-logout routes, it may unexpectedly delete user sessions or other cookies, causing functionality failures. If the same cookie is set and deleted in the same response, the deletion takes precedence in some browsers.

**Why it matters:** Max-Age=0 is the correct and portable way to delete a cookie. However, emitting it outside dedicated logout or session-reset endpoints indicates either a bug or a race condition where a cookie is being both set and deleted in the same response.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6265#section-4.1.1

**Fix:**
- Restrict Max-Age=0 Set-Cookie emission to logout and session-reset endpoints only.
- Verify no response sets and deletes the same cookie in the same response.
- **Logout endpoint cookie deletion** (typescript):
```typescript
// Only on the logout endpoint
res.setHeader('Set-Cookie', '__Host-session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
res.redirect('/');
```

### `cookie-no-samesite-third-party` [cookies / medium / header]
**Third-Party Cookie Without SameSite**

A cookie set in a third-party context (iframe, cross-site redirect) does not specify a SameSite attribute. Modern browsers default to SameSite=Lax and block the cookie in third-party contexts.

**Risk:** The cookie will be blocked by modern browsers (Chrome, Firefox, Safari) in third-party contexts, breaking embedded widget functionality, OAuth flows, or cross-site forms.

**Why it matters:** When a cookie is omitted SameSite, Chrome 80+ defaults to SameSite=Lax, which blocks the cookie in cross-site subresource requests. For intentional third-party cookies, SameSite=None; Secure is required. For first-party cookies, SameSite=Lax or Strict is safer.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies/SameSite
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-5.3.7

**Fix:**
- For first-party cookies: add SameSite=Lax (default for most login flows) or SameSite=Strict.
- For intentional third-party cookies: add SameSite=None; Secure; Partitioned.
- **Third-party cookie (CHIPS)** (http):
```http
Set-Cookie: embed-token=xyz; SameSite=None; Secure; Partitioned; Path=/
```
- **First-party SameSite=Lax** (http):
```http
Set-Cookie: __Host-session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```

### `cookie-partitioned-without-secure` [cookies / high / header]
**Partitioned Cookie Missing Secure Attribute**

A cookie carrying the Partitioned attribute (CHIPS) does not also carry the Secure attribute. Browsers require Partitioned cookies to be Secure; without it, the cookie is rejected.

**Risk:** The browser will silently reject the Partitioned cookie, breaking embed functionality for users in Chrome and other browsers that enforce this requirement.

**Why it matters:** CHIPS (Partitioned cookies) are designed for privacy-preserving third-party use cases. Because they are cross-site by design, browsers require them to be Secure to prevent them from being set or read over unencrypted connections.

**References:**
- https://developer.chrome.com/docs/privacy-sandbox/chips/
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis

**Fix:**
- Add Secure alongside Partitioned on every cookie that uses CHIPS.
- Ensure the host is served over HTTPS before setting Partitioned cookies.
- **Correct CHIPS cookie** (http):
```http
Set-Cookie: embed-session=xyz; SameSite=None; Secure; Partitioned; HttpOnly; Path=/
```

### `cookie-third-party-no-samesite-none-secure` [cookies / high / header]
**Third-Party Cookie Missing SameSite=None; Secure**

A cross-site cookie does not have both SameSite=None and Secure set. Without this combination, modern browsers will block the cookie in cross-site contexts.

**Risk:** The cookie is silently dropped in third-party contexts by Chrome, Firefox, and Safari. Cross-site embed functionality (payment widgets, analytics, OAuth flows) breaks for these users.

**Why it matters:** SameSite=None signals to the browser that the cookie is intentionally cross-site. The Secure requirement was added alongside SameSite=None to prevent cross-site cookies from being transmitted over HTTP where they could be stolen.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies/SameSite
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-5.3.7

**Fix:**
- Add SameSite=None; Secure to every cross-site cookie.
- Add Partitioned if the cookie is for embedded content (CHIPS requirement).
- **Cross-site cookie** (http):
```http
Set-Cookie: cross-site-token=xyz; SameSite=None; Secure; HttpOnly; Path=/
# If embedded content, also add: Partitioned
```

### `cookie-host-prefix-injection-subdomain` [cookies / high / header]
**Cookie Prefix Injection via User-Controlled Subdomain**

If user-controlled values (subdomain names, host headers, redirect targets) flow into cookie names without validation, an attacker can craft __Host- or __Secure- prefixed cookies from a controlled subdomain, enabling cookie fixation attacks.

**Risk:** An attacker who controls a subdomain or can inject a Host header can set __Host- prefixed cookies, which may overwrite the application's legitimate __Host- session cookie and fix a known session ID for session hijacking.

**Why it matters:** User-controlled values should never be used as cookie names. An attacker who can set a cookie named __Host-session from a compromised subdomain can fix a session ID and wait for an admin to log in with that fixed session.

**References:**
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-4.1.3.2

**Fix:**
- Never let user input flow into cookie names.
- Hard-code __Host-/__Secure- cookie names on the server; never derive them from request data.
- Audit subdomain takeover surface and co-tenanted subdomains.
- **Validate cookie names server-side** (typescript):
```typescript
// Never dynamically derive cookie names from user input
const COOKIE_NAME = '__Host-session'; // Hard-coded constant

res.setHeader('Set-Cookie',
  `<value>=<value>; Path=/; Secure; HttpOnly; SameSite=Lax`);
```

### `cookie-httponly-missing` [cookies / medium / header]
**Cookie Missing HttpOnly Attribute**

A session or authentication cookie is set without the HttpOnly attribute. Without HttpOnly, the cookie is accessible to JavaScript via document.cookie, making it stealable by any XSS vulnerability on the page.

**Risk:** A single XSS vulnerability anywhere on the site can steal all non-HttpOnly cookies. An attacker who exfiltrates the session cookie can authenticate as the victim from a different device, bypassing all client-side controls.

**Why it matters:** HttpOnly prevents JavaScript (including injected malicious scripts) from accessing the cookie via document.cookie. The cookie is still sent automatically by the browser on every HTTP request, so it works identically for server-side session management. Only browser JavaScript access is blocked.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#restrict_access_to_cookies
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

**Fix:**
- Add HttpOnly to all session, authentication, and CSRF cookies.
- Only omit HttpOnly for cookies that must be read by client-side JavaScript (e.g., a CSRF token that JS reads to include in request headers).
- **Set-Cookie with HttpOnly** (http):
```http
Set-Cookie: __Host-session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```
- **Node.js response.cookie()** (javascript):
```javascript
res.cookie('__Host-session', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
});
```

### `cookie-samesite-missing` [cookies / medium / header]
**Cookie Missing SameSite Attribute**

A cookie is set without the SameSite attribute. Without SameSite, the cookie is sent on all cross-site requests (or defaults to SameSite=Lax in modern browsers), potentially enabling CSRF attacks.

**Risk:** Without SameSite=Lax or Strict, cross-site POST requests (CSRF attacks) carry the session cookie. Older browsers that do not enforce a default SameSite will include the cookie in every cross-origin request.

**Why it matters:** SameSite controls whether a cookie is sent with cross-site requests. SameSite=Strict prevents the cookie from being sent on any cross-site request. SameSite=Lax (the browser default in Chrome) allows top-level navigation GET requests but blocks cross-site POST. Explicitly setting SameSite is more portable than relying on browser defaults.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies/SameSite
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

**Fix:**
- Add SameSite=Lax for most session cookies (allows OAuth redirects and link clicks to work).
- Add SameSite=Strict for admin or high-privilege cookies where cross-site navigation should not carry the session.
- Add SameSite=None; Secure only for cookies explicitly needed in third-party contexts.
- **SameSite=Lax (recommended default)** (http):
```http
Set-Cookie: __Host-session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```
- **SameSite=Strict (high-privilege)** (http):
```http
Set-Cookie: __Host-admin-token=xyz; HttpOnly; Secure; SameSite=Strict; Path=/admin
```

### `cookie-prefix-invalid` [cookies / high / header]
**Cookie Prefix Used Incorrectly**

A cookie uses the __Host- or __Secure- prefix but does not satisfy the prefix's requirements (Secure attribute, Path=/, no Domain= attribute for __Host-). The browser will reject or ignore the prefix semantics.

**Risk:** Invalid prefix usage means the browser does not enforce the security properties the prefix is supposed to guarantee, leaving the cookie vulnerable to subdomain override, HTTP transmission, or path-based injection attacks.

**Why it matters:** __Host- requires: Secure, Path=/, and no Domain=. __Secure- requires: Secure. If any required attribute is missing, compliant browsers either reject the cookie entirely or ignore the prefix, stripping its security guarantees.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-4.1.3

**Fix:**
- For __Host-: ensure Secure; Path=/; no Domain= is set.
- For __Secure-: ensure Secure is present.
- Validate all prefixed cookie names at startup with a unit test.
- **Correct __Host- cookie** (http):
```http
Set-Cookie: __Host-session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```
- **Correct __Secure- cookie** (http):
```http
Set-Cookie: __Secure-prefs=dark-mode; Secure; SameSite=Lax; Path=/settings
```

### `cookie-no-secure-prefix` [cookies / info / header]
**Sensitive Cookie Without __Secure- or __Host- Prefix**

A session or authentication cookie is set without using the __Host- or __Secure- cookie prefix. These prefixes provide browser-enforced security guarantees beyond what the Secure flag alone offers.

**Risk:** Without a security prefix, attributes like Secure, Path=/, and no Domain= are self-declared but not enforced by the browser. A subdomain that sets the same cookie name without Secure can override the parent domain's cookie.

**Why it matters:** Cookie prefixes are a defense-in-depth mechanism. __Host- guarantees (at the browser level) that the cookie: was set over HTTPS, is only sent to the exact host, has Path=/, and was not set with a Domain= attribute. These properties cannot be overridden by a subdomain or HTTP response.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-4.1.3

**Fix:**
- Rename session and auth cookies with the __Host- prefix.
- Remove Domain= attribute; __Host- is always host-only.
- Verify the site is HTTPS-only before deploying __Host- cookies.
- **__Host- prefixed session cookie** (http):
```http
Set-Cookie: __Host-session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```

### `set-cookie-samesite-none-no-secure` [cookies / high / header]
**SameSite=None Cookie Missing Secure Attribute**

A cookie is set with SameSite=None but without the Secure attribute. Modern browsers reject SameSite=None cookies that are not also Secure.

**Risk:** The browser will reject this cookie in cross-site contexts. If the site depends on this cookie for third-party embed functionality, that functionality silently breaks for all modern browsers.

**Why it matters:** SameSite=None was introduced to explicitly allow cross-site cookies. To prevent cleartext transmission of cross-site cookies, browsers require SameSite=None to always be paired with Secure. A SameSite=None cookie without Secure is treated as invalid.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies/SameSite
- https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-5.3.7

**Fix:**
- Add Secure to every cookie that uses SameSite=None.
- Add Partitioned if the cookie is for embedded third-party content.
- **Correct SameSite=None cookie** (http):
```http
Set-Cookie: embed-token=xyz; SameSite=None; Secure; HttpOnly; Path=/
```

### `session-cookie-flags` [cookies / high / header]
**Session Cookie Missing Security Flags**

A session cookie (identified by name pattern: session, sid, auth, token) is missing one or more critical security attributes: HttpOnly, Secure, or SameSite.

**Risk:** A session cookie without HttpOnly is stealable via XSS. Without Secure it can be intercepted on HTTP. Without SameSite it is vulnerable to CSRF. Missing any one of these flags weakens the session's resistance to common attacks.

**Why it matters:** Session cookies are the primary authentication token in most web applications. They require all three protections: HttpOnly (no JS access), Secure (HTTPS only), and SameSite (CSRF protection). Omitting any one creates a gap that specific attacks exploit.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies

**Fix:**
- Ensure session cookies have HttpOnly; Secure; SameSite=Lax (minimum) or SameSite=Strict.
- Use the __Host- prefix to enforce these properties at the browser level.
- **Fully secured session cookie** (http):
```http
Set-Cookie: __Host-session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```
- **Node.js (express-session)** (javascript):
```javascript
app.use(session({
  name: '__Host-sid',
  secret: process.env.SESSION_SECRET,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
  resave: false,
  saveUninitialized: false,
}));
```

### `cookie-domain-set-too-loose` [cookies / medium / header]
**Cookie Domain Scoped to Parent Domain**

A cookie is set with Domain= pointing to a parent domain rather than the exact host. This makes the cookie available to all subdomains of the parent domain, including potentially compromised or third-party subdomains.

**Risk:** Any subdomain of the parent domain can read this cookie. A subdomain that is vulnerable to XSS or subject to subdomain takeover can steal the session cookie for the entire domain.

**Why it matters:** Setting Domain=example.com sends the cookie to every subdomain: www.example.com, api.example.com, dev.example.com, staging.example.com, etc. Each of these subdomains is a potential attack vector. Omitting Domain= restricts the cookie to the exact host that set it.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- https://datatracker.ietf.org/doc/html/rfc6265#section-4.1.2.3

**Fix:**
- Remove the Domain= attribute to make the cookie host-only.
- If cross-subdomain sharing is required, use __Host- prefix where possible and audit all receiving subdomains.
- **Host-only (no Domain=)** (http):
```http
Set-Cookie: __Host-session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```

### `cookie-no-csrf-token` [cookies / medium / header]
**No CSRF Token Cookie Detected**

The application uses session cookies but no CSRF token cookie was observed. Without CSRF protection, state-changing requests (POST, PUT, DELETE) may be triggered by cross-site requests from malicious pages.

**Risk:** Cross-Site Request Forgery (CSRF) attacks allow a malicious site to trigger state-changing actions (password change, fund transfer, account deletion) using the victim's authenticated session. SameSite=Lax mitigates most CSRF but does not cover all scenarios.

**Why it matters:** CSRF tokens provide defense-in-depth alongside SameSite cookies. A CSRF token is a per-session or per-form random value that the server verifies on every state-changing request. The token is inaccessible to attacker-controlled pages (different origin) because it is tied to the specific user's session.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

**Fix:**
- Set a CSRF token in a non-HttpOnly cookie so JavaScript can read and include it in request headers.
- Or use the Double Submit Cookie pattern with a signed token.
- Alternatively, rely on SameSite=Strict for high-privilege operations and validate the Origin header.
- **CSRF token cookie (double-submit pattern)** (http):
```http
Set-Cookie: csrf-token=<random-secure-token>; Secure; SameSite=Strict; Path=/
```
- **Read and send CSRF token in requests** (javascript):
```javascript
// Client reads CSRF token from cookie (not HttpOnly)
const csrfToken = document.cookie.match(/csrf-token=([^;]+)/)?.[1];

fetch('/api/transfer', {
  method: 'POST',
  headers: { 'X-CSRF-Token': csrfToken },
  body: JSON.stringify({ amount: 100 }),
});
```

### `cookie-samesite-invalid-value` [cookies / low / header]
**Cookie Has an Invalid SameSite Value**

A cookie sets a SameSite attribute to a value other than Strict, Lax, or None.

**Risk:** Browsers reject or reinterpret unrecognized SameSite values (commonly falling back to Lax), so the CSRF protection the developer intended to configure may not actually be in effect.

**Why it matters:** SameSite only accepts three defined values: Strict, Lax, and None. A typo (e.g. 'Strong', 'Same-Site', an empty value) silently loses the intended protection instead of raising an error, because cookie attributes fail open by design.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite

**Fix:**
- Set SameSite to exactly Strict, Lax, or None (case-insensitive) with no typos.
- If using None, always pair it with the Secure attribute.
- Add an automated test that parses Set-Cookie headers and validates attribute values.
- **Correct SameSite value** (text):
```text
Set-Cookie: session=abc123; Secure; HttpOnly; SameSite=Strict
```

### `cookie-duplicate-name-different-path` [cookies / low / header]
**Cookie Set Multiple Times With Different Paths**

The same cookie name is set more than once in the response, each with a different Path attribute.

**Risk:** The browser stores both cookies simultaneously and sends whichever one matches the current request path, so server-side code reading a single 'the' value for that name can silently read stale or unintended data.

**Why it matters:** Cookies are keyed by (name, domain, path) as a tuple, not by name alone. Setting 'session' at Path=/ and again at Path=/app creates two independent cookies that both appear as 'session' in document.cookie on paths under /app, and which one wins depends on cookie ordering rules that vary by browser.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie

**Fix:**
- Use a single, consistent Path (usually /) for each cookie name across the whole application.
- If you need path-scoped cookies, give them distinct names instead of relying on Path to disambiguate.
- **Use one Path per cookie name** (text):
```text
Set-Cookie: session=abc123; Path=/; Secure; HttpOnly; SameSite=Lax
```

### `cookie-jwt-value-not-httponly` [cookies / high / header]
**JWT-Shaped Cookie Missing HttpOnly**

A cookie whose value has the three-part base64url.base64url.base64url shape of a JWT is missing the HttpOnly attribute.

**Risk:** Any script running on the page, including one injected via XSS or a compromised third-party dependency, can read document.cookie and exfiltrate the token, giving the attacker a valid, unexpired session.

**Why it matters:** A cookie value matching the JWT structure is almost always a session or access token. Storing it without HttpOnly makes it readable from JavaScript, which defeats the entire point of using a cookie (rather than localStorage) as the storage mechanism in the first place.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

**Fix:**
- Set the HttpOnly attribute on any cookie carrying a JWT or other bearer token.
- If client-side JavaScript genuinely needs to read the token, split it: keep the signature in an HttpOnly cookie and issue a separate non-sensitive value for JS to read.
- **Set HttpOnly on a JWT cookie** (text):
```text
Set-Cookie: access_token=eyJhbGciOi...; HttpOnly; Secure; SameSite=Lax; Path=/
```

### `f5-bigip-cookie-exposes-internal-ip` [cookies / medium / header]
**F5 BIG-IP Cookie May Expose Internal IP**

An F5 BIG-IP persistence cookie (BIGipServer*) was observed. Depending on the load balancer's configuration, its value can encode the internal pool member's IP address and port.

**Risk:** An attacker who decodes the cookie value learns internal network topology (private IP ranges, port numbers) that would otherwise not be reachable from outside the network, aiding further attacks.

**Why it matters:** By default, F5 BIG-IP's cookie-based persistence encodes the selected pool member's IP and port directly in the cookie value using a simple, publicly documented, reversible encoding. F5 supports an 'insert' mode with encryption to prevent this, but it is not the default in every configuration.

**References:**
- https://my.f5.com/manage/s/article/K6917

**Fix:**
- Enable cookie encryption for BIG-IP persistence cookies (LTM Cookie Encryption).
- Alternatively, switch to an opaque session-based persistence method that does not embed pool member details in the cookie.
- Ensure internal pool member IPs are not otherwise reachable even if disclosed.
- **Enable BIG-IP cookie encryption (tmsh)** (bash):
```bash
tmsh modify ltm profile cookie-persistence my_cookie_persist cookie-encryption required cookie-encryption-passphrase <passphrase>
```

### `netscaler-cookie-exposes-internal-server` [cookies / low / header]
**Citrix NetScaler Cookie May Expose Internal Server**

A Citrix NetScaler/ADC persistence cookie (NSC_* or citrix_ns_id) was observed, which can encode backend server details depending on configuration.

**Risk:** If the deployment uses legacy plaintext cookie persistence rather than the default obfuscated/hashed form, the cookie can reveal the internal backend server's IP and port to anyone who receives it.

**Why it matters:** NetScaler's cookie-based server persistence stores an identifier for the selected backend server in the cookie. Modern default configurations obfuscate this value, but legacy or misconfigured deployments can still expose it in a decodable form.

**References:**
- https://support.citrix.com/article/CTX200329

**Fix:**
- Confirm the NetScaler persistence configuration uses encrypted or securely hashed server identifiers, not plaintext IP encoding.
- Restrict which backend details are derivable from a client-visible cookie regardless of encoding.
- **Reference** (text):
```text
# Verify persistence cookie mode in the Citrix ADC configuration:
# show lb group <name>
# Ensure cookie persistence is not using plaintext server encoding.
```

### `cookie-maxage-expires-conflict` [cookies / low / header]
**Cookie Max-Age and Expires Disagree**

A cookie sets both Max-Age and Expires with lifetimes that differ by more than an hour.

**Risk:** Modern browsers use Max-Age and ignore Expires when both are present, but any legacy client, proxy, or custom HTTP client that only understands Expires will apply a different session lifetime than the one the application intended, which can extend a session's exposure window well beyond what was intended.

**Why it matters:** RFC 6265 says Max-Age takes precedence over Expires when both are set, but the two are usually generated from the same source value. A large mismatch typically means a bug (e.g. Expires computed from a stale timestamp, or a hardcoded date left over from testing) rather than an intentional dual-lifetime design.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie

**Fix:**
- Compute Max-Age and Expires from the same expiration timestamp so they always agree.
- Prefer setting only Max-Age in modern applications and drop Expires unless a legacy client requires it.
- **Derive both from one timestamp** (typescript):
```typescript
const maxAgeSeconds = 3600;
const expires = new Date(Date.now() + maxAgeSeconds * 1000).toUTCString();
res.setHeader('Set-Cookie', `session=abc123; Max-Age=<value>; Expires=<value>; Secure; HttpOnly`);
```

---

## Category: dns (13 checks)

### `dns-caa-record-missing` [dns / medium / header]
**CAA Record Missing**

No Certification Authority Authorization (CAA) DNS record exists for this domain. CAA records restrict which CAs are permitted to issue certificates for your domain, reducing the risk of misissued certificates.

**Risk:** Without a CAA record, any publicly trusted CA can issue a certificate for your domain. A compromised or rogue CA could issue a certificate that allows MITM attacks on your site.

**Why it matters:** CAA records (RFC 8659) let domain owners declare which CAs are authorized to issue certificates. When a CA checks for CAA before issuance (now mandatory per CA/Browser Forum), only listed CAs can issue. An empty policy defaults to permitting all CAs.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8659
- https://letsencrypt.org/docs/caa/

**Fix:**
- Publish a CAA record listing your CA(s) and optionally an issuewild for wildcard certs.
- Add an iodef address to receive issuance violation reports.
- Verify with: dig +short CAA example.com
- **DNS zone file** (dns):
```dns
example.com. IN CAA 0 issue "letsencrypt.org"
example.com. IN CAA 0 issue "digicert.com"
example.com. IN CAA 0 issuewild "letsencrypt.org"
example.com. IN CAA 0 iodef "mailto:security@example.com"
```
- **Verify CAA** (bash):
```bash
dig +short CAA example.com
```

### `dns-ns-record-count` [dns / high / header]
**Less Than 2 Authoritative Nameservers**

RFC 1035 requires at least two authoritative nameservers for redundancy. A single NS means the entire domain goes dark when that server is unreachable.

**Risk:** If the single authoritative nameserver goes offline, the entire domain becomes unreachable. Attackers who DoS or compromise one server can take your domain offline.

**Why it matters:** DNS relies on redundant nameservers to prevent single points of failure. Having only one NS means any outage, DDoS, or maintenance window makes your entire domain unreachable for all users.

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1035

**Fix:**
- Add a second NS record pointing to a nameserver on a different subnet or provider.
- Consider using a managed DNS provider (Cloudflare, Route 53, NS1) which provides multiple geographically distributed nameservers automatically.
- **Check NS records** (bash):
```bash
dig +short NS example.com
```
- **DNS zone file: two NS** (dns):
```dns
example.com. IN NS ns1.example.com.
example.com. IN NS ns2.example-backup.com.
```

### `dns-mx-record-missing` [dns / medium / header]
**MX Record Missing**

No MX record exists for this domain. Domains that send or receive email must have an MX record. Without it, mail delivery to this domain fails and email spoofing countermeasures (SPF/DMARC) lack a target.

**Risk:** Without MX records, inbound mail to this domain bounces. If the domain is used to send mail without an MX record, receiving servers may treat it as a red flag and mark mail as spam.

**Why it matters:** MX records direct incoming mail to the correct mail server. Their absence means the domain cannot receive email. DMARC and SPF records also become less meaningful without a functioning mail infrastructure.

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc5321

**Fix:**
- Publish an MX record pointing to your mail server with the appropriate priority.
- Verify with: dig +short MX example.com
- **DNS zone file** (dns):
```dns
example.com. IN MX 10 mail.example.com.
example.com. IN MX 20 mail-backup.example.com.
```
- **Verify MX** (bash):
```bash
dig +short MX example.com
```

### `dns-mx-backup-record` [dns / low / header]
**No Backup MX Server**

Only a single MX server exists with no higher-priority fallback. If the primary MX goes down, inbound mail is lost or deferred until the server recovers.

**Risk:** During primary MX outages, inbound mail queues at the sender for minutes or hours. If the outage is long enough, senders give up and mail is permanently lost.

**Why it matters:** Multiple MX records with different priorities provide redundancy. When the primary MX (lowest number) is unreachable, senders try the next MX (higher number). This prevents mail loss during maintenance or outages.

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc5321

**Fix:**
- Add a backup MX with a higher priority number (e.g., 20 or 30).
- The backup can be a cloud mail relay or a secondary mail server.
- **DNS zone file** (dns):
```dns
example.com. IN MX 10 mail.example.com.       ; primary
example.com. IN MX 20 backup-mail.example.com. ; backup
```

### `dns-ds-record-missing` [dns / medium / header]
**DNSSEC DS Record Missing**

No DS (Delegation Signer) record exists in the parent zone for this domain. DS records are required to establish the DNSSEC chain of trust from the parent zone to the child zone.

**Risk:** Without a DS record in the parent zone, DNSSEC validation fails or is bypassed entirely. Resolvers cannot build a chain of trust and may treat the zone as unsigned, allowing DNS cache poisoning attacks.

**Why it matters:** DNSSEC works by creating a chain of trust from the DNS root down to the domain. The DS record in the parent zone (e.g., the TLD) contains a hash of the child zone's DNSKEY, linking the two zones together. Without the DS record, even a fully signed child zone cannot be validated by resolvers.

**References:**
- https://datatracker.ietf.org/doc/html/rfc4034
- https://datatracker.ietf.org/doc/html/rfc4035

**Fix:**
- Generate DNSSEC keys for your zone using your DNS provider or BIND.
- Submit the DS record to your domain registrar to publish it in the parent TLD zone.
- Verify the chain: dig +dnssec DS example.com
- **Check DS record** (bash):
```bash
dig +short DS example.com @1.1.1.1
```
- **Verify DNSSEC chain** (bash):
```bash
dig +dnssec +multiline A example.com | grep -E '(RRSIG|NSEC|ad)'
```

### `dns-soa-refresh-high` [dns / low / header]
**SOA Refresh Interval Too High**

The SOA refresh interval is above 24 hours. This slows propagation of zone changes to secondary nameservers, increasing the time it takes for NS record updates to take effect.

**Risk:** During incident response or planned NS rollover, stale secondary nameservers continue serving old data for up to the refresh interval, delaying changes and potentially causing resolution failures.

**Why it matters:** The SOA refresh value tells secondary nameservers how often to check the primary for zone updates. A value above 86400 seconds (24h) means secondaries may serve outdated zone data for a full day after a change.

**References:**
- https://datatracker.ietf.org/doc/html/rfc1035
- https://datatracker.ietf.org/doc/html/rfc2182

**Fix:**
- Lower the refresh interval to 3600-7200 seconds for zones that change frequently.
- Verify your SOA: dig SOA example.com
- **DNS zone file SOA** (dns):
```dns
example.com. IN SOA ns1.example.com. hostmaster.example.com. (
  2024010101 ; serial
  3600       ; refresh (1 hour)
  900        ; retry (15 min)
  604800     ; expire (1 week)
  300        ; negative TTL (5 min)
)
```
- **Check SOA** (bash):
```bash
dig +short SOA example.com
```

### `dns-tlsa-record-missing` [dns / info / header]
**TLSA (DANE) Record Missing**

No TLSA record exists at _443._tcp.yourdomain.com. TLSA records (DANE) pin the expected TLS certificate or public key in DNS, providing an additional layer of verification beyond CA trust.

**Risk:** Without TLSA, certificate validation relies entirely on the CA ecosystem. A compromised or rogue CA can issue fraudulent certificates that pass standard TLS validation.

**Why it matters:** DANE (DNS-Based Authentication of Named Entities) uses DNSSEC-secured TLSA records to bind certificates or public keys to DNS names. With DNSSEC + TLSA, a client can verify that the certificate presented matches what the domain owner published, independently of the CA.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6698
- https://datatracker.ietf.org/doc/html/rfc7671

**Fix:**
- Enable DNSSEC for your domain first.
- Publish a TLSA record at _443._tcp.yourdomain.com.
- Verify: dig +short TLSA _443._tcp.example.com
- **Generate TLSA record** (bash):
```bash
# TLSA 3 1 1 = domain-issued cert, SubjectPublicKeyInfo, SHA-256
openssl s_client -connect example.com:443 < /dev/null 2>/dev/null | \
  openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER | \
  openssl dgst -sha256 -binary | xxd -p -c 32
```
- **DNS zone file** (dns):
```dns
_443._tcp.example.com. IN TLSA 3 1 1 <sha256-hash-of-pubkey>
```

### `dns-dangling-cname` [dns / high / header]
**Dangling CNAME Record (Subdomain Takeover Risk)**

A CNAME record points to a hostname that no longer resolves. If the target service (e.g., Heroku, AWS, Fastly) is unregistered, an attacker can register it and serve content from your subdomain.

**Risk:** Subdomain takeover lets attackers serve malicious content on your subdomain, steal session cookies scoped to the parent domain, bypass CSP using your origin, and conduct phishing attacks that appear to originate from your domain.

**Why it matters:** When a CNAME points to an abandoned cloud resource (defunct Heroku app, removed S3 bucket, cancelled Azure CDN), the DNS entry remains while the cloud resource is gone. Anyone who claims that cloud resource now controls what is served from your subdomain.

**References:**
- https://github.com/EdOverflow/can-i-take-over-xyz
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/10-Test_for_Subdomain_Takeover

**Fix:**
- Remove CNAME records that point to decommissioned services.
- Regularly audit all CNAME records against active cloud resources.
- Use automated tooling (subjack, nuclei subdomain-takeover templates) for continuous monitoring.
- **Check CNAME resolution** (bash):
```bash
# Check if CNAME target resolves
for sub in staging dev api; do
  target=$(dig +short CNAME <value>.example.com)
  [ -n "$target" ] && echo "<value> -> $target: $(dig +short $target | head -1)"
done
```

### `dns-resolves` [dns / info / header]
**DNS A/AAAA Resolution**

Async check: resolves A and AAAA records for the target hostname. Reports whether the domain resolves at all and flags private, loopback, or link-local addresses that should not appear in public DNS.

**Risk:** Private IPs in public DNS reveal internal network topology and can indicate dangling records or takeover risk for cloud-provisioned addresses.

**Why it matters:** DNS resolution is the first step of every scan. If the resolver returns RFC1918 (10.x, 172.16-31.x, 192.168.x), loopback (127.x), or link-local (169.254.x) addresses for a public hostname, the target may not be publicly reachable or may expose internal infrastructure.

**References:**
- https://datatracker.ietf.org/doc/html/rfc1034
- https://datatracker.ietf.org/doc/html/rfc1918

**Fix:**
- Remove A/AAAA records pointing to internal or private IP ranges from public DNS.
- Audit CNAME chains for dangling-takeover risk (Cloudfront, Heroku, GitHub Pages, etc.).
- Use split-horizon DNS only where appropriate and audit both views.
- **Check A and AAAA** (bash):
```bash
dig +short A example.com
dig +short AAAA example.com
```

### `dns-dangling-cname-cdn-paas` [dns / high / header]
**Dangling CNAME (CDN/PaaS Takeover)**

A CNAME points to GitHub Pages (github.io), Heroku (herokuapp.com), AWS CloudFront, Azure CDN (azurewebsites.net/azureedge.net), Fastly, or Netlify, and the target no longer resolves. Attackers can register the orphan resource and serve content from your subdomain.

**Risk:** Subdomain takeover via CDN/PaaS enables phishing using your domain name, cookie theft for cookies scoped to the parent domain, bypass of CSP using your origin, and Content Security Policy violations.

**Why it matters:** When you remove a CDN resource (delete a Heroku app, unpublish a GitHub Pages site, remove a CloudFront distribution) without removing the DNS CNAME record, the record still points at a now-unclaimed namespace. Anyone who registers a new resource at that provider can then claim your subdomain.

**References:**
- https://github.com/EdOverflow/can-i-take-over-xyz
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/10-Test_for_Subdomain_Takeover

**Fix:**
- Audit all CNAMEs targeting GitHub, Heroku, AWS, Azure, Fastly, and Netlify.
- Remove CNAMEs whose backing service no longer resolves.
- Verify takeover feasibility at https://github.com/EdOverflow/can-i-take-over-xyz
- **Check CNAME targets** (bash):
```bash
dig +short CNAME staging.example.com
# If it returns e.g. myapp.herokuapp.com., verify the app exists:
curl -I https://myapp.herokuapp.com/
```

### `dns-dangling-cname-saas` [dns / high / header]
**Dangling CNAME (SaaS Takeover)**

A CNAME points to a SaaS provider (Zendesk, HelpScout, Intercom, Drift, statuspage.io, Pingdom, Pantheon, Acquia, WP Engine) and the target no longer resolves. Attackers can claim the namespace on your subdomain.

**Risk:** SaaS subdomain takeover enables phishing and impersonation of your support and help-center pages (help.example.com, status.example.com), eroding customer trust and enabling credential theft.

**Why it matters:** SaaS subdomain takeover follows the same pattern as CDN takeover: a CNAME points to a provider-hosted namespace that was previously claimed by your account but is now unclaimed. Attackers register a new account at the provider and claim that namespace.

**References:**
- https://github.com/EdOverflow/can-i-take-over-xyz
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/10-Test_for_Subdomain_Takeover

**Fix:**
- Audit all CNAMEs targeting customer-support SaaS providers.
- Remove dangling entries or re-register the integration if still needed.
- Set up automated monitoring with subjack, nuclei, or can-i-take-over-xyz.
- **Check for dangling CNAME** (bash):
```bash
# Check if target resolves
target=$(dig +short CNAME help.example.com)
echo "CNAME target: $target"
dig +short A $target || echo "Target does not resolve: possible takeover"
```

### `dns-zone-transfer-allowed` [dns / high / header]
**DNS Zone Transfer (AXFR) Allowed from Public IPs**

The authoritative nameserver responds to AXFR (zone transfer) requests from arbitrary sources. Zone transfers expose every hostname, IP, and record in the zone to anyone who asks.

**Risk:** An attacker who downloads the full zone file gains a complete map of all hostnames and IP addresses in your domain, including internal services, staging environments, and management interfaces not intended for public discovery.

**Why it matters:** AXFR is the DNS protocol for transferring an entire zone from primary to secondary nameservers. When enabled without IP restrictions, any Internet host can download a complete inventory of your DNS zone, revealing infrastructure that should not be public.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5936
- https://datatracker.ietf.org/doc/html/rfc1034

**Fix:**
- Restrict AXFR to known secondary nameserver IPs in BIND or your DNS provider.
- Test: dig AXFR example.com @ns1.example.com (should return REFUSED)
- **BIND named.conf** (bind):
```bind
zone "example.com" {
  type master;
  file "/etc/bind/db.example.com";
  allow-transfer { 192.0.2.10; 198.51.100.20; };  // secondary NS IPs only
};
```
- **Test zone transfer** (bash):
```bash
dig AXFR example.com @ns1.example.com
# Should return: Transfer failed. or REFUSED
```

### `dns-dnskey-record-missing` [dns / medium / header]
**DNSKEY Record Missing**

No DNSKEY records are present in the zone. DNSKEY records publish the public keys used to sign the zone and are required for DNSSEC validation to work.

**Risk:** Without DNSKEY records, no DNSSEC validation is possible for this zone. Resolvers cannot verify DNS responses, leaving the domain vulnerable to cache poisoning (Kaminsky-style) attacks.

**Why it matters:** DNSKEY records hold the public keys that correspond to the private keys used to sign DNS records (RRSIG). There are two types: KSK (Key Signing Key, flags 257) signs the DNSKEY RRset, and ZSK (Zone Signing Key, flags 256) signs all other RRsets. Both are needed for a fully signed zone.

**References:**
- https://datatracker.ietf.org/doc/html/rfc4034
- https://datatracker.ietf.org/doc/html/rfc4035

**Fix:**
- Enable DNSSEC signing on your authoritative DNS server.
- Generate KSK and ZSK key pairs and sign the zone.
- Submit the DS record (derived from the KSK) to your domain registrar.
- Verify: dig +dnssec DNSKEY example.com
- **Check DNSKEY** (bash):
```bash
dig +short DNSKEY example.com
# Should return two records: KSK (flags 257) and ZSK (flags 256)
```
- **BIND: generate DNSSEC keys** (bash):
```bash
# Generate KSK
dnssec-keygen -a ECDSAP256SHA256 -f KSK -n ZONE example.com
# Generate ZSK
dnssec-keygen -a ECDSAP256SHA256 -n ZONE example.com
```

---

## Category: email (18 checks)

### `email-dmarc-ruf-missing` [email / low / header]
**DMARC Forensic Report URI (ruf=) Missing**

The DMARC record does not include a ruf= tag specifying a forensic report URI. Forensic reports contain message samples from emails that fail DMARC, which are invaluable for diagnosing spoofing attempts.

**Risk:** Without ruf=, you receive no forensic reports about individual spoofed messages targeting your domain. Active spoofing campaigns may go undetected until end users report them.

**Why it matters:** DMARC defines two reporting channels: rua= (aggregate reports, delivered daily) and ruf= (forensic reports, delivered per-failure). Forensic reports include message headers and sometimes body excerpts from emails that failed DMARC. They give you actionable intelligence about spoofing attempts and legitimate mail that is misconfigured.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7489#section-6.2
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html

**Fix:**
- Add ruf=mailto:dmarc-forensic@yourdomain.com to your _dmarc TXT record.
- Use a dedicated inbox or a DMARC reporting service that can parse and alert on forensic reports.
- Note: some receivers do not send forensic reports for privacy reasons.
- **DNS TXT record** (dns):
```dns
_dmarc.example.com. IN TXT "v=DMARC1; p=reject; rua=mailto:dmarc-agg@example.com; ruf=mailto:dmarc-forensic@example.com; adkim=s; aspf=s"
```

### `email-dmarc-rua-missing` [email / medium / header]
**DMARC Aggregate Report URI (rua=) Missing**

The DMARC record does not include an rua= tag. Without aggregate reports, you have no visibility into how receivers are handling mail from your domain, and you cannot see if your legitimate mail is failing authentication.

**Risk:** Without rua= aggregate reports, you cannot detect SPF/DKIM misconfigurations in your mail stack, identify unauthorized senders using your domain, or track the effectiveness of your DMARC policy rollout.

**Why it matters:** DMARC aggregate reports (rua=) are sent daily by receivers that process mail claiming to come from your domain. They summarize how many messages passed and failed SPF and DKIM checks. Without them, you are flying blind: your policy may be blocking legitimate mail or letting through spoofed mail without you knowing.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7489#section-6.2
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html

**Fix:**
- Add rua=mailto:dmarc-reports@yourdomain.com to your _dmarc TXT record.
- Consider using a DMARC reporting service (Postmark, Dmarcian, Valimail) to parse and visualize aggregate reports.
- Review reports weekly while rolling out DMARC to catch legitimate mail failures before tightening policy.
- **DNS TXT record** (dns):
```dns
_dmarc.example.com. IN TXT "v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com"
# Start with p=none to monitor, then move to p=quarantine, then p=reject
```

### `mta-sts` [email / medium / header]
**MTA-STS (SMTP Strict Transport Security)**

Async check: probes _mta-sts.<domain> for a v=STSv1 TXT record and fetches the policy file at mta-sts.<domain>/.well-known/mta-sts.txt.

**Risk:** Without MTA-STS, inbound SMTP sessions can be downgraded from STARTTLS to plaintext by a network attacker, exposing all email content and credentials.

**Why it matters:** MTA-STS tells sending mail servers to require TLS and refuse to deliver mail if TLS cannot be established. Without it, opportunistic STARTTLS can be stripped by a MITM between sending and receiving mail servers.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8461
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html

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
- **DNS TXT** (dns):
```dns
_mta-sts.example.com. IN TXT "v=STSv1; id=20240101000000"
```

### `email-tls-rpt-rua-missing` [email / info / header]
**TLS-RPT (SMTP TLS Reporting) Missing**

Async check: probes _smtp._tls.<domain> for a v=TLSRPTv1 TXT record. TLS-RPT sends reports about SMTP TLS failures to the specified address.

**Risk:** Without TLS-RPT you receive no telemetry about SMTP TLS failures. STARTTLS downgrade attacks and certificate validation errors go undetected.

**Why it matters:** TLS-RPT is a companion to MTA-STS: it tells receivers where to send aggregate reports about SMTP TLS negotiation failures. Reports help you detect misconfigured certificates, policy violations, and potential STARTTLS stripping.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8460
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html

**Fix:**
- Publish _smtp._tls.<domain> TXT with v=TLSRPTv1; rua=https://...
- **DNS TXT** (dns):
```dns
_smtp._tls.example.com. IN TXT "v=TLSRPTv1; rua=mailto:tls-reports@example.com"
```

### `email-spf-lookup-count-too-high` [email / high / header]
**SPF Exceeds 10 DNS Lookup Limit**

The SPF record triggers more than 10 DNS lookups during evaluation. RFC 7208 mandates a maximum of 10 DNS lookups; exceeding this causes a permerror, causing SPF to fail for all messages.

**Risk:** When SPF returns permerror due to too many lookups, receivers may treat all mail from your domain as unauthenticated. Combined with a DMARC p=reject policy, this causes legitimate mail to be rejected.

**Why it matters:** Each include:, a:, mx:, ptr:, and exists: mechanism in SPF counts as a DNS lookup. Nested includes recursively count their own lookups against the 10-lookup limit. Exceeding this limit results in a permerror, which some receivers treat as a hard fail.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7208#section-4.6.4

**Fix:**
- Replace include: for senders with static IP ranges using ip4: or ip6: mechanisms.
- Flatten deeply nested SPF includes using tools like dmarcian's SPF Surveyor.
- Verify the lookup count with: dig TXT example.com | grep v=spf1
- **Flattened SPF** (dns):
```dns
example.com. IN TXT "v=spf1 ip4:203.0.113.0/24 ip4:198.51.100.10 include:_spf.google.com -all"
# Use ip4:/ip6: instead of include: where possible
```

### `email-spf-redirect-loop` [email / high / header]
**SPF Redirect Loop**

The SPF record contains a redirect= modifier that creates a circular reference back to the original domain, causing infinite recursion and a permerror.

**Risk:** A redirect loop causes permerror on every SPF check, making all mail from your domain unauthenticated and subject to rejection by strict DMARC policies.

**Why it matters:** The SPF redirect= modifier replaces the current domain's SPF policy with another domain's policy. If that domain's SPF record redirects back to the original domain (directly or via a chain), SPF evaluators detect the loop and return permerror.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7208#section-6.1

**Fix:**
- Audit the redirect chain and remove the circular reference.
- Replace redirect= with include: where appropriate, or consolidate SPF records into a single authoritative record.
- **Detect the loop** (bash):
```bash
dig +short TXT example.com | grep v=spf1
dig +short TXT redirecttarget.com | grep v=spf1
# Trace until you find the circular reference
```

### `email-dmarc-pct-not-100` [email / low / header]
**DMARC pct= Below 100**

The DMARC record specifies pct= less than 100, meaning the declared policy (quarantine or reject) is only applied to a percentage of failing messages. The remainder are delivered as if no DMARC policy exists.

**Risk:** Spoofed messages that fail DMARC have a (100 - pct)% chance of being delivered to recipients, bypassing the protection DMARC is supposed to provide.

**Why it matters:** pct= is intended as a gradual rollout mechanism. Set it to 100 once you are confident that all legitimate mail passes SPF and DKIM. Leaving it below 100 indefinitely creates a partial protection gap.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7489#section-6.3

**Fix:**
- Review DMARC aggregate reports (rua=) to ensure all legitimate mail sources pass authentication.
- Increment pct= toward 100 as you fix any failing legitimate mail sources.
- Set pct=100 once you are confident no legitimate mail is failing.
- **DNS TXT** (dns):
```dns
_dmarc.example.com. IN TXT "v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@example.com; adkim=s; aspf=s"
```

### `email-mta-sts-policy-missing` [email / medium / header]
**MTA-STS Policy File Missing**

An MTA-STS TXT record exists but the policy file at https://mta-sts.<domain>/.well-known/mta-sts.txt is not reachable. Without the policy file, the MTA-STS declaration has no effect.

**Risk:** Without a retrievable policy file, sending servers that check MTA-STS will not enforce TLS for mail delivery to your domain. STARTTLS downgrade attacks remain possible.

**Why it matters:** MTA-STS works in two parts: a DNS TXT record at _mta-sts.<domain> declares the policy ID, and the actual policy file is served over HTTPS at a well-known path. If the policy file is unreachable, the MTA-STS declaration is incomplete and sending servers will not enforce TLS.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8461

**Fix:**
- Serve the policy at https://mta-sts.<domain>/.well-known/mta-sts.txt with mode: enforce.
- Ensure the mta-sts subdomain is HTTPS-accessible with a valid certificate.
- Verify: curl https://mta-sts.example.com/.well-known/mta-sts.txt
- **mta-sts.txt** (text):
```text
version: STSv1
mode: enforce
mx: mail.example.com
mx: *.example.com
max_age: 604800
```

### `email-mta-sts-mode-none` [email / high / header]
**MTA-STS Mode Set to 'none' or 'testing'**

The MTA-STS policy is set to mode: none or mode: testing. These modes do not enforce TLS for inbound SMTP connections, so STARTTLS downgrade attacks remain possible.

**Risk:** Attackers can downgrade inbound SMTP sessions from STARTTLS to plaintext, exposing email content and relay credentials. The MTA-STS declaration provides false assurance without enforcement.

**Why it matters:** MTA-STS mode: none and mode: testing tell sending servers to check the policy but not enforce it. Only mode: enforce causes sending servers to abort delivery if TLS cannot be established.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8461#section-5

**Fix:**
- Change mode: testing or mode: none to mode: enforce.
- Before switching to enforce, verify TLS is consistently working by reviewing TLS-RPT aggregate reports.
- Update the id= value in the _mta-sts DNS record to force cache invalidation.
- **mta-sts.txt** (text):
```text
version: STSv1
mode: enforce
mx: mail.example.com
max_age: 604800
```

### `email-mta-sts-id-not-rotated` [email / low / header]
**MTA-STS Policy ID Not Rotated**

The MTA-STS id= field has not changed, meaning previously cached policies may not be invalidated when the policy changes. Sending servers cache MTA-STS policies for up to max_age seconds.

**Risk:** Stale cached policies prevent rapid policy changes from taking effect. During an incident where you need to change MX records or revoke TLS enforcement, sending servers may continue enforcing the old policy for hours.

**Why it matters:** The id= tag in the _mta-sts DNS TXT record serves as a cache-buster. When you update the policy file (e.g., change mode from testing to enforce, or update MX hostnames), you must also update id= to a new value. Sending servers compare the cached id against the current DNS id; if different, they fetch the new policy.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8461#section-3.2

**Fix:**
- Update id= to a new value (e.g., a UTC timestamp like 20240101120000) whenever the policy file changes.
- Also update id= when changing MX records to ensure sending servers pick up the new MX list.
- **DNS TXT: updated id** (dns):
```dns
_mta-sts.example.com. IN TXT "v=STSv1; id=20240101120000"
# Increment id every time the mta-sts.txt policy changes
```

### `email-mx-hostname-cname` [email / medium / header]
**MX Hostname Is a CNAME (RFC Violation)**

An MX record points to a hostname that is a CNAME alias rather than an A/AAAA record. RFC 5321 explicitly prohibits MX targets from being CNAME records.

**Risk:** Mail servers that strictly follow RFC 5321 will reject or skip this MX record, causing mail delivery failures for a subset of senders.

**Why it matters:** RFC 5321 §5.1 requires that MX target hostnames resolve to A or AAAA records directly, not via CNAME. Many mail servers follow the RFC strictly and will not follow CNAMEs for MX targets, treating them as invalid.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5321#section-5.1

**Fix:**
- Point the MX record directly at a hostname with an A/AAAA record.
- If the MX hostname is managed by a provider, use the canonical hostname they provide, not a CNAME alias.
- **Correct MX: no CNAME** (dns):
```dns
# Correct: MX points to a hostname with A record
example.com. IN MX 10 mail.example.com.
mail.example.com. IN A 198.51.100.10

# Incorrect: MX points to a CNAME
# example.com. IN MX 10 alias.example.com.
# alias.example.com. IN CNAME mail.example.com.  <- RFC violation
```

### `email-spf-include-no-prefix` [email / low / header]
**SPF include: Without Provider _spf Prefix**

The SPF record includes a domain that does not follow the standard _spf.* subdomain convention used by legitimate ESPs. Non-standard includes may indicate misconfiguration or an unauthorized ESP.

**Risk:** Mis-prefixed or unauthorized SPF includes may grant a third party the ability to send email on behalf of your domain, or may cause SPF to break silently if the included domain's SPF is misconfigured.

**Why it matters:** Legitimate ESPs (Google Workspace, SendGrid, Mailgun, Mailchimp) publish their allowed senders under predictable _spf.* subdomains. Includes that point to domains without this convention may be from unofficial or unauthorized mail sources.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7208#section-5.2

**Fix:**
- Verify each include: points to a recognized provider's documented SPF subdomain.
- Replace ad-hoc includes with the provider's officially documented _spf subdomain.
- Audit all sending services authorized to send from your domain.
- **Correct include prefixes** (dns):
```dns
example.com. IN TXT "v=spf1 include:_spf.google.com include:sendgrid.net include:_spf.mailchimp.com -all"
```

### `spf-record` [email / high / header]
**SPF Record (Sender Policy Framework)**

No SPF record was found at the domain apex. SPF is one of three email authentication mechanisms (SPF, DKIM, DMARC) that prevent unauthorized senders from sending mail as your domain.

**Risk:** Without SPF, any server on the Internet can send email appearing to come from your domain. Phishing, business email compromise (BEC), and spam campaigns regularly exploit domains without SPF.

**Why it matters:** SPF (RFC 7208) publishes an allowlist of servers authorized to send email from your domain as a TXT record at the apex. When a receiving server gets mail claiming to be from your domain, it checks whether the sending server's IP is in your SPF record. Without SPF, this check cannot be performed.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7208
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html

**Fix:**
- Publish a TXT record at the apex: v=spf1 <mechanisms> -all
- Include all services that send mail on your behalf (Google, SendGrid, etc.).
- Stay under the 10 DNS lookup limit.
- Use -all (hard fail) once all legitimate senders are included.
- **DNS TXT** (dns):
```dns
example.com. IN TXT "v=spf1 include:_spf.google.com include:sendgrid.net ip4:203.0.113.10 -all"
```

### `dmarc-record` [email / high / header]
**DMARC Record Missing**

No DMARC record exists at _dmarc.<domain>. Without DMARC, there is no policy telling receivers what to do with mail that fails SPF or DKIM authentication, and you receive no reports about authentication failures.

**Risk:** Without DMARC, spoofed mail that fails SPF or DKIM is still delivered to recipients. You have no visibility into who is sending email as your domain, making phishing and BEC attacks undetectable.

**Why it matters:** DMARC (RFC 7489) ties together SPF and DKIM with a declared policy (none/quarantine/reject) and reporting addresses. It is the standard mechanism for telling receivers to quarantine or reject mail that fails authentication and to send you reports about what they see.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7489
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html

**Fix:**
- Publish a TXT record at _dmarc.<domain> starting with p=none to collect reports.
- Review aggregate reports (rua=) to identify legitimate mail sources.
- Progress to p=quarantine then p=reject as you fix authentication issues.
- **DNS TXT: start with p=none** (dns):
```dns
_dmarc.example.com. IN TXT "v=DMARC1; p=none; rua=mailto:dmarc@example.com; adkim=r; aspf=r"
```
- **DNS TXT: enforce with p=reject** (dns):
```dns
_dmarc.example.com. IN TXT "v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@example.com; ruf=mailto:dmarc-forensic@example.com; adkim=s; aspf=s"
```

### `dkim-record` [email / high / header]
**DKIM Record Missing**

No DKIM public key record was found for this domain. DKIM (DomainKeys Identified Mail) cryptographically signs outgoing messages, allowing receivers to verify the signature has not been tampered with.

**Risk:** Without DKIM, your email messages have no cryptographic signature. DMARC alignment relies on either SPF or DKIM passing; without DKIM, SPF-only alignment is more easily broken by mail forwarding, weakening your overall protection.

**Why it matters:** DKIM (RFC 6376) adds a digital signature to outgoing email headers. The receiving server looks up the public key in DNS at <selector>._domainkey.<domain> and verifies the signature. A valid DKIM signature proves the message was sent by an authorized server and was not modified in transit.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6376
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Spoofing_Prevention_Cheat_Sheet.html

**Fix:**
- Generate a DKIM key pair in your mail server or ESP.
- Publish the public key as a TXT record at <selector>._domainkey.<domain>.
- Verify: dig +short TXT selector._domainkey.example.com
- **DKIM DNS TXT record** (dns):
```dns
google._domainkey.example.com. IN TXT "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..."
```
- **Postfix + OpenDKIM** (postfix):
```postfix
# Generate 2048-bit RSA DKIM key
opendkim-genkey -b 2048 -d example.com -s mail -t
# Publishes: mail._domainkey.example.com
```

### `dnssec-enabled` [email / medium / header]
**DNSSEC Not Enabled**

DNSSEC is not enabled for this domain's DNS zone. Without DNSSEC, DNS responses can be forged by cache poisoning attacks, redirecting email to attacker-controlled servers.

**Risk:** Without DNSSEC, attackers can poison DNS caches to forge MX records, redirecting inbound email to attacker-controlled mail servers. SPF and DMARC DNS lookups can also be spoofed, undermining email authentication.

**Why it matters:** DNSSEC (RFC 4034/4035) uses public-key cryptography to sign DNS records. When DNSSEC is enabled and a DS record is published at the parent TLD, DNSSEC-validating resolvers can verify that DNS responses have not been tampered with. This is particularly important for email since MX, SPF, DKIM, and DMARC all rely on DNS lookups.

**References:**
- https://datatracker.ietf.org/doc/html/rfc4034
- https://datatracker.ietf.org/doc/html/rfc4035

**Fix:**
- Enable DNSSEC in your DNS provider's control panel or configure it in BIND/Knot/PowerDNS.
- Submit the DS record to your domain registrar.
- Verify: dig +dnssec A example.com (look for 'ad' flag and RRSIG records)
- **Verify DNSSEC status** (bash):
```bash
dig +dnssec A example.com | grep -E '(RRSIG|flags.*ad)'
```

### `tls-rpt` [email / info / header]
**TLS-RPT Record Missing**

No TLS-RPT record exists at _smtp._tls.<domain>. TLS-RPT (RFC 8460) is a companion to MTA-STS that receives aggregate reports about SMTP TLS negotiation failures.

**Risk:** Without TLS-RPT, you have no visibility into SMTP TLS failures. Certificate expiry, policy misconfiguration, and potential STARTTLS downgrade attacks go undetected until mail delivery fails.

**Why it matters:** TLS-RPT collects daily aggregate reports from mail senders about TLS connection failures when delivering to your mail servers. Reports include MX hostnames, failure reasons, and counts. They are essential for monitoring the health of MTA-STS enforcement.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8460

**Fix:**
- Publish a TXT record at _smtp._tls.<domain> with v=TLSRPTv1; rua=.
- Use an email address or HTTPS endpoint that can receive and process JSON reports.
- **DNS TXT** (dns):
```dns
_smtp._tls.example.com. IN TXT "v=TLSRPTv1; rua=mailto:tls-reports@example.com"
```

### `email-spf-ptr-mechanism` [email / low / header]
**SPF Uses Deprecated ptr: Mechanism**

The SPF record uses the ptr: mechanism. RFC 7208 explicitly deprecates ptr: because it triggers expensive and unreliable reverse DNS lookups that slow SPF evaluation and may cause timeouts.

**Risk:** ptr: lookups can timeout or fail intermittently, causing SPF to return temperror. Some receivers treat temperror as a pass (accepting mail), others may defer or fail delivery.

**Why it matters:** The SPF ptr: mechanism performs a reverse DNS lookup on the sending IP to find a hostname, then forward-confirms it. This is slow, expensive (counts as multiple DNS lookups), and unreliable since not all IPs have PTR records. RFC 7208 §5.5 explicitly says: 'This mechanism SHOULD NOT be published.'

**References:**
- https://datatracker.ietf.org/doc/html/rfc7208#section-5.5

**Fix:**
- Replace ptr: with explicit ip4:, ip6:, a:, or include: mechanisms.
- Audit all senders and add their IPs or SPF include references directly.
- **Replace ptr: with ip4:** (dns):
```dns
# Avoid:
# v=spf1 ptr:example.com -all

# Use instead:
example.com. IN TXT "v=spf1 ip4:203.0.113.0/24 include:_spf.google.com -all"
```

---

## Category: headers (133 checks)

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
**X-Content-Type-Options Set to Invalid Value (disabled duplicate)**

Disabled: exact duplicate of nosniff-incorrect, which checks the same 'header present but not nosniff' condition on the same header. The 'header missing' case is covered separately by xcto-missing.

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
- **Migrate report-uri to report-to** (javascript):
```javascript
// next.config.mjs: use report-to instead of deprecated report-uri
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "Report-To", value: JSON.stringify({ group: "csp-endpoint", max_age: 86400, endpoints: [{ url: "https://yoursite.com/api/csp-report" }] }) },
      { key: "Content-Security-Policy", value: "default-src 'self'; report-to csp-endpoint" },
    ]}];
  },
};
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
- **Replace unsafe-inline with nonces** (typescript):
```typescript
import { randomBytes } from "crypto";

// Generate nonce per request
const nonce = randomBytes(16).toString("base64");

// Set CSP header
res.setHeader("Content-Security-Policy",
  `script-src 'nonce-<value>' 'strict-dynamic'; object-src 'none';`
);

// In HTML: <script nonce="{nonce}">...</script>
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
- **Remove unsafe-eval from CSP** (javascript):
```javascript
// BAD: script-src 'unsafe-eval', enables eval(), Function(), setTimeout(string)
// GOOD: use 'strict-dynamic' with nonces instead
// In Next.js:
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{
      key: "Content-Security-Policy",
      value: "script-src 'self' 'nonce-RANDOM'; object-src 'none';"
    }]}];
  },
};
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
- **Replace CSP wildcards with specific origins** (javascript):
```javascript
// BAD: script-src *, allows any origin to run scripts
// GOOD: explicit allowlist
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{
      key: "Content-Security-Policy",
      value: "default-src 'self'; script-src 'self' https://cdn.example.com; img-src 'self' data:; object-src 'none';"
    }]}];
  },
};
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
- **Add default-src to CSP** (javascript):
```javascript
// default-src is the fallback for all resource types not otherwise specified
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{
      key: "Content-Security-Policy",
      value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none';"
    }]}];
  },
};
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
- **Set a safe Referrer-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] }];
  },
};
// strict-origin-when-cross-origin sends the full URL for same-origin requests
// and only the origin for cross-origin HTTPS requests, nothing for HTTP downgrades
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
- **Remove X-XSS-Protection: 0 and use CSP instead** (javascript):
```javascript
// X-XSS-Protection is deprecated in modern browsers
// The header X-XSS-Protection: 0 disables the old browser XSS filter
// Replace with a strong Content-Security-Policy instead:
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; object-src 'none';" }] }];
  },
};
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
- **Replace unsafe-hashes with nonces** (typescript):
```typescript
// unsafe-hashes allows inline event handlers with specific hashes, still risky
// Better approach: move all inline handlers to external scripts with nonces
import { randomBytes } from "crypto";
const nonce = randomBytes(16).toString("base64");
res.setHeader("Content-Security-Policy", `script-src 'nonce-<value>'; object-src 'none';`);
// Then add nonce={nonce} to your <script> tags only
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
- **Add frame-src to CSP** (javascript):
```javascript
// Without frame-src, child-src or default-src controls iframe sources
// Be explicit about which origins can be embedded:
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{
      key: "Content-Security-Policy",
      value: "default-src 'self'; frame-src 'self' https://www.youtube.com https://player.vimeo.com; object-src 'none';"
    }]}];
  },
};
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
- **Set object-src 'none' in CSP** (javascript):
```javascript
// object-src controls Flash, Java applets, PDF embeds: all legacy plugins
// There is no legitimate reason to allow plugins in modern web apps:
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{
      key: "Content-Security-Policy",
      value: "default-src 'self'; object-src 'none'; plugin-types;"
    }]}];
  },
};
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
- **Add strict-dynamic with nonce to script-src 'self'** (typescript):
```typescript
// 'self' alone allows any same-origin script, too broad
// Use nonce + strict-dynamic for better control:
import { randomBytes } from "crypto";
const nonce = randomBytes(16).toString("base64");
res.setHeader("Content-Security-Policy",
  `script-src 'nonce-<value>' 'strict-dynamic'; object-src 'none'; base-uri 'none';`
);
```

### `csp-frame-ancestors` [headers / medium / combined]
**Missing Clickjacking Protection (disabled duplicate)**

Disabled: this fired only when neither CSP frame-ancestors nor X-Frame-Options was set, a strict subset of clickjack-missing's condition, so it always double-counted the same evidence.

**Risk:** Older browsers may not support headers.

**Why it matters:** JavaScript frame busting provides backup.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add JS frame busting for legacy browser support.
- **Set frame-ancestors to restrict embedding** (javascript):
```javascript
// frame-ancestors controls who can embed your page in a frame
// Use 'none' to block all framing (replaces X-Frame-Options: DENY)
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{
      key: "Content-Security-Policy",
      value: "frame-ancestors 'none'; default-src 'self'; object-src 'none';"
    }]}];
  },
};
// Or allow specific origins:
// frame-ancestors 'self' https://dashboard.partner.com
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
- **Set X-Frame-Options to a valid value** (javascript):
```javascript
// Valid values: DENY, SAMEORIGIN
// X-Frame-Options: ALLOW-FROM is deprecated, use CSP frame-ancestors instead
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] }];
  },
};
// Or with CSP (preferred):
// Content-Security-Policy: frame-ancestors 'none'
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
- **Add Cache-Control: no-store for sensitive pages** (javascript):
```javascript
// Prevent browsers and proxies from caching sensitive responses
export default {
  async headers() {
    return [
      // Apply to dashboard and account pages only:
      { source: "/(dashboard|account|admin)(.*)", headers: [{
        key: "Cache-Control",
        value: "no-store, max-age=0"
      }]}
    ];
  },
};
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
- **Replace Pragma: no-cache with Cache-Control** (javascript):
```javascript
// Pragma: no-cache is a HTTP/1.0 artifact, use Cache-Control for modern browsers
// Remove Pragma header and use:
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] }];
  },
};
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
- **Remove Expires headers or set Cache-Control instead** (javascript):
```javascript
// Expires header with a past date is a HTTP/1.0 mechanism, use Cache-Control
// For no caching:
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] }];
  },
};
// For long caching of static assets:
// Cache-Control: public, max-age=31536000, immutable
```

### `coop-missing` [headers / info / header]
**Missing Cross-Origin-Opener-Policy (COOP) Header**

No Cross-Origin-Opener-Policy header is set. The detector checks for the real, enforcing header, not the optional Report-Only preview variant.

**Risk:** Without COOP, cross-origin windows opened by or opening this page can retain a reference via window.opener, which weakens isolation and can enable Spectre-style side-channel attacks.

**Why it matters:** Cross-Origin-Opener-Policy: same-origin isolates the page's browsing context from cross-origin windows it opens or that open it. Combined with COEP, it enables cross-origin isolation (SharedArrayBuffer, high-resolution timers).

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Cross-Origin-Opener-Policy: same-origin to responses.
- Use same-origin-allow-popups if the page needs to open popups while staying isolated.
- Preview with Cross-Origin-Opener-Policy-Report-Only first if you're unsure it's safe to enable.
- **Add Cross-Origin-Opener-Policy header** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin" }] }];
  },
};
// same-origin: isolates your browsing context from cross-origin windows
// Enables SharedArrayBuffer and high-resolution timers (required for some APIs)
// same-origin-allow-popups: allows popups but isolates main page
```

### `corp-missing` [headers / info / header]
**Missing Cross-Origin-Resource-Policy (CORP) Header (disabled duplicate)**

Disabled: exact duplicate of cross-origin-resource-policy-report-only-missing, which checks the same real Cross-Origin-Resource-Policy header (CORP has no separate Report-Only variant).

**Risk:** See cross-origin-resource-policy-report-only-missing.

**Why it matters:** See cross-origin-resource-policy-report-only-missing.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add 'Cross-Origin-Resource-Policy: same-origin' (or same-site/cross-origin as appropriate).
- **Add Cross-Origin-Resource-Policy header** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Cross-Origin-Resource-Policy", value: "same-origin" }] }];
  },
};
// same-origin: only allow same-origin pages to embed this resource
// same-site: allow same-site pages (includes subdomains)
// cross-origin: allow any origin (use only for public CDN resources)
```

### `charset-meta-missing` [headers / info / header]
**Missing <meta charset> Declaration**

The HTML document does not declare a character set via <meta charset>. Without an explicit charset, older browsers could be tricked into an encoding (e.g. UTF-7) that enables reflected content to execute as script.

**Risk:** Largely historical: modern browsers no longer support UTF-7 auto-detection, so the practical XSS risk is minimal. Still worth declaring for correctness and to avoid mojibake rendering.

**Why it matters:** Declare <meta charset="utf-8"> within the first 1024 bytes of the document, or set charset via the Content-Type header.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add <meta charset="utf-8"> as the first element inside <head>.
- **Declare charset in HTML meta tag** (html):
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Must be within first 1024 bytes of the document -->
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Page Title</title>
</head>
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
- **Restrict Access-Control-Allow-Headers to specific headers** (javascript):
```javascript
// BAD: Access-Control-Allow-Headers: *, allows any header from any origin
// GOOD: explicit list
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Requested-With" }] }];
  },
};
```

### `cors-null-origin-allowed` [headers / medium / header]
**CORS Allows 'null' Origin**

Access-Control-Allow-Origin is set to the literal string 'null'. The 'null' origin is sent by sandboxed iframes, data: URIs, and some file:// contexts, so trusting it lets attacker-controlled sandboxed content bypass the intended origin restriction.

**Risk:** An attacker can host a sandboxed iframe (sandbox without allow-same-origin) that sends the Origin: null header, which this configuration trusts, granting the attacker's page cross-origin access it should never have.

**Why it matters:** Never explicitly allow 'null' as an origin. Validate the incoming Origin header against an allowlist and never return 'null' or reflect an origin that wasn't matched.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Remove 'null' from any CORS origin allowlist.
- Validate the Origin header against an explicit allowlist of trusted origins.
- Never return 'null' for unmatched or missing Origin headers.
- **Never allow the null CORS origin** (typescript):
```typescript
// BAD: Access-Control-Allow-Origin: null
// The "null" origin is sent by sandboxed iframes and file://, allowing it
// gives untrusted sandboxed content access to your API

export function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  const ALLOWED = new Set(["https://yoursite.com", "https://app.yoursite.com"]);
  return ALLOWED.has(origin) ? origin : ""; // never return "null"
}
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
- **Set X-Frame-Options to DENY or SAMEORIGIN** (javascript):
```javascript
// X-Frame-Options: ALLOWALL is not a valid value and is ignored by browsers
// Use one of:
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] }];
  },
};
// Or to allow same-origin framing only:
// X-Frame-Options: SAMEORIGIN
// Prefer CSP frame-ancestors which is more flexible:
// Content-Security-Policy: frame-ancestors 'none'
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
- **Fix incompatible CSP directive combinations** (javascript):
```javascript
// Common incompatibilities:
// - report-uri + report-to (use only report-to in CSP Level 3)
// - block-all-mixed-content + upgrade-insecure-requests (pick one)
// - 'unsafe-inline' + nonce (nonce overrides unsafe-inline in CSP3)
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{
      key: "Content-Security-Policy",
      value: "default-src 'self'; script-src 'self'; object-src 'none'; upgrade-insecure-requests;"
    }]}];
  },
};
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
- **Simplify CSP using strict-dynamic and nonces** (typescript):
```typescript
// A CSP with hundreds of allowlisted URLs is unmaintainable and often too permissive
// Use nonce + strict-dynamic instead:
import { randomBytes } from "crypto";
const nonce = randomBytes(16).toString("base64");

// CSP becomes short and strict:
// script-src 'nonce-{nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'none';
// strict-dynamic allows scripts loaded by trusted nonce'd scripts automatically
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
- **Block geolocation in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "geolocation=()" }] }];
  },
};
// () means the feature is disabled for all frames
// 'self' means only the same origin can use it
// https://example.com means only that specific origin
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
- **Restrict camera access in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "camera=('self')" }] }];
  },
};
// Blocks camera access for all third-party iframes by default
// Only allow your own origin to request camera permission
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
- **Restrict microphone in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "microphone=('self')" }] }];
  },
};
// Only allow your own origin to request microphone permission
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
- **Restrict Payment Request API in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "payment=('self')" }] }];
  },
};
// Prevents third-party iframes from initiating payment requests
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
- **Block USB API in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "usb=()" }] }];
  },
};
// Disables the WebUSB API for all contexts, rarely needed on web pages
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
- **Block Bluetooth API in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "bluetooth=()" }] }];
  },
};
// Disables the Web Bluetooth API for all contexts
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
- **Block Serial API in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "serial=()" }] }];
  },
};
// Disables the Web Serial API for all contexts
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
- **Block Screen Wake Lock in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "screen-wake-lock=()" }] }];
  },
};
// Prevents pages from preventing the device screen from sleeping
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
- **Restrict WebAuthn credential access in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "publickey-credentials-get=('self')" }] }];
  },
};
// Allows WebAuthn (passkeys) only for your own origin, not third-party iframes
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
- **Disable unload event handler in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "unload=()" }] }];
  },
};
// Disables the beforeunload/unload event, improves bfcache eligibility
// Unload handlers prevent back-forward cache restores (hurts Core Web Vitals)
```

### `permissions-policy-clipboard-read-blocked` [headers / info / header]
**Permissions-Policy clipboard-read allowed**

Permissions-Policy does not restrict the clipboard-read feature.

**Risk:** Set Permissions-Policy: clipboard-read=() to fully block clipboard reading

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/clipboard-read

**Fix:**
- Set Permissions-Policy: clipboard-read=() to fully block clipboard reading
- **Restrict clipboard-read in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "clipboard-read=('self')" }] }];
  },
};
// Only your origin can read clipboard content, third-party iframes cannot
```

### `permissions-policy-clipboard-write-blocked` [headers / info / header]
**Permissions-Policy clipboard-write allowed**

Permissions-Policy does not restrict the clipboard-write feature.

**Risk:** Set Permissions-Policy: clipboard-write=(self) to scope clipboard write to your origin

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/clipboard-write

**Fix:**
- Set Permissions-Policy: clipboard-write=(self) to scope clipboard write to your origin
- **Restrict clipboard-write in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "clipboard-write=('self')" }] }];
  },
};
// Only your origin can write to the clipboard, third-party iframes cannot
```

### `permissions-policy-accelerometer-blocked` [headers / info / header]
**Permissions-Policy accelerometer allowed**

Permissions-Policy does not restrict the accelerometer sensor.

**Risk:** Set Permissions-Policy: accelerometer=() to block device motion sensors

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/accelerometer

**Fix:**
- Set Permissions-Policy: accelerometer=() to block device motion sensors
- **Block accelerometer in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "accelerometer=()" }] }];
  },
};
// Disables accelerometer sensor access for all frames
```

### `permissions-policy-gyroscope-blocked` [headers / info / header]
**Permissions-Policy gyroscope allowed**

Permissions-Policy does not restrict the gyroscope sensor.

**Risk:** Set Permissions-Policy: gyroscope=() to block orientation sensors

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/gyroscope

**Fix:**
- Set Permissions-Policy: gyroscope=() to block orientation sensors
- **Block gyroscope in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "gyroscope=()" }] }];
  },
};
// Disables gyroscope sensor access for all frames
```

### `permissions-policy-magnetometer-blocked` [headers / info / header]
**Permissions-Policy magnetometer allowed**

Permissions-Policy does not restrict the magnetometer sensor.

**Risk:** Set Permissions-Policy: magnetometer=() to block compass sensors

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/magnetometer

**Fix:**
- Set Permissions-Policy: magnetometer=() to block compass sensors
- **Block magnetometer in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "magnetometer=()" }] }];
  },
};
// Disables magnetometer (compass) sensor access for all frames
```

### `permissions-policy-ambient-light-sensor-blocked` [headers / info / header]
**Permissions-Policy ambient-light-sensor allowed**

Permissions-Policy does not restrict the ambient-light-sensor feature.

**Risk:** Set Permissions-Policy: ambient-light-sensor=() to block ambient light sensors

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/ambient-light-sensor

**Fix:**
- Set Permissions-Policy: ambient-light-sensor=() to block ambient light sensors
- **Block ambient-light-sensor in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "ambient-light-sensor=()" }] }];
  },
};
// Disables ambient light sensor access for all frames
```

### `permissions-policy-display-capture-blocked` [headers / info / header]
**Permissions-Policy display-capture allowed**

Permissions-Policy does not restrict display-capture (screen capture).

**Risk:** Set Permissions-Policy: display-capture=() to block screen capture

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/display-capture

**Fix:**
- Set Permissions-Policy: display-capture=() to block screen capture
- **Restrict display-capture in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "display-capture=('self')" }] }];
  },
};
// Restricts screen capture (getDisplayMedia) to your own origin
```

### `permissions-policy-fullscreen-blocked` [headers / info / header]
**Permissions-Policy fullscreen allowed**

Permissions-Policy does not restrict the fullscreen feature.

**Risk:** Set Permissions-Policy: fullscreen=(self) to scope fullscreen requests to your origin

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/fullscreen

**Fix:**
- Set Permissions-Policy: fullscreen=(self) to scope fullscreen requests to your origin
- **Restrict fullscreen API in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "fullscreen=('self')" }] }];
  },
};
// Only your own origin and explicitly allowed iframes can go fullscreen
```

### `permissions-policy-midi-blocked` [headers / info / header]
**Permissions-Policy midi allowed**

Permissions-Policy does not restrict Web MIDI access.

**Risk:** Set Permissions-Policy: midi=() to block MIDI device access

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/midi

**Fix:**
- Set Permissions-Policy: midi=() to block MIDI device access
- **Block MIDI API in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "midi=()" }] }];
  },
};
// Disables the Web MIDI API for all frames
```

### `permissions-policy-picture-in-picture-blocked` [headers / info / header]
**Permissions-Policy picture-in-picture allowed**

Permissions-Policy does not restrict the picture-in-picture feature.

**Risk:** Set Permissions-Policy: picture-in-picture=(self) to scope PiP to your origin

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/picture-in-picture

**Fix:**
- Set Permissions-Policy: picture-in-picture=(self) to scope PiP to your origin
- **Restrict picture-in-picture in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "picture-in-picture=('self')" }] }];
  },
};
// Only allow your origin to use picture-in-picture video mode
```

### `permissions-policy-storage-access-blocked` [headers / info / header]
**Permissions-Policy storage-access allowed**

Permissions-Policy does not restrict the Storage Access API used by third-party iframes.

**Risk:** Set Permissions-Policy: storage-access=() to block third-party storage access requests

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/storage-access

**Fix:**
- Set Permissions-Policy: storage-access=() to block third-party storage access requests
- **Restrict storage-access in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "storage-access=('self')" }] }];
  },
};
// Restricts the Storage Access API (used for cross-site cookie access)
```

### `permissions-policy-window-management-blocked` [headers / info / header]
**Permissions-Policy window-management allowed**

Permissions-Policy does not restrict the Window Management API for multi-screen layouts.

**Risk:** Set Permissions-Policy: window-management=() to block window placement APIs

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/window-management

**Fix:**
- Set Permissions-Policy: window-management=() to block window placement APIs
- **Block window-management in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "window-management=()" }] }];
  },
};
// Disables the Window Management API (multi-screen window placement)
```

### `server-timing-sensitive-key-leak` [headers / low / header]
**Server-Timing exposes sensitive key**

The Server-Timing response header includes custom keys that may expose internal metrics like db, sql, redis, cache, or query durations.

**Risk:** Drop or sanitize Server-Timing entries with sensitive names in production

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing

**Fix:**
- Drop or sanitize Server-Timing entries with sensitive names in production
- **Remove sensitive metric names from Server-Timing** (typescript):
```typescript
// BAD: Server-Timing: db;dur=150, cache-miss;dur=5
// Reveals internal architecture: database, cache layer

// GOOD: use opaque names or omit timing in production
const timings: string[] = [];
if (process.env.NODE_ENV !== "production") {
  timings.push(`db;dur=<value>`);
}
if (timings.length) res.setHeader("Server-Timing", timings.join(", "));
```

### `cookie-host-prefix-attribute-mismatch` [headers / medium / header]
**__Host- cookie prefix with wrong attributes**

A cookie using the __Host- prefix must have Secure, Path=/, and no Domain attribute. Otherwise the browser silently rejects it.

**Risk:** Add Secure and Path=/ and remove Domain from any __Host- prefixed cookie

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies

**Fix:**
- Add Secure and Path=/ and remove Domain from any __Host- prefixed cookie
- **Fix cookie attributes to match host/secure prefix requirements** (typescript):
```typescript
// __Host- prefix requires: Secure, Path=/, no Domain attribute
res.setHeader("Set-Cookie", "__Host-session=TOKEN; Secure; Path=/; HttpOnly; SameSite=Strict");
// Do NOT set Domain= on __Host- cookies

// __Secure- prefix requires: Secure flag
res.setHeader("Set-Cookie", "__Secure-token=TOKEN; Secure; HttpOnly; SameSite=Strict; Domain=yoursite.com");
```

### `xcto-missing` [headers / medium / header-missing]
**Missing X-Content-Type-Options header**

The server does not send the X-Content-Type-Options: nosniff header, allowing browsers to guess content types.

**Risk:** Without nosniff, browsers may interpret a response with an unexpected content type as executable, enabling MIME confusion attacks where a text file is loaded as a script or HTML document.

**Why it matters:** X-Content-Type-Options: nosniff tells browsers to strictly follow the declared Content-Type and not try to guess it from content.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add X-Content-Type-Options: nosniff to all responses
- Ensure all resources are served with correct Content-Type headers
- **Next.js** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header X-Content-Type-Options "nosniff" always;
```

### `coep-missing` [headers / medium / header-missing]
**Missing Cross-Origin-Embedder-Policy header**

The response lacks a Cross-Origin-Embedder-Policy (COEP) header, which is required for cross-origin isolation.

**Risk:** Without COEP, the page cannot achieve cross-origin isolation, which blocks access to high-resolution timers, SharedArrayBuffer, and other APIs that depend on isolation, and leaves the page potentially exposed to Spectre-class side-channel attacks.

**Why it matters:** COEP requires all loaded resources to explicitly opt into cross-origin sharing via CORP or CORS headers.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Cross-Origin-Embedder-Policy: require-corp to responses
- Also add Cross-Origin-Opener-Policy: same-origin for full isolation
- Ensure all embedded cross-origin resources serve CORP or CORS headers
- **Next.js** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Cross-Origin-Embedder-Policy", value: "require-corp" }] }];
  },
};
```

### `cache-control-missing` [headers / low / header-missing]
**Missing Cache-Control header**

No Cache-Control header is present, leaving caching behavior undefined and potentially caching sensitive responses.

**Risk:** Without explicit Cache-Control, browsers and intermediary proxies may cache sensitive pages, exposing authenticated content to subsequent users on shared devices or to cached responses on a CDN.

**Why it matters:** All responses should have an explicit Cache-Control directive appropriate to the content type.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- For sensitive/authenticated pages: Cache-Control: no-store
- For static assets: Cache-Control: public, max-age=31536000, immutable
- For dynamic pages: Cache-Control: no-cache, must-revalidate
- **Next.js: sensitive pages** (javascript):
```javascript
export default {
  async headers() {
    return [
      { source: "/(dashboard|account|admin)(.*)", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
      { source: "/_next/static/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};
```

### `nel-header-missing` [headers / info / header-missing]
**NEL header not configured**

Network Error Logging is not configured via the NEL header, preventing automatic collection of network-level failures.

**Risk:** Network failures like DNS resolution errors, connection timeouts, and TLS handshake failures that affect real users remain invisible without NEL reporting.

**Why it matters:** NEL collects client-side network failure events and reports them to your specified endpoint.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Configure a Report-To header with a Nel reporting group
- Add NEL header referencing that group
- Monitor reports for patterns indicating infrastructure issues
- **NEL setup** (javascript):
```javascript
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "Report-To", value: JSON.stringify({ group: "nel", max_age: 86400, endpoints: [{ url: "/api/nel" }] }) },
      { key: "NEL", value: JSON.stringify({ report_to: "nel", max_age: 86400 }) },
    ]}];
  },
};
```

### `access-control-expose` [headers / low / header-missing]
**Overly broad Access-Control-Expose-Headers**

The Access-Control-Expose-Headers response header exposes a broad set of response headers to cross-origin JavaScript.

**Risk:** Exposing response headers like Set-Cookie, Authorization, or internal tracking headers to cross-origin JavaScript leaks information that was intended to be opaque to the requesting page.

**Why it matters:** Only expose the headers that cross-origin clients actually need to read.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Review which headers cross-origin clients need to access
- List only those specific headers in Access-Control-Expose-Headers
- Never expose Set-Cookie, Authorization, or internal headers
- **Expose only necessary headers** (typescript):
```typescript
return new Response(data, {
  headers: {
    "Access-Control-Allow-Origin": "https://trusted-partner.com",
    "Access-Control-Expose-Headers": "X-Total-Count, X-Rate-Limit-Remaining",
    // Only expose what the client actually needs to read
  },
});
```

### `access-control-expose-broad` [headers / low / header-missing]
**Access-Control-Expose-Headers: * exposes all headers**

Access-Control-Expose-Headers is set to a wildcard, exposing all response headers to cross-origin JavaScript.

**Risk:** Exposing all headers means any cross-origin page that has CORS access can read every response header, including internal routing headers, server version info, and any sensitive metadata that was not intended to be public.

**Why it matters:** Only list the specific headers that cross-origin clients need to access.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Replace * with an explicit list of required headers
- Never include headers like Set-Cookie, Authorization, or internal headers in the list
- **Explicit header list** (typescript):
```typescript
headers["Access-Control-Expose-Headers"] = "Content-Length, X-Total-Count";
// Not: Access-Control-Expose-Headers: *
```

### `access-control-max-age-long` [headers / low / header-missing]
**CORS preflight cache time is too long**

The Access-Control-Max-Age value is very large, caching CORS preflight results for an excessively long time.

**Risk:** A very long preflight cache means browsers will not re-check CORS permissions if you change your policy, potentially allowing stale permissions to persist for days or weeks on the client.

**Why it matters:** Set Access-Control-Max-Age to a reasonable value (600 seconds recommended) to balance performance and policy update latency.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set Access-Control-Max-Age to 600 seconds (10 minutes) or less
- Browsers impose their own cap (Chrome: 7200s, Firefox: 86400s)
- **Reasonable preflight cache** (typescript):
```typescript
return new Response(null, {
  headers: {
    "Access-Control-Max-Age": "600", // 10 minutes
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  },
});
```

### `csp-no-upgrade-insecure` [headers / low / header-missing]
**CSP missing upgrade-insecure-requests directive**

The Content-Security-Policy header does not include upgrade-insecure-requests, leaving HTTP sub-resources unprotected.

**Risk:** Without upgrade-insecure-requests, HTTP URLs for images, scripts, and other resources are not automatically upgraded to HTTPS, enabling mixed content attacks that downgrade connections.

**Why it matters:** The upgrade-insecure-requests directive instructs browsers to treat all HTTP resource requests as HTTPS.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add upgrade-insecure-requests to your CSP header
- Verify your CSP does not also include block-all-mixed-content (pick one)
- **Add to existing CSP** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: "upgrade-insecure-requests; default-src 'self'; script-src 'self'; object-src 'none';" }] }];
  },
};
```

### `csp-data-uri-allowed` [headers / medium / header-missing]
**CSP allows data: URIs in script or object sources**

The Content-Security-Policy permits data: URIs as a script or object source, enabling data-URI-based script execution.

**Risk:** Allowing data: in script-src allows attackers to execute base64-encoded scripts via XSS; this is functionally similar to allowing unsafe-inline and bypasses many CSP protections.

**Why it matters:** data: URIs in script-src are treated as unsafe by CSP Level 3. Remove data: from any security-critical directive.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Remove data: from script-src and object-src
- Limit data: to img-src or font-src where needed for inline images or fonts
- Use nonces for any inline scripts that were previously base64-encoded data URIs
- **Safe data: usage** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self' data:; object-src 'none';" }] }];
  },
};
```

### `csp-allows-http-sources` [headers / medium / header]
**CSP script-src allows HTTP sources**

The Content-Security-Policy allows scripts to be loaded over unencrypted HTTP, enabling man-in-the-middle injection of arbitrary JavaScript.

**Risk:** An attacker on the network path (coffee shop Wi-Fi, compromised router, ISP-level interception) can inject malicious scripts into HTTP responses, executing arbitrary code in the victim's browser on your HTTPS page.

**Why it matters:** CSP's value is negated when scripts can be loaded over HTTP. Restrict all sources to https:// or use 'self' with a relative path.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src
- https://owasp.org/www-project-secure-headers/

**Fix:**
- Replace all http:// sources in script-src and default-src with https:// equivalents
- Prefer 'self' and relative paths over absolute URLs for first-party scripts
- Add upgrade-insecure-requests to automatically upgrade HTTP sub-resources
- **Use HTTPS sources only** (http):
```http
# Before (vulnerable)
Content-Security-Policy: script-src 'self' http://cdn.example.com;

# After (safe)
Content-Security-Policy: script-src 'self' https://cdn.example.com; upgrade-insecure-requests;
```

### `excessive-permissions` [headers / medium / header-missing]
**Permissions-Policy grants excessive browser feature access**

The Permissions-Policy header allows broad access to sensitive browser features like camera, geolocation, or microphone for all origins.

**Risk:** Granting access to sensitive features to all origins means any third-party iframe embedded on the page can request those permissions from the user, without the user understanding it is the iframe, not your site, making the request.

**Why it matters:** Follow least-privilege: only allow the specific origins that need each feature.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Audit which features your application actually uses
- Disable features you do not use: feature=()
- Limit features you do use to your own origin: feature=(self)
- **Restrictive Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()" }] }];
  },
};
```

### `feature-policy-deprecated` [headers / info / header-missing]
**Deprecated Feature-Policy header in use**

The Feature-Policy header is present. This header has been replaced by Permissions-Policy.

**Risk:** Feature-Policy is no longer supported in modern browsers. Relying on it means your feature restrictions may be silently ignored, leaving the page without the intended browser feature controls.

**Why it matters:** Feature-Policy was renamed to Permissions-Policy in 2020. Use Permissions-Policy instead.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Replace the Feature-Policy header with Permissions-Policy
- Update the directive syntax (Permissions-Policy uses a different format)
- Remove the Feature-Policy header entirely once Permissions-Policy is set
- **Migrate to Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" }] }];
  },
};
```

### `nosniff-incorrect` [headers / medium / header-missing]
**X-Content-Type-Options set to an invalid value**

The X-Content-Type-Options header is present but set to a value other than "nosniff", making it ineffective.

**Risk:** An incorrect value like X-Content-Type-Options: true or X-Content-Type-Options: 1 is ignored by browsers, leaving MIME sniffing enabled and the page vulnerable to content-type confusion attacks.

**Why it matters:** The only valid value for X-Content-Type-Options is "nosniff" (lowercase).

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Set X-Content-Type-Options: nosniff (the only valid value)
- Remove any other value you may have set
- **Correct value** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] }];
  },
};
```

### `hsts-no-preload` [headers / low / header-missing]
**HSTS header missing preload directive**

The Strict-Transport-Security header is present but does not include the preload directive, preventing inclusion in browser HSTS preload lists.

**Risk:** Without the preload directive and inclusion in the HSTS preload list, first-time visitors who type the domain without https:// may connect over HTTP before being redirected, exposing that first request to interception.

**Why it matters:** The preload directive enables submission to browser preload lists so the domain is always loaded over HTTPS, even on the first visit.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add preload to your HSTS header: max-age=63072000; includeSubDomains; preload
- Ensure max-age is at least 31536000 and includeSubDomains is present
- Submit to the preload list at hstspreload.org
- **Next.js** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```
- **Apache** (apache):
```apache
Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
```

### `server-header-disclosure` [headers / low / header-missing]
**Server header discloses software identity**

The HTTP Server response header identifies the web server software by name.

**Risk:** Knowing the server software (nginx, Apache, IIS, etc.) enables targeted vulnerability scanning against known CVEs for that software and version, reducing the effort needed for an attack.

**Why it matters:** Remove or genericize the Server header to reduce information leakage.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Nginx: add "server_tokens off;" in the http block
- Apache: set "ServerTokens Prod" and "ServerSignature Off"
- Next.js: set poweredByHeader: false in next.config.mjs
- **Nginx** (nginx):
```nginx
# In nginx.conf http block:
server_tokens off;
# This removes the version; to hide the server name entirely:
# server_tokens "VulnRadar";  # or any generic string
```
- **Apache** (apache):
```apache
ServerTokens Prod
ServerSignature Off
```

### `server-version-detailed` [headers / low / header-missing]
**Server header reveals detailed version number**

The Server header exposes the exact version of the web server software, enabling targeted version-specific attacks.

**Risk:** An exact version like "nginx/1.18.0" allows an attacker to instantly identify applicable CVEs and patch status, removing the need to probe for vulnerabilities manually.

**Why it matters:** Set Server to a product-only token without version, or remove it entirely.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Nginx: server_tokens off removes the version number
- Apache: ServerTokens Prod shows only "Apache" without version
- Consider removing the header entirely via middleware
- **Nginx: hide version** (nginx):
```nginx
server_tokens off;  # Shows "nginx" without version
# To hide name entirely, use a custom token:
# server_tokens "x";
```

### `x-powered-by-exposed` [headers / low / header-missing]
**X-Powered-By header reveals application framework**

The X-Powered-By response header discloses the application framework and sometimes version (e.g., "Express", "PHP/8.1").

**Risk:** Knowing the framework allows attackers to focus on framework-specific vulnerabilities, default paths, and known misconfigurations, reducing reconnaissance effort significantly.

**Why it matters:** Remove the X-Powered-By header.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Next.js: poweredByHeader: false in next.config.mjs
- Express: app.disable("x-powered-by")
- PHP: expose_php = Off in php.ini
- **Next.js** (javascript):
```javascript
// next.config.mjs
export default { poweredByHeader: false };
```
- **Express** (javascript):
```javascript
app.disable("x-powered-by");
// Or use helmet: app.use(helmet({ hidePoweredBy: true }));
```

### `x-aspnet-version-exposed` [headers / low / header-missing]
**X-AspNet-Version header exposes ASP.NET version**

The X-AspNet-Version header is present and reveals the exact ASP.NET framework version.

**Risk:** The specific ASP.NET version allows attackers to immediately identify applicable CVEs and security patches that have not been applied, narrowing exploit selection.

**Why it matters:** Disable the X-AspNet-Version header in your application configuration.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- In Web.config: <httpRuntime enableVersionHeader="false" />
- Or via custom header removal in Global.asax
- **Web.config** (xml):
```xml
<configuration>
  <system.web>
    <httpRuntime enableVersionHeader="false" />
  </system.web>
</configuration>
```

### `x-aspnetmvc-version-exposed` [headers / low / header-missing]
**X-AspNetMvc-Version header exposes MVC version**

The X-AspNetMvc-Version header reveals which version of ASP.NET MVC the application is running.

**Risk:** The specific MVC version helps attackers identify framework-specific vulnerabilities and apply targeted exploits.

**Why it matters:** Disable the header in your MvcHandler configuration.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- In Global.asax Application_Start: MvcHandler.DisableMvcResponseHeader = true;
- **Global.asax.cs** (csharp):
```csharp
protected void Application_Start() {
  MvcHandler.DisableMvcResponseHeader = true;
}
```

### `via-header-exposed` [headers / low / header-missing]
**Via header reveals proxy infrastructure**

The Via header is present and reveals proxy server software names or versions in the request chain.

**Risk:** The Via header can reveal internal proxy names, software versions, or infrastructure topology, giving attackers a map of the request chain and potential pivot points.

**Why it matters:** Strip or genericize the Via header at your edge proxy.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Configure your CDN/proxy to remove or genericize the Via header
- Nginx: proxy_set_header Via "";
- Ensure internal hostnames are not reflected in Via headers
- **Nginx: remove Via** (nginx):
```nginx
proxy_hide_header Via;
# Or replace with a generic value:
proxy_set_header Via "";
```

### `x-runtime-exposed` [headers / low / header-missing]
**X-Runtime header reveals request processing time**

The X-Runtime header is present, exposing per-request server processing time in milliseconds.

**Risk:** Request timing information can be used for timing-based side-channel attacks, inferring whether a user exists, whether a resource is cached, or the cost of specific operations.

**Why it matters:** Remove the X-Runtime header in production.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Disable X-Runtime in your framework configuration
- Rails: config.action_dispatch.x_runtime_header = nil
- **Nginx: remove runtime header** (nginx):
```nginx
proxy_hide_header X-Runtime;
```

### `x-request-id-exposed` [headers / info / header-missing]
**X-Request-Id header exposed to clients**

The X-Request-Id header is returned in the response and exposes internal request tracking identifiers.

**Risk:** Internal request IDs may leak details about infrastructure, help attackers correlate requests across systems, or reveal predictable ID schemes that enable enumeration or replay attacks.

**Why it matters:** Request IDs used for internal logging can be stripped from client-facing responses.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Remove X-Request-Id from client responses while keeping it in internal logs
- If needed for debugging, only return it to authenticated users
- **Strip in Nginx** (nginx):
```nginx
proxy_hide_header X-Request-Id;
```

### `x-backend-server-exposed` [headers / low / header-missing]
**X-Backend-Server header reveals backend hostname**

The X-Backend-Server header discloses the internal hostname or IP of the backend server that handled the request.

**Risk:** Internal hostnames and IPs reveal your infrastructure topology, making it easier to target specific backend servers, bypass load balancers, or enumerate internal services.

**Why it matters:** Remove all headers that expose backend server identity.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Configure your load balancer or CDN to strip X-Backend-Server
- Audit all custom headers set by backend services for internal information
- **Nginx: strip backend headers** (nginx):
```nginx
proxy_hide_header X-Backend-Server;
proxy_hide_header X-Real-Server;
proxy_hide_header X-Node-Id;
```

### `age-header-reveals-cdn` [headers / info / header-missing]
**Age header reveals CDN cache age**

The Age header is present and reveals how long the response has been cached at a CDN or proxy.

**Risk:** Age headers reveal CDN infrastructure is in use and indicate whether a response is served from cache, helping attackers time cache-poisoning attacks or infer when cached entries will expire.

**Why it matters:** Age is a standard HTTP header; consider removing it for sensitive responses if it reveals operational details.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- For sensitive responses, set Cache-Control: no-store (CDN will not cache them, so Age will not appear)
- For public resources, Age is expected behavior and low risk
- **Remove Age for sensitive endpoints** (nginx):
```nginx
location /api/ {
  proxy_hide_header Age;
  add_header Cache-Control "no-store, max-age=0";
}
```

### `x-debug-header-exposed` [headers / medium / header-missing]
**Debug header present in production response**

A debug-related response header is present (e.g., X-Debug-Info, X-Debug-Token, X-Symfony-Debug), revealing application internals.

**Risk:** Debug headers expose internal application state, configuration, database query counts, or profiler data, information that helps attackers understand the application and identify inefficiencies to target.

**Why it matters:** Debug headers must not be present in production responses.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Disable debug mode in production
- Audit your framework config to ensure debug output is suppressed
- Symfony: remove the Debug toolbar; Laravel: set APP_DEBUG=false
- **Strip debug headers in Nginx** (nginx):
```nginx
proxy_hide_header X-Debug-Token;
proxy_hide_header X-Debug-Token-Link;
proxy_hide_header X-Debug-Info;
```

### `x-amz-request-id` [headers / info / header-missing]
**X-Amz-Request-Id reveals AWS infrastructure**

The X-Amz-Request-Id header is present, revealing that the response is served from AWS infrastructure.

**Risk:** While low severity on its own, revealing AWS infrastructure enables attackers to tailor attacks to AWS-specific vulnerabilities, targeting S3 public bucket access, EC2 metadata endpoints, or IAM misconfigurations.

**Why it matters:** Strip AWS-specific headers at your edge proxy before they reach clients.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Configure your CDN or reverse proxy to strip X-Amz-* headers
- Ensure S3 bucket responses are proxied and not directly accessed
- **Nginx: strip AWS headers** (nginx):
```nginx
proxy_hide_header X-Amz-Request-Id;
proxy_hide_header X-Amz-Id-2;
proxy_hide_header X-Amz-Version-Id;
```

### `cf-ray-header` [headers / info / header]
**Cloudflare CF-Ray request identifier present**

The Cloudflare CF-Ray response header exposes the request identifier that Cloudflare assigns to every proxied request.

**Risk:** CF-Ray alone does not leak sensitive information, but it confirms your origin sits behind Cloudflare and lets attackers correlate request IDs to logs.

**Why it matters:** CF-Ray is informational: it lets support teams trace a specific request through Cloudflare's edge. It does not contain user data, PII, or session tokens.

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

### `x-vercel-id` [headers / info / header-missing]
**X-Vercel-Id reveals deployment platform**

The X-Vercel-Id header is present and reveals the application is hosted on Vercel.

**Risk:** Revealing the deployment platform enables targeted attacks specific to Vercel's architecture, including serverless function cold-start timing attacks, deployment URL enumeration, or platform-specific configuration issues.

**Why it matters:** Vercel headers can be suppressed via custom Next.js middleware.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- In Next.js middleware, you can strip headers before they are forwarded
- **Next.js middleware: strip Vercel headers** (typescript):
```typescript
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  res.headers.delete("x-vercel-id");
  res.headers.delete("x-vercel-cache");
  return res;
}
```

### `x-cache-header` [headers / info / header-missing]
**X-Cache header reveals CDN cache status**

The X-Cache header (e.g., X-Cache: HIT or MISS) is present and reveals CDN caching details.

**Risk:** Cache HIT/MISS status can be used to probe CDN behavior, aid cache poisoning attacks by identifying when poison entries are cached, and reveal which resources are cached by CDN nodes.

**Why it matters:** X-Cache is an informational header; strip it for sensitive responses.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Configure your CDN to not forward X-Cache to end users
- Most CDNs have a header suppression option in their dashboard
- **Nginx** (nginx):
```nginx
proxy_hide_header X-Cache;
proxy_hide_header X-Cache-Hit;
```

### `etag-inode` [headers / low / header-missing]
**ETag reveals server inode number**

The ETag header format suggests it includes a file inode number, potentially revealing internal server file system details.

**Risk:** inode-based ETags leak the file's inode number on the server, which can be used to identify server software, configuration, and in some cases to correlate requests across virtual hosts sharing the same filesystem.

**Why it matters:** Apache's default ETag format includes inode, file size, and modification time. Configure it to exclude the inode.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Apache: FileETag MTime Size (removes inode)
- Nginx generates ETags from last-modified time and content length, no inode included by default
- **Apache: remove inode from ETag** (apache):
```apache
# In httpd.conf or .htaccess:
FileETag MTime Size
# The default "FileETag All" includes inode; this removes it
```

### `etag-inode-leak` [headers / low / header-missing]
**ETag value may contain inode information**

The ETag response header contains a value that appears to embed inode numbers from the server filesystem.

**Risk:** Exposing inode numbers helps attackers fingerprint the exact web server software version and may reveal filesystem structure that aids in targeted path traversal or LFI attacks.

**Why it matters:** Change Apache's ETag configuration to exclude inode values.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Apache: "FileETag MTime Size" in httpd.conf or .htaccess removes inode from ETags
- Alternatively, disable ETags entirely: "FileETag None"
- **Apache: disable inode in ETags** (apache):
```apache
FileETag MTime Size
# Or disable ETags entirely if not needed:
# FileETag None
# Header unset ETag
```

### `server-timing-exposure` [headers / low / header-missing]
**Server-Timing header exposes internal metrics**

The Server-Timing response header reveals internal performance metrics such as database query times, cache status, or backend service timings.

**Risk:** Detailed server timing data reveals internal architecture (database, cache, rendering steps), helps attackers identify slow operations for timing attacks, and provides a map of backend services being called.

**Why it matters:** Restrict Server-Timing to non-sensitive metric names and only expose it in development or to internal monitoring.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- In production, disable Server-Timing or use opaque metric names
- Gate Server-Timing behind an internal IP check or admin auth
- Add Timing-Allow-Origin to restrict which origins can read the timings
- **Conditional Server-Timing** (typescript):
```typescript
// Only add timing in development
if (process.env.NODE_ENV !== "production") {
  res.setHeader("Server-Timing", `db;dur=<value>, render;dur=<value>`);
}
```

### `date-time-skew` [headers / info / header-missing]
**Server Date header shows clock skew**

The Date response header shows a time significantly different from the current time, indicating a misconfigured server clock.

**Risk:** Severe clock skew can cause authentication token expiration issues, TOTP/HOTP MFA code rejection, TLS certificate validation failures, and session management problems. Predictable skew can also help attackers infer server restart times or virtualization artifacts.

**Why it matters:** Ensure NTP synchronization is configured and running on all servers.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Enable and configure NTP: systemctl enable --now systemd-timesyncd
- Verify time sync: timedatectl status
- For containers, ensure the host clock is synchronized and the container inherits it
- **Linux: enable NTP sync** (bash):
```bash
# Enable systemd-timesyncd
systemctl enable --now systemd-timesyncd

# Check sync status
timedatectl show --property=NTPSynchronized

# Or install and configure chrony for better accuracy:
apt-get install chrony
service chrony restart
```

### `cache-control-public-sensitive` [headers / high / header-missing]
**Cache-Control: public on sensitive resource**

A response containing authenticated or user-specific content is served with Cache-Control: public, allowing it to be cached by shared proxies.

**Risk:** Caching authenticated responses at shared proxy caches (CDNs, corporate proxies) means one user's private data may be served to another user, a critical data leakage vulnerability.

**Why it matters:** Authenticated and user-specific responses must use Cache-Control: private or no-store to prevent shared caching.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Change Cache-Control to "no-store" for authenticated/private responses
- Use "private, no-cache" for responses that vary per user but can be re-validated
- Review your CDN configuration to ensure it does not cache authenticated routes
- **Correct for authenticated responses** (typescript):
```typescript
return Response.json(userData, {
  headers: { "Cache-Control": "no-store, max-age=0" }
});
// Never use "public" for authenticated or user-specific data
```

### `deprecated-tls` [headers / high / header-missing]
**Deprecated TLS version (TLS 1.0 or 1.1) supported**

The server supports TLS 1.0 or TLS 1.1, which are deprecated protocols with known security weaknesses.

**Risk:** TLS 1.0 and 1.1 are vulnerable to BEAST, POODLE, and other downgrade attacks that can allow an attacker to decrypt the connection, exposing credentials, session tokens, and all transmitted data.

**Why it matters:** Only TLS 1.2 and 1.3 should be accepted. TLS 1.0 and 1.1 were deprecated by RFC 8996 in 2021.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Configure your web server to only accept TLS 1.2 and TLS 1.3
- Disable TLS 1.0 and TLS 1.1 in your server configuration
- Prefer TLS 1.3 which provides forward secrecy by default
- **Nginx: TLS 1.2+ only** (nginx):
```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers off;
```

### `mixed-content` [headers / high / header-missing]
**HTTP resources loaded on HTTPS page (mixed content)**

An HTTPS page loads scripts, images, or other resources over HTTP, triggering browser mixed content warnings.

**Risk:** Active mixed content (scripts, iframes, forms) is blocked by modern browsers. Passive mixed content (images) is loaded but can be intercepted by a network attacker, replacing images, injecting watermarks, or fingerprinting users via the unencrypted HTTP request.

**Why it matters:** All resources must be loaded over HTTPS when the page is served over HTTPS.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Update all resource URLs from http:// to https://
- Add upgrade-insecure-requests to your CSP to auto-upgrade HTTP requests
- Use protocol-relative URLs (//example.com) or absolute HTTPS URLs
- **CSP upgrade-insecure-requests** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: "upgrade-insecure-requests; default-src https: 'self';" }] }];
  },
};
```

### `form-action-http` [headers / high / header-missing]
**Form submits data over unencrypted HTTP**

An HTML form uses an HTTP (not HTTPS) action URL, transmitting form data in plaintext.

**Risk:** Form data submitted over HTTP is visible to any network observer, exposing passwords, personal data, payment information, or authentication tokens to interception.

**Why it matters:** All form actions must use HTTPS URLs.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Change the form action from http:// to https://
- Enable HSTS to prevent HTTP downgrades
- Audit all forms to verify action URLs use HTTPS
- **Correct form action** (html):
```html
<!-- BAD: <form action="http://example.com/submit"> -->
<!-- GOOD: -->
<form action="https://example.com/submit" method="POST">
  <!-- Always use HTTPS for form submissions -->
</form>
```

### `sri-missing` [headers / low / header-missing]
**External script loaded without Subresource Integrity**

A script or stylesheet is loaded from an external origin without a Subresource Integrity (SRI) hash. Note: SRI is impractical for continuously-updated third-party vendor scripts (analytics, ads, payment SDKs), which is why the overwhelming majority of production sites, including large, security-conscious ones, don't use it for those; it's most actionable for pinned, versioned static library includes.

**Risk:** Without SRI, if the CDN or third-party host serving the resource is compromised, attackers can replace the file with malicious code that executes in every visitor's browser, a supply chain attack.

**Why it matters:** SRI allows browsers to verify that a fetched resource has not been tampered with by checking a cryptographic hash.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Generate hash: openssl dgst -sha384 -binary file.js | openssl base64 -A
- Add integrity="sha384-HASH" and crossorigin="anonymous" to the element
- Lock CDN URLs to specific versioned filenames
- **Script with SRI** (html):
```html
<script
  src="https://cdn.example.com/lib.min.js"
  integrity="sha384-COMPUTED_HASH"
  crossorigin="anonymous"
></script>
```

### `sri-stylesheet-missing` [headers / medium / header-missing]
**External stylesheet without SRI**

A CSS stylesheet loaded from a third-party CDN does not have a Subresource Integrity hash.

**Risk:** A compromised CDN stylesheet can inject CSS-based data exfiltration techniques, CSS keyloggers, or modify the visual appearance of the page to enable phishing, without any JavaScript.

**Why it matters:** SRI must be applied to all external CSS resources.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Generate hash: openssl dgst -sha384 -binary style.css | openssl base64 -A
- Add integrity and crossorigin to the link element
- **Stylesheet with SRI** (html):
```html
<link
  rel="stylesheet"
  href="https://cdn.example.com/styles.min.css"
  integrity="sha384-COMPUTED_HASH"
  crossorigin="anonymous"
/>
```

### `cookie-security` [headers / high / header-missing]
**Cookies missing security attributes**

One or more cookies are set without required security attributes (Secure, HttpOnly, SameSite).

**Risk:** Cookies without Secure can be sent over HTTP (interceptable). Without HttpOnly, scripts can steal session cookies via XSS. Without SameSite, cookies are sent on cross-site requests, enabling CSRF attacks.

**Why it matters:** All session and authentication cookies must have Secure, HttpOnly, and SameSite attributes set.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Secure to prevent sending over HTTP
- Add HttpOnly to prevent JavaScript access
- Add SameSite=Strict or Lax to prevent CSRF
- **Secure cookie attributes** (typescript):
```typescript
res.setHeader("Set-Cookie",
  `session=<value>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`
);
// For session cookies: omit Max-Age (expires on browser close)
// For remember-me: Max-Age=2592000 (30 days)
```

### `frame-busting-header-only` [headers / low / header-missing]
**Frame-busting relies on header only without JS fallback**

Clickjacking protection is provided by HTTP header only, without a JavaScript frame-busting script for older browsers.

**Risk:** Older browsers that do not support X-Frame-Options may be tricked into framing the page. While modern browsers all support X-Frame-Options, the JS fallback provides defense in depth for legacy clients.

**Why it matters:** Combine HTTP header protection with a JavaScript frame-busting snippet for legacy browser coverage.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Keep X-Frame-Options header
- Add a JS frame-buster for legacy browsers
- Consider CSP frame-ancestors which supersedes X-Frame-Options in modern browsers
- **JS frame buster** (javascript):
```javascript
// Add to <head> of your page:
if (window.self !== window.top) {
  window.top.location = window.self.location;
}
```

### `cors-methods-too-permissive` [headers / medium / header-missing]
**CORS allows overly broad HTTP methods**

Access-Control-Allow-Methods lists methods (e.g., PUT, DELETE, PATCH) that the endpoint does not actually use.

**Risk:** Granting CORS access to methods beyond what is needed enables cross-origin requests to trigger state changes (PUT, DELETE) from malicious sites, combining with CSRF for authenticated destructive actions.

**Why it matters:** List only the HTTP methods that cross-origin clients actually need to use.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Audit which methods each endpoint supports
- Only list those specific methods in Access-Control-Allow-Methods
- Return 405 for methods not in your allowlist
- **Minimal CORS methods** (typescript):
```typescript
return new Response(null, {
  headers: {
    "Access-Control-Allow-Methods": "GET, POST",  // only what you need
    "Access-Control-Allow-Origin": "https://partner.yoursite.com",
  },
});
```

### `referrer-policy-no-referrer-strict-origin-when-cross-origin` [headers / low / header-missing]
**Referrer-Policy not set to strict-origin-when-cross-origin**

The Referrer-Policy header is absent or not set to a strict value, potentially leaking full URL referrers to cross-origin destinations.

**Risk:** Without a strict Referrer-Policy, the full URL of pages (including query strings with tokens, user IDs, or search terms) is sent in the Referer header to every third-party origin, leaking user activity and potentially sensitive URL parameters.

**Why it matters:** strict-origin-when-cross-origin is the recommended value: it sends the full URL for same-origin requests but only the origin for cross-origin HTTPS requests.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add Referrer-Policy: strict-origin-when-cross-origin to all responses
- **Next.js** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] }];
  },
};
```

### `strict-transport-security-include-subdomains` [headers / medium / header-missing]
**HSTS header missing includeSubDomains directive**

The Strict-Transport-Security header is present but does not include includeSubDomains, leaving subdomains unprotected.

**Risk:** Without includeSubDomains, attackers can downgrade connections to subdomains over HTTP and set cookies (without Secure flag) that are sent to the main domain, a subdomain cookie injection attack.

**Why it matters:** includeSubDomains extends HSTS protection to all subdomains of the current domain.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add includeSubDomains to the HSTS header
- Ensure all subdomains are served over HTTPS before adding includeSubDomains
- Consider also adding preload for first-visit protection
- **Next.js** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```
- **Apache** (apache):
```apache
Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
```

### `form-no-action-https` [headers / high / header-missing]
**Form submits to a non-HTTPS URL**

A form action URL does not use HTTPS, transmitting data in cleartext.

**Risk:** Data submitted through the form travels unencrypted and can be intercepted by a network observer, exposing passwords, payment data, or personal information.

**Why it matters:** All form actions must use HTTPS.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Update the form action to use https://
- Ensure the destination server has a valid TLS certificate
- Enable HSTS on the destination to prevent protocol downgrades
- **Secure form action** (html):
```html
<form action="https://yoursite.com/submit" method="POST">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}" />
  <button type="submit">Submit</button>
</form>
```

### `meta-redirect-no-url` [headers / medium / header-missing]
**Meta refresh redirect with missing or empty URL**

A meta refresh tag is present but the URL attribute is missing or empty, causing unpredictable redirect behavior.

**Risk:** A meta refresh without a URL reloads the current page in a loop, causing poor user experience. If the URL can be injected by user input, it becomes an open redirect vulnerability.

**Why it matters:** Meta refresh should always point to an explicit absolute HTTPS URL, or better, be replaced with a server-side redirect.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Replace meta refresh with a server-side 301/302 redirect
- If meta refresh must be used, set an explicit absolute HTTPS URL
- Never derive the meta refresh URL from user input
- **Server-side redirect (preferred)** (typescript):
```typescript
export function GET() {
  return Response.redirect("https://yoursite.com/new-page", 301);
}
```

### `autocomplete-username` [headers / info / header-missing]
**Username field missing autocomplete="username"**

A username or login field does not specify autocomplete="username", hindering password manager autofill.

**Risk:** Without autocomplete="username", password managers cannot reliably identify the username field, reducing autofill accuracy and discouraging password manager use.

**Why it matters:** Set autocomplete="username" on username and login identifier fields.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add autocomplete="username" to the username/login field
- Pair with autocomplete="current-password" on the password field
- **Login form with autocomplete** (html):
```html
<input type="email" name="email" autocomplete="username" />
<input type="password" name="password" autocomplete="current-password" />
```

### `image-protocol-relative` [headers / low / header-missing]
**Image URL uses protocol-relative scheme (//)**

An image source uses a protocol-relative URL (//example.com/image.jpg) that inherits the page protocol.

**Risk:** If the page is served over HTTP (e.g., after a redirect failure or HSTS bypass), protocol-relative image URLs also load over HTTP, enabling mixed content and potential image replacement by a network attacker.

**Why it matters:** Use explicit https:// URLs for all external resources.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Replace // with https:// in all image src attributes
- This also ensures images load correctly if the HTML is shared or stored outside a web server context
- **Explicit HTTPS image** (html):
```html
<!-- BAD: //cdn.example.com/image.jpg -->
<!-- GOOD: -->
<img src="https://cdn.example.com/image.jpg" alt="Description" />
```

### `open-graph-image-not-https` [headers / low / header-missing]
**OpenGraph image URL is not HTTPS**

The og:image meta tag uses an HTTP URL, which may cause browsers and social platforms to block the image.

**Risk:** HTTP image URLs in OG tags are blocked by major social platforms (Twitter/X, LinkedIn, Facebook) and browsers on HTTPS pages, causing missing preview images when the URL is shared. An attacker on the network can also replace the HTTP image with their own content.

**Why it matters:** All OpenGraph image URLs must use HTTPS.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Change og:image content from http:// to https://
- Ensure the image server has a valid TLS certificate
- **HTTPS og:image** (html):
```html
<meta property="og:image" content="https://yoursite.com/preview.jpg" />
```

### `doctype-missing` [headers / low / header-missing]
**HTML DOCTYPE declaration is missing**

The page does not start with a DOCTYPE declaration, triggering quirks mode in some browsers.

**Risk:** Without a DOCTYPE, browsers may render the page in quirks mode, a legacy compatibility mode with different CSS box model behavior, inconsistent XSS filtering (in old browsers), and unpredictable rendering that can break security UI elements.

**Why it matters:** Every HTML page must start with <!DOCTYPE html>.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add <!DOCTYPE html> as the very first line of every HTML document
- **Correct DOCTYPE** (html):
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Page Title</title>
</head>
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

### `target-blank-no-noopener` [headers / low / body-pattern]
**Reverse Tabnabbing: target=_blank without rel=noopener**

Anchor tags use target="_blank" without rel="noopener". Since Chrome 88 and Firefox 79, browsers implicitly apply noopener behavior to <a target="_blank"> links by default, so the practical risk on modern browsers is low; this is now mainly a defense-in-depth / older-browser recommendation rather than an active vulnerability.

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

### `iframe-third-party-without-sandbox` [headers / low / header-missing]
**Third-party iframe without sandbox attribute**

An iframe embedding third-party content does not use the sandbox attribute. Note: this fires on any cross-origin iframe, including common, legitimate embeds (YouTube, Google Maps, payment SDKs, chat widgets) that routinely omit sandbox because it would break their required functionality.

**Risk:** Without sandbox, a compromised third-party iframe can still open new windows/tabs, submit forms, or navigate the top-level page (the browser's Same-Origin Policy already prevents it from reading the parent page's DOM regardless of sandbox).

**Why it matters:** Add sandbox to third-party iframes where the embedded content doesn't need popups, top-level navigation, or forms, and grant only the permissions actually needed via allow-* tokens.

**References:**
- https://owasp.org/www-project-secure-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security

**Fix:**
- Add sandbox="" (most restrictive)
- Add allow-scripts if the iframe requires JavaScript
- Never combine allow-scripts with allow-same-origin for cross-origin content
- **Sandboxed third-party iframe** (html):
```html
<iframe
  src="https://widget.third-party.com"
  sandbox="allow-scripts"
  loading="lazy"
  title="Widget"
></iframe>
```

### `xpcdp-missing` [headers / low / header-missing]
**Missing X-Permitted-Cross-Domain-Policies header**

The server does not send X-Permitted-Cross-Domain-Policies: none, so legacy plugins (Adobe Flash, Acrobat Reader) fall back to permissive cross-domain policy discovery.

**Risk:** Without this header set to 'none', a legacy plugin on an older browser may load a permissive crossdomain.xml from this origin (or a parent path) and grant cross-domain data access it shouldn't have.

**Why it matters:** X-Permitted-Cross-Domain-Policies controls whether Adobe Flash and Acrobat treat this domain as willing to share data with other domains via crossdomain.xml. Modern browsers have dropped Flash, but the header is still checked by security scanners and costs nothing to set.

**References:**
- https://owasp.org/www-project-secure-headers/#x-permitted-cross-domain-policies
- https://www.adobe.com/devnet-docs/acrobatetk/tools/AppSec/xdomain.html

**Fix:**
- Add X-Permitted-Cross-Domain-Policies: none to all responses.
- If you deliberately serve a crossdomain.xml for a legacy integration, use 'master-only' instead of 'none' so only that top-level file is honored.
- **Next.js** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Permitted-Cross-Domain-Policies", value: "none" }] }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header X-Permitted-Cross-Domain-Policies "none" always;
```

### `origin-agent-cluster-missing` [headers / info / header-missing]
**Missing Origin-Agent-Cluster header**

The server does not send Origin-Agent-Cluster: ?1, so the browser may place this page in a shared, document.domain-relaxable agent cluster instead of an origin-isolated one.

**Risk:** Without origin isolation, this page stays eligible for document.domain relaxation and shares its agent cluster (process, in Chromium) with same-site-but-different-origin pages, widening the blast radius of a Spectre-style side-channel and keeping the legacy document.domain same-origin downgrade available.

**Why it matters:** Origin-Agent-Cluster: ?1 asks the browser to give this exact origin its own agent cluster, separate from other origins on the same site. It also permanently disables document.domain relaxation for pages that send it, closing off a decades-old way for two subdomains to opt into treating themselves as same-origin.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin-Agent-Cluster
- https://web.dev/articles/origin-agent-cluster

**Fix:**
- Add Origin-Agent-Cluster: ?1 to all responses.
- If any page relies on document.domain relaxation to communicate with a sibling subdomain, migrate that communication to postMessage before enabling this header, since it disables the relaxation for good on that origin.
- **Next.js** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Origin-Agent-Cluster", value: "?1" }] }];
  },
};
```
- **Nginx** (nginx):
```nginx
add_header Origin-Agent-Cluster "?1" always;
```

### `permissions-policy-browsing-topics-blocked` [headers / info / header]
**Permissions-Policy Browsing-Topics allowed**

Permissions-Policy does not block the browsing-topics directive, leaving Chrome's Privacy Sandbox Topics API available to any script on the page.

**Risk:** With browsing-topics left enabled, third-party scripts embedded on the page (ads, widgets) can call document.browsingTopics() and read the browser's inferred interest categories for this visitor, without an explicit opt-in from the site.

**Why it matters:** The Topics API replaced FLoC as Chrome's cohort-based interest-tracking mechanism. Sites that don't intend to participate should explicitly disable it via Permissions-Policy, the same way the earlier interest-cohort directive was recommended for FLoC.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/browsing-topics
- https://privacysandbox.google.com/private-advertising/topics

**Fix:**
- Set Permissions-Policy: browsing-topics=()
- **Block the Topics API in Permissions-Policy** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "browsing-topics=()" }] }];
  },
};
// Disables Chrome's Privacy Sandbox Topics API for this page
```

### `coop-unsafe-none` [headers / low / header-value]
**Cross-Origin-Opener-Policy Explicitly Set to unsafe-none**

The Cross-Origin-Opener-Policy header is explicitly set to 'unsafe-none', which opts the page out of browsing-context isolation.

**Risk:** Without COOP isolation, a malicious popup or cross-origin window can retain a reference to this page via window.opener and probe it for cross-window (XS-Leaks) side-channel attacks.

**Why it matters:** 'unsafe-none' is the pre-COOP legacy default that keeps window.opener references alive across origins. Setting it explicitly (rather than simply omitting the header) usually means isolation was deliberately turned off, often to support a legacy popup-based OAuth or payment flow.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy
- https://web.dev/articles/why-coop-coep

**Fix:**
- Set Cross-Origin-Opener-Policy: same-origin unless a specific cross-origin popup flow requires opener access.
- If a popup flow needs partial isolation, use same-origin-allow-popups instead of unsafe-none.
- Migrate any window.opener-based communication to postMessage with explicit origin checks.
- **Next.js** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }],
    }];
  },
};
export default nextConfig;
```
- **Nginx** (nginx):
```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
```

### `coop-report-only-without-enforcing` [headers / medium / combined]
**COOP Report-Only Without Enforcement**

Cross-Origin-Opener-Policy-Report-Only is set but no enforcing Cross-Origin-Opener-Policy header exists.

**Risk:** The site is only logging what COOP would have blocked, not actually isolating the browsing context, so window.opener-based XS-Leaks attacks remain possible.

**Why it matters:** Cross-Origin-Opener-Policy-Report-Only is meant for testing before deployment, the same way CSP-Report-Only is. Running it indefinitely without a matching enforcing header means zero isolation is ever applied.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy-Report-Only

**Fix:**
- Deploy an enforcing Cross-Origin-Opener-Policy header alongside the report-only one.
- Start with same-origin-allow-popups if a popup flow depends on opener access, then tighten to same-origin.
- **Both headers** (text):
```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Opener-Policy-Report-Only: same-origin; report-to="coop-endpoint"
```

### `reporting-api-endpoints-missing` [headers / low / combined]
**CSP report-to Group Has No Reporting-Endpoints Definition**

The CSP references a 'report-to' group name, but the response does not define that group via a Reporting-Endpoints header.

**Risk:** CSP violation reports are silently dropped instead of being delivered, so real policy violations (including active XSS attempts) go unnoticed.

**Why it matters:** The modern Reporting API requires a separate Reporting-Endpoints header (or the legacy Report-To header) to map a group name used in 'report-to' to an actual URL. Without it, browsers have nowhere to send the reports.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Reporting-Endpoints
- https://developer.chrome.com/docs/capabilities/web-apis/reporting-api

**Fix:**
- Add a Reporting-Endpoints header defining the same group name referenced by CSP's report-to directive.
- Verify the endpoint URL accepts POST requests with the application/reports+json content type.
- **Next.js** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'Reporting-Endpoints', value: 'csp-endpoint="https://example.com/csp-reports"' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; report-to csp-endpoint" },
      ],
    }];
  },
};
export default nextConfig;
```

### `access-control-allow-private-network-wildcard` [headers / high / combined]
**Private Network Access Allowed With Wildcard CORS**

Access-Control-Allow-Private-Network is set to true while Access-Control-Allow-Origin is a wildcard, letting any public website's script reach into the private network.

**Risk:** A public webpage can use this endpoint as a pivot: the browser's Private Network Access checks are satisfied, so the attacker's script can send requests to internal-only services from a visitor's browser.

**Why it matters:** Private Network Access is a browser mechanism that normally blocks public websites from making requests to private-IP or localhost targets. Access-Control-Allow-Private-Network: true opts back into allowing it, and combining that opt-in with a wildcard origin removes the one control (origin allowlisting) that would otherwise limit who can use it.

**References:**
- https://developer.chrome.com/blog/private-network-access-preflight
- https://wicg.github.io/private-network-access/

**Fix:**
- Never combine Access-Control-Allow-Private-Network: true with a wildcard origin.
- Explicitly allowlist the specific origins that are permitted to reach this private-network endpoint.
- Reconsider whether the endpoint needs to be reachable from a browser context at all.
- **Restrict private-network CORS** (typescript):
```typescript
const ALLOWED = ['https://internal-tools.example.com'];
const origin = request.headers.get('origin');
if (ALLOWED.includes(origin)) {
  headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Private-Network'] = 'true';
}
```

### `permissions-policy-interest-cohort-blocked` [headers / info / header]
**Permissions-Policy interest-cohort allowed**

Permissions-Policy does not block the legacy interest-cohort directive (FLoC).

**Risk:** On browsers that still recognize the legacy FLoC directive, third-party scripts could read the page's cohort assignment.

**Why it matters:** interest-cohort was the original Permissions-Policy directive for opting out of FLoC before it was renamed to browsing-topics. Some scanners and older browser builds still check for it, so it's worth disabling explicitly alongside browsing-topics.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy

**Fix:**
- Set Permissions-Policy: interest-cohort=()
- **Block legacy FLoC directive** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "interest-cohort=(), browsing-topics=()" }] }];
  },
};
```

### `permissions-policy-attribution-reporting-blocked` [headers / info / header]
**Permissions-Policy attribution-reporting allowed**

Permissions-Policy does not block the attribution-reporting directive, leaving the Privacy Sandbox Attribution Reporting API available to any script on the page.

**Risk:** Third-party scripts embedded on the page can register attribution sources/triggers on the visitor's behalf without an explicit site opt-in.

**Why it matters:** Attribution Reporting is part of Chrome's Privacy Sandbox. Sites that don't intend to participate in ad-attribution measurement should explicitly disable it via Permissions-Policy.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/attribution-reporting

**Fix:**
- Set Permissions-Policy: attribution-reporting=()
- **Block Attribution Reporting API** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "attribution-reporting=()" }] }];
  },
};
```

### `permissions-policy-otp-credentials-blocked` [headers / info / header]
**Permissions-Policy otp-credentials allowed**

Permissions-Policy does not restrict the otp-credentials directive (WebOTP API), leaving SMS OTP auto-fill available to any embedded frame by default.

**Risk:** A third-party iframe embedded on the page could request access to the WebOTP API and intercept one-time-passcode SMS messages intended for the top-level site.

**Why it matters:** The WebOTP API lets a page read verification codes from incoming SMS. Restricting it to 'self' (or blocking it entirely on pages that don't use it) prevents embedded third parties from requesting the same access.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/otp-credentials

**Fix:**
- Set Permissions-Policy: otp-credentials=(self) or otp-credentials=() if unused.
- **Restrict WebOTP access** (javascript):
```javascript
// next.config.mjs
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "otp-credentials=(self)" }] }];
  },
};
```

---

## Category: host-validation (7 checks)

### `host-header-injection` [host-validation / high / header-present]
**Host Header Injection Risk**

The response reflects the X-Forwarded-Host header value or appears to use user-supplied host information in links, emails, or redirects. Host header injection allows attackers to poison password reset emails with an attacker-controlled domain.

**Risk:** Password reset links poisoned via Host header injection redirect victims to the attacker's domain, stealing reset tokens. Cache poisoning via host injection can serve malicious content to all users from a shared cache.

**Why it matters:** Web applications often construct absolute URLs using the Host request header (e.g., for password reset links). If the application trusts X-Forwarded-Host or accepts arbitrary Host headers, an attacker can inject a different domain and have the application send links pointing there.

**References:**
- https://portswigger.net/web-security/host-header
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/17-Testing_for_Host_Header_Injection

**Fix:**
- Hardcode the application's canonical hostname in configuration, never derive it from the Host header.
- Use ALLOWED_HOSTS validation: reject requests with Host headers not in the allowlist.
- In Django: configure ALLOWED_HOSTS. In Rails: configure config.hosts. In Express: validate req.hostname against a whitelist.
- For password reset emails: always use the configured APPLICATION_URL, never request.host.
- **Safe absolute URL generation** (typescript):
```typescript
// Bad: Host header poisonable
const resetUrl = `<value>://<value>/reset?token=<value>`;

// Good: use configured base URL
const resetUrl = `<value>/reset?token=<value>`;
```

### `symfony-debug-token` [host-validation / medium / header-present]
**Symfony Debug Token Header Exposed**

The X-Debug-Token or X-Debug-Token-Link header is present in the response. These headers indicate Symfony's debug profiler is active in production, exposing full request data, database queries, and application internals.

**Risk:** The Symfony profiler exposes the complete request/response cycle, environment variables, database queries with parameters, and application configuration. An attacker using the debug token link can access a full profiler UI with all this data.

**Why it matters:** Symfony's WebProfilerBundle adds X-Debug-Token and X-Debug-Token-Link headers in debug mode. The token link provides access to the profiler UI at /_profiler/{token}, exposing sensitive internals.

**References:**
- https://symfony.com/doc/current/profiler.html
- https://symfony.com/doc/current/deployment.html#d-configure-your-environment-variables

**Fix:**
- Disable debug mode in production: APP_DEBUG=false in .env.prod.
- Remove WebProfilerBundle from production: it should be in require-dev only.
- Set APP_ENV=prod which disables the profiler automatically.
- Verify: curl -I https://yoursite.com, no X-Debug-Token header should appear.
- **Production Symfony .env** (bash):
```bash
# .env.prod
APP_ENV=prod
APP_DEBUG=false
# composer install --no-dev in production
```

### `http-request-smuggling` [host-validation / high / combined]
**HTTP Request Smuggling Indicator**

Both Transfer-Encoding: chunked and Content-Length headers are present in the same response, which is a condition that can enable HTTP request smuggling attacks when a front-end proxy and backend server disagree on which header to use.

**Risk:** HTTP request smuggling allows attackers to bypass security controls, poison shared caches, access other users' requests, and in some configurations achieve SSRF or remote code execution. It exploits disagreement between load balancers and backend servers about message boundaries.

**Why it matters:** HTTP/1.1 specifies that when both Transfer-Encoding and Content-Length are present, Transfer-Encoding takes precedence. When front-end (proxy) and back-end servers interpret these headers differently, an attacker can 'smuggle' a prefix of a request that the back-end processes as the next request.

**References:**
- https://portswigger.net/web-security/request-smuggling
- https://owasp.org/www-community/attacks/HTTP_Request_Smuggling

**Fix:**
- Ensure your proxy and backend use the same HTTP message framing.
- Configure your reverse proxy to rewrite or normalize ambiguous transfer encoding.
- Upgrade to HTTP/2 end-to-end: HTTP/2 is not vulnerable to classical request smuggling.
- Use Burp Suite's HTTP Request Smuggler extension to actively test your setup.
- **Nginx fix: normalize Transfer-Encoding** (nginx):
```nginx
# Reject requests with both TE and CL (defense)
http {
  # Keep backend on HTTP/1.1 and normalize chunked encoding
  proxy_http_version 1.1;
  proxy_set_header Connection '';
  # Upgrade proxy-to-backend to HTTP/2 when possible
}
```

### `basic-auth-over-http` [host-validation / high / header-present]
**HTTP Basic Authentication Over Non-HTTPS**

The WWW-Authenticate: Basic header was found on a response served without HTTPS, or the URL is HTTP. Basic authentication transmits credentials as Base64-encoded plaintext, which is trivially decoded by any network observer.

**Risk:** HTTP Basic Auth credentials are transmitted in every request as 'Authorization: Basic base64(user:password)'. On HTTP, any network observer (ISP, shared Wi-Fi, VPN provider) can capture and decode these credentials in plaintext.

**Why it matters:** Base64 encoding is not encryption. HTTP Basic Auth over HTTP is effectively cleartext credential transmission. The credentials are sent with every request, not just the initial authentication, amplifying exposure.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication#basic_authentication_scheme
- https://owasp.org/www-project-top-ten/2021/A02_2021-Cryptographic_Failures

**Fix:**
- Enforce HTTPS for any endpoint protected by HTTP Basic Auth.
- Redirect all HTTP traffic to HTTPS before authentication can occur.
- Consider replacing Basic Auth with a proper session-based or token-based authentication system.
- If Basic Auth is required: ensure HSTS is configured so browsers will always use HTTPS.
- **Force HTTPS before auth (Nginx)** (nginx):
```nginx
server {
  listen 80;
  return 301 https://$host$request_uri; # Redirect HTTP to HTTPS
}

server {
  listen 443 ssl;
  auth_basic "Protected Area";
  auth_basic_user_file /etc/nginx/.htpasswd;
}
```

### `aspnet-viewstate-no-mac` [host-validation / high / body-pattern]
**ASP.NET ViewState Without MAC Protection**

An ASP.NET ViewState field was found without a corresponding ViewStateMAC field, or with enableViewStateMac disabled. ViewState without MAC validation allows forged ViewState that can trigger deserialization exploits.

**Risk:** Forged ViewState enables deserialization attacks against ASP.NET's ObjectStateFormatter. An attacker who knows the machineKey (or when no MAC is required) can craft a ViewState payload that executes arbitrary .NET code on the server.

**Why it matters:** ASP.NET's ViewState stores page state between requests. The MAC (Message Authentication Code) prevents tampering. Without it, an attacker can inject malicious serialized objects into the ViewState, exploiting .NET deserialization gadget chains.

**References:**
- https://owasp.org/www-community/vulnerabilities/Improper_Data_Validation
- https://docs.microsoft.com/en-us/dotnet/api/system.web.ui.page.enableviewstatemac

**Fix:**
- Never set EnableViewStateMac=false or ViewStateEncryptionMode=Never.
- Ensure <machineKey> is configured with a strong random validationKey.
- Consider enabling ViewState encryption: ViewStateEncryptionMode='Always'.
- Upgrade to .NET 4.5.2+ which enforces ViewState MAC by default.
- **Web.config ViewState protection** (xml):
```xml
<configuration>
  <system.web>
    <!-- Always require MAC validation -->
    <pages enableViewStateMac="true" viewStateEncryptionMode="Always" />
    <machineKey
      validationKey="[strong-random-key]"
      decryptionKey="[strong-random-key]"
      validation="HMACSHA256"
      decryption="AES" />
  </system.web>
</configuration>
```

### `cache-poisoning-unkeyed-header` [host-validation / high / combined]
**Cache Poisoning via Unkeyed Headers**

The response shows cache hit indicators (X-Cache: HIT) while also including or reflecting content from headers that may not be part of the cache key (X-Forwarded-Host, X-Original-URL). This configuration can enable cache poisoning attacks.

**Risk:** Web cache poisoning allows an attacker to poison a cached response so that all subsequent users who receive the cached copy get the attacker's injected content. This can enable XSS at scale: the XSS is cached and served to thousands of users without further attacker interaction.

**Why it matters:** Cache keys determine which requests share a cached response. If a cache serves different responses based on X-Forwarded-Host but doesn't include it in the cache key, an attacker can inject a crafted X-Forwarded-Host that gets cached and served to other users.

**References:**
- https://portswigger.net/web-security/web-cache-poisoning
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/16-Testing_for_HTTP_Splitting_Smuggling

**Fix:**
- Normalize and strip unkeyed headers at the cache layer before forwarding to the origin.
- Include all headers that affect the response content in the cache key.
- Audit Vary headers to ensure all differentiating headers are included.
- Test with Param Miner (Burp extension) to discover unkeyed headers.
- **Cloudflare cache key configuration** (javascript):
```javascript
// Cloudflare Worker: strip unkeyed headers
addEventListener('fetch', event => {
  const request = new Request(event.request);
  // Remove headers that affect response but aren't in cache key
  request.headers.delete('X-Forwarded-Host');
  request.headers.delete('X-Original-URL');
  event.respondWith(fetch(request));
});
```

### `idor-sequential-id-in-url` [host-validation / medium / url-check]
**Sequential Numeric ID in URL (IDOR Risk)**

The scanned URL contains a sequential numeric identifier in a path segment that suggests a resource ID. Sequential IDs enable Insecure Direct Object Reference (IDOR) attacks: an attacker can enumerate IDs to access other users' resources.

**Risk:** IDOR vulnerabilities are the most common access control bug in APIs. An attacker who finds /api/invoices/1042 can try /api/invoices/1043 to access another user's invoice. If the server doesn't verify ownership, the attack succeeds.

**Why it matters:** Sequential integer IDs (1, 2, 3...) are predictable and enumerable. The fix is not to hide IDs from attackers: it's to verify ownership server-side on every request. UUIDs make enumeration impractical but authorization checks are still required.

**References:**
- https://owasp.org/www-project-top-ten/2021/A01_2021-Broken_Access_Control
- https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html

**Fix:**
- Verify resource ownership on every API endpoint: confirm the requesting user owns the resource.
- Switch from sequential integers to UUID primary keys for user-facing resource IDs.
- Use the 'check before you leak' pattern: fetch, verify ownership, then return data.
- Implement automated IDOR testing in your security test suite.
- **Ownership check on resource endpoint** (typescript):
```typescript
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAuth(req);
  const invoice = await db.invoice.findUnique({ where: { id: params.id } });
  if (!invoice) return new Response('Not Found', { status: 404 });
  // Critical: verify the requester owns this resource
  if (invoice.userId !== session.userId && session.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }
  return Response.json(invoice);
}
```

---

## Category: information-disclosure (41 checks)

### `rails-cookie-httponly` [information-disclosure / medium / body-pattern]
**Rails Session Cookie Missing HttpOnly Flag**

A Rails-style session cookie (matching the *_session naming pattern) was found in the Set-Cookie header without the HttpOnly flag. HttpOnly prevents client-side JavaScript from reading the cookie value, which blocks XSS-based session hijacking.

**Risk:** Without HttpOnly, any injected JavaScript on the page can read the session cookie via document.cookie and exfiltrate it to an attacker-controlled server. This enables full session hijacking even when the XSS vulnerability itself has limited reach.

**Why it matters:** Rails session cookies use a *_session suffix by default (e.g., myapp_session). When the HttpOnly flag is absent, client-side scripts have unrestricted access to the cookie. An attacker who achieves XSS on any page in the same origin can steal the session and impersonate the authenticated user.

**References:**
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/06-Session_Management_Testing/02-Testing_for_Cookies_Attributes
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#httponly
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#httponly-attribute

**Fix:**
- In Rails, enable HttpOnly on the session cookie via config.session_store :cookie_store, httponly: true in config/application.rb.
- In config/initializers/session_store.rb, verify :httponly => true is set.
- For non-Rails cookies, always include HttpOnly in the Set-Cookie header: Set-Cookie: name=value; HttpOnly; Secure; SameSite=Strict.
- Audit all cookies set by the application and ensure none are readable by JavaScript unnecessarily.
- **Rails (config/initializers/session_store.rb)** (ruby):
```ruby
Rails.application.config.session_store :cookie_store,
  key: '_myapp_session',
  httponly: true,
  secure: Rails.env.production?,
  same_site: :strict
```
- **PHP (generic HttpOnly cookie)** (php):
```php
// Set session cookie with HttpOnly and Secure flags
session_set_cookie_params([
  'lifetime' => 0,
  'path'     => '/',
  'domain'   => '',
  'secure'   => true,
  'httponly' => true,
  'samesite' => 'Strict',
]);
session_start();
```
- **Express.js (express-session)** (javascript):
```javascript
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
  },
  resave: false,
  saveUninitialized: false,
}));
```

### `server-header-truncated` [information-disclosure / info / header]
**Server header truncated**

The Server response header ends with the literal string '(truncated)', which indicates the upstream version was actively hidden but the truncation marker is itself a fingerprint.

**Risk:** Even a truncated Server header confirms that a real version string is present upstream and that the masking is incomplete. The marker reveals which middleware layer is involved and may help an attacker identify the proxy or load balancer in use.

**Why it matters:** Some reverse proxies append '(truncated)' after the version string when server_tokens is configured to mask but not fully strip the value. The marker still confirms a real version is present upstream.

**References:**
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Set server_tokens off; in nginx.conf and remove the Server header entirely with proxy_hide_header Server;.
- In Apache, set ServerTokens Prod and ServerSignature Off.
- At Cloudflare, use a Transform Rule to strip Server before the response leaves the edge.
- **Nginx (nginx.conf)** (nginx):
```nginx
http {
  server_tokens off;

  server {
    # Strip the Server header entirely at the proxy layer
    proxy_hide_header Server;
    add_header Server "" always;
  }
}
```
- **Apache (httpd.conf)** (apache):
```apache
# Reveal only the product name, no version
ServerTokens Prod
# Remove the version footer from error pages
ServerSignature Off
```

### `php-version-exposed-in-cookie` [information-disclosure / info / header]
**PHP session cookie naming exposes runtime**

The PHPSESSID cookie name in the Set-Cookie header reveals that the server-side runtime is PHP. Default framework cookie names act as free fingerprints for attackers performing stack reconnaissance.

**Risk:** Knowing the server uses PHP lets attackers immediately focus on PHP-specific vulnerabilities, version checks, and misconfigurations rather than needing to probe the stack. Combined with an X-Powered-By header or error messages, it narrows the attack surface to PHP CVEs.

**Why it matters:** PHP sets the session cookie to PHPSESSID by default. This name is universally recognized as a PHP fingerprint. Renaming it to a generic opaque string costs nothing and removes one layer of passive information disclosure.

**References:**
- https://www.php.net/manual/en/session.configuration.php#ini.session.name
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Override the default session cookie name in php.ini: session.name = sid
- Alternatively, set it at runtime before session_start(): ini_set('session.name', 'sid');
- Choose a name that does not reference the framework or language.
- Also set session.cookie_httponly = 1 and session.cookie_secure = 1 in php.ini.
- **PHP (php.ini)** (ini):
```ini
; Rename the session cookie to a generic opaque name
session.name = sid
session.cookie_httponly = 1
session.cookie_secure = 1
session.cookie_samesite = Strict
```
- **PHP (runtime, before session_start)** (php):
```php
// Set before calling session_start()
ini_set('session.name', 'sid');
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_secure', 1);
session_start();
```

### `config-js-leaked` [information-disclosure / medium / header]
**config.js / settings.js leaked**

A reference to a public config.js or settings.js file was found in the page source. These files are commonly used to store API keys, backend endpoints, feature flags, and environment-specific values that should not be served to browsers.

**Risk:** Public config.js files commonly contain API keys, service endpoints, environment names, and feature flags in plain text. An attacker who requests this file can immediately extract credentials, identify third-party integrations, and map the application's internal architecture without any authentication.

**Why it matters:** Developers sometimes place environment configuration in public JavaScript files for convenience, particularly in single-page applications. Any file served under a public web root is readable by any visitor regardless of whether it is linked from the main page.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- https://cwe.mitre.org/data/definitions/312.html
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Move secrets out of any file served from the public web root.
- For frontend-only config (non-secret), use build-time environment variable injection (e.g., NEXT_PUBLIC_* in Next.js, Vite's import.meta.env).
- Never put API keys, database URLs, or OAuth secrets in client-side JavaScript.
- If a public config file is necessary, audit it to ensure it contains only non-sensitive values.
- **Next.js (env vars instead of config.js)** (javascript):
```javascript
// .env.local: never committed to source control
NEXT_PUBLIC_API_URL=https://api.example.com
// NOT secret: exposed to browser

// Secret values: never prefix with NEXT_PUBLIC_
DATABASE_URL=postgres://...
SECRET_KEY=...
```
- **Vite (import.meta.env)** (javascript):
```javascript
// .env
VITE_API_URL=https://api.example.com
// Accessed in code:
const apiUrl = import.meta.env.VITE_API_URL;

// Variables without VITE_ prefix are server-only and not bundled
```
- **Nginx (block config.js from public access)** (nginx):
```nginx
location ~* /config\.js$ {
  deny all;
  return 404;
}
```

### `env-js-leaked` [information-disclosure / medium / header]
**env.js / environment.js exposed**

A reference to env.js or environment.js was found in the page source. These files are commonly placed in the public directory as a deployment-time configuration injection point but frequently contain secrets that should never reach the browser.

**Risk:** An env.js or environment.js served from a public path may contain database URLs, API keys, OAuth client secrets, and environment names in plain text. Any visitor can request this file directly and extract credentials without needing to authenticate or exploit any vulnerability.

**Why it matters:** A common pattern in containerized deployments is to generate env.js at startup from environment variables and serve it as a static file. When secrets are included alongside frontend configuration, anyone who knows the file path (or finds the script tag) can read them.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- https://cwe.mitre.org/data/definitions/312.html
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Never serve env.js from a public web root path.
- For non-secret frontend config, use build-time injection (NEXT_PUBLIC_*, VITE_*, etc.).
- For runtime config, serve a minimal JSON endpoint that requires authentication or returns only non-sensitive values.
- If env.js already exists, audit it immediately and rotate any exposed credentials.
- **Docker entrypoint (safe pattern: non-secrets only)** (bash):
```bash
#!/bin/sh
# Only inject non-secret public config into env.js
cat > /app/public/env.js <<EOF
window.__ENV__ = {
  API_URL: "<value>",
  FEATURE_FLAG_X: "<value>"
};
EOF
# Secrets like DB_URL, SECRET_KEY must NEVER appear here
```
- **Nginx (block env.js from public access)** (nginx):
```nginx
location ~* /env\.js$ {
  deny all;
  return 404;
}
```

### `sitemap-public` [information-disclosure / info / header]
**Sitemap.xml publicly accessible**

sitemap.xml is publicly accessible or referenced in the page. While a sitemap is designed to help search engines index public content, it may inadvertently list admin paths, internal tools, or staging URLs that were not intended for public visibility.

**Risk:** A sitemap intended for search engines may expose admin paths, internal API routes, staging URLs, or paginated content trees. Attackers can use sitemap.xml as a ready-made map of the application's endpoint structure, skipping the need for active crawling or brute-force discovery.

**Why it matters:** Sitemaps are meant to list pages you want indexed. Problems arise when the sitemap is generated automatically from all routes without filtering, including paths like /admin, /internal, or /_debug that should not be publicly listed.

**References:**
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/03-Review_Webserver_Metafiles_for_Information_Leakage
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Audit sitemap.xml to confirm it lists only pages intended for public indexing.
- Exclude admin, internal, debug, and API routes from sitemap generation.
- Use robots.txt Disallow rules alongside sitemap to signal crawler scope.
- For Next.js, configure the sitemap generator to exclude protected paths.
- **Next.js (next-sitemap.config.js)** (javascript):
```javascript
/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || 'https://example.com',
  generateRobotsTxt: true,
  exclude: [
    '/admin',
    '/admin/*',
    '/api/*',
    '/_debug',
    '/internal/*',
  ],
};
```
- **robots.txt (pair with sitemap)** (text):
```text
User-agent: *
Disallow: /admin/
Disallow: /api/
Disallow: /internal/

Sitemap: https://example.com/sitemap.xml
```

### `open-api-schema-version-leak` [information-disclosure / info / header]
**OpenAPI schema version exposed in URL**

The OpenAPI or Swagger schema version is exposed in the URL or response body. Pinning a specific schema version in the URL or body makes it easy for attackers to identify whether the API is running a release with known vulnerabilities.

**Risk:** Exposing the exact API schema version helps attackers identify whether the running version has known vulnerabilities. Older pinned Swagger/OpenAPI versions may have documented parser or injection vulnerabilities, and the version string itself confirms which generation of the API is active.

**Why it matters:** OpenAPI and Swagger UI bundle version numbers in URLs like /openapi-v2.json or in the schema's info.version field. While API versioning is necessary, exposing it in a way that maps directly to a library or tooling release aids targeted reconnaissance.

**References:**
- https://owasp.org/www-project-api-security/
- https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Use path-based API versioning (/api/v1/, /api/v2/) rather than embedding the OpenAPI schema version in the URL.
- Restrict access to the raw schema endpoint to authenticated users or internal networks only.
- Serve a generic URL like /api/schema rather than /openapi-v3.1.0.json.
- Keep Swagger UI and OpenAPI tooling up to date regardless of version exposure.
- **Express.js (restrict schema access)** (javascript):
```javascript
// Only expose the schema to authenticated users or internal IPs
app.get('/api/schema', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'openapi.json'));
});

// Use path versioning, not schema versioning in URL
// Good: /api/v2/users
// Avoid: /openapi-v2.1.json
```
- **Nginx (block public schema access)** (nginx):
```nginx
location ~* /(?:openapi|swagger)[^/]*\.json$ {
  # Allow only internal networks
  allow 10.0.0.0/8;
  allow 172.16.0.0/12;
  allow 192.168.0.0/16;
  deny all;
}
```

### `cdn-cors-exposes-internal` [information-disclosure / low / header]
**CORS exposes internal CDN hostname**

The Access-Control-Allow-Origin header references an internal CDN or host pattern (e.g., .internal, .local, .corp, or CloudFront/S3 hostnames). This reveals internal infrastructure details that should not be visible in public responses.

**Risk:** A CORS header referencing internal hostnames (.internal, .local, cloudfront.net distributions) reveals the internal network topology, backend CDN architecture, and cloud provider configuration. Attackers can use this to identify backend services and pivot toward internal targets if they achieve access to another system in the same network.

**Why it matters:** CORS headers are sent to browsers to authorize cross-origin requests. When the Access-Control-Allow-Origin value is an internal hostname, it exposes the infrastructure layout. A wildcard (*) is dangerous for credentialed requests, while internal-origin values are a fingerprinting issue.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/CORS_Security_Cheat_Sheet.html
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Origin
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Set Access-Control-Allow-Origin to the specific public customer-facing origin(s) only.
- Maintain an allowlist of valid origins and reflect only the exact matching origin, not internal hostnames.
- Never reflect internal CDN domains, .local, .corp, or cloud-provider hostnames in CORS headers.
- Use a centralized CORS configuration module rather than setting the header ad hoc in each endpoint.
- **Express.js (safe CORS allowlist)** (javascript):
```javascript
const ALLOWED_ORIGINS = new Set([
  'https://example.com',
  'https://app.example.com',
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  // Do NOT reflect internal CDN or cloud hostnames here
  next();
});
```
- **Nginx (CORS origin allowlist)** (nginx):
```nginx
map $http_origin $cors_origin {
  default "";
  "https://example.com"     $http_origin;
  "https://app.example.com" $http_origin;
}

server {
  add_header Access-Control-Allow-Origin $cors_origin always;
}
```

### `recaptcha-key-leaked` [information-disclosure / info / header]
**reCAPTCHA site key exposure**

A Google reCAPTCHA site key was found in the page source. reCAPTCHA site keys are intentionally public (they must be embedded in the browser to work), but their exposure is worth noting for rotation policy awareness.

**Risk:** reCAPTCHA site keys are not secret by design and do not grant API access. However, a disclosed site key can be used by third parties to load reCAPTCHA widgets on their own pages under your property, potentially consuming your quota or generating noise in your reCAPTCHA dashboard. Secret keys (used server-side for token verification) are the sensitive component and must never appear in client-side code.

**Why it matters:** Google reCAPTCHA uses a two-key system: the site key (public, embedded in HTML) and the secret key (server-side, used to verify tokens). Only the site key is expected to appear in browser-visible source. This finding is informational unless the secret key is also exposed.

**References:**
- https://developers.google.com/recaptcha/docs/v3
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Confirm only the site key (6L...) is embedded in client-side code, never the secret key.
- Rotate site keys if you suspect abuse (e.g., spam or unusual reCAPTCHA token requests).
- Store secret keys in environment variables on the server side only.
- Monitor reCAPTCHA analytics for unusual traffic patterns that might indicate key abuse.
- **Safe usage (site key in frontend, secret key server-side only)** (javascript):
```javascript
// Frontend (public: site key is intentionally visible)
grecaptcha.ready(() => {
  grecaptcha.execute(process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY, { action: 'submit' })
    .then(token => { /* send token to server */ });
});

// Server-side (secret key must NEVER reach the browser)
const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
  method: 'POST',
  body: new URLSearchParams({
    secret: process.env.RECAPTCHA_SECRET_KEY, // env var, not NEXT_PUBLIC_
    response: tokenFromClient,
  }),
});
```

### `ga-tracking-id-leaked` [information-disclosure / info / header]
**Google Analytics tracking ID exposed**

A Google Analytics tracking ID (UA-XXXX or G-XXXX) was found in the page source. Analytics tracking IDs are public by design and must be present in the browser to work, but their exposure allows third parties to identify the analytics property.

**Risk:** Google Analytics tracking IDs are not secret by design. Their disclosure may allow a third party to send fake traffic or events to your analytics property (referrer spam), inflating metrics or triggering alerts. This does not expose user data or grant access to analytics reports, which are protected by Google account credentials.

**Why it matters:** The UA-XXXX (Universal Analytics) and G-XXXX (GA4) IDs must appear in page source for client-side tracking to function. Unlike API keys, they do not grant access to any backend service. The main concern is analytics spam from parties who find your tracking ID.

**References:**
- https://developers.google.com/analytics/devguides/collection/ga4
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- This is informational: no immediate action required.
- Monitor your Google Analytics reports for unusual spikes in bot or referrer traffic.
- Use server-side analytics or the Measurement Protocol with API secrets to reduce client-side tracking ID exposure.
- Enable bot filtering in Google Analytics settings.
- **Next.js (server-side analytics with GA Measurement Protocol)** (javascript):
```javascript
// Server-side event: tracking ID not exposed in browser source
const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID;
const GA_API_SECRET = process.env.GA_API_SECRET;

await fetch(
  `https://www.google-analytics.com/mp/collect?measurement_id=<value>&api_secret=<value>`,
  {
    method: 'POST',
    body: JSON.stringify({ client_id: clientId, events: [{ name: 'page_view' }] }),
  }
);
```

### `nginx-version-404-disclosure` [information-disclosure / low / body-pattern]
**nginx version disclosed in 404 / error pages**

Default nginx error pages and the Server response header expose the exact nginx version (e.g., 'nginx/1.18.0'). Knowing the version lets attackers search CVE databases for targeted exploits without any active scanning.

**Risk:** An attacker who knows the exact nginx version can immediately search CVE databases for matching vulnerabilities and known exploits. Version disclosure eliminates the reconnaissance phase and allows a targeted attack without additional probing.

**Why it matters:** By default, nginx includes its version number in both the Server header and the body of built-in error pages. A single 404 request to a non-existent path reveals the running version. The fix is a single config directive.

**References:**
- https://nginx.org/en/docs/http/ngx_http_core_module.html#server_tokens
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Add 'server_tokens off;' to the http block in nginx.conf to suppress the version in headers and error pages.
- Optionally strip the Server header entirely at the reverse proxy level.
- Use a custom error_page directive for 4xx and 5xx codes to serve a generic error page.
- Keep nginx updated regardless of whether the version is disclosed.
- **Nginx (nginx.conf)** (nginx):
```nginx
http {
  # Suppress version from Server header and default error pages
  server_tokens off;

  server {
    listen 443 ssl;

    # Custom generic error pages
    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;

    location = /404.html { root /usr/share/nginx/html; internal; }
    location = /50x.html  { root /usr/share/nginx/html; internal; }
  }
}
```

### `apache-version-404-disclosure` [information-disclosure / low / body-pattern]
**Apache version disclosed in 404 / error pages**

Default Apache error pages expose the full server version, loaded modules, and OS in the footer (e.g., 'Apache/2.4.57 (CentOS) Server at example.com Port 443').

**Risk:** Knowing the exact Apache version, loaded modules (e.g., mod_ssl version, mod_php), and OS distribution makes it trivial to identify applicable CVEs without additional scanning. The 'Server at host Port N' footer also confirms the virtual host name and port in use.

**Why it matters:** Apache by default appends a detailed signature to all error pages and the Server header. A single 404 request reveals the Apache version, OS, and active modules. Two directives in httpd.conf suppress this completely.

**References:**
- https://httpd.apache.org/docs/2.4/mod/core.html#servertokens
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Set 'ServerTokens Prod' in httpd.conf to reveal only 'Apache' without a version number.
- Set 'ServerSignature Off' to remove the version footer from error pages.
- Use custom ErrorDocument directives for 4xx and 5xx responses.
- Keep Apache updated regardless of whether version disclosure is suppressed.
- **Apache (httpd.conf)** (apache):
```apache
# Reveal only the product name, no version or OS
ServerTokens Prod

# Remove the 'Apache/version Server at host' footer from error pages
ServerSignature Off

# Custom error pages
ErrorDocument 404 /errors/404.html
ErrorDocument 500 /errors/500.html
```

### `iis-version-404-disclosure` [information-disclosure / low / body-pattern]
**IIS version disclosed in 404 / error pages**

Internet Information Services (IIS) leaks its version in the Server header and detailed error pages. These may also include the .NET CLR version via X-Powered-By and the machine name in some configurations.

**Risk:** The Microsoft-IIS version number, combined with the X-Powered-By header revealing the .NET CLR version, gives attackers a precise fingerprint to match against known IIS and ASP.NET CVEs without any active scanning. Detailed error pages may also expose the UNC path or machine name.

**Why it matters:** IIS includes its version number in the Server header by default and renders detailed error pages that can disclose the server name, .NET framework version, and path information. These can be suppressed via web.config or URL Rewrite rules.

**References:**
- https://learn.microsoft.com/en-us/iis/configuration/system.webserver/httpprotocol/
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Remove or suppress the Server header using URL Rewrite or a custom HttpModule.
- In web.config, set httpErrors mode='Custom' errorMode='Custom' to disable detailed error pages.
- Remove the X-Powered-By header in web.config under customHeaders.
- Disable 'Send Detailed Error Messages' in IIS Manager under Error Pages > Edit Feature Settings.
- **IIS (web.config)** (xml):
```xml
<configuration>
  <system.webServer>
    <!-- Remove version headers -->
    <httpProtocol>
      <customHeaders>
        <remove name="X-Powered-By" />
        <remove name="Server" />
      </customHeaders>
    </httpProtocol>

    <!-- Show only generic custom error pages -->
    <httpErrors errorMode="Custom" existingResponse="Replace">
      <remove statusCode="404" />
      <error statusCode="404" path="/errors/404.html" responseMode="ExecuteURL" />
      <remove statusCode="500" />
      <error statusCode="500" path="/errors/500.html" responseMode="ExecuteURL" />
    </httpErrors>
  </system.webServer>
</configuration>
```

### `mysql-access-denied-error` [information-disclosure / medium / body-pattern]
**MySQL Access Denied Error Exposed**

The application returned a raw MySQL 'Access denied for user' error message in the response body. These messages include the database username, host, and whether a password was provided, directly exposing database configuration details.

**Risk:** MySQL access denied errors expose the database username (e.g., 'root'@'localhost'), the hostname or IP of the database server, and whether a password was used ('using password: YES/NO'). This information helps attackers map the database configuration, try credential stuffing against the database port, and determine whether the database uses default or weak credentials.

**Why it matters:** When a PHP, Python, or other server-side application fails to catch a database connection error, the raw MySQL error message from mysqli_connect() or PDO is passed through to the HTTP response body. The error format 'Access denied for user "user"@"host" (using password: YES)' contains multiple sensitive fields that should never reach the browser.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- https://cwe.mitre.org/data/definitions/209.html
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Wrap all database connection calls in try/catch blocks and return a generic 500 error to the client.
- Log the full database error server-side (not to the response) for debugging.
- Never let unhandled exceptions propagate to the HTTP response in production.
- Set PHP's display_errors = Off and log_errors = On in php.ini for production environments.
- **PHP (safe error handling with PDO)** (php):
```php
try {
  $pdo = new PDO(
    'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME,
    DB_USER,
    DB_PASS,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
  );
} catch (PDOException $e) {
  // Log the real error server-side
  error_log('DB connection failed: ' . $e->getMessage());
  // Return a generic error to the client: never expose $e->getMessage()
  http_response_code(500);
  echo json_encode(['error' => 'Internal server error']);
  exit;
}
```
- **Node.js (safe MySQL error handling)** (javascript):
```javascript
import mysql from 'mysql2/promise';

let pool;
try {
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
} catch (err) {
  // Log, never expose
  console.error('DB pool creation failed:', err.message);
  process.exit(1);
}

// In route handlers:
try {
  const [rows] = await pool.query('SELECT ...');
} catch (err) {
  console.error('Query failed:', err.message);
  res.status(500).json({ error: 'Internal server error' });
}
```
- **PHP (php.ini production settings)** (ini):
```ini
; Production settings: never display errors to users
display_errors = Off
display_startup_errors = Off
log_errors = On
error_log = /var/log/php/error.log
```

### `aws-s3-nosuchbucket-error` [information-disclosure / low / body-pattern]
**AWS S3 NoSuchBucket error pattern exposed**

S3 bucket hosting returned a 'NoSuchBucket' or 'AccessDenied' XML error response, revealing the bucket name, region, and an x-amz-request-id header that can be correlated with AWS account activity.

**Risk:** S3 error responses expose the bucket name and region, enabling bucket name enumeration and subdomain takeover attempts on deleted or unclaimed buckets. The x-amz-request-id can be used alongside AWS support channels to correlate requests with account activity. AccessDenied responses also confirm that a bucket exists at the given name.

**Why it matters:** When a static site is served directly from an S3 bucket hostname, any error (missing file, wrong bucket name, or access control failure) returns an XML-formatted AWS error document. These responses confirm the bucket name, region endpoint, and the presence of the AWS account in the S3 namespace.

**References:**
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/HostingWebsiteOnS3Setup.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages.html
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Front S3 with CloudFront or another CDN that intercepts and rewrites error pages.
- Configure CloudFront custom error responses for 403 and 404 to serve generic HTML.
- Disable direct bucket hostname access via bucket policies that deny s3.amazonaws.com Origin requests.
- Use a vanity domain backed by CloudFront rather than exposing bucket hostnames.
- **CloudFront (custom error response via Terraform)** (hcl):
```hcl
resource "aws_cloudfront_distribution" "site" {
  # ... origin config ...

  custom_error_response {
    error_code         = 403
    response_code      = 404
    response_page_path = "/404.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 404
    response_page_path = "/404.html"
  }
}
```
- **S3 bucket policy (deny direct bucket access)** (json):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/EDFDVBD6EXAMPLE"
        }
      }
    }
  ]
}
```

### `privacy-policy-missing` [information-disclosure / low / body-pattern]
**Privacy Policy page not found**

No privacy policy link or page was detected on the site. A privacy policy is legally required in many jurisdictions (GDPR, CCPA).

**Risk:** Absence of a privacy policy may constitute a legal violation under GDPR, CCPA, and similar regulations, resulting in regulatory fines, user complaints, and reduced user trust.

**Why it matters:** Most jurisdictions require websites that collect user data to publish a privacy policy explaining what data is collected, how it is used, and how users can exercise their rights.

**References:**
- https://gdpr.eu/privacy-notice/
- https://oag.ca.gov/privacy/ccpa
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Create a /privacy-policy page explaining data collection and use
- Link to it from the site footer on every page
- Ensure it covers GDPR, CCPA, and other applicable regulations
- Keep it up to date as your data practices change
- **Footer link** (html):
```html
<footer>
  <a href="/privacy-policy">Privacy Policy</a>
  <a href="/terms-of-service">Terms of Service</a>
</footer>
```

### `terms-of-service-missing` [information-disclosure / low / body-pattern]
**Terms of Service page not found**

No terms of service or terms of use page was detected. Terms of service are recommended for all web services that accept users.

**Risk:** Without published terms of service, the site has no legal basis for enforcing usage restrictions, handling disputes, or limiting liability, exposing the operator to legal risk.

**Why it matters:** Terms of service define the rules for using the service, limit operator liability, and set expectations for both parties. They are especially important for sites that collect user data or offer paid services.

**References:**
- https://www.ftc.gov/business-guidance/blog/2023/05/digital-dark-patterns-are-you-deceiving-your-consumers
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Create a /terms-of-service (or /terms) page
- Link to it from the site footer
- Include acceptable use policy, limitation of liability, and dispute resolution clauses
- Consult a lawyer to ensure compliance with applicable law
- **Footer link** (html):
```html
<footer>
  <a href="/privacy-policy">Privacy Policy</a>
  <a href="/terms-of-service">Terms of Service</a>
</footer>
```

### `sitemap-missing` [information-disclosure / info / body-pattern]
**XML sitemap not found**

No XML sitemap was found at /sitemap.xml or referenced in robots.txt. A sitemap helps search engines index the site correctly.

**Risk:** Without a sitemap, search engines may incompletely index the site, missing important pages or discovering sensitive paths through link crawling rather than controlled disclosure.

**Why it matters:** A sitemap.xml file tells search engines which pages exist and their relative importance. The absence of a sitemap can lead to poor SEO and may cause crawlers to discover sensitive paths through other means.

**References:**
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Create a /sitemap.xml listing all public pages
- Reference it in robots.txt: Sitemap: https://yoursite.com/sitemap.xml
- Submit it to Google Search Console and Bing Webmaster Tools
- Exclude sensitive or authenticated pages from the sitemap
- **Basic sitemap.xml** (xml):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://yoursite.com/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
```

### `html-comment-leaks` [information-disclosure / medium / body-pattern]
**Sensitive information in HTML comments**

HTML comments in the page source contain potentially sensitive information such as developer notes, internal paths, or debug data.

**Risk:** HTML comments are visible to anyone who views the page source. Developer notes in comments can reveal internal architecture, incomplete security fixes, API endpoints, or credentials that were left during development.

**Why it matters:** HTML comments (<!-- ... -->) are stripped by minifiers in production builds but frequently remain in server-rendered or manually edited pages. They are the first place attackers look for reconnaissance information.

**References:**
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/05-Review_Web_Page_Content_for_Information_Leakage
- https://cwe.mitre.org/data/definitions/615.html
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Remove all HTML comments from production templates and views
- Configure your bundler or minifier to strip comments from HTML output
- Audit HTML output for <!-- comments --> before each deployment
- Use version control commit messages for developer notes instead
- **Next.js: disable HTML comments in production** (bash):
```bash
# HTML minifier options in next.config.mjs:
export default {
  experimental: {
    optimizeCss: true, // also strips some comments
  },
};

# Or audit for comments before deploy:
grep -rn "<!--" app/ --include="*.html" --include="*.tsx"
```

### `sql-error-exposure` [information-disclosure / high / body-pattern]
**SQL error message in response**

The response contains an SQL error message, indicating unhandled database exceptions are being returned to clients.

**Risk:** SQL error messages reveal the database type, query structure, table names, and column names, giving an attacker direct feedback for SQL injection probing. This dramatically reduces the effort needed for a successful injection attack.

**Why it matters:** When an SQL query fails and the exception is not caught, many frameworks return the raw error message to the HTTP response. This is the most direct form of SQL injection facilitation.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- https://cwe.mitre.org/data/definitions/209.html
- https://cwe.mitre.org/data/definitions/89.html

**Fix:**
- Wrap all database calls in try/catch blocks
- Return only generic error messages to clients (status 500)
- Log the full SQL error to a server-side logging system with a correlation ID
- Set your framework to production mode to disable detailed error output
- **Safe error handling** (typescript):
```typescript
try {
  const rows = await db.query(sql, params);
  return Response.json(rows);
} catch (err) {
  console.error("[DB Error]", err); // server-side only
  return Response.json({ error: "Database error" }, { status: 500 });
}
```

### `rails-version-exposure` [information-disclosure / low / header]
**Rails version disclosed in response headers**

The HTTP response headers reveal the Ruby on Rails version being used.

**Risk:** Knowing the exact Rails version lets attackers quickly identify applicable CVEs and unpatched vulnerabilities, reducing reconnaissance time and enabling targeted attacks on known Rails security issues.

**Why it matters:** Rails sends X-Powered-By or X-Runtime headers that can expose version information. These should be suppressed in production.

**References:**
- https://guides.rubyonrails.org/security.html#session-storage
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Add config.action_dispatch.default_headers to suppress version headers in production.rb
- Remove X-Powered-By and X-Runtime headers
- Use a reverse proxy to strip all version-identifying headers
- **config/environments/production.rb** (ruby):
```ruby
Rails.application.configure do
  config.action_dispatch.default_headers = {
    "X-Frame-Options" => "SAMEORIGIN",
    "X-XSS-Protection" => "0",
    "X-Content-Type-Options" => "nosniff",
    "X-Permitted-Cross-Domain-Policies" => "none",
    "Referrer-Policy" => "strict-origin-when-cross-origin"
    # No X-Powered-By or version headers
  }
end
```

### `django-csrftoken-cookie-exposed` [information-disclosure / medium / combined]
**Django CSRF token cookie missing security attributes**

The Django csrftoken cookie is present but may be missing Secure or SameSite attributes.

**Risk:** Without the Secure flag, the CSRF token is sent over HTTP connections where it can be intercepted. Without SameSite, it is sent on cross-site navigations, weakening CSRF protection.

**Why it matters:** Django's CSRF protection relies on the csrftoken cookie. If this cookie lacks Secure and SameSite attributes, an attacker can intercept or abuse it.

**References:**
- https://docs.djangoproject.com/en/stable/ref/settings/#csrf-cookie-name
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Set CSRF_COOKIE_SECURE = True in Django settings
- Set CSRF_COOKIE_SAMESITE = "Strict" or "Lax"
- Set SESSION_COOKIE_SECURE = True and SESSION_COOKIE_SAMESITE = "Strict"
- **settings.py: secure CSRF cookie** (python):
```python
# settings.py
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_SAMESITE = "Strict"
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_SAMESITE = "Strict"
```

### `laravel-session-cookie-exposes` [information-disclosure / medium / combined]
**Laravel session cookie missing security attributes**

The Laravel session cookie is present but may lack Secure, HttpOnly, or SameSite attributes.

**Risk:** A Laravel session cookie without HttpOnly can be stolen via XSS. Without Secure, it is sent over HTTP. Without SameSite, it enables CSRF attacks; all three together make session hijacking significantly easier.

**Why it matters:** Laravel session cookies must be configured with all three security attributes: Secure (HTTPS only), HttpOnly (no JS access), and SameSite (CSRF protection).

**References:**
- https://laravel.com/docs/session#configuration
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Set SESSION_SECURE_COOKIE=true in .env
- In config/session.php: "secure" => true, "http_only" => true, "same_site" => "strict"
- **config/session.php** (php):
```php
return [
  "driver" => "file",
  "secure" => true,          // HTTPS only
  "http_only" => true,       // no JS access
  "same_site" => "strict",   // CSRF protection
  "encrypt" => true,
  "lifetime" => 120,
];
```

### `express-cookie-exposes` [information-disclosure / medium / combined]
**Express session cookie missing security attributes**

An Express.js session cookie is set without required security attributes (HttpOnly, Secure, SameSite).

**Risk:** Session cookies without HttpOnly are readable by JavaScript (XSS theft). Without Secure they travel over HTTP (interception). Without SameSite they are sent on cross-site requests (CSRF).

**Why it matters:** Express session cookies should always include HttpOnly, Secure, and SameSite to protect against the three most common session attack vectors.

**References:**
- https://www.npmjs.com/package/express-session#name
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Configure express-session with cookie: { httpOnly: true, secure: true, sameSite: "strict" }
- Ensure NODE_ENV=production so secure: true is enforced
- Use __Host- prefix for the cookie name for additional binding
- **express-session config** (javascript):
```javascript
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));
```

### `express-error-format-disclosure` [information-disclosure / medium / body-pattern]
**Express.js error stack trace in response**

The response contains an Express.js error page with a stack trace, indicating the app is running in development mode or missing a production error handler.

**Risk:** Express development error pages expose full stack traces with file paths, line numbers, and sometimes variable values, giving an attacker a detailed map of the application's internal structure.

**Why it matters:** Express's default error handler prints stack traces when NODE_ENV is not "production". This must be disabled and replaced with a custom error handler before deployment.

**References:**
- https://expressjs.com/en/guide/error-handling.html
- https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- https://cwe.mitre.org/data/definitions/209.html

**Fix:**
- Set NODE_ENV=production in your deployment environment
- Add a custom error handler at the end of your middleware chain
- Return only generic error messages from the error handler
- **Production error handler** (javascript):
```javascript
// Must be the LAST middleware in the chain:
app.use((err, req, res, next) => {
  console.error("[Error]", err); // log server-side
  res.status(err.status || 500).json({
    error: "An unexpected error occurred"
    // Never include: err.message, err.stack
  });
});
```

### `flask-debug-page-exposure` [information-disclosure / critical / body-pattern]
**Flask debug mode enabled in production**

The Flask Werkzeug debugger is accessible, indicating DEBUG=True in a production environment.

**Risk:** The Flask Werkzeug interactive debugger allows arbitrary Python code execution in the browser. Any visitor can run any Python command on your server. This is a complete server compromise.

**Why it matters:** When Flask runs with debug=True, unhandled exceptions show an interactive debugger that executes Python code. This must NEVER be enabled in production.

**References:**
- https://flask.palletsprojects.com/en/stable/debugging/
- https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- https://cwe.mitre.org/data/definitions/94.html

**Fix:**
- Set FLASK_ENV=production and FLASK_DEBUG=0 in your deployment
- Never use app.run(debug=True) in production
- Set a strong debugger PIN if debug mode is needed in staging
- **Disable debug mode** (python):
```python
# NEVER run with debug=True in production
# app.run(debug=True)  # REMOVE THIS

# Correct production startup:
if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=5000)

# Or use gunicorn:
# gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### `django-debug-page-exposure` [information-disclosure / critical / body-pattern]
**Django debug mode enabled in production**

A Django debug error page (yellow screen) is visible, indicating DEBUG=True in the production environment.

**Risk:** Django debug pages expose full Python tracebacks with every local variable at each stack frame, all Django settings (including SECRET_KEY if it appears in a traceback), and installed apps: a critical information disclosure.

**Why it matters:** DEBUG = True must never be used in production. It enables verbose error pages and can expose SECRET_KEY and database credentials via traceback local variables.

**References:**
- https://docs.djangoproject.com/en/stable/ref/settings/#debug
- https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- https://cwe.mitre.org/data/definitions/209.html

**Fix:**
- Set DEBUG = False in production settings
- Set ALLOWED_HOSTS to your actual domain names
- Configure a proper error logging backend (Sentry, logging module)
- **settings/production.py** (python):
```python
DEBUG = False
ALLOWED_HOSTS = ["yoursite.com", "www.yoursite.com"]

LOGGING = {
  "version": 1,
  "handlers": { "file": { "class": "logging.FileHandler", "filename": "/var/log/django.log" } },
  "root": { "handlers": ["file"], "level": "WARNING" },
}
```

### `rails-error-page-disclosure` [information-disclosure / critical / body-pattern]
**Rails exception page accessible in production**

A Rails exception page is visible, exposing stack traces and application internals to the public.

**Risk:** Rails exception pages in production expose Ruby backtraces with file paths, gem versions, and application source snippets, giving attackers a detailed understanding of the application structure and dependencies.

**Why it matters:** In development, Rails shows detailed error pages via BetterErrors or the default exception page. These must never be shown in production.

**References:**
- https://guides.rubyonrails.org/configuring.html#rails-environment-settings
- https://guides.rubyonrails.org/security.html
- https://cwe.mitre.org/data/definitions/209.html

**Fix:**
- Ensure config.consider_all_requests_local = false in production.rb
- Rails automatically uses the public/500.html error page in production mode
- Set RAILS_ENV=production in your deployment environment
- **config/environments/production.rb** (ruby):
```ruby
Rails.application.configure do
  config.consider_all_requests_local = false
  config.action_dispatch.show_exceptions = :sanitized
end
```

### `spring-boot-actuator-exposed` [information-disclosure / high / body-pattern]
**Spring Boot Actuator endpoint publicly accessible**

A Spring Boot Actuator endpoint (/actuator, /health, /env, /metrics, etc.) is publicly accessible.

**Risk:** Exposed Actuator endpoints can reveal environment variables (including secrets), heap dumps, thread dumps, application configuration, database connection strings, and enable remote shutdown, depending on which endpoints are exposed.

**Why it matters:** Spring Boot Actuator provides operational endpoints for monitoring. In production, these must be restricted to internal networks or secured with authentication.

**References:**
- https://docs.spring.io/spring-boot/reference/actuator/endpoints.html
- https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Expose only the health endpoint publicly: management.endpoints.web.exposure.include=health
- Move management server to a separate internal port: management.server.port=8081
- Require authentication for all actuator endpoints
- Disable /env, /heapdump, /threaddump, and /shutdown entirely in production
- **application.yml: restrict actuator** (yaml):
```yaml
management:
  endpoints:
    web:
      exposure:
        include: "health"
  endpoint:
    health:
      show-details: never
  server:
    port: 8081  # internal port only
```

### `jenkins-version-exposure` [information-disclosure / low / header]
**Jenkins version disclosed in response**

The HTTP response reveals the Jenkins CI server version, either via headers or page content.

**Risk:** Knowing the exact Jenkins version allows attackers to search for applicable CVEs and exploit unpatched vulnerabilities. Jenkins has had numerous critical RCE vulnerabilities tied to specific versions.

**Why it matters:** Jenkins includes its version in the X-Jenkins header and sometimes in the HTML response. Both should be suppressed or Jenkins should not be publicly accessible.

**References:**
- https://www.jenkins.io/doc/book/security/securing-jenkins/
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Jenkins should not be publicly accessible: place it behind a VPN or IP allowlist
- If public access is required, use a reverse proxy that strips the X-Jenkins header
- Keep Jenkins updated to the latest LTS release
- **Nginx: strip Jenkins headers** (nginx):
```nginx
proxy_hide_header X-Jenkins;
proxy_hide_header X-Jenkins-Session;
proxy_hide_header X-Hudson;
```

### `grafana-version-exposure` [information-disclosure / low / header]
**Grafana version disclosed in response**

The Grafana dashboard version is exposed in HTTP headers or page content.

**Risk:** Known Grafana versions can be matched against CVEs. Grafana has had critical vulnerabilities including unauthenticated directory traversal (CVE-2021-43798) in specific versions.

**Why it matters:** Grafana includes version information in headers (X-Grafana-Org-ID, responses) and login page HTML. Version disclosure combined with internet exposure is a significant risk.

**References:**
- https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/
- https://nvd.nist.gov/vuln/detail/CVE-2021-43798
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Place Grafana behind a VPN or require authentication at the network level
- Use a reverse proxy to strip version-identifying headers
- Keep Grafana updated to the latest stable version
- **Nginx reverse proxy for Grafana** (nginx):
```nginx
location /grafana/ {
  proxy_pass http://localhost:3000/;
  proxy_hide_header X-Grafana-Org-ID;
  proxy_set_header Host $http_host;
  # Add authentication:
  auth_basic "Restricted";
  auth_basic_user_file /etc/nginx/.htpasswd;
}
```

### `nextjs-app-router-rsc-headers` [information-disclosure / info / header]
**Next.js App Router RSC headers exposed**

React Server Component (RSC) response headers from Next.js App Router are present, confirming the application is built with Next.js.

**Risk:** Identifying the framework as Next.js App Router enables targeted reconnaissance. Attackers can focus on Next.js-specific vulnerabilities, known misconfigurations (e.g., server action exposure, ISR cache poisoning), and common patterns.

**Why it matters:** Next.js sets RSC-specific headers like x-nextjs-cache and vary: RSC. While these serve a legitimate performance purpose, they also fingerprint the framework.

**References:**
- https://nextjs.org/docs/app/building-your-application/rendering/server-components
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- This is low-risk: focus on Next.js-specific security hardening rather than hiding the framework
- Ensure poweredByHeader: false in next.config.mjs
- Review server actions for proper authentication
- Enable HSTS and CSP headers
- **next.config.mjs: remove version signals** (javascript):
```javascript
export default {
  poweredByHeader: false,
  headers: async () => [
    { source: "/(.*)", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ]}
  ]
};
```

### `sveltekit-detection` [information-disclosure / info / body-pattern]
**SvelteKit application detected**

The page contains SvelteKit-specific markers, identifying the framework being used.

**Risk:** Framework fingerprinting helps attackers focus on SvelteKit-specific vulnerabilities and common misconfigurations rather than probing broadly.

**Why it matters:** SvelteKit includes framework-specific markers in the HTML output. While this is by design, it enables targeted reconnaissance.

**References:**
- https://kit.svelte.dev/docs/routing#server
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Focus on SvelteKit security hardening: set security headers in hooks.server.ts
- Validate all +server.ts endpoints have proper authentication
- Use SvelteKit's built-in CSRF protection (enabled by default in v1.0+)
- **src/hooks.server.ts: security headers** (typescript):
```typescript
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
};
```

### `vite-client-exposed` [information-disclosure / high / body-pattern]
**Vite development client endpoint accessible**

The Vite development server HMR (Hot Module Replacement) client is accessible, indicating a development server is running in a production or staging environment.

**Risk:** The Vite dev server is not designed for production use: it lacks security hardening, serves source maps and raw source files, and the HMR WebSocket endpoint accepts arbitrary module hot-replacement payloads. This can enable source code disclosure and code injection.

**Why it matters:** Vite's development server serves un-bundled source files and exposes HMR endpoints. It should never be deployed to environments accessible from the internet.

**References:**
- https://vitejs.dev/guide/cli.html#vite-build
- https://vitejs.dev/guide/env-and-mode.html
- https://cwe.mitre.org/data/definitions/200.html

**Fix:**
- Build the production bundle: npm run build
- Serve the dist/ directory with a proper web server (nginx, Vercel, Netlify)
- Never use vite dev or vite preview in production
- Ensure CI/CD deploys the build output, not the dev server
- **Production build and serve** (bash):
```bash
# Build production bundle
npm run build

# Serve with a static server:
npx serve dist -l 3000
# Or Nginx pointing to dist/
# Never: vite dev in production
```

### `rust-panic-trace-exposed` [information-disclosure / medium / body-pattern]
**Rust Panic Trace Exposed**

A Rust panic message ('thread ... panicked at ...') with a source file reference was found in the response body.

**Risk:** The panic message discloses internal source file paths and the exact condition that failed, helping an attacker map the application's internals and craft further probes.

**Why it matters:** An unhandled Rust panic that reaches the HTTP response means the panic handler (or a catch_unwind boundary) isn't converting the failure into a generic error response before it leaves the process.

**References:**
- https://doc.rust-lang.org/std/panic/fn.catch_unwind.html

**Fix:**
- Wrap request handlers in std::panic::catch_unwind (or use a framework's built-in panic-to-500 middleware) so panics never reach the client.
- Log the full panic server-side and return a generic error to the client.
- Fix the underlying condition that triggers the panic.
- **Catch panics at the request boundary (Actix Web)** (rust):
```rust
use actix_web::middleware::ErrorHandlers;
// Wrap handlers with catch_unwind or a panic-handling middleware
// so a panic becomes a 500 response instead of leaking to the client.
```

### `golang-panic-trace-exposed` [information-disclosure / medium / body-pattern]
**Go Panic / Goroutine Trace Exposed**

A Go panic message with a goroutine stack trace ('goroutine N [running]' plus .go file references) was found in the response body.

**Risk:** The trace discloses internal package/file paths and the full call stack leading to the crash, which helps an attacker understand the application's internal structure.

**Why it matters:** Go's default behavior on an unrecovered panic in an HTTP handler is to crash the goroutine and, depending on the server setup, can leak the panic output into the response or logs mixed with the response stream.

**References:**
- https://pkg.go.dev/builtin#recover

**Fix:**
- Add a recover() call in HTTP middleware wrapping every handler so a panic becomes a generic 500 response.
- Log the full panic and stack trace server-side only.
- Fix the underlying nil pointer / index-out-of-range / type-assertion condition causing the panic.
- **Recover middleware** (go):
```go
func RecoverMiddleware(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    defer func() {
      if err := recover(); err != nil {
        log.Printf("panic: %v", err)
        http.Error(w, "Internal Server Error", http.StatusInternalServerError)
      }
    }()
    next.ServeHTTP(w, r)
  })
}
```

### `ruby-backtrace-exposed` [information-disclosure / medium / body-pattern]
**Ruby Exception Backtrace Exposed**

A Ruby exception backtrace (two or more '<file>.rb:LINE:in `method'' frames) was found in the response body.

**Risk:** The backtrace discloses application file paths, method names, and gem versions in use, narrowing down the framework/library fingerprint for an attacker.

**Why it matters:** Plain Ruby scripts and lightweight frameworks (Sinatra, Rack apps) that don't run in a Rails-style production error-handling mode will render the raw exception and backtrace directly into the response when an unhandled exception occurs.

**References:**
- https://sinatrarb.com/configuration.html

**Fix:**
- Wrap the request-handling code in a rescue block that logs the backtrace and returns a generic error response.
- For Sinatra, disable :raise_errors and :show_exceptions in production ('set :environment, :production').
- Run the app with RACK_ENV=production so framework-level error pages are generic.
- **Sinatra production settings** (ruby):
```ruby
configure :production do
  set :raise_errors, false
  set :show_exceptions, false
end
```

### `dotnet-core-developer-exception-page` [information-disclosure / high / body-pattern]
**ASP.NET Core Developer Exception Page Exposed**

The ASP.NET Core Developer Exception Page ('An unhandled exception occurred while processing the request' with Microsoft.AspNetCore references) was found in the response.

**Risk:** This page renders the full exception, stack trace, request headers, cookies, query string, and route data, which is a significant amount of internal and potentially sensitive detail handed directly to any client that triggers an error.

**Why it matters:** UseDeveloperExceptionPage() is meant to be conditionally registered only when the ASP.NET Core hosting environment is Development. Registering it unconditionally (or misconfiguring ASPNETCORE_ENVIRONMENT) exposes this diagnostic page in production.

**References:**
- https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling

**Fix:**
- Only call app.UseDeveloperExceptionPage() inside an 'if (env.IsDevelopment())' branch.
- Use app.UseExceptionHandler("/Error") for all non-development environments.
- Verify ASPNETCORE_ENVIRONMENT is set to 'Production' in the deployed environment.
- **Program.cs / Startup.cs** (csharp):
```csharp
if (env.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}
else
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}
```

### `phoenix-debug-error-exposed` [information-disclosure / medium / body-pattern]
**Phoenix (Elixir) Debug Error Page Exposed**

A Phoenix framework debug error page, identifiable by an Elixir error marker alongside a '_web/controllers' or '_web/router.ex' module path, was found in the response.

**Risk:** The page discloses application module names, file paths, and the request pipeline's internal state at the point of failure.

**Why it matters:** Phoenix's debug error pages (enabled via 'debug_errors: true' in config/dev.exs) render detailed diagnostic information. This configuration should never be active for a production release.

**References:**
- https://hexdocs.pm/phoenix/errors.html

**Fix:**
- Ensure config/prod.exs sets debug_errors: false (the Phoenix generator default).
- Confirm MIX_ENV=prod is set for the deployed release.
- Add a generic error view for production so unhandled exceptions render a plain error page.
- **config/prod.exs** (elixir):
```elixir
config :my_app, MyAppWeb.Endpoint,
  debug_errors: false,
  code_reloader: false,
  check_origin: true
```

### `nodejs-unhandled-rejection-exposed` [information-disclosure / medium / body-pattern]
**Node.js UnhandledPromiseRejectionWarning Leaked to Response**

The literal text 'UnhandledPromiseRejectionWarning' was found in the response body, indicating Node.js process console output is leaking into HTTP responses.

**Risk:** This typically means console/stderr output is being mixed into the response stream (e.g. via a misconfigured process manager or a crashed dev server proxy), which can carry stack traces and internal object dumps alongside it.

**Why it matters:** UnhandledPromiseRejectionWarning is printed by Node.js to the process's stderr when a Promise rejection is never handled. It has no legitimate reason to appear inside an HTTP response body; its presence usually indicates output redirection gone wrong or a crash-and-restart loop.

**References:**
- https://nodejs.org/api/process.html#event-unhandledrejection

**Fix:**
- Add a global 'unhandledRejection' handler that logs to your normal logging pipeline, not stdout/stderr piped into the response.
- Audit every Promise-returning call in request handlers for a missing .catch() or try/catch around await.
- Verify the process manager isn't proxying raw console output into HTTP responses.
- **Global unhandledRejection handler** (javascript):
```javascript
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});
```

### `perl-cgi-error-exposed` [information-disclosure / medium / body-pattern]
**Perl CGI Software Error Page Exposed**

A classic Perl CGI 'Software error:' page with a script path and line number was found in the response.

**Risk:** The error page discloses the full server-side script path and the exact line that failed, useful reconnaissance for an attacker targeting a legacy CGI application.

**Why it matters:** CGI.pm and similar legacy Perl CGI libraries print 'Software error:' followed by the die() message and 'at <script>.pl line N' directly into the HTTP response by default when an uncaught error occurs.

**References:**
- https://perldoc.perl.org/CGI::Carp

**Fix:**
- Wrap the script body in an eval block and return a generic error page on failure.
- Use CGI::Carp's fatalsToBrowser only in development, never in production.
- Log the real error server-side instead of rendering it to the client.
- **Generic error handling in Perl CGI** (perl):
```perl
eval {
    # request handling logic
};
if ($@) {
    warn "Internal error: $@";
    print "Status: 500 Internal Server Error\r\n\r\n";
    print "An unexpected error occurred.";
}
```

---

## Category: reputation (3 checks)

### `url-flagged-malware` [reputation / critical / url-check]
**URL Flagged as Malware Distribution**

Google Web Risk lists this exact URL as a known source of malware. Browsers and security tools that check against Web Risk or Google Safe Browsing will warn visitors or block the page outright.

**Risk:** Visitors on Chrome, Firefox, Safari, and most enterprise web filters will see a full-page red warning before this page loads, or the request will be blocked entirely. Search engines may also delist or badge the domain as unsafe.

**Why it matters:** Web Risk aggregates threat data from Google's own crawling and third-party feeds. A URL only appears here after independent evidence it served or was used to distribute malware, not from this scan's own probing.

**References:**
- https://cloud.google.com/web-risk/docs
- https://safebrowsing.google.com/safebrowsing/report_general/

**Fix:**
- If this is a false positive or the compromise has been cleaned up, request a review through Google Search Console (Security Issues report) or https://safebrowsing.google.com/safebrowsing/report_general/.
- If the site was compromised, audit for injected scripts, unauthorized file uploads, or a vulnerable plugin/CMS version, then rotate all credentials.
- Re-scan after remediation: Web Risk listings clear once Google's own re-crawl confirms the page is clean, which can take hours to a few days.
- **Re-check current status directly against Web Risk** (bash):
```bash
curl -s "https://webrisk.googleapis.com/v1/uris:search?key=$WEB_RISK_API_KEY&threatTypes=MALWARE&uri=https%3A%2F%2Fyourdomain.com%2Fpath" | jq .
```

### `url-flagged-social-engineering` [reputation / critical / url-check]
**URL Flagged as Phishing / Social Engineering**

Google Web Risk lists this exact URL as a known phishing or social-engineering page: one designed to trick visitors into handing over credentials, payment details, or other sensitive information.

**Risk:** Visitors on most major browsers will see a full-page phishing warning before this page loads. If this is your own legitimate site, this listing actively drives away real users and damages trust in the domain.

**Why it matters:** This listing means Google (or a threat-intel feed it aggregates) has independent evidence this URL impersonates a login, payment, or other trusted flow to collect sensitive input.

**References:**
- https://cloud.google.com/web-risk/docs
- https://safebrowsing.google.com/safebrowsing/report_general/

**Fix:**
- If this is a false positive, request a review through Google Search Console (Security Issues report) or https://safebrowsing.google.com/safebrowsing/report_general/.
- If the page was compromised or spoofed without your knowledge, take it down or fix it immediately, then request review.
- Check whether an old, retired login/checkout page under this exact path is still reachable and was cloned or hijacked.
- **Re-check current status directly against Web Risk** (bash):
```bash
curl -s "https://webrisk.googleapis.com/v1/uris:search?key=$WEB_RISK_API_KEY&threatTypes=SOCIAL_ENGINEERING&uri=https%3A%2F%2Fyourdomain.com%2Fpath" | jq .
```

### `url-flagged-unwanted-software` [reputation / high / url-check]
**URL Flagged as Unwanted Software Distribution**

Google Web Risk lists this exact URL as a source of unwanted software: downloads that behave deceptively, are hard to remove, or bundle unrelated software without clear disclosure.

**Risk:** Browsers may block downloads initiated from this page or warn visitors before they proceed, reducing legitimate conversion and signaling a compromised or poorly vetted download pipeline.

**Why it matters:** This category covers software that does not clearly disclose its behavior, changes browser/system settings without consent, or bundles additional unwanted programs, per Google's Unwanted Software Policy.

**References:**
- https://cloud.google.com/web-risk/docs
- https://www.google.com/about/unwanted-software-policy.html

**Fix:**
- Review any downloadable installers or bundled software served from this URL against Google's Unwanted Software Policy.
- If this is a false positive, request a review through Google Search Console or https://safebrowsing.google.com/safebrowsing/report_general/.
- If a third-party ad network or affiliate script is injecting the flagged download, audit and remove it.
- **Re-check current status directly against Web Risk** (bash):
```bash
curl -s "https://webrisk.googleapis.com/v1/uris:search?key=$WEB_RISK_API_KEY&threatTypes=UNWANTED_SOFTWARE&uri=https%3A%2F%2Fyourdomain.com%2Fpath" | jq .
```

---

## Category: secrets-extended (51 checks)

### `secret-stripe-webhook-endpoint` [secrets-extended / critical / body-pattern]
**Stripe webhook signing secret in client bundle**

Stripe whsec_* values must live server-side. If they show up in client code, attackers can forge webhook events.

**Risk:** An attacker with the webhook signing secret can forge any Stripe event: payments.succeeded, invoice.paid, subscription.deleted, causing your server to credit fraudulent orders, cancel real subscriptions, or trigger payouts without any actual transaction.

**References:**
- https://stripe.com/docs/webhooks/signatures
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Move the webhook secret to an environment variable (STRIPE_WEBHOOK_SECRET)
- Verify webhooks server-side only using stripe.webhooks.constructEvent()
- Rotate the secret in the Stripe Dashboard under Webhooks
- **Next.js Route Handler: server-side webhook verification** (typescript):
```typescript
import Stripe from 'stripe';
import { NextResponse } from 'next/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const body = await req.text();
  const sig  = req.headers.get('stripe-signature')!;

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!  // Server-side only
    );
    // Handle event.type here
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  return NextResponse.json({ received: true });
}
```
- **.env.local: secret storage** (bash):
```bash
# .env.local (never commit this file)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# .gitignore
.env
.env.local
.env*.local
```

### `secret-google-maps-api-key` [secrets-extended / medium / body-pattern]
**Google Maps API key in source**

Google Maps API keys (AIzaSy*) in client code can be abused to bill against your account.

**Risk:** An unrestricted Google Maps API key found in client code lets anyone generate maps requests billed to your account, potentially resulting in thousands of dollars in unexpected charges before the key is noticed and revoked.

**References:**
- https://developers.google.com/maps/api-security-best-practices
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Restrict the key by HTTP referrer to your domain(s) in Google Cloud Console
- Set an API quota limit to cap maximum daily spend
- Rotate the key if it has been exposed without referrer restrictions
- **Google Cloud: restrict API key by referrer (gcloud CLI)** (bash):
```bash
# Restrict the Maps API key to your domains only
gcloud services api-keys update YOUR_KEY_ID \
  --api-target=service=maps-backend.googleapis.com \
  --browser-key-allowed-referrers='https://yourdomain.com/*,https://www.yourdomain.com/*'
```
- **Server-side proxy for Maps (recommended for high-traffic)** (typescript):
```typescript
// Proxy Maps requests through your API so the key never reaches the browser
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get('address');

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=<value>&key=<value>`
  );
  return Response.json(await res.json());
}
```

### `secret-google-oauth-client-secret` [secrets-extended / critical / body-pattern]
**Google OAuth client_secret in source**

Google client_secret values must never appear in client-side code.

**Risk:** An exposed OAuth client_secret lets an attacker impersonate your application in the OAuth flow, exchange authorization codes for access tokens, and access Google APIs (Drive, Gmail, Calendar) on behalf of any user who has authorized your app.

**References:**
- https://developers.google.com/identity/protocols/oauth2
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Move client_secret to a server-only environment variable
- Use the OAuth Authorization Code flow with PKCE for browser clients (no client_secret needed)
- Rotate the secret immediately in Google Cloud Console if it has been exposed
- **Server-only OAuth: store secret as env var** (typescript):
```typescript
// Server-only: never import this in client components
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,  // server-only env var
  process.env.GOOGLE_REDIRECT_URI
);
```
- **Public client: use PKCE, no client_secret** (typescript):
```typescript
// For browser-based apps, use PKCE flow (no client_secret)
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('code_challenge_method', 'S256');
authUrl.searchParams.set('code_challenge', codeChallenge);  // PKCE
```

### `secret-firebase-api-key-public` [secrets-extended / low / body-pattern]
**Firebase API key (public) in source**

Firebase Web API keys (AIzaSy*) are public by design. Security depends on Firestore rules / App Check.

**Risk:** Firebase Web API keys are intentionally public. Their presence alone is not a vulnerability. The risk is that weak Firestore or RTDB security rules combined with the exposed key allow unauthenticated read or write access to your entire database.

**References:**
- https://firebase.google.com/docs/app-check
- https://firebase.google.com/docs/rules

**Fix:**
- Enable Firebase App Check to block unauthorized clients
- Review Firestore and RTDB security rules to ensure no data is readable without authentication
- Restrict the API key to specific Firebase services in Google Cloud Console
- **Firestore rules: require authentication** (javascript):
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Default deny
    match /{document=**} {
      allow read, write: if false;
    }

    // Users can only read/write their own documents
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
- **Firebase App Check: enforce in production** (javascript):
```javascript
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const app = initializeApp(firebaseConfig);

// Enable App Check to block unauthorized clients
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY!),
  isTokenAutoRefreshEnabled: true,
});
```

### `secret-aws-secret-key` [secrets-extended / critical / body-pattern]
**AWS Secret Access Key in source**

AWS secret access keys (40-char base64) must never be in client code or public buckets.

**Risk:** An exposed AWS Secret Access Key paired with an Access Key ID gives attackers full programmatic access to your AWS account at the permissions level of that IAM user: this can mean reading S3 buckets, spinning up EC2 instances, creating new IAM users, or incurring six-figure compute bills before you notice.

**References:**
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate the key in IAM immediately (deactivate old key, create new key)
- Check CloudTrail for API calls made with the compromised key
- Use IAM Roles and short-lived STS credentials instead of long-lived access keys
- **Rotate compromised AWS credentials** (bash):
```bash
# 1. Create a new key
aws iam create-access-key --user-name YOUR_USER

# 2. Update your environment/secrets manager with the new key

# 3. Deactivate the old key
aws iam update-access-key --access-key-id AKIA... --status Inactive --user-name YOUR_USER

# 4. Check CloudTrail for unauthorized usage
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=AccessKeyId,AttributeValue=AKIA...
```
- **Use IAM Role (recommended, no long-lived keys)** (typescript):
```typescript
// On EC2/Lambda/ECS, use the instance/task role: no keys needed
import { S3Client } from '@aws-sdk/client-s3';

// SDK automatically picks up the IAM role from the environment
const s3 = new S3Client({ region: 'us-east-1' });
// No accessKeyId or secretAccessKey: uses the attached role
```

### `secret-github-pat` [secrets-extended / critical / body-pattern]
**GitHub PAT in source**

ghp_* / gho_* / ghu_* / ghs_* / ghr_* tokens grant repo / user access.

**Risk:** A leaked GitHub PAT gives an attacker access to every repository and organization the token owner can reach, including private repos, source code, CI/CD secrets, and deployment keys. Fine-grained tokens are scoped, but classic PATs are often overprivileged.

**References:**
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the token immediately via GitHub Settings → Developer Settings → Personal Access Tokens
- Audit the token's usage in the GitHub security log before revoking
- Switch to fine-grained tokens with the minimum required scopes and expiry dates
- **Revoke and audit the compromised token** (bash):
```bash
# Check recent usage for the token (replace TOKEN with the actual token)
curl -H 'Authorization: token TOKEN' https://api.github.com/user

# List recent events that may have used the token
curl -H 'Authorization: token TOKEN' https://api.github.com/users/OWNER/events

# Then revoke immediately at:
# https://github.com/settings/tokens
```
- **Use GitHub Actions secrets instead of hard-coded tokens** (yaml):
```yaml
# .github/workflows/deploy.yml
jobs:
  deploy:
    steps:
      - uses: actions/checkout@v4
        with:
          # Use the automatically-provided GITHUB_TOKEN
          token: <value>}
      # Never hard-code a PAT in workflow files
      # If you need a PAT, store it in GitHub Actions Secrets:
      - run: gh release create v1.0.0
        env:
          GH_TOKEN: <value>}
```

### `secret-npm-token` [secrets-extended / critical / body-pattern]
**NPM auth token in source**

npm_ tokens allow publishing packages as you. Should never be in client code or public repos.

**Risk:** An exposed npm token allows an attacker to publish malicious versions of any package you maintain, a supply-chain attack that can inject backdoors into every application that installs your package, potentially affecting millions of downstream users.

**References:**
- https://docs.npmjs.com/creating-and-viewing-access-tokens
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the token immediately: npm token revoke TOKEN_ID (find ID with: npm token list)
- Audit recent package publishes for unauthorized versions
- Create a new granular automation token scoped only to the packages that need it
- **Revoke and rotate npm token** (bash):
```bash
# List all tokens to find the compromised one
npm token list

# Revoke the compromised token (use the ID from the list)
npm token revoke <token-id>

# Create a new granular token with minimal permissions
npm token create --read-only          # for CI that only installs
npm token create --cidr=10.0.0.0/8   # restrict to internal IPs
```
- **GitHub Actions: use NPM_TOKEN secret** (yaml):
```yaml
jobs:
  publish:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm publish
        env:
          # Never hard-code the token: store it as a GitHub Actions secret
          NODE_AUTH_TOKEN: <value>}
```

### `secret-pypi-token` [secrets-extended / critical / body-pattern]
**PyPI token in source**

pypi-AgEIcHlwaS... tokens allow uploading packages.

**Risk:** An exposed PyPI token allows an attacker to upload a malicious version of any Python package associated with the token, injecting arbitrary code into the install process for every user that runs pip install on that package.

**References:**
- https://pypi.org/help/#apitoken
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the token immediately via PyPI account settings → API tokens
- Audit recent package uploads for your account
- Create a new token scoped to specific projects (not the whole account)
- **GitHub Actions: use PyPI Trusted Publisher (no token needed)** (yaml):
```yaml
# Use OIDC-based Trusted Publishers instead of tokens
jobs:
  publish:
    permissions:
      id-token: write  # Required for OIDC
    steps:
      - uses: actions/checkout@v4
      - run: python -m build
      - uses: pypa/gh-action-pypi-publish@release/v1
        # No password/token needed: OIDC handles auth
```
- **.pypirc: never commit this file** (ini):
```ini
# ~/.pypirc (user-level, never commit to source control)
[pypi]
username = __token__
password = pypi-AgEIcHlwaS...

# Add to .gitignore:
# .pypirc
```

### `secret-cloudflare-api-key` [secrets-extended / high / body-pattern]
**Cloudflare API key in source**

Cloudflare API tokens look like 40-char hex strings and grant DNS / WAF / Workers access.

**Risk:** An exposed Cloudflare API token can be used to modify DNS records (pointing your domain to attacker infrastructure), disable WAF rules (exposing your origin), purge cache, or exfiltrate Workers secrets, impacting availability and security for all users of your domain.

**References:**
- https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the token in Cloudflare Dashboard → My Profile → API Tokens
- Create a new token with the minimum required zone and permission scopes
- Restrict the new token by IP allowlist and set an expiry date
- **Cloudflare: create scoped token via API** (bash):
```bash
# Verify a token's permissions before use
curl -X GET 'https://api.cloudflare.com/client/v4/user/tokens/verify' \
  -H 'Authorization: Bearer YOUR_TOKEN'

# List all tokens to find the compromised one
curl -X GET 'https://api.cloudflare.com/client/v4/user/tokens' \
  -H 'Authorization: Bearer YOUR_TOKEN'

# Revoke it
curl -X DELETE 'https://api.cloudflare.com/client/v4/user/tokens/TOKEN_ID' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```
- **Use environment variable (never hard-code)** (bash):
```bash
# .env (never commit)
CLOUDFLARE_API_TOKEN=your_scoped_token_here

# Read in code:
import { Cloudflare } from 'cloudflare';
const client = new Cloudflare({ apiToken: process.env.CLOUDFLARE_API_TOKEN });
```

### `secret-tailscale-key` [secrets-extended / high / body-pattern]
**Tailscale auth key in source**

tskey-* values allow joining your tailnet. Rotate immediately if exposed.

**Risk:** An exposed Tailscale auth key allows an attacker to join your private tailnet, giving them full network-level access to every machine in your VPN, including databases, internal services, and admin panels that are not otherwise internet-accessible.

**References:**
- https://tailscale.com/kb/1085/auth-keys
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the key immediately in the Tailscale admin console under Settings → Keys
- Check for any unauthorized devices added to your tailnet
- Use ephemeral keys with short TTLs for automated systems; store them in a secrets manager
- **Revoke Tailscale key via API** (bash):
```bash
# List auth keys to find the compromised one
curl -H 'Authorization: Bearer TAILSCALE_API_KEY' \
  'https://api.tailscale.com/api/v2/tailnet/YOUR_TAILNET/keys'

# Delete the compromised key (replace KEY_ID)
curl -X DELETE \
  -H 'Authorization: Bearer TAILSCALE_API_KEY' \
  'https://api.tailscale.com/api/v2/tailnet/YOUR_TAILNET/keys/KEY_ID'
```
- **Store auth key as a secret (never in source)** (bash):
```bash
# Store in environment / secrets manager
export TS_AUTHKEY="tskey-auth-..."

# Use in Docker or systemd, not in code:
docker run -e TS_AUTHKEY="$TS_AUTHKEY" tailscale/tailscale
```

### `secret-algolia-admin-key` [secrets-extended / critical / body-pattern]
**Algolia admin API key in source**

Algolia admin keys (long base64 strings) grant full search-index control.

**Risk:** An exposed Algolia admin key grants full control over all search indices: creating, deleting, and overwriting index data, creating new API keys, and accessing all records in every index. An attacker can corrupt search results site-wide or exfiltrate all indexed content.

**References:**
- https://www.algolia.com/doc/guides/security/api-keys/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Never expose the admin key to client code; use the search-only API key in browsers
- Rotate the admin key in Algolia Dashboard → Settings → API Keys
- Use Algolia's virtual API keys with per-user restrictions for authenticated search
- **Correct: search-only key in client, admin key server-side** (typescript):
```typescript
// Client component: use the search-only key
import algoliasearch from 'algoliasearch';

const client = algoliasearch(
  process.env.NEXT_PUBLIC_ALGOLIA_APP_ID!,
  process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY!  // search-only, safe in browser
);

// Server-only: use the admin key for indexing
// import { algoliasearch } from 'algoliasearch';
// const adminClient = algoliasearch(appId, process.env.ALGOLIA_ADMIN_KEY!);
```

### `secret-mapbox-secret-token` [secrets-extended / high / body-pattern]
**Mapbox secret token in source**

sk.* Mapbox tokens grant upload / dataset access. Use pk.* for client.

**Risk:** An exposed Mapbox sk.* (secret) token grants write access to your datasets, styles, and tilesets: an attacker can modify or delete your map data, upload malicious content, and incur charges on your account. Public tokens (pk.*) are fine in browsers; secret tokens must stay server-side.

**References:**
- https://docs.mapbox.com/api/accounts/tokens/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the sk.* token in Mapbox Account → Tokens
- Use pk.* (public) tokens in client-side code
- Restrict the pk.* token by URL to prevent abuse by other sites
- **Correct token usage: public token in browser** (typescript):
```typescript
// Browser: use the public token (pk.*), restricted by URL
import mapboxgl from 'mapbox-gl';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;  // pk.* token

// Server-only operations (uploads, dataset edits): use sk.* from env
// const secretToken = process.env.MAPBOX_SECRET_TOKEN;  // never NEXT_PUBLIC_*
```

### `secret-pagerduty-key` [secrets-extended / high / body-pattern]
**PagerDuty REST API key in source**

PD keys grant incident / on-call rotation control.

**Risk:** An exposed PagerDuty API key lets an attacker silence real incidents, reassign on-call rotations, acknowledge alerts automatically, and query your team structure, potentially hiding a real security breach by suppressing the alerts that would trigger a response.

**References:**
- https://developer.pagerduty.com/api-reference/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate the key in PagerDuty → User Settings → API Access Keys
- Use app-level API keys with minimum required scopes
- Restrict key usage to server-side webhook handlers only
- **Store PagerDuty key as environment variable** (typescript):
```typescript
// Server-side incident creation (never in client code)
async function createIncident(title: string) {
  const res = await fetch('https://api.pagerduty.com/incidents', {
    method: 'POST',
    headers: {
      Authorization: `Token token=<value>`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      incident: { type: 'incident', title, service: { id: 'PXXXXXX', type: 'service_reference' } },
    }),
  });
  return res.json();
}
```

### `secret-twilio-account-sid` [secrets-extended / low / body-pattern]
**Twilio Account SID in source**

Twilio Account SIDs (AC*) are not strictly secret but should not be public.

**Risk:** Twilio Account SIDs are semi-public and require a paired auth token to perform any sensitive operations. However, knowing your Account SID combined with other leaked credentials enables account takeover. The SID alone leaks your Twilio account association.

**References:**
- https://www.twilio.com/docs/iam/credentials
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Move the SID to a server-side environment variable as a precaution
- Ensure the paired Twilio auth token is never exposed client-side
- If the auth token is also exposed, rotate it immediately in the Twilio console
- **Store Twilio credentials server-side only** (typescript):
```typescript
// Server-side only: never import in client components
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,   // AC...: server-only
  process.env.TWILIO_AUTH_TOKEN     // never expose this
);
```

### `secret-datadog-api-key` [secrets-extended / high / body-pattern]
**Datadog API key in source**

Datadog API keys grant metric ingestion. Restrict by hostname tag.

**Risk:** An exposed Datadog API key allows an attacker to flood your dashboards with fake metrics and events, masking real performance issues or triggering false alert storms, and potentially silencing real incident alerts during an attack.

**References:**
- https://docs.datadoghq.com/account_management/api-app-keys/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate the key in Datadog → Organization Settings → API Keys
- Restrict the key by host tag and scope to minimum required permissions
- Use the client token (pub_*) for browser RUM, not the API key
- **Server-side metric submission only** (typescript):
```typescript
// Only submit metrics server-side: never expose the API key to browsers
import { v1 } from '@datadog/datadog-api-client';

const configuration = v1.createConfiguration({
  authMethods: {
    apiKeyAuth: process.env.DD_API_KEY!,  // server-only
  },
});

const metricsApi = new v1.MetricsApi(configuration);
```

### `secret-huggingface-write-token` [secrets-extended / high / body-pattern]
**HuggingFace write token in source**

hf_* tokens grant model / dataset upload access.

**Risk:** An exposed HuggingFace write token lets an attacker upload malicious model weights or datasets under your account identity, a supply-chain attack that affects anyone who downloads and runs those models, potentially including your own users.

**References:**
- https://huggingface.co/docs/hub/security-tokens
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the token at huggingface.co/settings/tokens
- Create a read-only token for inference use in client/server code
- Use a write token only in CI pipelines via secrets manager
- **Use read-only token for inference** (python):
```python
from huggingface_hub import InferenceClient
import os

# Use a read-only token for inference: never a write token
client = InferenceClient(
    model="mistralai/Mistral-7B-Instruct-v0.1",
    token=os.environ['HF_READ_TOKEN'],  # read-only token from env
)
```

### `secret-pinecone-api-key` [secrets-extended / high / body-pattern]
**Pinecone API key in source**

Pinecone keys grant vector-DB control.

**Risk:** An exposed Pinecone API key grants full control over your vector database: an attacker can delete all vectors (destroying your semantic search), upsert poisoned embeddings, query all indexed data, or create new indexes at your expense.

**References:**
- https://docs.pinecone.io/guides/operations/security
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate the key in the Pinecone console under API Keys
- Keep Pinecone API calls server-side only; never expose the key in browser bundles
- Use environment-scoped keys when available
- **Server-only Pinecone client** (typescript):
```typescript
// Only call Pinecone from server-side API routes: never from client components
import { Pinecone } from '@pinecone-database/pinecone';

const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,  // server-only env var
});
```

### `secret-supabase-service-role` [secrets-extended / critical / body-pattern]
**Supabase service_role JWT in source**

The service_role JWT bypasses Row Level Security. Should NEVER be in client code.

**Risk:** The Supabase service_role key bypasses all Row Level Security (RLS) policies, giving anyone who has it unrestricted read and write access to every row in every table in your database, equivalent to handing over your database root password.

**References:**
- https://supabase.com/docs/guides/api/api-keys
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Immediately remove the service_role key from any client-accessible code
- Use the anon key + RLS policies in client code
- If exposed, rotate the service_role key in Supabase Dashboard → Settings → API
- **Correct: anon key in client, service_role server-only** (typescript):
```typescript
// Client component: use the anon key with RLS
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!  // public, safe with RLS
);

// Server-only admin client (API routes, server actions only)
// import { createClient } from '@supabase/supabase-js';
// const adminClient = createClient(
//   process.env.NEXT_PUBLIC_SUPABASE_URL!,
//   process.env.SUPABASE_SERVICE_ROLE_KEY!  // NEVER NEXT_PUBLIC_*
// );
```

### `secret-supabase-anon-key` [secrets-extended / info / body-pattern]
**Supabase anon key in source**

Supabase anon keys are public by design. Security depends on RLS policies.

**Risk:** Supabase anon keys are intentionally public. Their presence alone is not a vulnerability. The risk is that missing or overly permissive Row Level Security (RLS) policies combined with the key allow unauthenticated users to read or write data they should not access.

**References:**
- https://supabase.com/docs/guides/auth/row-level-security
- https://supabase.com/docs/guides/api/api-keys

**Fix:**
- Enable RLS on every table: ALTER TABLE your_table ENABLE ROW LEVEL SECURITY
- Add explicit policies for each role (anon, authenticated)
- Test RLS with the Supabase Policy Simulator before deploying
- **Enable RLS and create policies** (sql):
```sql
-- Enable RLS on the table
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can read
CREATE POLICY "Authenticated users can read posts"
  ON posts FOR SELECT
  TO authenticated
  USING (true);

-- Users can only update their own posts
CREATE POLICY "Users can update own posts"
  ON posts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- No anonymous access
CREATE POLICY "No anon access"
  ON posts FOR ALL
  TO anon
  USING (false);
```

### `secret-aws-access-key-id` [secrets-extended / medium / body-pattern]
**AWS Access Key ID in source**

AKIA* keys are not secrets by themselves but pair with secret keys.

**Risk:** An exposed AWS Access Key ID is a partial credential. It is harmless without the matching secret key. However, its exposure signals that secret keys may also be present in the same codebase, and the Key ID is needed to rotate or audit usage even after compromise.

**References:**
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Search the same codebase for the matching SecretAccessKey (40-char base64 string)
- Rotate both keys via IAM if both are present or if exposure is uncertain
- Move to IAM Roles and short-lived STS tokens to eliminate long-lived key pairs entirely
- **Detect co-located secret key** (bash):
```bash
# Search for the matching secret key near the Access Key ID
# AWS Secret Access Keys are 40-char base64 strings
grep -rE '[A-Za-z0-9/+=]{40}' --include='*.js' --include='*.ts' --include='*.env' .

# If found, rotate immediately:
aws iam create-access-key --user-name YOUR_USER
aws iam update-access-key --access-key-id AKIA... --status Inactive --user-name YOUR_USER
```
- **Use IAM Roles instead of key pairs** (typescript):
```typescript
// On AWS compute (EC2, Lambda, ECS, EKS): use IAM roles
// The SDK picks up credentials automatically: no key pair needed
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const db = new DynamoDBClient({ region: 'us-east-1' });
// No credentials config: relies on the attached IAM role
```

### `secret-private-key-pem` [secrets-extended / critical / body-pattern]
**PEM private key in source**

-----BEGIN ... PRIVATE KEY----- blocks grant signing/decryption access.

**Risk:** An exposed PEM private key lets an attacker impersonate your service in TLS handshakes, forge signed JWTs or documents, decrypt intercepted encrypted traffic, or assume any identity associated with the key, depending on how the key is used.

**References:**
- https://owasp.org/www-project-secrets-management/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the key immediately (TLS: re-issue certificate; JWT: rotate signing key and invalidate tokens)
- Store private keys in a KMS (AWS KMS, HashiCorp Vault, Azure Key Vault), never in source
- Use hardware-backed key storage (HSM or cloud KMS) for production signing operations
- **Load private key from environment variable (not source)** (typescript):
```typescript
import { createSign } from 'crypto';

// Load from environment variable: never hard-code in source
const privateKeyPem = process.env.SIGNING_PRIVATE_KEY;
if (!privateKeyPem) throw new Error('SIGNING_PRIVATE_KEY is required');

const sign = createSign('SHA256');
sign.update(data);
const signature = sign.sign(privateKeyPem, 'hex');
```
- **AWS KMS: sign without local private key** (typescript):
```typescript
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';

const kms = new KMSClient({ region: 'us-east-1' });

// Private key never leaves AWS KMS
const { Signature } = await kms.send(new SignCommand({
  KeyId: process.env.KMS_KEY_ID!,
  Message: Buffer.from(data),
  MessageType: 'RAW',
  SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
}));
```

### `secret-oracle-cloud-credentials` [secrets-extended / critical / body-pattern]
**Oracle Cloud Infrastructure (OCI) credentials in source**

Oracle config files (.oci/config), user OCIDs, tenancy OCIDs, and API signing keys (PEM) grant full tenancy access.

**Risk:** Exposed OCI credentials grant full programmatic access to your Oracle Cloud tenancy at the IAM policy level of the compromised user, including compute instances, databases, object storage, and network infrastructure.

**References:**
- https://docs.oracle.com/en-us/iaas/Content/API/Concepts/sdkconfig.htm
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Delete the compromised API key in OCI Console → Identity → Users → API Keys
- Create a new key pair and upload only the public key to OCI
- Move to Instance Principals or Resource Principals to eliminate static credentials
- **Store OCI config securely (never in source)** (bash):
```bash
# Store the private key in a secrets manager, not in source
# Example with HashiCorp Vault:
vault kv put secret/oci private_key=@~/.oci/oci_api_key.pem

# In CI: set as a masked variable, not a config file
export OCI_CLI_KEY_CONTENT="$(vault kv get -field=private_key secret/oci)"
```
- **Use Instance Principal (no static credentials needed)** (python):
```python
import oci

# Use Instance Principal on OCI compute: no key file needed
signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
object_storage = oci.object_storage.ObjectStorageClient(config={}, signer=signer)
```

### `secret-ibm-cloud-iam-key` [secrets-extended / critical / body-pattern]
**IBM Cloud IAM API key in source**

IBM IAM API keys (32+ char strings) grant access to the entire IBM Cloud account - Kubernetes, databases, Object Storage.

**Risk:** An exposed IBM Cloud IAM API key grants programmatic access to your IBM Cloud account at the IAM policy level of the key owner, potentially including Kubernetes clusters, databases, object storage, and Watson AI services.

**References:**
- https://cloud.ibm.com/iam/apikeys
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Delete the key immediately: ibmcloud iam api-key-delete KEY_NAME
- Create a service ID with minimum required policies and a new API key scoped to it
- Store the new key in IBM Secrets Manager, not in environment variables
- **Rotate IBM Cloud IAM key** (bash):
```bash
# Log in and delete the compromised key
ibmcloud login --apikey $COMPROMISED_KEY
ibmcloud iam api-key-delete COMPROMISED_KEY_NAME --force

# Create a new key with a service ID instead of a user key
ibmcloud iam service-id-create my-service --description 'Limited access service'
ibmcloud iam service-policy-create my-service \
  --roles Reader --service-name cloud-object-storage
ibmcloud iam service-api-key-create my-key my-service
```

### `secret-digitalocean-pat` [secrets-extended / critical / body-pattern]
**DigitalOcean PAT in source**

dop_v1_* tokens allow full control over droplets, databases, spaces, and Kubernetes clusters.

**Risk:** An exposed DigitalOcean PAT gives an attacker full API access to your entire DigitalOcean account, including creating and deleting Droplets, accessing managed databases, reading Spaces object storage, and controlling Kubernetes clusters.

**References:**
- https://docs.digitalocean.com/reference/api/digitalocean/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke immediately: DigitalOcean control panel → API → Tokens → Revoke
- Generate a new token with read/write scopes limited to required services
- Store the new token in a secrets manager, not in environment variables
- **Revoke via DigitalOcean API** (bash):
```bash
# Check what the token has access to
curl -X GET 'https://api.digitalocean.com/v2/account' \
  -H 'Authorization: Bearer YOUR_TOKEN'

# Revoke at the control panel (no API endpoint for self-revocation):
# https://cloud.digitalocean.com/account/api/tokens
```

### `secret-linode-api-key` [secrets-extended / critical / body-pattern]
**Linode API token in source**

Linode personal access tokens (64-char hex) grant Linode account takeover including instance termination.

**Risk:** An exposed Linode personal access token gives full API control over your Linode account: an attacker can terminate running instances, create new ones to mine cryptocurrency at your expense, access managed databases, and read or delete your stored data.

**References:**
- https://www.linode.com/docs/api/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the token at cloud.linode.com → Profile → API Tokens
- Generate a new token with minimum required permissions and a short expiry
- Store new tokens in a secrets manager, not in code or environment variables
- **Revoke Linode token via API** (bash):
```bash
# List personal access tokens to find the compromised one
curl -H 'Authorization: Bearer YOUR_TOKEN' \
  'https://api.linode.com/v4/profile/tokens'

# Revoke the token (replace TOKEN_ID with the ID from the list)
curl -X DELETE \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  'https://api.linode.com/v4/profile/tokens/TOKEN_ID'
```

### `secret-vultr-api-key` [secrets-extended / critical / body-pattern]
**Vultr API key in source**

Vultr API keys grant instance, DNS, and billing control on the Vultr account.

**Risk:** An exposed Vultr API key gives full API control over your Vultr account: an attacker can create GPU/bare-metal instances for cryptomining at your expense, modify DNS zones, access snapshots, and manage billing settings.

**References:**
- https://www.vultr.com/api/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Regenerate the API key at my.vultr.com → Account → API
- The old key is invalidated immediately when a new one is generated
- Store the new key in a secrets manager and never commit it to source
- **Store Vultr key as environment variable** (typescript):
```typescript
// Never hard-code the key: read from environment
const response = await fetch('https://api.vultr.com/v2/instances', {
  headers: {
    Authorization: `Bearer <value>`,
    'Content-Type': 'application/json',
  },
});
```

### `secret-rubygems-api-key` [secrets-extended / critical / body-pattern]
**RubyGems API key in source**

RubyGems API keys (rubygems_* / older 32-hex) allow publishing gems as the user, enabling supply-chain takeover.

**Risk:** An exposed RubyGems API key allows an attacker to publish a new malicious version of any gem you own, injecting backdoors into every Ruby application that runs bundle update or gem update, a direct supply-chain attack with wide blast radius.

**References:**
- https://guides.rubygems.org/api-key-scopes/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the key at rubygems.org → Edit Profile → API Keys
- Enable MFA on your RubyGems account to prevent future unauthorized access
- Audit recent gem publishes for unauthorized versions
- **GitHub Actions: use Trusted Publishing (OIDC)** (yaml):
```yaml
# Use RubyGems Trusted Publishing instead of API keys
jobs:
  publish:
    permissions:
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: rubygems/release-gem@v1
        # No RUBYGEMS_API_KEY secret needed with Trusted Publishing
```

### `secret-nuget-api-key` [secrets-extended / critical / body-pattern]
**NuGet API key in source**

NuGet API keys (oy2_*) allow pushing new package versions to nuget.org under the user's identity - direct supply-chain attack.

**Risk:** An exposed NuGet API key lets an attacker push malicious versions of your .NET packages to nuget.org, injecting backdoors into every project that adds or updates those packages, a supply-chain attack affecting .NET developers worldwide.

**References:**
- https://learn.microsoft.com/en-us/nuget/nuget-org/scoped-api-keys
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the key at nuget.org → Account → API Keys
- Audit recent package pushes for unauthorized versions
- Use scoped API keys tied to specific packages with push-only permissions
- **GitHub Actions: use Trusted Publishing (OIDC, no key needed)** (yaml):
```yaml
jobs:
  publish:
    permissions:
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - run: dotnet pack -c Release
      - uses: actions/setup-dotnet@v4
      - run: dotnet nuget push '**/*.nupkg' --source https://api.nuget.org/v3/index.json
        env:
          # Only use API key if Trusted Publishing is not available
          NUGET_API_KEY: <value>}
```

### `secret-jfrog-api-key` [secrets-extended / critical / body-pattern]
**JFrog Artifactory API key in source**

Artifactory access tokens and encrypted passwords grant upload, delete, and admin over artifact repositories.

**Risk:** An exposed JFrog Artifactory token can be used to upload malicious artifacts, overwrite existing package versions with backdoored builds, delete critical artifacts, or exfiltrate proprietary build outputs, a supply-chain attack on your internal build system.

**References:**
- https://jfrog.com/help/r/jfrog-platform-administration-documentation/access-tokens
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the token in JFrog Platform → Administration → User Management → Access Tokens
- Audit recent artifact uploads for unauthorized changes
- Use short-lived access tokens (TTL < 1 hour) for CI/CD pipelines
- **JFrog CLI: rotate access token** (bash):
```bash
# Revoke the compromised token (requires admin token)
curl -X DELETE \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  'https://your-org.jfrog.io/access/api/v1/tokens/COMPROMISED_TOKEN_ID'

# Create a short-lived token for CI (expires in 1 hour)
curl -X POST \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -d '{"expires_in": 3600, "scope": "applied-permissions/user"}' \
  'https://your-org.jfrog.io/access/api/v1/tokens'
```

### `secret-newrelic-browser-key` [secrets-extended / medium / body-pattern]
**New Relic browser key in source**

New Relic browser license keys (NRBR-*) are shipped in client JS to report RUM data. They are scoped by allowlist but still leak account info.

**Risk:** New Relic browser keys are intentionally public for RUM collection but an unrestricted key lets any site submit events billed to your account. Exposed server-side ingest keys (different from browser keys) would allow an attacker to inject fake metrics and suppress real alerts.

**References:**
- https://docs.newrelic.com/docs/browser/browser-monitoring/getting-started/browser-agent-licenses/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Restrict the browser key by hostname allowlist in New Relic Account Settings
- Ensure server-side ingest keys (different from browser keys) are never shipped to the browser
- Rotate periodically and audit usage for unexpected event sources
- **Restrict browser key by hostname (New Relic UI)** (bash):
```bash
# New Relic browser keys are restricted via the UI, not via API
# Go to: New Relic → Account Settings → Browser Keys → Edit → Add Allowed Hosts
# Allowed hosts: yourdomain.com, *.yourdomain.com

# Verify the key is scoped correctly:
curl 'https://api.newrelic.com/v2/browser_apps.json' \
  -H 'X-Api-Key: YOUR_INGEST_KEY'
```

### `secret-honeycomb-write-key` [secrets-extended / high / body-pattern]
**Honeycomb write key in source**

Honeycomb events API keys grant ingest to specific datasets; long-lived classic keys can also read.

**Risk:** An exposed Honeycomb write key lets an attacker inject fake trace events to poison observability data, potentially hiding real errors or performance issues from your engineering team during an incident.

**References:**
- https://docs.honeycomb.io/api/authentication/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate the key in the Honeycomb UI under Settings → API Keys
- Switch to environment-scoped keys with shorter TTLs
- Use classic keys only for ingest; never expose them in browser bundles
- **Server-only Honeycomb instrumentation** (typescript):
```typescript
// Only initialize Honeycomb server-side (API route, server component)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'https://api.honeycomb.io/v1/traces',
    headers: {
      'x-honeycomb-team': process.env.HONEYCOMB_API_KEY!,  // server-only
      'x-honeycomb-dataset': 'production',
    },
  }),
});
```

### `secret-datadog-client-token` [secrets-extended / low / body-pattern]
**Datadog client token in source**

Datadog client tokens (pub_*) are intentionally shipped in browser bundles for RUM. They are read-only / ingest-only but leak account.

**Risk:** Datadog client tokens (pub_*) are intentionally public for browser RUM collection. The primary risk is that an unrestricted token allows any site to submit fake RUM data billed to your account. Ensure it is not confused with a full API key, which would be more dangerous.

**References:**
- https://docs.datadoghq.com/account_management/api-app-keys/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Restrict the client token by service and origin in Datadog Organization Settings
- Rotate periodically and audit for unexpected traffic sources
- Ensure the full API key is never in client bundles; only the pub_* token
- **Correct: use pub_* token in browser, API key server-only** (typescript):
```typescript
import { datadogRum } from '@datadog/browser-rum';

datadogRum.init({
  applicationId: process.env.NEXT_PUBLIC_DD_APPLICATION_ID!,
  clientToken: process.env.NEXT_PUBLIC_DD_CLIENT_TOKEN!,  // pub_*: safe in browser
  site: 'datadoghq.com',
  service: 'my-app',
  // Never use the API key here; only the pub_* client token
});
```

### `secret-gitlab-deploy-token` [secrets-extended / high / body-pattern]
**GitLab deploy token in source**

GitLab deploy tokens grant push/pull to the project registry and package registry. Long-lived and project-scoped - very useful to attackers.

**Risk:** An exposed GitLab deploy token lets an attacker pull private container images and packages, or push malicious versions, compromising your container supply chain and any system that pulls from your registry.

**References:**
- https://docs.gitlab.com/ee/user/project/deploy_tokens/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the token: GitLab Project → Settings → Repository → Deploy tokens → Revoke
- Switch to CI/CD job tokens (per-job TTL, automatically expires after the job)
- For CI/CD, use group-level access tokens with minimum required scopes
- **Use CI/CD job token instead of deploy token** (yaml):
```yaml
# .gitlab-ci.yml
docker_pull:
  script:
    # Use the automatically-provided CI_JOB_TOKEN (expires after the job)
    - docker login -u $CI_REGISTRY_USER \
        -p $CI_JOB_TOKEN \
        $CI_REGISTRY
    - docker pull $CI_REGISTRY_IMAGE:latest
    # Never use a hard-coded deploy token here
```

### `secret-gitlab-runner-registration` [secrets-extended / critical / body-pattern]
**GitLab runner registration token in source**

Runner registration tokens allow anyone to attach a malicious runner and exfiltrate CI secrets and source from every job.

**Risk:** An exposed runner registration token allows an attacker to register a malicious runner that intercepts CI/CD jobs, stealing all CI environment variables, source code, deploy keys, and any secrets passed to pipelines. This is a complete CI/CD supply-chain compromise.

**References:**
- https://docs.gitlab.com/ee/security/reset_user_password.html
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate the registration token immediately in GitLab → Admin → Runners or Project → Settings → CI/CD
- Unregister all unknown runners and audit recently registered ones
- Switch to the new runner authentication token workflow (group-runner auth tokens)
- **Rotate runner registration token via API** (bash):
```bash
# Reset the registration token for a project
curl --request POST \
  --header 'PRIVATE-TOKEN: YOUR_ADMIN_TOKEN' \
  'https://gitlab.example.com/api/v4/projects/PROJECT_ID/runners/reset_registration_token'

# List all registered runners to find unauthorized ones
curl --header 'PRIVATE-TOKEN: YOUR_ADMIN_TOKEN' \
  'https://gitlab.example.com/api/v4/runners/all?status=online'
```

### `secret-bitbucket-app-password` [secrets-extended / critical / body-pattern]
**Bitbucket app password in source**

Bitbucket app passwords (with associated username) grant repo, project, and account API access. Easy to misuse because they look like strings.

**Risk:** A Bitbucket app password combined with the account username grants API-level access to repositories, pipelines, and project settings, allowing an attacker to clone private repos, push malicious commits, or modify CI/CD variables to inject backdoors.

**References:**
- https://support.atlassian.com/bitbucket-cloud/docs/app-passwords/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the app password at Bitbucket Settings → App passwords
- Migrate to repository access tokens with expiry dates and minimum required permissions
- For CI/CD, use Bitbucket Pipelines' built-in BITBUCKET_REPO_FULL_NAME and step credentials
- **Repository access token (preferred over app passwords)** (bash):
```bash
# Revoke the exposed app password at:
# https://bitbucket.org/account/settings/app-passwords/

# For CI/CD, use Pipelines-provided variables instead:
# BITBUCKET_REPO_FULL_NAME, BITBUCKET_BUILD_NUMBER, etc.
# Store secrets in: Repository Settings → Repository variables (masked)
```

### `secret-paypal-client-secret` [secrets-extended / critical / body-pattern]
**PayPal OAuth client secret in source**

PayPal client secrets are paired with a client ID and grant order/refund/payout operations on the merchant account.

**Risk:** An exposed PayPal client secret paired with the client ID lets an attacker create fraudulent orders, issue refunds to attacker-controlled accounts, trigger payouts, and access all transaction history on your merchant account.

**References:**
- https://developer.paypal.com/api/rest/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate the secret at developer.paypal.com → My Apps & Credentials → Edit App → Regenerate Secret
- Keep the client secret server-side only; the client ID alone is safe in browsers
- Use the PayPal JS SDK (which handles auth client-side) for browser integrations
- **Server-side PayPal token exchange (client secret stays server-only)** (typescript):
```typescript
// Fetch an access token on the server: never expose client_secret to browsers
async function getPayPalAccessToken() {
  const credentials = Buffer.from(
    `<value>:<value>`
  ).toString('base64');

  const res = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic <value>`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const { access_token } = await res.json();
  return access_token;
}
```

### `secret-braintree-token` [secrets-extended / critical / body-pattern]
**Braintree API token in source**

Braintree access tokens (production + sandbox) grant full payment processing, refund, and customer data access.

**Risk:** An exposed Braintree API token grants full access to your merchant account: creating charges, issuing refunds to attacker bank accounts, accessing all payment methods and customer PII (names, emails, masked card numbers) stored in the vault.

**References:**
- https://developer.paypal.com/braintree/docs/guides/extend/api
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate via Braintree Control Panel → Account → API Keys
- Enable IP allowlisting in Braintree to restrict API key usage to your server IPs
- Keep all Braintree credentials server-side; use client tokens (not private keys) in browsers
- **Correct: generate client token server-side, use private key never in browser** (typescript):
```typescript
import braintree from 'braintree';

// Server-only Braintree gateway
const gateway = new braintree.BraintreeGateway({
  environment: braintree.Environment.Production,
  merchantId: process.env.BRAINTREE_MERCHANT_ID!,
  publicKey:  process.env.BRAINTREE_PUBLIC_KEY!,
  privateKey: process.env.BRAINTREE_PRIVATE_KEY!,  // server-only
});

// Generate a one-time client token for the browser
export async function generateClientToken() {
  const { clientToken } = await gateway.clientToken.generate({});
  return clientToken;  // safe to send to browser, not the private key
}
```

### `secret-square-webhook-signature` [secrets-extended / critical / body-pattern]
**Square webhook signature key in source**

Square HMAC signature keys let attackers forge webhook events (payments.created, refund.updated). Must live server-side only.

**Risk:** An exposed Square webhook signature key allows an attacker to forge webhook events: sending fake payments.completed or refund.updated events to your server, causing it to fulfill orders, ship goods, or issue refunds for transactions that never occurred.

**References:**
- https://developer.squareup.com/docs/webhooks/validate-signatures
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Move the signature key to a server-only environment variable
- Rotate the key in Square Developer Dashboard → Webhooks → Signature key
- Verify all incoming webhooks server-side before acting on them
- **Next.js: verify Square webhook signature server-side** (typescript):
```typescript
import { createHmac } from 'crypto';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body       = await req.text();
  const signature  = req.headers.get('x-square-hmacsha256-signature')!;
  const notifUrl   = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL!;
  const sigKey     = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY!;  // server-only

  const hmac = createHmac('sha256', sigKey)
    .update(notifUrl + body)
    .digest('base64');

  if (hmac !== signature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Process event...
  return NextResponse.json({ ok: true });
}
```

### `secret-twilio-api-key-sk` [secrets-extended / critical / body-pattern]
**Twilio API Key (SK prefix) in source**

Twilio API keys (SK*) with their secret allow programmatic SMS, voice, and account access - different from the Account SID (AC*) which is public-ish.

**Risk:** An exposed Twilio SK key combined with its secret grants full API access: sending unlimited SMS/voice calls billed to your account, accessing all call recordings, and manipulating phone numbers. A single exposed key can result in thousands of dollars in fraudulent telecom charges.

**References:**
- https://www.twilio.com/docs/iam/api-keys
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the key at console.twilio.com → Account → API keys & tokens
- Audit recent API usage for unauthorized SMS/voice calls
- Create a new key with minimum required permissions and store in a secrets manager
- **Twilio: server-side only, key from environment** (typescript):
```typescript
import twilio from 'twilio';

// SK keys + secret must live server-side only
const client = twilio(
  process.env.TWILIO_API_KEY_SID!,      // SK...
  process.env.TWILIO_API_KEY_SECRET!,   // paired secret
  { accountSid: process.env.TWILIO_ACCOUNT_SID! }
);

// This call never happens in a browser component
await client.messages.create({
  to: '+15551234567',
  from: process.env.TWILIO_FROM_NUMBER!,
  body: 'Your verification code is: 123456',
});
```

### `secret-messagebird-access-key` [secrets-extended / critical / body-pattern]
**MessageBird access key in source**

MessageBird access keys grant SMS, voice, WhatsApp, and contact-list access on the business account.

**Risk:** An exposed MessageBird access key allows an attacker to send bulk SMS and WhatsApp messages billed to your account, access all contact lists and message history, and potentially intercept OTP codes sent to your users.

**References:**
- https://developers.messagebird.com/api/access-keys/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the key at dashboard.messagebird.com → Developers → API access
- Create a new key with minimum required permissions
- Keep MessageBird API calls server-side only
- **MessageBird: server-side only** (typescript):
```typescript
import messagebird from 'messagebird';

// Server-side only: never in client components
const mb = messagebird(process.env.MESSAGEBIRD_API_KEY!);

function sendSms(to: string, body: string) {
  return new Promise((resolve, reject) => {
    mb.messages.create({ originator: 'YourApp', recipients: [to], body }, (err, response) => {
      if (err) reject(err); else resolve(response);
    });
  });
}
```

### `secret-vonage-nexmo-key` [secrets-extended / critical / body-pattern]
**Vonage / Nexmo API key + secret in source**

Vonage (formerly Nexmo) API key/secret pairs grant SMS, voice, verify, and conversation API access.

**Risk:** An exposed Vonage API key/secret pair grants full access to SMS, voice, and 2FA verification APIs, allowing an attacker to send unlimited messages at your expense, intercept OTP verification codes sent to your users, and access all conversation history.

**References:**
- https://developer.vonage.com/en/getting-started/credentials
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate via dashboard.nexmo.com → Settings → API settings
- Keep API key and secret server-side only
- Use JWT-based authentication for longer-lived integrations
- **Vonage SDK: server-side only** (typescript):
```typescript
import Vonage from '@vonage/server-sdk';

// Server-side only
const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY!,
  apiSecret: process.env.VONAGE_API_SECRET!,
});
```

### `secret-replicate-api-token` [secrets-extended / high / body-pattern]
**Replicate API token in source**

Replicate API tokens (r8_*) grant inference and model upload access; can be abused for huge GPU bills.

**Risk:** An exposed Replicate token lets an attacker run expensive GPU inference workloads billed to your account. A single day of abuse can incur thousands of dollars in charges. It also allows uploading malicious model weights under your identity.

**References:**
- https://replicate.com/docs/reference/http
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the token at replicate.com → Account → API tokens
- Set billing alerts in your Replicate account to catch unexpected usage
- Proxy Replicate calls through your own API so the token never reaches the browser
- **Next.js: proxy Replicate calls server-side** (typescript):
```typescript
// app/api/predict/route.ts: server-only
import Replicate from 'replicate';
import { NextResponse } from 'next/server';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,  // server-only
});

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const output = await replicate.run('stability-ai/sdxl:...', { input: { prompt } });
  return NextResponse.json({ output });
}
```

### `secret-cohere-api-key` [secrets-extended / high / body-pattern]
**Cohere API key in source**

Cohere trial/production keys grant access to generate, embed, and classify endpoints with billable usage.

**Risk:** An exposed Cohere API key allows an attacker to consume your generation and embedding quotas, incurring billable usage charges. Production keys also expose any fine-tuned models or datasets you have created.

**References:**
- https://docs.cohere.com/reference/authentication
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the key at dashboard.cohere.com → API Keys
- Keep Cohere API calls server-side only
- Proxy browser-initiated requests through your own API route
- **Next.js: proxy Cohere through server route** (typescript):
```typescript
import { CohereClient } from 'cohere-ai';
import { NextResponse } from 'next/server';

const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY!,  // server-only
});

export async function POST(req: Request) {
  const { text } = await req.json();
  const response = await cohere.embed({
    texts: [text],
    model: 'embed-english-v3.0',
    inputType: 'search_query',
  });
  return NextResponse.json({ embeddings: response.embeddings });
}
```

### `secret-mistral-api-key` [secrets-extended / high / body-pattern]
**Mistral AI API key in source**

Mistral API keys grant chat/completion/embedding access on the La Plateforme and can incur significant cost.

**Risk:** An exposed Mistral API key allows an attacker to consume your chat and embedding quotas without restriction, potentially incurring large charges and exhausting your rate limits, disrupting your own application's ability to serve users.

**References:**
- https://docs.mistral.ai/api/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the key at console.mistral.ai → API Keys
- Set usage limits and billing alerts to detect unexpected consumption
- Keep Mistral API calls server-side only
- **Next.js: Mistral via server route** (typescript):
```typescript
import MistralClient from '@mistralai/mistralai';
import { NextResponse } from 'next/server';

const mistral = new MistralClient(process.env.MISTRAL_API_KEY!);  // server-only

export async function POST(req: Request) {
  const { messages } = await req.json();
  const response = await mistral.chat({
    model: 'mistral-large-latest',
    messages,
  });
  return NextResponse.json(response);
}
```

### `secret-groq-api-key` [secrets-extended / high / body-pattern]
**Groq API key in source**

Groq API keys (gsk_*) grant high-throughput inference on Groq LPU hardware - attractive to attackers because of speed.

**Risk:** Groq's LPU hardware is extremely fast, making an exposed Groq key particularly attractive to attackers; they can exhaust your daily token quota in minutes and incur significant charges before you notice, completely disrupting your application.

**References:**
- https://console.groq.com/docs/api-reference
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the key at console.groq.com → API Keys
- Set per-day token limits to reduce blast radius of future leaks
- Keep Groq API calls server-side only; never expose in browser bundles
- **Next.js: Groq via server route only** (typescript):
```typescript
import Groq from 'groq-sdk';
import { NextResponse } from 'next/server';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,  // server-only: never NEXT_PUBLIC_*
});

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
  });
  return NextResponse.json(completion);
}
```

### `secret-meilisearch-master-key` [secrets-extended / critical / body-pattern]
**Meilisearch master key in source**

The Meilisearch master key grants full control: index/document CRUD, tenant creation, and key issuance.

**Risk:** An exposed Meilisearch master key gives an attacker complete control over your search engine: deleting all indexes, corrupting search data, creating API keys for persistent access, and reading all indexed documents including any PII in the search corpus.

**References:**
- https://www.meilisearch.com/docs/learn/security/master_api_keys
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Restart Meilisearch with a new master key (set MEILI_MASTER_KEY env var)
- Create a scoped search-only API key for browser use: POST /keys with searchRoutes only
- Create a scoped indexing API key for server-side indexing operations
- **Create scoped keys: never use master key in app code** (bash):
```bash
# Create a search-only key for browser use (safe to expose)
curl -X POST 'http://localhost:7700/keys' \
  -H 'Authorization: Bearer MASTER_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"actions":["search"],"indexes":["products"],"expiresAt":null}'

# Create an indexing key for server-side use only
curl -X POST 'http://localhost:7700/keys' \
  -H 'Authorization: Bearer MASTER_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"actions":["documents.add","documents.delete"],"indexes":["products"],"expiresAt":null}'
```

### `secret-typesense-admin-key` [secrets-extended / critical / body-pattern]
**Typesense admin API key in source**

Typesense admin keys grant full schema, document, and key-management control on the cluster.

**Risk:** An exposed Typesense admin key lets an attacker delete all collections, overwrite document data, generate new API keys for persistent access, and modify cluster configuration, a complete takeover of your search infrastructure.

**References:**
- https://typesense.org/docs/latest/api/keys.html
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Generate new keys via the Typesense /keys endpoint using the current admin key
- Restart Typesense with a new --api-key to invalidate all existing keys
- Use search-only keys (actions: ["documents:search"]) in browser code
- **Create search-only key for browser use** (bash):
```bash
# Create a scoped search-only key (safe to use in browsers)
curl -X POST 'http://localhost:8108/keys' \
  -H 'X-TYPESENSE-API-KEY: ADMIN_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"actions":["documents:search"],"collections":["products"],"description":"Search-only key"}'
```
- **Use search-only key in Next.js client** (typescript):
```typescript
import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';

// Use search-only key: safe to ship to browsers
const adapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_KEY!,  // search-only
    nodes: [{ host: 'your-cluster.typesense.net', port: 443, protocol: 'https' }],
  },
  additionalSearchParameters: { query_by: 'name,description' },
});
```

### `secret-planetscale-password` [secrets-extended / critical / body-pattern]
**PlanetScale database password in source**

PlanetScale service-token JWTs and DB passwords grant full MySQL access including branch databases and deploy-requests.

**Risk:** An exposed PlanetScale database password gives an attacker direct MySQL access to your entire database, reading all user data, PII, and application state, and executing arbitrary SQL including destructive DROP TABLE operations.

**References:**
- https://planetscale.com/docs/concepts/service-tokens
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Delete the compromised password at app.planetscale.com → Settings → Passwords
- Create a new password with the minimum required role (read-only vs read-write)
- Store the connection string in a secrets manager, not in .env files committed to source
- **Store connection string securely** (bash):
```bash
# .env.local (never commit)
DATABASE_URL="mysql://USERNAME:PASSWORD@HOST/DATABASE?ssl={\"rejectUnauthorized\":true}"

# In production: use a secrets manager (Vercel, AWS Secrets Manager, Vault)
# Never commit .env files; add to .gitignore:
.env
.env.local
.env.production
```
- **Use database-level read-only account for analytics** (sql):
```sql
-- Create a read-only user for analytics/reporting to minimize blast radius
CREATE USER 'analytics'@'%' IDENTIFIED BY 'strong_random_password';
GRANT SELECT ON mydb.* TO 'analytics'@'%';
-- Never use the main database password in application code
```

### `secret-auth0-client-secret` [secrets-extended / critical / body-pattern]
**Auth0 client secret in source**

Auth0 client secrets paired with client IDs let attackers exchange authorization codes for tokens against any Auth0 application.

**Risk:** An exposed Auth0 client secret lets an attacker exchange intercepted authorization codes for access tokens, impersonate your application in the OAuth flow, and gain access to any Auth0 Management API permissions granted to the application.

**References:**
- https://auth0.com/docs/secure/application-credentials
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate via Auth0 Dashboard → Applications → Settings → Rotate Secret
- Use PKCE (no client_secret) for browser-based single-page apps
- Keep client secrets exclusively in server-side environment variables
- **Auth0 Next.js SDK: server-side only config** (typescript):
```typescript
// auth0.ts (server-side only, no 'use client')
import { Auth0Client } from '@auth0/nextjs-auth0/server';

export const auth0 = new Auth0Client({
  domain: process.env.AUTH0_DOMAIN!,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,  // server-only, never NEXT_PUBLIC_*
  appBaseUrl: process.env.APP_BASE_URL!,
});
```

### `secret-okta-api-token` [secrets-extended / critical / body-pattern]
**Okta API token (SSWS) in source**

Okta SSWS tokens grant full admin access to the org - user CRUD, app assignments, factor reset. Treat like a root password.

**Risk:** An Okta SSWS token with full admin scope lets an attacker create new admin users, reset MFA factors for existing users (enabling account takeover of any employee), assign users to any application, and exfiltrate the entire directory including all user attributes.

**References:**
- https://developer.okta.com/docs/reference/api/
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Revoke the token immediately: Okta Admin → Security → API → Tokens → Revoke
- Audit the Okta System Log for API calls made with the token
- Switch to OAuth2 service apps with the minimum required API scopes
- **Rotate Okta token via API** (bash):
```bash
# Revoke the compromised SSWS token
curl -X DELETE \
  -H 'Authorization: SSWS YOUR_ADMIN_TOKEN' \
  'https://YOUR_ORG.okta.com/api/v1/api-tokens/TOKEN_ID'

# Audit recent API usage in the System Log
curl -H 'Authorization: SSWS YOUR_ADMIN_TOKEN' \
  'https://YOUR_ORG.okta.com/api/v1/logs?since=2024-01-01T00:00:00Z&filter=eventType+eq+"system.api_token.create"'
```

### `secret-keycloak-realm-key` [secrets-extended / critical / body-pattern]
**Keycloak realm signing key in source**

Keycloak realm RSA/EC private keys sign every JWT issued by the realm. A leaked key lets attackers mint valid tokens for any user.

**Risk:** A leaked Keycloak realm signing key allows an attacker to mint valid JWTs for any user in the realm, including realm-admin, with any roles, claims, or expiry they choose, effectively bypassing all authentication for every application in the realm.

**References:**
- https://www.keycloak.org/docs/latest/server_admin/index.html#realm-keys
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Rotate via Realm Settings → Keys → Active → click the provider → Regenerate
- After rotation, all existing tokens signed with the old key become invalid immediately
- Store realm export backups (which contain signing keys) in an encrypted secrets store, not in source
- **Keycloak: force key rotation via Admin CLI** (bash):
```bash
# Use the Keycloak Admin CLI to rotate the realm key
/opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user admin --password admin

# Add a new RSA key provider (higher priority will be used for new tokens)
/opt/keycloak/bin/kcadm.sh create components \
  -r YOUR_REALM \
  -f - <<EOF
{
  "name": "rsa-generated",
  "providerId": "rsa-generated",
  "providerType": "org.keycloak.keys.KeyProvider",
  "config": { "priority": ["200"] }
}
EOF
```

---

## Category: ssl (8 checks)

### `ssl-https-only-cookie-on-http` [ssl / high / url-check]
**Secure Cookie Set on HTTP Endpoint**

A Set-Cookie header with the Secure attribute was observed on a plain HTTP response. Browsers silently ignore the Secure flag on non-HTTPS connections, so the cookie is transmitted in cleartext on every subsequent request.

**Risk:** Any network observer can intercept the cookie in cleartext, including session tokens marked Secure, because the browser ignores the Secure flag and sends the cookie over HTTP anyway.

**Why it matters:** The Secure attribute on a cookie tells the browser to transmit it only over HTTPS. When the server sets a Secure cookie from an HTTP endpoint, the browser still sends the cookie on subsequent HTTP requests to the same origin, defeating the entire purpose of the flag.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6265#section-4.1.2.5
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#restrict_access_to_cookies

**Fix:**
- Serve every page and API endpoint over HTTPS and redirect all HTTP traffic to HTTPS.
- Never issue a Secure-flagged cookie from an HTTP handler.
- Enable HSTS to prevent browsers from downgrading future requests.
- **Node.js / Express** (javascript):
```javascript
// Only set Secure cookies from HTTPS handlers
res.cookie('session', token, {
  httpOnly: true,
  secure: true,   // only effective over HTTPS
  sameSite: 'strict',
  path: '/'
});
```
- **Nginx HTTP redirect** (nginx):
```nginx
server {
  listen 80;
  server_name example.com;
  return 301 https://$host$request_uri;
}
```

### `unencrypted-connection` [ssl / critical / url-check]
**Site Served Over Unencrypted HTTP**

The site is accessible over plain HTTP without TLS encryption. All traffic including credentials, session tokens, and user data is transmitted in cleartext.

**Risk:** Any on-path attacker can passively read every request and response, inject content into pages, steal session cookies, and capture credentials submitted in forms.

**Why it matters:** HTTP transmits everything in cleartext. On any shared network (coffee shop Wi-Fi, corporate proxy, ISP), passive sniffing requires no special privileges. Active attackers can additionally inject malicious scripts into responses.

**References:**
- https://datatracker.ietf.org/doc/html/rfc2818
- https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security

**Fix:**
- Obtain and install a TLS certificate (Let's Encrypt is free).
- Configure HTTPS and redirect all HTTP traffic to HTTPS.
- Enable HSTS to prevent future downgrades.
- **Nginx redirect** (nginx):
```nginx
server {
  listen 80;
  server_name example.com;
  return 301 https://$server_name$request_uri;
}
server {
  listen 443 ssl;
  ssl_certificate /etc/ssl/certs/example.com.pem;
  ssl_certificate_key /etc/ssl/private/example.com.key;
}
```

### `expect-ct-missing` [ssl / info / header]
**Missing Expect-CT Header**

The Expect-CT header is absent. This header lets sites opt into Certificate Transparency enforcement and receive reports about CT violations before they affect users.

**Risk:** Without Expect-CT, misissued certificates targeting your domain may go undetected until a user notices a browser warning. CT violations are not reported back to you.

**Why it matters:** Certificate Transparency requires CAs to log every certificate they issue to append-only public CT logs. Expect-CT lets a site declare that its certificate must appear in a CT log, and optionally request enforcement. Note: Chrome auto-requires CT since 2018 for new certificates, so this header is most useful for reporting.

**References:**
- https://datatracker.ietf.org/doc/html/rfc9163
- https://certificate.transparency.dev/

**Fix:**
- Add Expect-CT with a report-uri to collect violation reports in monitor mode first.
- Once confident, add the enforce directive to force CT compliance.
- **Header** (http):
```http
Expect-CT: max-age=86400, enforce, report-uri="https://example.com/ct-report"
```
- **Nginx** (nginx):
```nginx
add_header Expect-CT 'max-age=86400, report-uri="https://example.com/ct-report"' always;
```

### `https-unusual-port` [ssl / low / url-check]
**HTTPS Served on Non-Standard Port**

HTTPS is being served on a port other than 443. Non-standard ports confuse users, bypass browser HSTS expectations for port 443, and indicate the service may be intended as internal-only.

**Risk:** Non-443 HTTPS bypasses HSTS preload protection (preload entries only cover port 443), and users may not notice the non-standard port in the URL bar, making phishing easier.

**Why it matters:** HSTS preload entries and browser defaults only apply to port 443 for HTTPS. A service on port 8443 or 4443 does not benefit from preloaded HSTS, so users on those ports are not protected on their first visit.

**References:**
- https://datatracker.ietf.org/doc/html/rfc2818

**Fix:**
- Move public-facing HTTPS to port 443 behind a reverse proxy.
- Keep non-standard ports bound to internal listeners only.
- If a non-standard port must be exposed, set an explicit HSTS header for that port.
- **Nginx reverse proxy to non-standard port** (nginx):
```nginx
# Expose port 443 publicly, proxy to internal :8443
server {
  listen 443 ssl;
  server_name example.com;
  location / {
    proxy_pass https://127.0.0.1:8443;
  }
}
```

### `x-forwarded-method-override` [ssl / medium / header]
**HTTP Method Override via X-Forwarded-Method / X-HTTP-Method-Override**

The server accepts X-Forwarded-Method or X-HTTP-Method-Override headers, allowing clients to silently rewrite the effective HTTP method. Proxies that forward these headers without stripping them enable method-spoofing attacks.

**Risk:** An attacker sending a GET request with X-HTTP-Method-Override: DELETE can bypass middleware that restricts dangerous verbs based on the wire-level method, effectively executing a DELETE as a GET.

**Why it matters:** Some legacy frameworks and proxies use X-HTTP-Method-Override to support PUT/DELETE from form-based clients. If the proxy forwards these headers to the origin without validation, upstream auth/authz checks keyed on the HTTP method can be bypassed.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7231#section-4

**Fix:**
- Configure the reverse proxy to strip X-Forwarded-Method and X-HTTP-Method-Override from inbound client requests.
- Enforce method-based authorization at the origin using the wire-level method, not override headers.
- Only honor method-override headers from trusted internal services over a private network.
- **Nginx: strip override headers** (nginx):
```nginx
proxy_set_header X-HTTP-Method-Override '';
proxy_set_header X-Forwarded-Method '';
proxy_set_header X-Method-Override '';
```

### `ssl-strip-detected` [ssl / info / header]
**HSTS Present on HTTP Response (SSL-Strip Indicator)**

A Strict-Transport-Security header was detected in a plain HTTP response. HSTS is only meaningful over HTTPS; its presence on HTTP indicates either a misconfigured server or an active SSL-strip interception where the attacker forwards HSTS headers to create a false sense of security.

**Risk:** An SSL-strip attack sitting between the client and server can forward HSTS headers while still serving HTTP to the victim, preventing the browser from upgrading the connection and exposing all traffic in cleartext.

**Why it matters:** Strict-Transport-Security is only enforced by browsers when received over a valid HTTPS connection. When the browser sees HSTS over HTTP, it ignores the header. However, an attacker performing SSL-stripping may include HSTS in the stripped response to make the victim think the site is secure while intercepting all traffic.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6797

**Fix:**
- Ensure all HTTP requests are redirected to HTTPS before sending any application response.
- Never include Strict-Transport-Security in HTTP responses.
- Submit to the HSTS preload list to protect first-visit users.
- **Nginx: HTTPS only with HSTS** (nginx):
```nginx
server {
  listen 80;
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl;
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
}
```

### `mixed-protocol-content` [ssl / medium / body-pattern]
**Mixed-Protocol Content (HTTPS Page Loading HTTP Resources)**

Pages served over HTTPS include subresources (scripts, images, iframes, XHR) loaded over plain HTTP. Browsers block or warn on mixed content, and the HTTP subresources are vulnerable to MITM modification.

**Risk:** An attacker on the network can modify HTTP subresources in transit. A malicious script injected into an HTTP JS resource runs in the HTTPS page's origin, giving full access to session cookies and the DOM.

**Why it matters:** Mixed content occurs when an HTTPS page loads resources over HTTP. Modern browsers block active mixed content (scripts, iframes) and warn on passive mixed content (images). The HTTP resources are still vulnerable to MITM tampering regardless of the HTTPS page.

**References:**
- https://www.w3.org/TR/mixed-content/

**Fix:**
- Replace all http:// URLs in templates with https:// or protocol-relative //.
- Add a Content-Security-Policy header with upgrade-insecure-requests.
- Audit third-party widgets and ad tags for HTTP-only assets.
- **CSP upgrade-insecure-requests** (http):
```http
Content-Security-Policy: upgrade-insecure-requests
```
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Content-Security-Policy', value: 'upgrade-insecure-requests' }],
    }];
  },
};
export default nextConfig;
```

### `http-no-redirect` [ssl / medium / url-check]
**HTTP Endpoint Does Not Redirect to HTTPS**

An HTTP endpoint returns a 200 response instead of redirecting to HTTPS. Users and bots who visit the plain HTTP URL are never forced onto the encrypted version of the site.

**Risk:** Users who type or follow an HTTP link never get pushed to HTTPS. All their traffic travels in cleartext, exposing credentials, session tokens, and personal data on the wire.

**Why it matters:** Redirecting HTTP to HTTPS is the foundational step in enforcing transport encryption. Without it, HSTS, Secure cookies, and other protections are bypassed for users who arrive over HTTP. Search engines and link-scrapers also index the HTTP version, creating a persistent exposure surface.

**References:**
- https://datatracker.ietf.org/doc/html/rfc2818
- https://datatracker.ietf.org/doc/html/rfc6797

**Fix:**
- Configure the server to return 301 (permanent redirect) from every HTTP URL to its HTTPS equivalent.
- Add Strict-Transport-Security once HTTPS is stable so browsers cache the redirect.
- **Nginx** (nginx):
```nginx
server {
  listen 80;
  server_name example.com www.example.com;
  return 301 https://$host$request_uri;
}
```
- **Apache** (apache):
```apache
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

---

## Category: supply-chain (8 checks)

### `supply-chain-lockfile-exposed` [supply-chain / medium / body-pattern]
**npm/yarn Lock File Exposed**

A package-lock.json or yarn.lock file was found accessible at a public URL. Lock files contain the exact dependency tree including all transitive dependencies and their versions, enabling an attacker to identify vulnerable packages.

**Risk:** Exposed lock files allow attackers to build a precise vulnerability map: exact dependency versions, dependency tree structure, and package registry sources. Combined with public CVE databases, this turns reconnaissance from hours to minutes.

**Why it matters:** Lock files are essential for reproducible builds but should not be publicly accessible. They contain enough information to identify every package version installed, including vulnerable transitive dependencies that don't appear in package.json.

**References:**
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server
- https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json

**Fix:**
- Add /package-lock.json, /yarn.lock, /pnpm-lock.yaml to your web server's deny list.
- In Nginx: location ~* /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml) { deny all; }
- In Next.js: add a redirect or rewrite to return 404 for these paths.
- Ensure your build process doesn't copy lock files to the public output directory.
- **Next.js rewrites to block lock files** (javascript):
```javascript
// next.config.js
module.exports = {
  async rewrites() {
    return [
      { source: '/package-lock.json', destination: '/api/not-found' },
      { source: '/yarn.lock', destination: '/api/not-found' },
    ];
  }
};
```

### `supply-chain-requirements-exposed` [supply-chain / medium / body-pattern]
**Python Requirements File Exposed**

A requirements.txt, Pipfile, or Pipfile.lock was found at a public URL. Python dependency files reveal the exact package versions installed, enabling attackers to find known CVEs in your dependencies.

**Risk:** Pinned dependency versions in requirements.txt allow attackers to cross-reference against public CVE databases to find exploitable vulnerabilities in your installed packages.

**Why it matters:** Dependency manifests should be development-only artifacts. Production web servers should never serve these files. They're commonly exposed when deploying directly from a repository or when static file serving is too permissive.

**References:**
- https://owasp.org/www-community/vulnerabilities/Configuration_Security
- https://pip.pypa.io/en/stable/reference/requirements-file-format/

**Fix:**
- Deny access to requirements.txt, Pipfile, Pipfile.lock, setup.py, and pyproject.toml in your web server config.
- Ensure your deployment process copies only the necessary application files, not the entire repository.
- Add these files to your web application's security headers or path-based access controls.
- **Nginx deny rule** (nginx):
```nginx
location ~* /(requirements\.txt|Pipfile(\.lock)?|setup\.py|pyproject\.toml|Gemfile(\.lock)?) {
  deny all;
  return 404;
}
```

### `supply-chain-gemfile-exposed` [supply-chain / medium / body-pattern]
**Ruby Gemfile or Gemfile.lock Exposed**

A Gemfile or Gemfile.lock was found publicly accessible. Ruby gem dependency files reveal the exact gem versions used, enabling CVE-based vulnerability scanning against your dependencies.

**Risk:** Gemfile.lock contains the complete dependency tree with exact versions including all transitive gems. An attacker can use bundler-audit or CVE databases to find vulnerable gems in under a minute.

**Why it matters:** Gemfile.lock is similar to package-lock.json: it pins every gem to an exact version. This is necessary for reproducibility but should never be publicly accessible in production.

**References:**
- https://bundler.io/man/gemfile.5.html
- https://owasp.org/www-project-dependency-check/

**Fix:**
- Block access to Gemfile and Gemfile.lock in your web server configuration.
- In Rails: use config.public_file_server.enabled = false or configure Nginx to block these paths.
- Audit what files are in your Rails public/ directory.
- **Rails public file server config** (ruby):
```ruby
# config/environments/production.rb
config.public_file_server.enabled = ENV['RAILS_SERVE_STATIC_FILES'].present?

# Nginx deny rule
# location ~* /(Gemfile(\.(lock))?) { deny all; }
```

### `supply-chain-sri-external-script` [supply-chain / medium / body-pattern]
**External CDN Script Without SRI Hash**

An external JavaScript file is loaded from a CDN without a Subresource Integrity (integrity=) attribute. If the CDN is compromised or serves a different file version, malicious code can run on your site without detection.

**Risk:** CDN compromises (Polyfill.io 2024, event-stream 2018, ua-parser-js 2021) have injected malicious code into millions of sites. SRI is the primary defense: it makes CDN tampering immediately detectable and blocks execution of modified scripts.

**Why it matters:** When you load a script from a CDN without SRI, you're trusting that CDN completely. SRI lets you cryptographically pin the exact bytes of the script you tested, so any modification by a compromised CDN is blocked.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity
- https://www.srihash.org/

**Fix:**
- Generate SRI hash: npx sri-hash https://cdn.example.com/script.js
- Add integrity and crossorigin attributes to all external script and link tags.
- Pin to specific versions in CDN URLs, avoid 'latest' or major-version aliases.
- Consider self-hosting critical scripts instead of relying on CDNs.
- **SRI-protected script tag** (html):
```html
<script
  src="https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js"
  integrity="sha512-WFN04846sdKMIP5LKNphMaWzU7YpMyCU245etK3g/2ARYbPK9Ub18eG+ljU96qKRCWh+quCY7yefSmlkQw1ANQ=="
  crossorigin="anonymous"
  referrerpolicy="no-referrer"
></script>
```

### `supply-chain-http-script-on-https` [supply-chain / high / body-pattern]
**HTTP Script Loaded on HTTPS Page**

An HTTPS page loads a JavaScript file over HTTP. This is a mixed-content violation that allows network attackers to replace the HTTP script with malicious code, compromising the entire HTTPS page.

**Risk:** An attacker on the same network (Wi-Fi, ISP-level) can intercept the HTTP script request and replace it with arbitrary JavaScript. This completely compromises the HTTPS page's security guarantees despite TLS protecting the main page.

**Why it matters:** HTTPS protects the main page load. But if the page loads any resource over HTTP, that resource can be intercepted and modified by a network attacker. A compromised HTTP script can exfiltrate all cookies, form data, and user interactions.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/upgrade-insecure-requests

**Fix:**
- Change all http:// script URLs to https://.
- Add Content-Security-Policy: upgrade-insecure-requests to automatically upgrade HTTP to HTTPS.
- Add a CSP that blocks all HTTP sources: default-src https:.
- Serve all scripts from your own domain over HTTPS.
- **CSP upgrade-insecure-requests** (typescript):
```typescript
// Next.js middleware
response.headers.set(
  'Content-Security-Policy',
  'upgrade-insecure-requests; default-src https: \'self\';'
);
```

### `supply-chain-composer-json-exposed` [supply-chain / medium / body-pattern]
**PHP composer.json or composer.lock Exposed**

A composer.json or composer.lock file was found publicly accessible. PHP Composer dependency files reveal exact package versions including all transitive dependencies.

**Risk:** Exposed composer.lock allows attackers to identify vulnerable PHP packages (CVEs in Laravel, Symfony, Doctrine, etc.) and target accordingly. Combined with PHP version from Server or X-Powered-By headers, this provides a complete attack surface map.

**Why it matters:** Composer files should be in the project root above the web root. If the webroot is set to the project root rather than public/ or web/, all project files become accessible.

**References:**
- https://getcomposer.org/doc/faqs/how-do-i-install-composer-programmatically.md
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/04-Review_Old_Backup_and_Unreferenced_Files_for_Sensitive_Information

**Fix:**
- Set your web server document root to the public/ or web/ directory, not the project root.
- In Nginx: root /var/www/myapp/public; (not /var/www/myapp/)
- Block access to composer.json and composer.lock at the web server level.
- In Laravel: verify document root points to the public/ folder.
- **Nginx correct document root** (nginx):
```nginx
server {
  root /var/www/myapp/public; # Not /var/www/myapp/
  
  # Block sensitive files as defense-in-depth
  location ~* /(composer\.(json|lock)|Makefile|\.env) {
    deny all;
    return 404;
  }
}
```

### `supply-chain-dockerfile-exposed` [supply-chain / high / body-pattern]
**Dockerfile or docker-compose.yml Exposed**

A Dockerfile or docker-compose.yml file was found publicly accessible. These files reveal the base image, environment variables, secrets handling, port mappings, and infrastructure topology.

**Risk:** Dockerfiles often contain ARG/ENV values with credentials, reveal base image versions with known vulnerabilities, and expose internal service topology. docker-compose.yml often includes database credentials in environment variables.

**Why it matters:** Container configuration files should never be in the web-accessible directory. They're build-time artifacts that reveal everything about how your application is deployed.

**References:**
- https://docs.docker.com/engine/reference/commandline/run/#env
- https://owasp.org/www-community/vulnerabilities/Information_exposure_through_query_strings_in_url

**Fix:**
- Store Dockerfiles and docker-compose files above the web root.
- Block access to Dockerfile, docker-compose.yml, .dockerignore at the web server.
- Never put actual secrets in Dockerfiles: use Docker secrets or environment injection at runtime.
- Scan Dockerfiles with docker scan or Trivy for base image vulnerabilities.
- **Nginx deny rule** (nginx):
```nginx
location ~* /(Dockerfile|docker-compose\.ya?ml|\.dockerignore|Makefile) {
  deny all;
  return 404;
}
```

### `supply-chain-env-file-exposed` [supply-chain / critical / body-pattern]
**.env File Exposed at Public URL**

A .env or .env.local file was found publicly accessible. Environment files contain application secrets, database credentials, API keys, and encryption keys in plaintext.

**Risk:** A single .env file exposure can compromise every service the application uses: database (full data access), third-party APIs (billing and data exfiltration), email (sending forged messages), payment processing, and encryption keys (decrypting stored data).

**Why it matters:** .env files are the most sensitive files in a web application. They are in the project root precisely because they should be gitignored and never deployed to the web root. When the webroot equals the project root, .env files become instantly accessible.

**References:**
- https://owasp.org/www-community/vulnerabilities/Configuration_Security
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

**Fix:**
- Immediately rotate every credential in the exposed .env file.
- Set the web server document root to public/ or dist/, not the project root.
- Block access to .env* files at the web server level as defense-in-depth.
- Add *.env to .gitignore and ensure it has never been committed to version control.
- **Block .env files in Nginx** (nginx):
```nginx
location ~* /\.env {
  deny all;
  return 404;
}

# Also block hidden files in general
location ~ /\. {
  deny all;
  return 404;
}
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

**Risk:** Older TLS versions have known attacks (POODLE, BEAST, ROBOT) and lack modern AEAD cipher suites. Clients negotiating TLS 1.0 or 1.1 are vulnerable to downgrade attacks.

**Why it matters:** TLS 1.0 and 1.1 have been deprecated by IETF (RFC 8996). Most browsers and APIs no longer support them.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc8996

**Fix:**
- Disable TLS 1.0 and 1.1 on the server.
- Keep TLS 1.2 and 1.3 enabled.
- Prefer AEAD ciphers (AES-GCM, ChaCha20-Poly1305).
- **Nginx** (nginx):
```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
```

### `tls-cert-key-size-rsa` [tls / medium / header]
**RSA Key Size Below 2048 Bits**

The TLS certificate uses an RSA key smaller than 2048 bits. Keys below this threshold are practically factorable with modern compute resources.

**Risk:** An RSA key below 1024 bits can be factored offline. Keys between 1024 and 2048 bits are at risk from well-resourced attackers, allowing session decryption and impersonation.

**Why it matters:** Modern TLS certs should use RSA 2048 bits minimum; 3072 is recommended for certificates with long validity windows. Keys below 2048 bits are considered cryptographically weak by NIST and will be rejected by strict verifiers.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8446
- https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final

**Fix:**
- Reissue the certificate with RSA 2048 or 3072 bits.
- Consider switching to ECDSA P-256 for equivalent security with smaller keys.
- **Generate RSA 3072 CSR** (bash):
```bash
openssl req -newkey rsa:3072 -keyout server.key -out server.csr -nodes -subj '/CN=example.com'
```
- **Generate ECDSA P-256 CSR** (bash):
```bash
openssl ecparam -genkey -name prime256v1 -out server.key
openssl req -new -key server.key -out server.csr -subj '/CN=example.com'
```

### `tls-cert-self-signed` [tls / high / header]
**Self-Signed Certificate in Production**

The TLS certificate is self-signed (issuer equals subject with no trusted CA chain). Browsers display a hard error and require users to manually bypass the warning.

**Risk:** Users who bypass the self-signed certificate warning receive no guarantee of server identity. Attackers can present any self-signed certificate during a MITM attack and users are trained to click through the warning.

**Why it matters:** Self-signed certificates are appropriate for development environments but must never be used in production. They provide encryption but no authentication, which defeats half the purpose of TLS.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5280
- https://letsencrypt.org/docs/

**Fix:**
- Replace with a certificate from a publicly trusted CA.
- Let's Encrypt provides free certificates with 90-day lifetime and auto-renewal via certbot or ACME clients.
- **Let's Encrypt via certbot** (bash):
```bash
certbot --nginx -d example.com -d www.example.com
# Auto-renewal
certbot renew --dry-run
```

### `tls-ocsp-stapling-missing` [tls / info / header]
**OCSP Stapling Not Enabled**

The TLS handshake does not include a stapled OCSP response. Without stapling, browsers must contact the CA's OCSP responder separately on every connection to check revocation status.

**Risk:** Without OCSP stapling, browsing activity leaks to the CA's OCSP responder. If the OCSP responder is slow or unavailable, browsers may soft-fail and accept a revoked certificate.

**Why it matters:** OCSP stapling eliminates the need for browsers to make a live OCSP request during the handshake. The server periodically fetches the OCSP response and staples it into the TLS handshake, improving privacy and reducing latency.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6960
- https://datatracker.ietf.org/doc/html/rfc6961

**Fix:**
- Enable ssl_stapling on; ssl_stapling_verify on; in nginx.
- Provide the full CA certificate chain via ssl_trusted_certificate.
- Set a resolver so nginx can fetch the OCSP response.
- **Nginx** (nginx):
```nginx
ssl_stapling on;
ssl_stapling_verify on;
ssl_trusted_certificate /etc/ssl/certs/ca-chain.pem;
resolver 1.1.1.1 8.8.8.8 valid=300s;
```

### `tls-cert-must-staple-missing` [tls / info / header]
**TLS Must-Staple Extension Missing**

The certificate does not carry the TLS Feature extension (Must-Staple, RFC 7633). Without Must-Staple, browsers accept the certificate even when no OCSP staple is provided, negating the soft-fail protection of OCSP.

**Risk:** Without Must-Staple, an attacker who obtains a certificate but cannot get a valid OCSP staple can still present it to clients, and clients will accept it rather than reject the connection.

**Why it matters:** Must-Staple is an X.509 extension that requires the server to always provide an OCSP staple in the TLS handshake. If the staple is missing or expired, Must-Staple-aware clients hard-fail the connection instead of soft-failing. This closes the attack window between certificate revocation and client enforcement.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7633
- https://datatracker.ietf.org/doc/html/rfc6960

**Fix:**
- Request Must-Staple from your CA when issuing or renewing the certificate.
- Ensure OCSP stapling is enabled and working on your server before enabling Must-Staple.
- Test with: openssl s_client -connect example.com:443 -status
- **Inspect Must-Staple extension** (bash):
```bash
openssl x509 -in cert.pem -noout -ext tlsfeature
# Should output: TLS Feature: status_request
```

### `tls-hpkp-deprecated` [tls / info / header]
**HPKP Header Present**

The Public-Key-Pins (HPKP) response header is present. HPKP was deprecated in 2018 and removed from Chrome due to the risk of catastrophic self-inflicted denial of service when a pinned key is lost.

**Risk:** A misconfigured HPKP pin that no longer matches any valid certificate will hard-block all browser access to your site for the duration of max-age, with no override mechanism for users.

**Why it matters:** HPKP was designed to prevent CA-misissued certificates, but it was too dangerous in practice. Losing the pinned key means locking out every browser that cached the pin. Certificate Transparency with Expect-CT is the modern replacement.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Public_Key_Pinning
- https://certificate.transparency.dev/

**Fix:**
- Remove the Public-Key-Pins header entirely.
- Rely on Certificate Transparency (CT) logs and Expect-CT for mis-issuance detection instead.
- **Nginx: remove HPKP** (nginx):
```nginx
# Remove any existing HPKP header
proxy_hide_header Public-Key-Pins;
proxy_hide_header Public-Key-Pins-Report-Only;
# Add Expect-CT instead
add_header Expect-CT 'max-age=86400, report-uri="https://example.com/ct-report"' always;
```

### `tls-tls-1-3-not-supported` [tls / low / header]
**TLS 1.3 Not Supported**

The server does not offer TLS 1.3. Connections fall back to TLS 1.2, which lacks TLS 1.3's 0-RTT resumption, reduced round-trip handshake, and mandatory forward-secrecy-only cipher suites.

**Risk:** Without TLS 1.3, clients miss improved forward secrecy and the cleaner cipher-suite design that eliminates weak algorithms at the protocol level. TLS 1.2 remains safe but requires more careful cipher configuration.

**Why it matters:** TLS 1.3 removes support for all non-AEAD ciphers, weak key exchange, and the legacy handshake format. It also adds 0-RTT resumption and reduces handshake latency by one round-trip. Enabling it alongside TLS 1.2 is backward compatible.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8446
- https://datatracker.ietf.org/doc/html/rfc8996

**Fix:**
- Add TLSv1.3 to ssl_protocols in nginx.
- Ensure OpenSSL 1.1.1 or later is installed.
- **Nginx** (nginx):
```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
```

### `tls-hsts-preload-status` [tls / info / header]
**HSTS Preload List Status**

Even with Strict-Transport-Security set, browsers are not bound by it on first visit. Submitting to the HSTS preload list guarantees TLS-only from the very first request.

**Risk:** Without preload, the first request to your domain can be downgraded by an attacker who strips the HSTS header before it reaches the browser. Users on their first visit are unprotected.

**References:**
- https://datatracker.ietf.org/doc/html/rfc6797
- https://hstspreload.org/

**Fix:**
- Set Strict-Transport-Security with includeSubDomains and max-age >= 31536000.
- Submit to https://hstspreload.org once stable.
- **Nginx** (nginx):
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```
- **Next.js (next.config.mjs)** (javascript):
```javascript
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }],
    }];
  },
};
export default nextConfig;
```

### `tls-cert-san-missing` [tls / high / header]
**Subject Alternative Name (SAN) Missing**

The TLS certificate does not include a Subject Alternative Name (SAN) extension. Modern browsers and APIs only trust certificates that list hostnames in SAN. The legacy CN field is ignored.

**Risk:** A certificate without SAN is treated as untrusted by current browsers and modern TLS libraries, breaking HTTPS for end users with a hard error page.

**Why it matters:** RFC 2818 deprecated the use of Common Name (CN) for hostname verification in favor of the SAN extension. Browsers and libraries that follow the RFC will reject the certificate if SAN is missing, even if CN matches.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5280#section-4.2.1.6
- https://datatracker.ietf.org/doc/html/rfc2818#section-3.1

**Fix:**
- Reissue the certificate with all required hostnames in the SAN extension.
- Use certbot or acme.sh with -d flags to ensure SAN is populated.
- **Inspect SAN** (bash):
```bash
openssl s_client -connect example.com:443 < /dev/null 2>/dev/null | openssl x509 -noout -ext subjectAltName
```
- **Generate CSR with SANs** (bash):
```bash
openssl req -new -key server.key -out server.csr \
  -subj '/CN=example.com' \
  -addext 'subjectAltName=DNS:example.com,DNS:www.example.com'
```

### `tls-cert-key-usage-wrong` [tls / high / header]
**Key Usage Extension Wrong or Absent**

The X.509 certificate does not declare the Key Usage extension with digitalSignature and keyEncipherment as required for TLS server certificates. Wrong or absent Key Usage is rejected by strict TLS verifiers.

**Risk:** TLS libraries and browsers that enforce Key Usage may refuse to negotiate with this certificate, breaking HTTPS for security-conscious clients.

**Why it matters:** X.509 certificates carry a Key Usage extension that declares the cryptographic operations the key is authorized for. TLS server certificates must declare digitalSignature (for ECDHE/DHE key exchange) and/or keyEncipherment (for RSA key exchange).

**References:**
- https://datatracker.ietf.org/doc/html/rfc5280#section-4.2.1.3
- https://datatracker.ietf.org/doc/html/rfc5280#section-4.2.1.12

**Fix:**
- Regenerate the CSR so the CA includes digitalSignature and keyEncipherment in the Key Usage extension.
- Inspect with: openssl x509 -in cert.pem -noout -ext keyUsage,extendedKeyUsage
- **Inspect Key Usage** (bash):
```bash
openssl x509 -in cert.pem -noout -ext keyUsage,extendedKeyUsage
# Expected output includes:
# Key Usage: Digital Signature, Key Encipherment
# Extended Key Usage: TLS Web Server Authentication
```

### `tls-cipher-3des-offered` [tls / high / header]
**3DES Cipher Suite Offered**

Triple DES (3DES / DES-CBC3) is offered as a cipher suite. 3DES is vulnerable to the SWEET32 birthday attack and is slower than modern AEAD ciphers.

**Risk:** Attackers can recover plaintext from long-lived TLS sessions using the SWEET32 birthday-bound attack on 3DES. Sessions carrying authentication or payment data are at risk.

**Why it matters:** 3DES uses 64-bit blocks, which means collisions become likely after 2^32 blocks (~32GB), achievable in hours on a high-bandwidth connection. SWEET32 exploits this to extract plaintext from HTTPS sessions.

**References:**
- https://sweet32.info/
- https://datatracker.ietf.org/doc/html/rfc7465

**Fix:**
- Remove all 3DES cipher strings (DES-CBC3-SHA, ECDHE-RSA-DES-CBC3-SHA) from your cipher list.
- Use only AEAD ciphers: AES-128-GCM, AES-256-GCM, or CHACHA20-POLY1305.
- **Nginx** (nginx):
```nginx
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
```

### `tls-cipher-rc4-offered` [tls / critical / header]
**RC4 Cipher Suite Offered**

RC4 is cryptographically broken and prohibited by RFC 7465. Servers that still offer RC4 expose all sessions to practical plaintext recovery attacks.

**Risk:** Long-term plaintext recovery attacks on RC4 are practical with collected traffic. Session cookies and credentials transmitted over RC4-encrypted sessions can be exfiltrated.

**Why it matters:** RC4 was prohibited by RFC 7465 in 2015. Multiple attacks (Bar Mitzvah, NOMORE) demonstrate practical plaintext recovery within gigabytes of captured ciphertext. No modern client should negotiate RC4, but servers that offer it may do so under downgrade pressure.

**References:**
- https://datatracker.ietf.org/doc/html/rfc7465
- https://www.rc4nomore.com/

**Fix:**
- Remove all RC4 cipher strings (RC4-SHA, ECDHE-RSA-RC4-SHA, etc.) from your cipher configuration.
- Verify removal with: nmap --script ssl-enum-ciphers -p 443 <host>.
- **Nginx: exclude RC4** (nginx):
```nginx
ssl_ciphers HIGH:!RC4:!aNULL:!eNULL:!MD5;
ssl_prefer_server_ciphers on;
```
- **Verify with nmap** (bash):
```bash
nmap --script ssl-enum-ciphers -p 443 example.com | grep -i rc4
```

### `tls-cipher-null-offered` [tls / critical / header]
**NULL Cipher Suite Offered (No Encryption)**

The server offers NULL cipher suites (e.g., TLS_RSA_WITH_NULL_SHA) that provide authentication but zero encryption. All traffic is transmitted in cleartext.

**Risk:** All traffic is transmitted in cleartext despite using TLS. Any on-path observer can read credentials, session tokens, and user data. The TLS handshake provides a false sense of security.

**Why it matters:** NULL cipher suites complete the TLS handshake (including certificate verification and MAC authentication) but encrypt nothing. They exist for testing and debugging, never for production use.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246#appendix-A.5
- https://datatracker.ietf.org/doc/html/rfc8446

**Fix:**
- Explicitly exclude NULL ciphers: ssl_ciphers HIGH:!aNULL:!eNULL:!NULL.
- Verify with: nmap --script ssl-enum-ciphers -p 443 <host>.
- **Nginx: exclude NULL ciphers** (nginx):
```nginx
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:!NULL:!aNULL:!eNULL;
ssl_protocols TLSv1.2 TLSv1.3;
```

### `tls-cipher-export-offered` [tls / critical / header]
**EXPORT-Grade Cipher Suite Offered**

EXPORT cipher suites use intentionally weakened 40/56-bit keys, mandated by US export regulations in the 1990s. Offering them makes the server vulnerable to FREAK and Logjam downgrade attacks.

**Risk:** Attackers can downgrade the session to a 512-bit RSA key (FREAK) or a 512-bit DHE group (Logjam) and factor the key within hours, recovering session secrets.

**Why it matters:** EXPORT ciphers were deliberately weakened for export from the US. Although modern clients do not request them, servers advertising EXPORT ciphers are vulnerable to downgrade: a MITM modifies the ClientHello to advertise only EXPORT ciphers, and a server that accepts them negotiates a weak session.

**References:**
- https://freakattack.com/
- https://weakdh.org/

**Fix:**
- Remove EXPORT from your cipher list: ssl_ciphers !EXPORT.
- Ensure DHE parameters are at least 2048 bits (ssl_dhparam) to also close Logjam.
- **Nginx** (nginx):
```nginx
ssl_ciphers HIGH:!EXPORT:!aNULL:!eNULL:!RC4:!3DES:!MD5;
ssl_dhparam /etc/ssl/dhparam.pem;  # 2048-bit or larger
ssl_protocols TLSv1.2 TLSv1.3;
```
- **Generate 2048-bit DH params** (bash):
```bash
openssl dhparam -out /etc/ssl/dhparam.pem 2048
```

### `tls-cipher-anonymous-dh` [tls / critical / header]
**Anonymous DH Key Exchange Offered**

The server offers anonymous Diffie-Hellman cipher suites (ADH / AECDH) that provide no server authentication. Any on-path attacker can perform a trivial MITM without presenting a certificate.

**Risk:** An attacker can intercept the entire TLS session without detection because anonymous cipher suites complete the handshake without a certificate, defeating the authentication purpose of TLS entirely.

**Why it matters:** Anonymous cipher suites (aNULL) agree on a shared key via DH or ECDH but skip server authentication entirely. The session is encrypted but the client cannot verify who they are talking to, making MITM attacks trivial.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5246#appendix-A.5
- https://datatracker.ietf.org/doc/html/rfc8446

**Fix:**
- Exclude aNULL from cipher lists: ssl_ciphers ... !aNULL:!eNULL.
- Require ECDHE-RSA or ECDHE-ECDSA key exchange with a valid server certificate.
- **Nginx: exclude anonymous ciphers** (nginx):
```nginx
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:!aNULL:!eNULL;
ssl_protocols TLSv1.2 TLSv1.3;
```

### `tls-cert-key-size-ecdsa` [tls / info / header]
**ECDSA Key Size Below P-256**

The TLS certificate uses an ECDSA key on a curve smaller than P-256 (secp256r1). Curves below P-256 provide less than 128-bit equivalent security and should be avoided in new certificates.

**Risk:** Smaller ECDSA curves provide weaker cryptographic guarantees. While not yet practically broken, they offer a smaller security margin than modern recommendations require.

**Why it matters:** NIST recommends P-256 (secp256r1) as the minimum ECDSA curve for new certificates. P-256 provides 128-bit equivalent security. Curves below this (e.g., secp192r1) are considered substandard by modern standards.

**References:**
- https://datatracker.ietf.org/doc/html/rfc8446
- https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final

**Fix:**
- Reissue the certificate using ECDSA P-256 or P-384.
- Inspect the current key: openssl x509 -in cert.pem -noout -text | grep 'Public Key'
- **Generate P-256 ECDSA key** (bash):
```bash
openssl ecparam -genkey -name prime256v1 -out server.key
openssl req -new -key server.key -out server.csr -subj '/CN=example.com'
```
- **Inspect key curve** (bash):
```bash
openssl x509 -in cert.pem -noout -text | grep -A2 'Public Key Algorithm'
```

### `tls-cert-sha1-sig` [tls / medium / header]
**Certificate Signed with SHA-1**

The TLS certificate uses a SHA-1 signature algorithm. SHA-1 has known collision attacks and has been deprecated by browsers and CAs since 2017.

**Risk:** SHA-1 collision attacks allow an attacker to forge a certificate with the same signature as a legitimate one. Browsers display untrusted certificate errors for SHA-1 certificates.

**Why it matters:** In 2017 Google demonstrated a practical SHA-1 collision (SHAttered). All major browsers now reject SHA-1 certificates. CAs stopped issuing SHA-1 certificates, but older intermediate or root certificates may still appear in chains.

**References:**
- https://shattered.io/
- https://datatracker.ietf.org/doc/html/rfc8446

**Fix:**
- Reissue the certificate with SHA-256 or SHA-384 signature algorithm.
- Inspect current algorithm: openssl x509 -in cert.pem -noout -text | grep 'Signature Algorithm'
- **Generate CSR with SHA-256** (bash):
```bash
openssl req -new -sha256 -key server.key -out server.csr -subj '/CN=example.com'
```
- **Inspect signature algorithm** (bash):
```bash
openssl x509 -in cert.pem -noout -text | grep 'Signature Algorithm'
```

### `tls-ct-log-missing` [tls / info / header]
**Certificate Not Submitted to CT Logs**

The TLS certificate does not appear in public Certificate Transparency (CT) logs. CAs are required to submit certificates to CT logs, and browsers enforce CT for publicly trusted certificates issued after 2018.

**Risk:** Certificates not in CT logs may be rejected by Chrome and Safari. More importantly, CT logs are the primary mechanism for detecting misissued certificates targeting your domain.

**Why it matters:** CT log submission is now mandatory for publicly trusted CA certificates. The signed certificate timestamp (SCT) embedded in the certificate or delivered via TLS extension proves the certificate was logged. Without SCTs, modern browsers display an error.

**References:**
- https://certificate.transparency.dev/
- https://datatracker.ietf.org/doc/html/rfc6962

**Fix:**
- Reissue the certificate from a CA that submits to CT logs automatically (all major CAs do this).
- Verify CT inclusion using: curl https://crt.sh/?q=example.com
- **Check CT log inclusion** (bash):
```bash
# Check via crt.sh API
curl -s 'https://crt.sh/?q=example.com&output=json' | jq '.[0] | {logged_at, issuer_name}'
```
- **Inspect SCTs in certificate** (bash):
```bash
openssl x509 -in cert.pem -noout -text | grep -A5 'CT Precertificate SCTs'
```

### `tls-cert-expired-ca-chain` [tls / high / header]
**Expired Certificate in CA Chain**

One or more intermediate or root certificates in the TLS chain have expired. An expired CA certificate in the chain causes strict verifiers to reject the entire chain even if the leaf certificate is still valid.

**Risk:** Browsers and API clients that enforce strict chain validation will refuse connections with an expired intermediate CA, breaking HTTPS for all affected users.

**Why it matters:** TLS chain validation requires every certificate from the leaf to the trust anchor to be within its validity period. If an intermediate CA certificate expires, the full chain is invalid regardless of the leaf certificate's expiry. This commonly happens when an intermediate CA renewed its own certificate but the server was not updated to serve the new chain.

**References:**
- https://datatracker.ietf.org/doc/html/rfc5280#section-6.1
- https://datatracker.ietf.org/doc/html/rfc8446

**Fix:**
- Update the certificate bundle on your server to include the renewed intermediate CA certificate.
- Verify the full chain: openssl verify -CAfile ca-bundle.pem server.crt
- Test the chain from the client perspective: openssl s_client -connect example.com:443 -showcerts
- **Inspect chain expiry** (bash):
```bash
openssl s_client -connect example.com:443 -showcerts < /dev/null 2>/dev/null | \
  openssl storeutl -noout -text /dev/stdin | grep 'Not After'
```
- **Verify chain** (bash):
```bash
openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted chain.pem server.crt
```

---

## Category: vibe-code (37 checks)

### `vibe-generic-error-message` [vibe-code / low / body-pattern]
**Generic Error Messages Leak No Context**

The page responds with a generic catch-all error message (e.g., 'An error occurred', 'Something went wrong'). AI-generated code often wraps all exceptions in a single handler that swallows the real error, making debugging impossible and frustrating legitimate users.

**Risk:** While generic errors are good for security (they don't leak stack traces), they break the user experience and often indicate exception handling that silently discards important errors, including security-relevant ones.

**Why it matters:** AI-generated error handlers commonly produce single catch blocks with vague messages. The real risk is that the underlying exceptions, authentication failures, permission denials, data validation errors, are all treated identically, masking logic bugs and making incident response impossible.

**References:**
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/08-Testing_for_Error_Handling/
- https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html

**Fix:**
- Log the full exception server-side with a correlation ID.
- Return structured errors with a code field: { error: 'VALIDATION_FAILED', code: 400, correlationId: 'abc123' }.
- Distinguish between user-facing messages (safe, vague) and internal logging (full detail).
- Never return the same message for a 400 validation error and a 500 database crash.
- **Bad (AI-generated pattern)** (javascript):
```javascript
try {
  await doSomething();
} catch (err) {
  // AI-generated: swallows all errors identically
  return res.status(500).json({ message: 'An error occurred' });
}
```
- **Better** (typescript):
```typescript
try {
  await doSomething();
} catch (err) {
  const correlationId = crypto.randomUUID();
  console.error('[doSomething]', { correlationId, err });
  if (err instanceof ValidationError) {
    return Response.json({ error: err.message, code: 'VALIDATION_FAILED' }, { status: 400 });
  }
  return Response.json({ error: 'Internal error', correlationId }, { status: 500 });
}
```

### `vibe-todo-security-comment` [vibe-code / medium / body-pattern]
**TODO/FIXME Security Note in Response**

A TODO or FIXME comment referencing security, authentication, authorization, or validation was found in the HTTP response. This indicates unfinished security logic shipped to production.

**Risk:** Shipped TODO comments around security functionality indicate the protection is intentionally incomplete. Attackers scanning for these patterns can identify exactly where to probe for bypasses.

**Why it matters:** AI-assisted development frequently generates skeleton code with TODO stubs for security checks: 'TODO: add authentication', 'FIXME: validate input here', 'TODO: check permissions'. When this reaches production, the security check is absent by design.

**References:**
- https://owasp.org/www-community/vulnerabilities/Leftover_Debug_Code

**Fix:**
- Grep the codebase for TODO/FIXME comments before every release.
- Enforce a lint rule (eslint-plugin-no-unsanitized, custom rules) that flags TODO comments in security-critical paths.
- Complete all security TODOs before shipping; never disable authentication 'temporarily'.
- Add a CI check that fails the build if security-related TODO comments exist in diff.
- **Pattern to catch in CI** (bash):
```bash
# Grep for security TODOs in changed files
git diff origin/main -- '*.ts' '*.js' | grep -i 'TODO.*\(auth\|security\|validate\|permission\|csrf\)'
```

### `vibe-eval-usage` [vibe-code / high / body-pattern]
**eval() Usage Detected**

An eval() call was found in the HTTP response body. eval() executes arbitrary JavaScript strings and is a common AI-generated mistake when dynamically constructing logic.

**Risk:** If any user-controlled data reaches eval(), it enables full JavaScript code execution in the browser or server context. Even when input is not directly user-controlled, eval() breaks static analysis and makes the application unauditable.

**Why it matters:** AI code generators often produce eval() when asked to 'dynamically evaluate' configuration, templates, or expressions. The correct alternative is almost always a lookup table, JSON.parse, or a dedicated expression parser.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval#never_use_eval!
- https://owasp.org/www-community/attacks/Code_Injection

**Fix:**
- Remove all eval() calls. Use JSON.parse() for parsing JSON, Function() only with extreme caution and never with user input.
- Replace dynamic dispatch with an explicit lookup: const handlers = { add: (a,b) => a+b }; handlers[op](x, y).
- Enable eslint's no-eval rule to prevent regressions.
- If server-side: consider vm2 or isolated-vm for sandboxed evaluation, never raw eval().
- **Remove eval: use a lookup table** (javascript):
```javascript
// Bad (AI-generated)
const result = eval(`math.<value>(<value>, <value>)`);

// Good
const ops = { add: (a,b) => a+b, sub: (a,b) => a-b, mul: (a,b) => a*b };
const fn = ops[operation];
if (!fn) throw new Error('Unknown operation');
const result = fn(Number(a), Number(b));
```

### `vibe-disabled-ssl-verify` [vibe-code / high / body-pattern]
**SSL Certificate Verification Disabled**

The response body contains code patterns that disable SSL/TLS certificate verification (rejectUnauthorized: false, verify=False, InsecureRequestWarning). This is a common AI-generated workaround for TLS errors.

**Risk:** Disabling certificate verification makes every HTTPS connection vulnerable to man-in-the-middle attacks. An attacker on the same network can intercept and modify all traffic, including credentials and sensitive data, without detection.

**Why it matters:** When AI tools hit TLS errors during development (self-signed certs, expired certs), they commonly suggest rejectUnauthorized: false or verify=False. This fix works immediately but creates a critical vulnerability if shipped to production.

**References:**
- https://owasp.org/www-community/vulnerabilities/Improper_Certificate_Validation
- https://cwe.mitre.org/data/definitions/295.html

**Fix:**
- Never set rejectUnauthorized: false or verify=False in production code.
- For self-signed certs in development: add the CA cert to NODE_EXTRA_CA_CERTS or requests' ca parameter instead.
- Use proper TLS certificates (Let's Encrypt is free) in staging and production.
- Add a lint rule or pre-commit hook that blocks rejectUnauthorized: false.
- **Fix for Node.js HTTPS** (javascript):
```javascript
// Bad (AI-generated workaround)
const agent = new https.Agent({ rejectUnauthorized: false });

// Good: use proper cert or custom CA
const agent = new https.Agent({
  ca: fs.readFileSync('/path/to/ca.crt'),
});
```

### `vibe-weak-random` [vibe-code / high / body-pattern]
**Math.random() Used for Security Tokens**

Math.random() was found in a context suggesting security token generation (combined with hex encoding or token/id variable names). Math.random() is not cryptographically secure and must not be used for tokens, session IDs, or CSRF values.

**Risk:** Math.random() outputs are predictable given the RNG seed. An attacker who observes any output can reconstruct the seed and predict all past and future values, enabling them to forge tokens, guess session IDs, or predict CSRF values.

**Why it matters:** AI code generators frequently use Math.random().toString(36) or Math.floor(Math.random() * N) for generating IDs and tokens. This is correct for non-security use cases (e.g., animation seeds) but critically wrong for anything security-related.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues
- https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html

**Fix:**
- Use crypto.randomUUID() for UUIDs.
- Use crypto.randomBytes(32).toString('hex') for tokens.
- In browsers, use crypto.getRandomValues() instead of Math.random().
- Never use Math.random() for session IDs, CSRF tokens, password reset tokens, or API keys.
- **Secure token generation** (typescript):
```typescript
// Bad (AI-generated)
const token = Math.random().toString(36).slice(2);

// Good
import { randomBytes } from 'node:crypto';
const token = randomBytes(32).toString('hex'); // 256 bits of entropy
```

### `vibe-placeholder-auth` [vibe-code / critical / body-pattern]
**Hardcoded Credential in Authentication Logic**

A hardcoded credential comparison was detected in the response body. Patterns like password === 'admin', password === 'password', or token === '12345' indicate placeholder authentication logic that was never replaced with real credential verification.

**Risk:** Anyone who reads the source (bundle, source map, or JS file) gets the master credential. This is a complete authentication bypass: the hardcoded value works for every account with no brute force needed.

**Why it matters:** AI tools generate placeholder authentication for scaffolding and examples: 'if (password === "secret") { ... }'. These are intended to be replaced before deployment but frequently are not. They show up in both backend routes and frontend code.

**References:**
- https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password
- https://cwe.mitre.org/data/definitions/798.html

**Fix:**
- Remove all hardcoded credential comparisons immediately.
- Use proper password hashing (bcrypt, argon2) and comparison against stored hashes.
- For API tokens, use constant-time comparison: crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)).
- Rotate any credentials that were ever hardcoded, assuming they are compromised.
- **Secure password verification** (typescript):
```typescript
import bcrypt from 'bcryptjs';

// Bad (AI-generated placeholder)
if (password === 'admin') { ... }

// Good
const user = await db.getUserByEmail(email);
if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
  return Response.json({ error: 'Invalid credentials' }, { status: 401 });
}
```

### `vibe-jwt-none-alg` [vibe-code / critical / body-pattern]
**JWT 'none' Algorithm Accepted**

The response body contains patterns suggesting JWT tokens with the 'none' algorithm may be accepted, or the JWT library is used without explicit algorithm restriction.

**Risk:** The JWT 'none' algorithm attack allows an attacker to forge any JWT payload without knowing the signing key. By setting alg: 'none' and removing the signature, an attacker can impersonate any user including admins.

**Why it matters:** AI-generated JWT verification code often omits the algorithms whitelist parameter. Libraries like jsonwebtoken default to accepting any algorithm unless explicitly restricted. The 'none' algorithm means the token is unsigned and trivially forgeable.

**References:**
- https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/06-Session_Management_Testing/10-Testing_JSON_Web_Tokens

**Fix:**
- Always specify the allowed algorithms explicitly: jwt.verify(token, secret, { algorithms: ['HS256'] }).
- Never accept 'none' as a valid algorithm.
- Upgrade to a well-maintained JWT library and check its default algorithm handling.
- Consider switching to opaque session tokens stored server-side for simpler, safer session management.
- **Safe JWT verification** (typescript):
```typescript
import jwt from 'jsonwebtoken';

// Bad (AI-generated, no algorithm restriction)
const payload = jwt.verify(token, process.env.JWT_SECRET);

// Good
const payload = jwt.verify(token, process.env.JWT_SECRET, {
  algorithms: ['HS256'],  // Explicit whitelist: rejects 'none' and RS256
});
```

### `vibe-sql-string-concat` [vibe-code / critical / body-pattern]
**SQL String Concatenation Pattern Detected**

The response body contains code patterns that construct SQL queries through string concatenation or template literals. This is one of the most common AI-generated vulnerabilities, enabling SQL injection.

**Risk:** SQL injection via string concatenation allows attackers to read arbitrary database contents, bypass authentication, modify or delete data, and potentially execute OS commands depending on the database configuration.

**Why it matters:** AI code generators very commonly produce SQL queries as template literals: SELECT * FROM users WHERE id = ${userId}. This works immediately and looks correct but is fundamentally broken: any user-controlled input in the query enables full SQL injection.

**References:**
- https://owasp.org/www-community/attacks/SQL_Injection
- https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

**Fix:**
- Use parameterized queries exclusively: pool.query('SELECT * FROM users WHERE id = $1', [userId]).
- Use an ORM (Prisma, Drizzle, TypeORM) with parameterized queries by default.
- If you must use raw SQL, validate and sanitize all inputs before interpolation (whitelist IDs as integers, etc.).
- Enable static analysis tools (sqlfluff, eslint-plugin-security) to catch string-concatenated queries.
- **Parameterized query (pg)** (typescript):
```typescript
// Bad (AI-generated SQL injection)
const query = `SELECT * FROM users WHERE email = '<value>'`;
await pool.query(query);

// Good
await pool.query('SELECT * FROM users WHERE email = $1', [email]);
```

### `vibe-expose-stacktrace` [vibe-code / medium / body-pattern]
**Stack Trace Exposed in Response**

A JavaScript or server-side stack trace was found in the HTTP response. AI-generated error handlers frequently pass exception objects directly to the HTTP response, leaking internal file paths, function names, and line numbers.

**Risk:** Stack traces reveal the technology stack, file system structure, library versions, and internal function names. This intelligence accelerates targeted attacks and helps attackers identify exploitable code paths.

**Why it matters:** AI-generated code like res.json({ error: err.message, stack: err.stack }) is common in development but disastrous in production. Even err.message can leak internal details about database schemas, file paths, and logic.

**References:**
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/08-Testing_for_Error_Handling/
- https://cwe.mitre.org/data/definitions/209.html

**Fix:**
- Never include err.stack or err.message in production HTTP responses.
- Log full details server-side with a correlation ID, return only the correlation ID to the client.
- Set NODE_ENV=production: many frameworks suppress detailed errors automatically in production mode.
- Add a global error handler that strips sensitive fields before responding.
- **Safe error response** (typescript):
```typescript
// Bad (AI-generated, leaks internals)
return Response.json({ error: err.message, stack: err.stack }, { status: 500 });

// Good
const correlationId = crypto.randomUUID();
console.error('[api]', { correlationId, error: err });
return Response.json({ error: 'Internal error', correlationId }, { status: 500 });
```

### `vibe-md5-sha1-usage` [vibe-code / high / body-pattern]
**Weak Hashing Algorithm (MD5/SHA-1) Detected**

The response contains code using MD5 or SHA-1 for hashing. These algorithms are cryptographically broken and should not be used for any security purpose including password hashing, token generation, or data integrity.

**Risk:** MD5 and SHA-1 are broken. Collision attacks on SHA-1 are practical (SHAttered attack). For passwords, both algorithms are too fast: billion-hash-per-second GPU cracking makes them trivially reversible given any common password.

**Why it matters:** AI tools frequently suggest md5() or sha1() for 'hashing passwords' or 'generating tokens'. These functions were never designed for password storage and have been cryptographically broken since 2005 (MD5) and 2017 (SHA-1).

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://shattered.io/

**Fix:**
- For password hashing: use bcrypt (cost 12+), argon2id, or scrypt.
- For tokens and IDs: use crypto.randomBytes(32).toString('hex').
- For data integrity/checksums (non-security): SHA-256 is acceptable.
- Migrate existing MD5/SHA-1 password hashes by rehashing on next login.
- **Argon2 password hashing** (typescript):
```typescript
import argon2 from 'argon2';

// Bad (AI-generated)
const hash = crypto.createHash('md5').update(password).digest('hex');

// Good
const hash = await argon2.hash(password, { type: argon2.argon2id });
const valid = await argon2.verify(hash, password);
```

### `vibe-insecure-deserialize` [vibe-code / high / body-pattern]
**Unsafe Deserialization of User Input**

The response body contains patterns of deserializing user-controlled data without schema validation (JSON.parse, eval, node-serialize). Unsafe deserialization is a top OWASP vulnerability class.

**Risk:** Unsafe deserialization can lead to remote code execution, denial of service, or authentication bypass depending on the deserialization library and the shape of attacker-controlled input.

**Why it matters:** AI-generated code commonly pipes request body directly to JSON.parse without validating the structure, type, or content of the result. When combined with libraries that execute code during deserialization (node-serialize, pickle), this enables RCE.

**References:**
- https://owasp.org/www-project-top-ten/2017/A8_2017-Insecure_Deserialization
- https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html

**Fix:**
- Always validate deserialized data against a schema: zod, joi, or ajv.
- Never use node-serialize, PHP unserialize, Python pickle on user data.
- Set type expectations before using: const body = RequestBodySchema.parse(await req.json()).
- Reject unexpected fields with strict schema validation (no passthrough/unknown keys).
- **Zod schema validation** (typescript):
```typescript
import { z } from 'zod';

const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['user', 'admin']).optional(),
});

// Safe
const body = CreateUserSchema.parse(await req.json());
```

### `vibe-http-not-https` [vibe-code / medium / body-pattern]
**Hardcoded HTTP URL in Application**

A hardcoded http:// URL (non-localhost) was found in the response body, indicating the application may make insecure connections to external services or load resources over plaintext HTTP.

**Risk:** HTTP traffic is unencrypted and susceptible to man-in-the-middle attacks, content injection, and eavesdropping. Browsers block mixed content (HTTP resources on HTTPS pages) which also causes silent failures.

**Why it matters:** AI-generated code frequently hardcodes http:// URLs from examples or documentation. While localhost is fine over HTTP, production service URLs, CDN assets, and API endpoints must use HTTPS.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content
- https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html

**Fix:**
- Replace all hardcoded http:// URLs with https://.
- Use environment variables for all external URLs so they can be configured per environment.
- Add a CSP upgrade-insecure-requests directive to automatically upgrade HTTP to HTTPS in the browser.
- Configure your server to redirect HTTP to HTTPS permanently (301).
- **Use environment variables for URLs** (typescript):
```typescript
// Bad (AI-generated)
const apiUrl = 'http://api.example.com/v1';

// Good
const apiUrl = process.env.API_URL; // Set to https://... in all environments
```

### `vibe-predictable-userid` [vibe-code / medium / body-pattern]
**Sequential/Predictable IDs in API Responses**

API responses contain predictable sequential integer IDs for user accounts or resources. This enables IDOR (Insecure Direct Object Reference) enumeration: an attacker can iterate IDs to access any user's data.

**Risk:** Predictable IDs allow attackers to enumerate all resources: change /users/1000 to /users/1001 to access another user's data if the authorization check is absent or weak. This is one of the most common and dangerous patterns in AI-generated CRUD APIs.

**Why it matters:** AI-generated CRUD scaffolding uses integer primary keys and exposes them directly. The correct defense is either UUIDs (random, non-enumerable) or strict per-object authorization checks that verify ownership on every request.

**References:**
- https://owasp.org/www-project-top-ten/2021/A01_2021-Broken_Access_Control
- https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html

**Fix:**
- Use random UUIDs (uuid_generate_v4()) as public-facing IDs instead of sequential integers.
- Add authorization checks on every resource endpoint: verify the requesting user owns or has access to the object.
- Never assume 'the user can only see their own data'; always verify ownership server-side.
- Consider using opaque tokens (base64url of encrypted ID) to hide internal ID structure.
- **UUID primary key in PostgreSQL** (sql):
```sql
-- Use UUIDs instead of SERIAL
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
- **Authorization check on resource access** (typescript):
```typescript
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  const resource = await db.getResource(params.id);
  if (!resource) return notFound();
  if (resource.userId !== session.userId) return forbidden();
  return Response.json(resource);
}
```

### `vibe-missing-csrf` [vibe-code / high / body-pattern]
**Form Missing CSRF Protection**

An HTML form was found without a CSRF token field. AI-generated form scaffolding commonly omits CSRF protection, assuming the developer will add it later.

**Risk:** Without CSRF protection, any website can submit forms on behalf of an authenticated user by tricking them into visiting a malicious page. This enables attackers to change passwords, transfer funds, delete accounts, or perform any privileged action the user can perform.

**Why it matters:** CSRF attacks exploit the browser's automatic inclusion of cookies in cross-origin requests. When a form lacks a CSRF token, a malicious page can create a form that submits to your site and the victim's authenticated session is automatically included.

**References:**
- https://owasp.org/www-community/attacks/csrf
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

**Fix:**
- Add CSRF tokens to all state-changing forms: a cryptographically random value stored in the session and verified on submission.
- Use the SameSite=Strict cookie attribute to prevent cross-origin cookie inclusion.
- For JSON APIs, verify the Content-Type header is application/json (browsers cannot set this cross-origin in forms).
- Use framework CSRF middleware: csurf (Express), Django's CsrfViewMiddleware, Rails' protect_from_forgery.
- **Next.js CSRF with SameSite cookies** (typescript):
```typescript
// Set session cookie with SameSite=Strict
res.setHeader('Set-Cookie', [
  `session=<value>; HttpOnly; Secure; SameSite=Strict; Path=/`
]);

// For forms, include CSRF token
<form method="POST" action="/api/action">
  <input type="hidden" name="_csrf" value={csrfToken} />
  ...
</form>
```

### `vibe-base64-sensitive` [vibe-code / high / body-pattern]
**Base64-Encoded Secret Pattern Detected**

A Base64-encoded string that decodes to a secret, token, or credential pattern was found in the response. AI-generated code sometimes 'encodes' secrets as Base64 under the mistaken impression that encoding is encryption.

**Risk:** Base64 is not encryption; it is trivially reversible. Anyone who sees the encoded value can decode it in seconds. Encoding secrets provides no security protection and creates a false sense of obscurity.

**Why it matters:** AI tools sometimes produce patterns like Buffer.from('username:password').toString('base64') embedded in source code or API responses, believing this 'secures' the credential. It does not; it only obscures it slightly for a human reader, not for any automated system.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

**Fix:**
- Never store credentials as Base64 in source code or responses.
- Use environment variables for all secrets.
- Treat Base64 as transparent encoding, not encryption.
- Rotate any credentials that were ever exposed as Base64 in source code.
- **Correct: environment variables** (typescript):
```typescript
// Bad (AI-generated, Base64 is NOT encryption)
const auth = Buffer.from('admin:password123').toString('base64');

// Good
const auth = Buffer.from(`<value>:<value>`).toString('base64');
```

### `vibe-unrestricted-file-upload` [vibe-code / high / body-pattern]
**File Upload Without Type Validation**

A file upload handler was detected without content-type or extension validation. AI-generated upload scaffolding frequently accepts all file types without restriction, enabling malicious file upload attacks.

**Risk:** Unrestricted file upload allows attackers to upload web shells, malicious executables, or oversized files. If uploaded files are served from the same domain, an attacker can upload an HTML file and steal cookies via XSS.

**Why it matters:** AI tools generate upload handlers that call formData.get('file') and save it without checking the type. The fix requires validating both the declared content type and the actual magic bytes of the file content.

**References:**
- https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload
- https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

**Fix:**
- Validate content-type against an allowed list: ['image/jpeg', 'image/png', 'application/pdf'].
- Validate magic bytes (not just extension): check the first bytes of the file content match the declared type.
- Rename uploaded files; never preserve the original filename.
- Store uploaded files outside the web root or in a separate storage bucket, never serving them from the app domain.
- Enforce file size limits.
- **File upload with type validation** (typescript):
```typescript
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return badRequest('No file');
  if (!ALLOWED_TYPES.includes(file.type)) return badRequest('Invalid file type');
  if (file.size > MAX_SIZE) return badRequest('File too large');
  // Rename to random UUID + validated extension
  const ext = file.type.split('/')[1];
  const filename = `<value>.<value>`;
  // Store in S3/blob storage, not local disk
}
```

### `vibe-template-injection` [vibe-code / high / body-pattern]
**Server-Side Template Injection Risk**

A template rendering function was detected being called with unsanitized user input. Server-side template injection (SSTI) allows attackers to execute arbitrary code on the server by injecting template directives.

**Risk:** SSTI vulnerabilities enable remote code execution. An attacker who can inject into a template can execute OS commands, read environment variables (including secrets), and pivot to other systems.

**Why it matters:** AI tools generate code that passes user input directly to template engines (Handlebars, Nunjucks, EJS, Jinja2). If the template engine evaluates code, the attacker's input becomes server-side code.

**References:**
- https://portswigger.net/web-security/server-side-template-injection
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/18-Testing_for_Server-Side_Template_Injection

**Fix:**
- Never pass user input as the template string itself, only as data to a pre-compiled template.
- Use data interpolation, not template compilation, for user content.
- Enable sandboxing in template engines that support it (Nunjucks sandbox mode).
- Prefer logic-less templates (Mustache) for user-facing rendering.
- **Safe template usage** (javascript):
```javascript
// Bad (AI-generated, user controls the template)
const output = nunjucks.renderString(userInput, data);

// Good: user controls only the data, not the template
const template = nunjucks.render('email/welcome.njk', {
  name: sanitize(userName),
  message: sanitize(userMessage),
});
```

### `vibe-password-in-comment` [vibe-code / high / body-pattern]
**Password or Credential Commented Out in Source**

A commented-out password, secret, or credential was found in the response body. Developers frequently comment out credentials temporarily and forget to remove them before committing.

**Risk:** Commented credentials are permanently stored in git history and exposed in any source distribution. Even if removed later, the credential may be in git history or cached versions of the file.

**Why it matters:** AI code generators sometimes produce example code with commented-out credentials for documentation purposes. These find their way into production builds through bundlers that don't strip comments by default in development mode.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password

**Fix:**
- Remove all commented-out credentials immediately and rotate them.
- Use .env files (gitignored) for credentials in development.
- Configure your bundler to strip all comments in production builds.
- Run git-secrets or truffleHog as a pre-commit hook to prevent credentials from entering git history.
- **Pre-commit credential scan** (bash):
```bash
# Install git-secrets
brew install git-secrets
git secrets --install
git secrets --register-aws

# Or use trufflehog
trufflehog git file://. --since-commit HEAD --only-verified
```

### `vibe-open-redirect` [vibe-code / medium / body-pattern]
**Open Redirect via User-Controlled URL**

A redirect was detected that may use a user-controlled URL parameter without validation. AI-generated authentication flows frequently implement 'redirect after login' with an unvalidated redirect_to or next parameter.

**Risk:** Open redirects enable phishing by forwarding users from your trusted domain to a malicious site. Attackers craft URLs like your-site.com/login?next=http://evil.com to steal credentials or session tokens.

**Why it matters:** AI tools generate login flows with const redirectUrl = searchParams.get('next'); ... redirect(redirectUrl) without validating that the URL stays on the same origin. This is a direct phishing enabler.

**References:**
- https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet
- https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html

**Fix:**
- Validate that redirect URLs are relative paths or match your domain explicitly.
- Reject any redirect URL that starts with http://, https://, //, or contains a @.
- Use a whitelist of allowed redirect destinations.
- For post-login redirects, store the intended URL in the session, not in the URL.
- **Safe redirect validation** (typescript):
```typescript
function isSafeRedirect(url: string): boolean {
  // Reject absolute URLs and protocol-relative URLs
  if (/^(https?:)?\/\//i.test(url)) return false;
  // Only allow paths starting with /
  if (!url.startsWith('/')) return false;
  // Reject paths with protocol-like patterns
  if (url.includes('://') || url.includes('@')) return false;
  return true;
}

const next = searchParams.get('next') ?? '/dashboard';
return redirect(isSafeRedirect(next) ? next : '/dashboard');
```

### `vibe-loose-equality-auth` [vibe-code / low / body-pattern]
**Loose Equality in Authentication Check**

A loose equality comparison (== instead of ===) was detected in what appears to be an authentication or authorization check. In JavaScript, loose equality can produce unexpected coercion results that bypass security checks. Note: this pattern is scanned from client-delivered page scripts, where `role == 'admin'` is most often harmless UI-gating (show/hide an element) rather than the actual server-side authorization decision -- treat this as a prompt to check the real backend logic, not confirmation that a bypass exists.

**Risk:** JavaScript type coercion with == means that '0' == 0 (true), null == undefined (true), and '' == false (true). An authentication check using == instead of === can be bypassed with specially crafted input that evaluates as equal through coercion.

**Why it matters:** AI tools frequently generate authentication checks using == because it looks natural. The canonical bypass is sending JSON with role: 0 instead of role: false, or exploiting array-to-string coercions in role checks.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness
- https://eslint.org/docs/latest/rules/eqeqeq

**Fix:**
- Use === (strict equality) everywhere, especially in security checks.
- Enable eslint's eqeqeq rule to prevent == usage.
- Validate and type-check input with a schema library before comparing.
- Be explicit about types: parseInt(userId, 10) === session.userId.
- **Use strict equality** (typescript):
```typescript
// Bad (AI-generated, loose equality, type coercion risk)
if (user.role == 'admin') { ... }
if (token == expectedToken) { ... }

// Good
if (user.role === 'admin') { ... }
// For secrets: constant-time comparison
if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))) { ... }
```

### `vibe-no-input-validation` [vibe-code / high / body-pattern]
**API Endpoint Missing Input Validation**

An API endpoint appears to process request body data without schema validation. AI-generated API handlers commonly skip input validation, trusting that clients will send well-formed data.

**Risk:** Without input validation, attackers can send malformed data that causes type errors, crashes, database constraint violations, or logic bypasses. Negative numbers, empty strings, excessively long inputs, and unexpected types are common attack vectors.

**Why it matters:** AI tools generate clean-path code that works for valid input. Adversarial inputs (negative price, 10000-character name, null where object expected) are not handled, leading to crashes or unexpected behavior that can be exploited.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- https://owasp.org/www-project-top-ten/2021/A03_2021-Injection

**Fix:**
- Validate all request inputs with a schema library: zod, joi, yup, or typebox.
- Reject unknown fields (strip extra properties or error on them).
- Enforce length limits, type constraints, and business rules at the API boundary.
- Return 400 Bad Request with a structured error for invalid input, never 500.
- **Zod validation for POST endpoint** (typescript):
```typescript
import { z } from 'zod';

const CreateItemSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  price: z.number().positive().finite(),
  quantity: z.number().int().min(0).max(10000),
});

export async function POST(req: Request) {
  const result = CreateItemSchema.safeParse(await req.json());
  if (!result.success) {
    return Response.json({ error: result.error.flatten() }, { status: 400 });
  }
  const { name, price, quantity } = result.data;
  // ... proceed with validated data
}
```

### `vibe-cors-wildcard` [vibe-code / high / body-pattern]
**CORS Wildcard Origin in API Handler**

A CORS wildcard origin (Access-Control-Allow-Origin: *) was found combined with Access-Control-Allow-Credentials: true, or in code that explicitly sets Allow-Origin to *. AI-generated CORS configs frequently use wildcards to 'fix' preflight errors.

**Risk:** Wildcard CORS with credentials allows any website to make authenticated API calls on behalf of the user. This completely undermines same-origin policy and enables attackers to call your API from any domain using the victim's session.

**Why it matters:** AI tools commonly generate res.setHeader('Access-Control-Allow-Origin', '*') to fix CORS errors quickly. This is safe for truly public APIs but catastrophic when combined with cookies or when the endpoint has any authentication.

**References:**
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- https://portswigger.net/web-security/cors

**Fix:**
- Never use * with Access-Control-Allow-Credentials: true (browsers will refuse it anyway).
- Maintain an explicit allowlist of allowed origins.
- Validate the Origin header against the allowlist and reflect it only if it matches.
- For public read-only APIs: * is acceptable if there is no authentication.
- **Safe CORS configuration** (typescript):
```typescript
const ALLOWED_ORIGINS = new Set([
  'https://yourapp.com',
  'https://www.yourapp.com',
]);

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}
```

### `vibe-debug-endpoint` [vibe-code / high / body-pattern]
**Debug or Test Endpoint Exposed in Production**

An internal debug, test, or health-check endpoint was found exposed with diagnostic information. AI-generated applications frequently include /debug, /test, /__health, or /api/debug routes that were never removed before deployment.

**Risk:** Debug endpoints can expose environment variables, database credentials, internal service URLs, memory dumps, query logs, and system information. They are often unauthenticated by design ('it's just for debugging').

**Why it matters:** AI tools generate debugging endpoints for development convenience. These endpoints frequently include environment variable dumps, database connection status, internal configuration, and request/response logging, all invaluable to an attacker.

**References:**
- https://owasp.org/www-community/vulnerabilities/Leftover_Debug_Code
- https://cwe.mitre.org/data/definitions/489.html

**Fix:**
- Remove all debug endpoints before deployment, or gate them behind strong authentication + IP allowlist.
- Use environment-specific middleware to disable debug routes in production.
- Check NODE_ENV === 'production' and return 404 for any debug endpoint.
- Audit all /debug, /test, /info, /status, /__health, /api/test routes.
- **Gate debug endpoints** (typescript):
```typescript
// Only expose in non-production environments
export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not Found', { status: 404 });
  }
  return Response.json({
    env: process.env,
    // debug info...
  });
}
```

### `vibe-mass-assignment` [vibe-code / high / body-pattern]
**Mass Assignment Vulnerability Risk**

An object spread or direct assignment from request body to database model was detected. Mass assignment allows attackers to set unexpected fields (like role, admin, or isVerified) that should not be user-modifiable.

**Risk:** An attacker can POST { 'role': 'admin', 'isVerified': true, 'balance': 99999 } to an endpoint that uses object spread, instantly elevating their account privileges or modifying protected fields.

**Why it matters:** AI-generated CRUD APIs commonly write await db.update({ ...body, id: params.id }), spreading the entire request body into the database operation. This gives the user control over every field in the table.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
- https://owasp.org/www-community/vulnerabilities/Mass_Assignment

**Fix:**
- Explicitly pick only the allowed fields from the request body.
- Use a schema that defines exactly which fields are user-modifiable.
- Never spread the entire request body into a database operation.
- Separate user-modifiable fields from system fields (role, created_at, isVerified) in your schema.
- **Explicit field selection** (typescript):
```typescript
// Bad (AI-generated mass assignment)
await db.updateUser(userId, { ...body });

// Good: only allow specific fields
const { name, bio, website } = body;
await db.updateUser(userId, {
  name: name?.slice(0, 100),
  bio: bio?.slice(0, 500),
  website: validateUrl(website),
});
```

### `vibe-timing-attack-risk` [vibe-code / medium / body-pattern]
**String Comparison Vulnerable to Timing Attacks**

A direct string equality check was found on what appears to be a token, API key, or password comparison. Standard string comparison (===) is not constant-time and leaks information through response timing.

**Risk:** Timing attacks allow an attacker to determine how many characters of a secret they guessed correctly by measuring response time differences. Over many requests, they can reconstruct the full secret character by character.

**Why it matters:** JavaScript string comparison (===) short-circuits on the first mismatched byte. An attacker can send thousands of requests with slightly different tokens, measure average response times, and determine the correct prefix of the secret.

**References:**
- https://codahale.com/a-lesson-in-timing-attacks/
- https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b

**Fix:**
- Use crypto.timingSafeEqual() for all secret comparison operations.
- Ensure both buffers are the same length before comparing (pad or use fixed-length tokens).
- Prefer opaque session tokens validated against a database lookup over direct comparison.
- This matters most for API keys, CSRF tokens, and webhook signatures.
- **Constant-time comparison** (typescript):
```typescript
import { timingSafeEqual } from 'node:crypto';

function verifyToken(provided: string, expected: string): boolean {
  // Ensure equal length to prevent length oracle
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(expected, 'utf8')
  );
}
```

### `vibe-xss-via-innerhtml` [vibe-code / high / body-pattern]
**XSS Risk via innerHTML Assignment**

innerHTML assignment was detected with what may be user-controlled data. Direct innerHTML assignment is a primary XSS vector: AI-generated frontend code frequently uses it to render dynamic content.

**Risk:** Assigning user-controlled HTML to innerHTML allows attackers to inject arbitrary JavaScript that executes in the victim's browser, enabling session hijacking, keylogging, and credential theft.

**Why it matters:** AI-generated frontend code frequently produces patterns like element.innerHTML = userData or element.innerHTML = <p>${serverData}</p>. These are safe only if the value is completely static: any user-controlled content makes them XSS vectors.

**References:**
- https://owasp.org/www-community/attacks/xss/
- https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html

**Fix:**
- Use textContent instead of innerHTML when setting plain text.
- If HTML rendering is required, sanitize with DOMPurify before assignment: element.innerHTML = DOMPurify.sanitize(html).
- Use a Content Security Policy that blocks inline scripts as a defense-in-depth measure.
- In React, avoid dangerouslySetInnerHTML; if needed, always sanitize with DOMPurify first.
- **DOMPurify sanitization** (javascript):
```javascript
import DOMPurify from 'dompurify';

// Bad (AI-generated)
element.innerHTML = userContent;

// Good: sanitize first
element.innerHTML = DOMPurify.sanitize(userContent, {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a'],
  ALLOWED_ATTR: ['href'],
});

// Best: use textContent for plain text
element.textContent = userContent;
```

### `vibe-insecure-cookie-domain` [vibe-code / medium / body-pattern]
**Cookie Set with Overly Broad Domain**

A cookie is being set with a broad domain attribute (e.g., .example.com) that shares it across all subdomains. If any subdomain is compromised or allows user content, this exposes the session to that subdomain.

**Risk:** A cookie scoped to .example.com is accessible from attacker.example.com, staging.example.com, and any other subdomain. A subdomain takeover or user-content subdomain (user.example.com) can steal session cookies from all other subdomains.

**Why it matters:** AI-generated session management often sets cookies with the parent domain for 'SSO across subdomains'. While this has legitimate uses, it significantly expands the attack surface for session theft.

**References:**
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/06-Session_Management_Testing/02-Testing_for_Cookies_Attributes
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#domaindomain-value

**Fix:**
- Scope cookies to the specific domain that needs them unless cross-subdomain sharing is explicitly required.
- For session cookies: prefer Domain=example.com (without dot prefix is fine in modern browsers).
- Audit all subdomains for subdomain takeover risks before setting broad domain cookies.
- Use separate session mechanisms (with separate cookies) for different trust domains.
- **Scoped cookie** (typescript):
```typescript
// Broad (shared across all subdomains)
Set-Cookie: session=...; Domain=.example.com; Secure; HttpOnly

// Scoped (only this host)
Set-Cookie: session=...; Secure; HttpOnly; SameSite=Strict
// Omitting Domain scopes to the exact host
```

### `vibe-no-rate-limit` [vibe-code / high / body-pattern]
**Authentication Endpoint Lacks Rate Limiting**

A login, password reset, or OTP verification endpoint was found without rate limiting headers or logic. AI-generated authentication scaffolding almost never includes rate limiting by default.

**Risk:** Without rate limiting on authentication endpoints, attackers can brute-force passwords, OTPs, and password reset codes at thousands of attempts per second with no throttling or lockout.

**Why it matters:** AI tools generate clean login handlers: validate email, check password, return token. Rate limiting, account lockout, and brute-force protection are rarely included because they require infrastructure decisions (Redis, database) that the AI avoids making.

**References:**
- https://owasp.org/www-community/attacks/Brute_force_attack
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout

**Fix:**
- Add rate limiting to /login, /register, /reset-password, /verify-otp, and all authentication endpoints.
- Implement progressive delay: after 5 failures, slow down responses; after 10, lock the account temporarily.
- Use Redis-backed rate limiting (upstash/ratelimit, ioredis) that works across multiple server instances.
- Return 429 Too Many Requests with a Retry-After header when the limit is exceeded.
- **Upstash rate limiting** (typescript):
```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const loginRateLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '1 m'), // 5 attempts per minute
});

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const { success, reset } = await loginRateLimit.limit(`login:<value>`);
  if (!success) {
    return Response.json({ error: 'Too many attempts' }, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)) },
    });
  }
  // ... proceed with authentication
}
```

### `vibe-path-traversal` [vibe-code / critical / body-pattern]
**Path Traversal Risk in File Operations**

A file system operation was detected using user-controlled input without path sanitization. AI-generated file serving code often constructs file paths directly from URL parameters, enabling directory traversal attacks.

**Risk:** Path traversal (../../../etc/passwd) allows attackers to read arbitrary files on the server including credentials, source code, private keys, and system files. Write operations can overwrite critical system files.

**Why it matters:** AI tools generate file servers: const filePath = path.join('./uploads', params.filename); return fs.readFile(filePath). The filename parameter can contain ../ sequences to escape the uploads directory entirely.

**References:**
- https://owasp.org/www-community/attacks/Path_Traversal
- https://cwe.mitre.org/data/definitions/22.html

**Fix:**
- Resolve the full path and verify it starts with the intended base directory.
- Use path.resolve() and check that the result starts with your allowed base path.
- Sanitize filenames: strip path separators, dots, and special characters.
- Store files with server-generated names (UUIDs) and only look them up by database ID, not filename.
- **Safe file path resolution** (typescript):
```typescript
import path from 'node:path';
import fs from 'node:fs/promises';

const UPLOAD_DIR = path.resolve('./uploads');

async function serveFile(filename: string) {
  const fullPath = path.resolve(UPLOAD_DIR, filename);
  // Ensure the resolved path is inside the allowed directory
  if (!fullPath.startsWith(UPLOAD_DIR + path.sep)) {
    throw new Error('Access denied');
  }
  return fs.readFile(fullPath);
}
```

### `vibe-weak-password-policy` [vibe-code / medium / body-pattern]
**No Password Strength Requirement Enforced**

A password registration or reset handler was found without minimum length or complexity requirements. AI-generated user registration accepts any string as a password, including single characters.

**Risk:** Without password strength requirements, users set trivially guessable passwords ('1', 'a', 'password') that an attacker can crack in seconds with a dictionary attack. Combined with no rate limiting, accounts are trivially compromised.

**Why it matters:** AI registration scaffolding validates that a password field is present and non-empty, but rarely enforces length minimums, complexity requirements, or checks against common password lists.

**References:**
- https://pages.nist.gov/800-63-3/sp800-63b.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#implement-proper-password-strength-controls

**Fix:**
- Enforce a minimum password length of 12 characters (NIST recommends 8 minimum, 64 maximum).
- Check against a list of known-compromised passwords (haveibeenpwned API or zxcvbn).
- Do not enforce complexity rules (uppercase + number + symbol), they reduce actual entropy; length matters more.
- Consider checking the password against the user's name and email.
- **Password validation** (typescript):
```typescript
import zxcvbn from 'zxcvbn';

function validatePassword(password: string, email: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters';
  if (password.length > 128) return 'Password must be under 128 characters';
  const result = zxcvbn(password, [email]);
  if (result.score < 2) return `Password too weak: <value>`;
  return null; // valid
}
```

### `vibe-prototype-pollution` [vibe-code / high / body-pattern]
**Prototype Pollution Vulnerability Risk**

Deep merge or property assignment with user-controlled keys was detected. When user input can set `__proto__`, constructor, or prototype properties, attackers can pollute the JavaScript prototype chain.

**Risk:** Prototype pollution can enable remote code execution, privilege escalation, and denial of service. Attackers can inject properties into Object.prototype that affect all objects in the application, bypassing security checks that rely on undefined properties being falsy.

**Why it matters:** AI tools generate deep merge utilities and Object.assign patterns to merge configuration. When the keys come from user input, an attacker can send { '__proto__': { 'isAdmin': true } } to pollute all objects with isAdmin: true.

**References:**
- https://portswigger.net/web-security/prototype-pollution
- https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html

**Fix:**
- Use Object.create(null) for objects that will receive user-controlled keys.
- Block __proto__, constructor, and prototype keys from user input explicitly.
- Use Map instead of plain objects for user-keyed data.
- Use safe deep merge libraries that protect against prototype pollution (lodash merge with version 4.17.11+).
- **Safe merge with key filtering** (typescript):
```typescript
function safeMerge(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const key of Object.keys(source)) {
    // Block prototype pollution keys
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    target[key] = source[key];
  }
  return target;
}
```

### `vibe-prompt-injection-risk` [vibe-code / medium / body-pattern]
**User Input Concatenated Directly Into an LLM Prompt**

Request-derived data is interpolated directly into an LLM API call's prompt/message content with no visible isolation or sanitization.

**Risk:** An attacker can craft input that overrides the intended system instructions (prompt injection), potentially exfiltrating other users' data, bypassing content policies, or making the model take unintended actions if it has tool access.

**Why it matters:** AI-scaffolded backends commonly template the user's message straight into the prompt string sent to the model. Without structural separation between trusted instructions and untrusted user content, the model has no reliable way to distinguish 'developer instruction' from 'attacker-supplied text masquerading as an instruction'.

**References:**
- https://owasp.org/www-project-top-10-for-large-language-model-applications/

**Fix:**
- Keep user input in its own message role (e.g. the 'user' role) separate from the system prompt, rather than string-templating it into instructions.
- Treat any tool/function-calling output as untrusted and validate before acting on it.
- Apply an output-side check before taking irreversible actions based on model output derived from user text.
- **Keep user content in its own message role** (typescript):
```typescript
const response = await client.messages.create({
  system: 'You are a support assistant. Only answer questions about billing.',
  messages: [{ role: 'user', content: userInput }],
});
// Do not template userInput into the system prompt string
```

### `vibe-llm-api-called-from-client` [vibe-code / high / body-pattern]
**LLM API Called Directly From Client-Side Code**

A client-side script calls the OpenAI or Anthropic API directly via fetch(), instead of proxying the request through a backend endpoint.

**Risk:** Calling the provider API from the browser requires embedding the API key in client-side code, where it is trivially extractable by anyone who views the page source, leading to quota theft and unexpected billing.

**Why it matters:** AI-scaffolded prototypes frequently start with a direct browser-to-provider fetch() call because it's the fastest way to get a demo working, and that call (and the embedded key) ships unchanged to production.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

**Fix:**
- Move the LLM API call to a backend route; the client should call your own API, never the provider's API directly.
- Revoke and reissue any API key that has been exposed in shipped client code.
- Add rate limiting and per-user quotas on your backend proxy endpoint.
- **Proxy through your own backend** (typescript):
```typescript
// Client
await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message }) });

// Server (app/api/chat/route.ts): the API key lives only here
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

### `vibe-weak-file-extension-check` [vibe-code / medium / body-pattern]
**File Upload Validated With filename.includes() Instead of Real Extension Check**

An uploaded file's type is validated with filename.includes('.ext') or filename.indexOf('.ext') rather than checking the actual file extension or MIME type.

**Risk:** A filename like 'evil.jpg.exe' or 'shell.php.jpg' passes an includes()-based check while actually being executable content, letting an attacker upload a malicious file that a naive validator waves through.

**Why it matters:** This is a very common AI-generated validation shortcut: it looks correct against the obvious test case (a file literally named 'photo.jpg') but doesn't anchor the match to the actual extension position, so any filename that merely contains the substring passes.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

**Fix:**
- Extract the actual extension (the substring after the final '.') and compare it against an allowlist exactly.
- Validate the file's real content type via magic-byte/MIME sniffing, not just the filename.
- Store uploaded files outside the web root, or serve them with Content-Disposition: attachment and a randomized name.
- **Validate the actual extension** (javascript):
```javascript
const ALLOWED = new Set(['jpg', 'jpeg', 'png', 'gif']);
const ext = filename.split('.').pop()?.toLowerCase();
if (!ext || !ALLOWED.has(ext)) throw new Error('Invalid file type');
```

### `vibe-client-controlled-price` [vibe-code / high / body-pattern]
**Client-Computed Price Sent Directly to Checkout Endpoint**

A checkout/payment/order request sends an amount/total/price field whose value is read directly from a client-side variable rather than being recomputed server-side.

**Risk:** A user can modify the client-side total (via devtools, a proxy, or by editing the request directly) before it reaches the payment endpoint, paying an arbitrary, attacker-chosen amount for an order.

**Why it matters:** This is one of the most common business-logic flaws in quickly-scaffolded checkout flows: the cart total is computed in the browser for display, and that same computed value is trusted and forwarded as the amount to charge, instead of the server recomputing it from the authoritative cart/product data.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Business_Logic_Security_Cheat_Sheet.html

**Fix:**
- Recompute the order total server-side from trusted product/price data on every checkout request; never trust a client-supplied amount.
- If a client-side total is sent for display/confirmation purposes, explicitly ignore it when creating the actual charge.
- Add an integration test that tampers with the client-sent amount and asserts the charged amount is unaffected.
- **Recompute the total server-side** (typescript):
```typescript
// Ignore any amount sent by the client
const cart = await getCartFromDb(userId);
const total = cart.items.reduce((sum, i) => sum + i.product.priceCents * i.qty, 0);
await charge({ amountCents: total });
```

### `vibe-auth-check-fails-open` [vibe-code / high / body-pattern]
**Auth Check Fails Open on Error**

An authentication check is wrapped in try/catch, and the catch block only logs the error rather than denying access, letting a thrown/rejected auth check silently succeed.

**Risk:** Any condition that causes the auth check to throw (a downed auth service, a malformed token, a timeout) results in the request proceeding as if authentication succeeded, rather than being rejected.

**Why it matters:** Fail-open error handling is a frequent AI-generated code smell: the happy path correctly calls verify()/authenticate(), but the exception path was written purely to avoid an unhandled-rejection crash, without considering that a caught auth failure must still result in denial.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

**Fix:**
- In every auth-check catch block, explicitly deny access (return 401/403) rather than merely logging.
- Write a test that forces the auth check to throw and asserts the request is rejected, not allowed through.
- Prefer a linting rule or code-review checklist item for 'every catch around an auth check must fail closed'.
- **Fail closed on auth errors** (typescript):
```typescript
try {
  await verify(token);
} catch (err) {
  logger.error('auth check failed', err);
  return new Response('Unauthorized', { status: 401 });
}
```

### `vibe-dynamic-import-user-input` [vibe-code / high / body-pattern]
**Dynamic import() Called With Request-Derived Path**

A dynamic import() call's module specifier is built from request params, query, or body data.

**Risk:** Depending on the bundler/runtime, an attacker-controlled import path can load arbitrary local modules (path traversal to unintended code) or, in some Node configurations, fetch and execute a remote module.

**Why it matters:** AI-generated 'plugin loader' or 'dynamic page loader' code sometimes builds the import() specifier directly from a route parameter for convenience, without restricting it to a fixed allowlist of known-safe module names.

**References:**
- https://cheatsheetseries.owasp.org/cheatsheets/Path_Traversal_Cheat_Sheet.html

**Fix:**
- Map the request-derived value to a fixed allowlist of module names/paths instead of interpolating it into the import specifier directly.
- Reject any value containing path traversal sequences or characters outside an expected identifier pattern.
- Prefer a static switch/lookup table over dynamic import() when the set of loadable modules is known in advance.
- **Allowlist instead of dynamic path** (typescript):
```typescript
const MODULES: Record<string, () => Promise<unknown>> = {
  invoice: () => import('./plugins/invoice'),
  receipt: () => import('./plugins/receipt'),
};
const loader = MODULES[req.params.plugin];
if (!loader) throw new Error('Unknown plugin');
const mod = await loader();
```

---
