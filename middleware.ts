import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_PATHS } from "./lib/config/public-paths";
import { AUTH_SESSION_COOKIE_NAME, ROUTES } from "./lib/config/constants";

/** Server Components read this back via headers() to nonce their own inline scripts. */
const NONCE_HEADER = "x-nonce";

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
    ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
  ].join(" ");

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
      "img-src 'self' data: blob: https://www.browserbase.com https://static.cloudflareinsights.com https://cdn.discordapp.com https://www.gravatar.com",
      // BrowserBase: the live-view iframe connects to
      // wss://connect.{region}.browserbase.com/. connect-src
      // https://api.browserbase.com is for the popup calling
      // /api/v3/browser/sessions.
      "connect-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://api.browserbase.com wss://*.browserbase.com https://api.stripe.com",
      // js.stripe.com: Stripe Elements/Checkout renders its card-input and
      // 3DS-challenge UI inside its own iframes -- without it here, the
      // payment form fails to open at all (frame-src blocks the iframe
      // load, independent of script-src already allowing the JS itself).
      "frame-src https://challenges.cloudflare.com https://www.browserbase.com https://js.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
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
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Origin-Agent-Cluster": "?1",
    "Document-Policy": "force-load-at-top",
  };
}

function applySecurityHeaders(
  response: NextResponse,
  nonce: string,
): NextResponse {
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
  // Server Components (app/layout.tsx) read this back via headers() from
  // next/headers to nonce the one raw inline <script> the app renders
  // itself. Requires rewriting the *request* headers, not just the
  // response's -- NextResponse.next({ request: { headers } }) is what
  // actually threads a value through to the server-rendering pass.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  const nextWithNonce = () =>
    NextResponse.next({ request: { headers: requestHeaders } });

  // Normalize pathname: remove trailing slash except for root '/'
  const { pathname: rawPathname } = request.nextUrl;
  const pathname =
    rawPathname.endsWith("/") && rawPathname !== "/"
      ? rawPathname.slice(0, -1)
      : rawPathname;
  const sessionCookie = request.cookies.get(AUTH_SESSION_COOKIE_NAME);

  // Check if path is public (exact match for "/" and "/landing", startsWith for others)
  const isPublicPath = PUBLIC_PATHS.some((p) => {
    if (p === ROUTES.HOME || p === ROUTES.LANDING) {
      return pathname === p;
    }
    return pathname.startsWith(p);
  });

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
      );
    }
    // If not logged in and on root, redirect to landing
    if (!sessionCookie && pathname === ROUTES.HOME) {
      return applySecurityHeaders(
        NextResponse.redirect(new URL(ROUTES.LANDING, request.url)),
        nonce,
      );
    }
    return applySecurityHeaders(nextWithNonce(), nonce);
  }

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
  // IMPORTANT: CSRF check runs BEFORE the Bearer bypass below.
  // A fake "Authorization: Bearer anything" header must not suppress
  // Origin validation for session-authenticated routes (AUDIT-005#csrf-01).
  // enforceCsrf() is Bearer-aware: true API clients (Bearer + no Origin)
  // are exempted inside that function, not here.
  //
  // Webhooks from Stripe and Discord are exempt — they sign their
  // payloads (see app/api/v3/webhooks/stripe/route.ts and
  // app/api/v3/auth/discord/callback/route.ts). The exempt list
  // below is intentionally narrow: webhook signature verification
  // is the trust boundary for those endpoints, not the Origin header.
  if (pathname.startsWith("/api/v3/") && !isExemptFromCsrf(pathname)) {
    const csrfResponse = enforceCsrf(request, hasBearerToken);
    if (csrfResponse) {
      return applySecurityHeaders(csrfResponse, nonce);
    }
  }

  // Bearer token requests bypass the session-cookie redirect only —
  // API key auth is handled inside each route handler.
  if (hasBearerToken && pathname.startsWith("/api/v3/")) {
    return applySecurityHeaders(nextWithNonce(), nonce);
  }

  // Protect everything else - redirect to login if no session
  if (!sessionCookie) {
    const loginUrl = new URL(ROUTES.LOGIN, request.url);
    // Preserve the original destination so we can redirect back after login
    const intended = pathname + request.nextUrl.search;
    if (intended && intended !== ROUTES.DASHBOARD) {
      loginUrl.searchParams.set("redirect", intended);
    }
    return applySecurityHeaders(NextResponse.redirect(loginUrl), nonce);
  }

  return applySecurityHeaders(nextWithNonce(), nonce);
}

/**
 * csrf: list of API paths exempt from the CSRF check. Exempt
 * endpoints authenticate the caller some other way (signed payload,
 * server-issued secret, etc.) so the Origin header is not a useful
 * signal. Keep this list narrow — every entry needs a clear
 * non-CSRF trust boundary.
 */
function isExemptFromCsrf(pathname: string): boolean {
  // Stripe webhooks: signed via STRIPE_WEBHOOK_SECRET.
  // Discord callback: signed via HMAC-signed state token.
  // Demo scan / version / security-txt: unauthenticated or read-only.
  return (
    pathname.startsWith("/api/v3/webhooks/") ||
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

  if (!appOrigin || requestOrigin !== appOrigin) {
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
