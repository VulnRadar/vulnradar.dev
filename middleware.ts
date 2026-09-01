import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_PATHS } from "./lib/config/public-paths";
import { AUTH_SESSION_COOKIE_NAME, ROUTES } from "./lib/config/constants";
import {
  MAX_REQUEST_BODY_BYTES,
  BODY_CARRYING_METHODS,
} from "./lib/api/request-limits";

/** Server Components read this back via headers() to nonce their own inline scripts. */
const NONCE_HEADER = "x-nonce";

/**
 * Per-request correlation id. Spelled out here rather than imported from
 * lib/database/request-context.ts (which owns the Node-side half) because
 * this file compiles to the edge bundle and that module imports
 * node:async_hooks. Same arrangement as NONCE_HEADER above.
 */
const REQUEST_ID_HEADER = "x-request-id";

/** 128 bits of entropy, base64-encoded -- the standard CSP nonce shape. */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Builds every security header for one request. This used to be a static
 * const object, duplicated (and drifting) between here and next.config.mjs's
 * `headers()` -- now it's the single source of truth, since CSP needs a
 * fresh nonce per request and next.config.mjs's headers() is resolved
 * statically, not per-request.
 *
 * CSP script-src used to carry 'unsafe-inline' 'unsafe-eval', which lets any
 * injected inline script or eval() run regardless of the rest of the
 * policy -- confirmed by a real scan finding. Replaced with a nonce +
 * 'strict-dynamic', verified against every real script source this app
 * actually has:
 *   - Next.js's own framework/hydration scripts and next/script components
 *     (Turnstile's loader in signup-form.tsx, contact-form.tsx,
 *     browser-login.ts): Next.js automatically reads the nonce out of this
 *     header and stamps it on these itself (documented Next.js behavior,
 *     confirmed on 15.5.22) -- no nonce prop-threading needed anywhere else.
 *   - Stripe.js (@stripe/stripe-js's loadStripe() in stripe-checkout.tsx):
 *     injected via document.createElement from our own nonce'd bundle, so
 *     'strict-dynamic' propagates trust to it -- exactly the case
 *     'strict-dynamic' exists for. (js.stripe.com is also now explicitly
 *     allowlisted below as a graceful-degradation fallback -- it was
 *     missing entirely before this change.)
 *   - BrowserBase live-view (app/browser/[id]/page.tsx): a plain
 *     <iframe src=...>, governed by frame-src below, completely unaffected.
 *   - Cloudflare Web Analytics (static.cloudflareinsights.com): not
 *     referenced anywhere in our own code, so if it's injected by
 *     Cloudflare's edge proxy rather than our app, a browser that
 *     understands 'strict-dynamic' ignores the host-source allowlist
 *     entirely for script-src, and this beacon may stop firing. Kept in
 *     the allowlist for older browsers without strict-dynamic support.
 *     Non-functional impact only (analytics, not app behavior) -- worth
 *     confirming empirically rather than blocking this change on it.
 */
/**
 * Opt-out for a deployment that genuinely has no TLS in front of it: a bare
 * LAN install behind a plain-HTTP reverse proxy, which docker-compose.yml
 * documents as supported (HOST_BIND=0.0.0.0) and app/docs/setup tells
 * operators to configure with NEXT_PUBLIC_APP_URL=http://localhost:3000.
 * Without it the middleware 301'd every request to https, the CSP sent
 * `upgrade-insecure-requests` and HSTS pinned the browser to https for two
 * years, so such an install was simply unreachable and stayed unreachable
 * after the mistake was undone.
 *
 * Off by default, so nothing changes for the hosted instance or for any
 * self-host that does terminate TLS. Only set it on a trusted internal
 * network: with it on, traffic to this app is unencrypted and the session
 * cookie travels in the clear.
 */
const ALLOW_INSECURE_HTTP = process.env.ALLOW_INSECURE_HTTP === "1";

function buildSecurityHeaders(nonce: string): Record<string, string> {
  // next dev's webpack runtime (hot reload / fast refresh module loading)
  // calls eval() to evaluate updated modules -- a next-dev-only mechanism,
  // never used by a production build. Without 'unsafe-eval' here, that
  // eval() call is blocked by CSP, main-app.js never finishes initializing,
  // and React never hydrates -- every click on the page silently does
  // nothing. Scoped to non-production so the real, strict policy below is
  // exactly what ships.
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https://challenges.cloudflare.com",
    "https://static.cloudflareinsights.com",
    "https://www.browserbase.com",
    "https://js.stripe.com",
    // Cloudflare's "Email Address Obfuscation" (Scrape Shield) feature
    // injects a small inline bootstrap snippet at the edge -- after this
    // response leaves our server, so it never carries our nonce. Its
    // content is stable enough to allowlist by hash. This does NOT fix the
    // separate /cdn-cgi/scripts/.../email-decode.min.js <script src> tag
    // Cloudflare injects alongside it: under strict-dynamic, host-based
    // allowlisting (even for our own origin) is ignored in favor of
    // nonces/hashes, and Cloudflare doesn't give that external file a
    // matching one. That one only goes away by turning off Email Address
    // Obfuscation in the Cloudflare dashboard (Scrape Shield settings) for
    // this zone -- there's nothing left to fix from this codebase.
    "'sha256-zjP2BXYgSCCnXNMXI2IL1yRydoQdsGR/uCCr6kyKsD0='",
    ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
  ].join(" ");

  // If IPv4 capture is configured, a page on the main origin fetches the
  // IPv4-only echo host (a different subdomain), so it must be allowed in
  // connect-src. Off (empty) unless NEXT_PUBLIC_IPV4_ECHO_URL is set.
  let ipv4EchoOrigin = "";
  try {
    if (process.env.NEXT_PUBLIC_IPV4_ECHO_URL) {
      ipv4EchoOrigin = new URL(process.env.NEXT_PUBLIC_IPV4_ECHO_URL).origin;
    }
  } catch {
    ipv4EchoOrigin = "";
  }

  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      `script-src-elem ${scriptSrc}`,
      // style-src keeps 'unsafe-inline': styled-jsx needs it, and CSS
      // injection is a far weaker primitive than script injection -- not
      // part of this pass.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.browserbase.com",
      "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.browserbase.com",
      "font-src 'self' https://fonts.gstatic.com https://static.cloudflareinsights.com https://www.browserbase.com",
      // avatars.githubusercontent.com/*.googleusercontent.com: the avatar
      // URL OAuth sign-in returns as-is from GitHub/Google (lib/auth/
      // oauth-userinfo.ts) and renders in the profile Social tab and
      // wherever else an OAuth-linked identity's photo shows up.
      "img-src 'self' data: blob: https://www.browserbase.com https://static.cloudflareinsights.com https://cdn.discordapp.com https://www.gravatar.com https://avatars.githubusercontent.com https://*.googleusercontent.com",
      // BrowserBase: the live-view iframe connects to
      // wss://connect.{region}.browserbase.com/. connect-src
      // https://api.browserbase.com is for the popup calling
      // /api/v3/browser/sessions.
      `connect-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://api.browserbase.com wss://*.browserbase.com https://api.stripe.com${
        ipv4EchoOrigin ? ` ${ipv4EchoOrigin}` : ""
      }`,
      // js.stripe.com: Stripe Elements/Checkout renders its card-input and
      // 3DS-challenge UI inside its own iframes -- without it here, the
      // payment form fails to open at all (frame-src blocks the iframe
      // load, independent of script-src already allowing the JS itself).
      "frame-src https://challenges.cloudflare.com https://www.browserbase.com https://js.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      // Would rewrite every same-origin request to https on a deployment that
      // deliberately has no TLS, breaking it. See ALLOW_INSECURE_HTTP.
      ...(ALLOW_INSECURE_HTTP ? [] : ["upgrade-insecure-requests"]),
    ].join("; "),
    // Trusted Types: report-only, not enforced. Enforcing
    // require-trusted-types-for blind risks breaking any third-party
    // script that writes innerHTML internally (Stripe.js, Turnstile) with
    // no way to verify that from source. Report-only surfaces real
    // violations in devtools without breaking anything -- flip this to a
    // real Content-Security-Policy directive once a real browsing session
    // across the app shows zero violations.
    "Content-Security-Policy-Report-Only":
      "require-trusted-types-for 'script'; trusted-types default",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
    "X-Permitted-Cross-Domain-Policies": "none",
    // X-XSS-Protection removed: the browser XSS auditor it controlled was
    // removed from Chrome/Edge and never existed in Firefox. It has no
    // effect in any modern browser; CSP is the real XSS mitigation.
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    // 'unsafe-none': tried 'credentialless' here on the theory that it
    // would load the non-cooperating BrowserBase live-view iframe without
    // credentials instead of blocking it like 'require-corp' does. Real
    // testing in Firefox showed the opposite: the iframe's own
    // devtools-fullscreen/inspector.html got blocked with a
    // Cross-Origin-Resource-Policy error, breaking live browser sessions
    // entirely. Nothing in this app needs cross-origin isolation
    // (SharedArrayBuffer, high-resolution timers), so there is no upside
    // worth a broken feature -- reverted to 'unsafe-none', which is what
    // this app ran with before this was ever touched.
    "Cross-Origin-Embedder-Policy": "unsafe-none",
    "X-DNS-Prefetch-Control": "off",
    // Two years of forced https, remembered by the browser long after the
    // header stops being sent, so it must not go out on a deployment that
    // serves plain HTTP on purpose. See ALLOW_INSECURE_HTTP.
    ...(ALLOW_INSECURE_HTTP
      ? {}
      : {
          "Strict-Transport-Security":
            "max-age=63072000; includeSubDomains; preload",
        }),
    // Monitor-only: no `enforce` (would hard-block a legitimate cert if a
    // CT log had an outage) and no `report-uri` (we have no endpoint to
    // collect those reports). Chrome dropped Expect-CT support entirely in
    // 107 and enforces CT itself on every cert since 2018 regardless, so
    // this header is mostly a signal to older/other clients and scanners
    // that CT was considered, not something actively load-bearing here.
    "Expect-CT": "max-age=86400",
    "Origin-Agent-Cluster": "?1",
    "Document-Policy": "force-load-at-top",
  };
}

function applySecurityHeaders(
  response: NextResponse,
  nonce: string,
  requestId: string,
): NextResponse {
  // Echoed on every response, including the redirects and the 413/403 that
  // never reach a route handler, so the id an operator can see in the
  // browser is the same one system_error_logs recorded. Set before the
  // DISABLE_CSP branch below: this is a correlation id, not a security
  // header, and turning CSP off to debug an embed must not also take away
  // the thing that makes the resulting errors findable.
  response.headers.set(REQUEST_ID_HEADER, requestId);
  // Set DISABLE_CSP=1 in .env.local to ship the app without any
  // security headers. Useful when debugging a third-party embed
  // (BrowserBase, Turnstile, etc.) and you want to confirm whether
  // CSP/CORP/COOP is the blocker. Self-hosters: leave it unset.
  if (process.env.DISABLE_CSP === "1") {
    response.headers.delete("X-Powered-By");
    response.headers.delete("Server");
    response.headers.delete("X-AspNet-Version");
    response.headers.delete("X-AspNetMvc-Version");
    response.headers.delete("X-Runtime");
    response.headers.delete("X-Version");
    response.headers.delete("X-Nextjs-Cache");
    return response;
  }
  for (const [key, value] of Object.entries(buildSecurityHeaders(nonce))) {
    response.headers.set(key, value);
  }
  // Remove all server technology disclosure headers
  response.headers.delete("X-Powered-By");
  response.headers.delete("Server");
  response.headers.delete("X-AspNet-Version");
  response.headers.delete("X-AspNetMvc-Version");
  response.headers.delete("X-Runtime");
  response.headers.delete("X-Version");
  // Next.js's own ISR/SSG cache-state header (HIT/MISS/STALE/BYPASS) --
  // useful for debugging, not for a stranger's browser.
  response.headers.delete("X-Nextjs-Cache");

  return response;
}

export function middleware(request: NextRequest) {
  // A reverse proxy in front of this app (Cloudflare, nginx, Caddy -- see
  // docker-compose.yml) is expected to redirect plain HTTP to HTTPS itself,
  // but not every self-hosted deployment gets that configured. X-Forwarded-
  // Proto reflects what the client actually connected with, trusted the
  // same way requestSelfOrigin() below trusts it -- redirect here as a
  // fallback whenever it explicitly says "http". A no-op for any proxy
  // that already upgrades before forwarding (the request would already be
  // https by the time it reaches here), and for a direct/internal request
  // with no proxy in front at all (no header present, nothing to redirect
  // on).
  // ALLOW_INSECURE_HTTP=1 turns this off for a deployment that has no TLS at
  // all (see the constant's own comment); without an opt-out, such an install
  // was redirected to an https URL that nothing was listening on.
  if (
    !ALLOW_INSECURE_HTTP &&
    request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase() === "http"
  ) {
    const httpsUrl = new URL(request.url);
    httpsUrl.protocol = "https:";
    return NextResponse.redirect(httpsUrl, 301);
  }

  // This used to only be enforced at next.config.mjs build time, which a
  // pre-built Docker image started with a new env var would never
  // re-trigger. Middleware re-evaluates on every request in production, so
  // this is actually a more reliable place for the guard, not just a
  // relocated duplicate.
  if (
    process.env.DISABLE_CSP === "1" &&
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      "DISABLE_CSP=1 is not allowed in production. Remove it from your environment before deploying.",
    );
  }

  const nonce = generateNonce();
  // AUDIT-012#obs-07: one correlation id per request. Generated here, never
  // taken from the inbound header: it is written verbatim into
  // system_error_logs (an admin-facing table) and is what an operator
  // filters on, so letting a caller choose it would let anyone plant
  // arbitrary text there or deliberately collide two unrelated requests.
  // The forwarded REQUEST header below is how it reaches Node route
  // handlers -- middleware runs on the Edge runtime, so there is no shared
  // AsyncLocalStorage to hand it over in (see lib/database/request-context.ts).
  const requestId = crypto.randomUUID();
  // Server Components (app/layout.tsx) read this back via headers() from
  // next/headers to nonce the one raw inline <script> the app renders
  // itself. Requires rewriting the *request* headers, not just the
  // response's -- NextResponse.next({ request: { headers } }) is what
  // actually threads a value through to the server-rendering pass.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  // .set, not .append: this overwrites any x-request-id the client sent, so
  // a route handler can trust the value it reads.
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  // Do NOT also set content-security-policy on requestHeaders. It looks
  // necessary from Next's source (app-render.js reads the REQUEST header and
  // feeds it to getScriptNonceFromHeader), but production disproves it: the
  // live site serves this exact enforcing strict-dynamic policy and Next's
  // own chunk and flight-payload scripts already carry the matching nonce.
  // Verified against https://vulnradar.dev/landing, 73 of 77 script tags
  // nonced; the four without are two ld+json blocks, the app's own inline
  // script, and Cloudflare's edge-injected email-decode.js (the case the
  // sha256 entry in scriptSrc exists for).
  const nextWithNonce = () =>
    NextResponse.next({ request: { headers: requestHeaders } });

  // Normalize pathname: remove trailing slash except for root '/'
  const { pathname: rawPathname } = request.nextUrl;
  const pathname =
    rawPathname.endsWith("/") && rawPathname !== "/"
      ? rawPathname.slice(0, -1)
      : rawPathname;
  const sessionCookie = request.cookies.get(AUTH_SESSION_COOKIE_NAME);

  // Request-body ceiling for the whole API surface. The 1 MiB cap was written
  // down as a security property of this API but was only ever enforced inside
  // parseBody, which 54 of the 73 body-reading routes never call -- the entire
  // scan surface, teams, support tickets, both contact forms and the
  // session-less unsubscribe endpoint read their body raw, with nothing
  // underneath them (Next's App Router has no default body limit, unlike the
  // Pages Router). Any signed-in account could POST an arbitrarily large body
  // to any of them and the process buffered it before a single validation ran.
  // Enforced here, ahead of the CSRF check, so a route cannot opt out by
  // forgetting to call the helper. ref: AUDIT-013#dup-04
  //
  // Content-Length only: middleware cannot measure a chunked body without
  // consuming the stream the route handler still needs. That is not a hole a
  // client picks: dropping the header does not remove the cap parseBody-backed
  // routes still apply, and an unbounded chunked upload is bounded by the
  // reverse proxy every deployment doc puts in front of this app.
  if (
    pathname.startsWith("/api/") &&
    BODY_CARRYING_METHODS.has(request.method.toUpperCase())
  ) {
    const declaredLength = Number.parseInt(
      request.headers.get("content-length") ?? "",
      10,
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_REQUEST_BODY_BYTES
    ) {
      return applySecurityHeaders(
        NextResponse.json(
          {
            error: `Request body exceeds the ${MAX_REQUEST_BODY_BYTES} byte limit.`,
          },
          { status: 413 },
        ),
        nonce,
        requestId,
      );
    }
  }

  // Check if path is public (exact match for "/" and "/landing", startsWith for others)
  const isPublicPath = PUBLIC_PATHS.some((p) => {
    if (p === ROUTES.HOME || p === ROUTES.LANDING) {
      return pathname === p;
    }
    return pathname.startsWith(p);
  });

  const hasBearerToken =
    request.headers.get("authorization")?.startsWith("Bearer ") ?? false;

  // csrf: enforce CSRF for state-changing requests to the API
  // surface. We require that the request carries an Origin /
  // Referer header matching the app's own origin AND a
  // Sec-Fetch-Site header (when present) that is "same-origin" or
  // "same-site". Without this, a malicious site can submit
  // cross-origin POSTs against VulnRadar on behalf of an
  // authenticated user.
  //
  // IMPORTANT: this runs BEFORE the isPublicPath return below, and that
  // ordering is the point. It used to sit after it, which made PUBLIC_PATHS
  // the real exemption list rather than the deliberately narrow
  // isExemptFromCsrf() one: POST /api/v3/auth/login was exempt, so a
  // cross-site text/plain form could post valid JSON to it and log a victim
  // into the attacker's account, and POST /api/v3/badge/site (session
  // authenticated, under the "/api/v3/badge" prefix) was exempt with it
  // (AUDIT-012#auth-04). Nothing in PUBLIC_PATHS needs the exemption: every
  // same-origin fetch from this app carries an Origin header.
  //
  // IMPORTANT: the CSRF check also runs BEFORE the Bearer bypass below.
  // A fake "Authorization: Bearer anything" header must not suppress
  // Origin validation for session-authenticated routes (AUDIT-005#csrf-01).
  // enforceCsrf() is Bearer-aware: true API clients (Bearer + no Origin)
  // are exempted inside that function, not here.
  //
  // Webhooks from Stripe and Discord are exempt because they sign their
  // payloads (see app/api/v3/webhooks/stripe/route.ts and
  // app/api/v3/auth/discord/callback/route.ts). The exempt list
  // below is intentionally narrow: a signature or a bearer secret in the
  // URL is the trust boundary for those endpoints, not the Origin header.
  if (pathname.startsWith("/api/v3/") && !isExemptFromCsrf(pathname)) {
    const csrfResponse = enforceCsrf(request, hasBearerToken);
    if (csrfResponse) {
      return applySecurityHeaders(csrfResponse, nonce, requestId);
    }
  }

  // Allow public paths
  if (isPublicPath) {
    // If logged in and trying to access login/signup, redirect to dashboard
    if (
      sessionCookie &&
      (pathname === ROUTES.LOGIN || pathname === ROUTES.SIGNUP)
    ) {
      return applySecurityHeaders(
        NextResponse.redirect(new URL(ROUTES.DASHBOARD, request.url)),
        nonce,
        requestId,
      );
    }
    // If not logged in and on root, redirect to landing.
    // 308, not NextResponse.redirect's default 307: the arrangement is not
    // temporary, and a temporary redirect tells Google to keep evaluating both
    // "/" and "/landing" as separate URLs instead of consolidating the site's
    // highest-authority URL onto the page that actually serves the content.
    if (!sessionCookie && pathname === ROUTES.HOME) {
      return applySecurityHeaders(
        NextResponse.redirect(new URL(ROUTES.LANDING, request.url), 308),
        nonce,
        requestId,
      );
    }
    return applySecurityHeaders(nextWithNonce(), nonce, requestId);
  }

  // Bearer token requests bypass the session-cookie redirect only —
  // API key auth is handled inside each route handler.
  if (hasBearerToken && pathname.startsWith("/api/v3/")) {
    return applySecurityHeaders(nextWithNonce(), nonce, requestId);
  }

  // Protect everything else - redirect to login if no session
  if (!sessionCookie) {
    const loginUrl = new URL(ROUTES.LOGIN, request.url);
    // Preserve the original destination so we can redirect back after login
    const intended = pathname + request.nextUrl.search;
    if (intended && intended !== ROUTES.DASHBOARD) {
      loginUrl.searchParams.set("redirect", intended);
    }
    return applySecurityHeaders(
      NextResponse.redirect(loginUrl),
      nonce,
      requestId,
    );
  }

  return applySecurityHeaders(nextWithNonce(), nonce, requestId);
}

/**
 * csrf: list of API paths exempt from the CSRF check. Exempt
 * endpoints authenticate the caller some other way (signed payload,
 * server-issued secret, etc.) so the Origin header is not a useful
 * signal. Keep this list narrow — every entry needs a clear
 * non-CSRF trust boundary.
 */
function isExemptFromCsrf(pathname: string): boolean {
  // Stripe webhooks: signed via STRIPE_WEBHOOK_SECRET. Exact path only --
  // NOT a startsWith("/api/v3/webhooks/") prefix, which used to also exempt
  // /api/v3/webhooks/route.ts and /api/v3/webhooks/[id]/route.ts, the
  // user's own session-authenticated webhook list/edit/delete endpoints.
  // Those have no signature to fall back on, so they need the CSRF check
  // like every other session-authenticated route (AUDIT-010#security-03).
  // Discord callback: signed via HMAC-signed state token.
  // Demo scan / version / security-txt: unauthenticated or read-only.
  //
  // Unsubscribe: this is the RFC 8058 One-Click endpoint named in the
  // List-Unsubscribe header of every outgoing message (lib/email/email.ts),
  // so Gmail and Yahoo POST to it from their own servers with no Origin and
  // no cookie. Its credential is the unguessable token in the query string,
  // not the session cookie, which is exactly the case CSRF does not apply to:
  // a cross-site page that does not have the token cannot do anything with
  // this route. Blocking it would break one-click unsubscribe, which is a
  // deliverability and compliance failure, not just a broken link.
  return (
    pathname === "/api/v3/webhooks/stripe" ||
    pathname === "/api/v3/account/unsubscribe" ||
    pathname === "/api/v3/auth/discord/callback" ||
    pathname === "/api/v3/demo-scan" ||
    pathname === "/api/v3/version" ||
    pathname === "/api/security-txt" ||
    pathname === "/.well-known/security.txt" ||
    pathname === "/security.txt"
  );
}

/**
 * csrf: enforce that mutating requests (POST / PUT / PATCH / DELETE)
 * to the API carry an Origin / Referer matching this app and (when
 * present) a same-site Sec-Fetch-Site. Returns a 403 response if
 * the check fails, or null if it passes.
 *
 * hasBearerToken: when true, true API clients (Bearer present, no Origin)
 * are exempted. Browsers always include an Origin on cross-site requests,
 * so Bearer + Origin still goes through the full check (AUDIT-005#csrf-01).
 *
 * Self-hosters running curl-based integration tests can set
 * `process.env.SECURITY_ALLOW_NON_BROWSER_API=1` (development only)
 * to skip the check. Production code never sets this.
 */
function enforceCsrf(
  request: NextRequest,
  hasBearerToken = false,
): NextResponse | null {
  const method = request.method.toUpperCase();
  const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  if (!MUTATING.has(method)) {
    return null;
  }

  if (
    process.env.NODE_ENV !== "production" &&
    process.env.SECURITY_ALLOW_NON_BROWSER_API === "1"
  ) {
    return null;
  }

  const appOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL || "");
  // csrf: NEXT_PUBLIC_APP_URL is a NEXT_PUBLIC_ var, which Next.js inlines
  // into the compiled output at `next build` time -- including here in
  // middleware, a server-only file. .github/workflows/docker-publish.yml
  // builds the published ghcr.io/vulnradar/vulnradar image once with no
  // `--build-arg NEXT_PUBLIC_APP_URL`, so appOrigin above is "" in that
  // image no matter what a self-hoster sets in docker-compose.yml's
  // `environment:` section at container *runtime* -- that value was never
  // part of the build this code was compiled from. Every mutating request
  // (login included) was rejected for every self-hoster following the
  // documented quick start, since `!appOrigin` was always true below.
  // selfOrigin is read fresh from this request's own Host header, which
  // the reverse proxy docker-compose.yml assumes sits in front of the app
  // forwards unmodified by default (nginx/Caddy/Cloudflare Tunnel), so it
  // reflects the real domain on every request regardless of what was true
  // at image build time -- the standard OWASP Origin-vs-Host same-origin
  // check. Kept as an addition to appOrigin, not a replacement, so a
  // self-built image (where build-time and runtime agree) still matches.
  const selfOrigin = requestSelfOrigin(request);

  // Origin header (sent on cross-origin + same-origin fetch/XHR).
  const origin = request.headers.get("origin")?.trim().toLowerCase();
  let requestOrigin: string | null = origin || null;
  if (!requestOrigin) {
    const referer = request.headers.get("referer")?.trim();
    if (referer) {
      try {
        requestOrigin = new URL(referer).origin.toLowerCase();
      } catch {
        requestOrigin = null;
      }
    }
  }

  // True API clients (curl, SDK, server-to-server) send no Origin or
  // Referer. Browsers always include Origin on cross-site requests, so
  // a request with Bearer AND no Origin is a genuine non-browser API
  // call — exempt from CSRF. Bearer + Origin must still be validated
  // because a cross-site page could set a fake Bearer header.
  if (!requestOrigin && hasBearerToken) {
    return null;
  }

  // Browser extensions always send Origin: chrome-extension:// or
  // moz-extension:// — a scheme webpages cannot spoof. Combined with a
  // valid Bearer token (validated by the route handler), this is a
  // legitimate API call from the VulnRadar extension, not a CSRF forgery.
  if (
    hasBearerToken &&
    requestOrigin &&
    (requestOrigin.startsWith("chrome-extension://") ||
      requestOrigin.startsWith("moz-extension://"))
  ) {
    return null;
  }

  if (!requestOrigin) {
    return NextResponse.json(
      {
        error:
          "CSRF check failed: missing both Origin and Referer headers. " +
          "Mutating requests must originate from this site.",
      },
      { status: 403 },
    );
  }

  const originMatchesApp =
    (!!appOrigin && requestOrigin === appOrigin) ||
    (!!selfOrigin && requestOrigin === selfOrigin);
  if (!originMatchesApp) {
    return NextResponse.json(
      {
        error: "CSRF check failed: request origin does not match this app.",
      },
      { status: 403 },
    );
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return NextResponse.json(
      {
        error: `CSRF check failed: Sec-Fetch-Site is ${fetchSite}.`,
      },
      { status: 403 },
    );
  }

  return null;
}

function normalizeOrigin(url: string): string {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * csrf: the origin this request itself arrived on, built from the Host
 * header (falling back to X-Forwarded-Host for a proxy that rewrites Host
 * to an internal upstream name) and X-Forwarded-Proto from the reverse
 * proxy docker-compose.yml assumes is in front of the app. See
 * enforceCsrf's appOrigin comment for why this exists alongside
 * NEXT_PUBLIC_APP_URL instead of replacing it.
 *
 * Trusting these headers unconditionally matches this codebase's existing
 * proxy-trust model (lib/api/request-utils.ts's getClientIp does the same
 * for X-Forwarded-For). It is not a CSRF weakening: a genuine cross-site
 * attack is mediated by the victim's own browser, which sets both Origin
 * and Host truthfully and cannot be scripted to spoof either -- a request
 * with attacker-controlled headers implies direct network access to the
 * app, a strictly worse position than bypassing this check.
 */
function requestSelfOrigin(request: NextRequest): string {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const host =
    forwardedHost || request.headers.get("host")?.trim().toLowerCase();
  if (!host) return "";
  const proto =
    request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase() || request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (e.g. robots.txt)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
