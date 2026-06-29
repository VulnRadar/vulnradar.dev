import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_PATHS } from "./lib/config/public-paths";
import { AUTH_SESSION_COOKIE_NAME, ROUTES } from "./lib/config/constants";

const SECURITY_HEADERS: Record<string, string> = {
  // headers: CSP tightened to remove the broad `https:` wildcards.
  // We keep only the explicit origins each integration actually
  // needs. Note: 'unsafe-eval' and 'unsafe-inline' are still
  // required for Next.js to function in dev/prod.
  "Content-Security-Policy": [
    "default-src 'self'",
    // BrowserBase additions for the live-view iframe:
    //   - script/style/font: www.browserbase.com (DevTools frontend)
    //   - img:           www.browserbase.com (icons)
    //   - connect:       api.browserbase.com (REST) + wss://*.browserbase.com (CDP)
    //   - frame:         www.browserbase.com (the embed target)
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://embed.tawk.to https://*.tawk.to https://www.browserbase.com",
    "script-src-elem 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://embed.tawk.to https://*.tawk.to https://www.browserbase.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://embed.tawk.to https://*.tawk.to https://www.browserbase.com",
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://embed.tawk.to https://*.tawk.to https://www.browserbase.com",
    "font-src 'self' https://fonts.gstatic.com https://static.cloudflareinsights.com https://www.browserbase.com",
    "img-src 'self' data: blob: https: https://www.browserbase.com",
    "connect-src 'self' https://challenges.cloudflare.com https://embed.tawk.to https://*.tawk.to wss://*.tawk.to https://va.tawk.to https://static.cloudflareinsights.com https://api.browserbase.com wss://*.browserbase.com",
    "frame-src https://challenges.cloudflare.com https://embed.tawk.to https://*.tawk.to https://www.browserbase.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; "),
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "X-XSS-Protection": "1; mode=block",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

function applySecurityHeaders(response: NextResponse): NextResponse {
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
    return response;
  }
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  // Remove all server technology disclosure headers
  response.headers.delete("X-Powered-By");
  response.headers.delete("Server");
  response.headers.delete("X-AspNet-Version");
  response.headers.delete("X-AspNetMvc-Version");
  response.headers.delete("X-Runtime");
  response.headers.delete("X-Version");

  return response;
}

export function middleware(request: NextRequest) {
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
      );
    }
    // If not logged in and on root, redirect to landing
    if (!sessionCookie && pathname === ROUTES.HOME) {
      return applySecurityHeaders(
        NextResponse.redirect(new URL(ROUTES.LANDING, request.url)),
      );
    }
    return applySecurityHeaders(NextResponse.next());
  }

  // Allow API requests with Bearer tokens (API key auth handled in route)
  const hasBearerToken = request.headers
    .get("authorization")
    ?.startsWith("Bearer ");
  if (hasBearerToken && pathname.startsWith("/api/v3/")) {
    return applySecurityHeaders(NextResponse.next());
  }

  // csrf: enforce CSRF for state-changing requests to the API
  // surface. We require that the request carries an Origin /
  // Referer header matching the app's own origin AND a
  // Sec-Fetch-Site header (when present) that is "same-origin" or
  // "same-site". Without this, a malicious site can submit
  // cross-origin POSTs against VulnRadar on behalf of an
  // authenticated user.
  //
  // Webhooks from Stripe and Discord are exempt — they sign their
  // payloads (see app/api/v3/webhooks/stripe/route.ts and
  // app/api/v3/auth/discord/callback/route.ts). The exempt list
  // below is intentionally narrow: webhook signature verification
  // is the trust boundary for those endpoints, not the Origin header.
  if (pathname.startsWith("/api/v3/") && !isExemptFromCsrf(pathname)) {
    const csrfResponse = enforceCsrf(request);
    if (csrfResponse) {
      return applySecurityHeaders(csrfResponse);
    }
  }

  // Protect everything else - redirect to login if no session
  if (!sessionCookie) {
    const loginUrl = new URL(ROUTES.LOGIN, request.url);
    // Preserve the original destination so we can redirect back after login
    const intended = pathname + request.nextUrl.search;
    if (intended && intended !== ROUTES.DASHBOARD) {
      loginUrl.searchParams.set("redirect", intended);
    }
    return applySecurityHeaders(NextResponse.redirect(loginUrl));
  }

  return applySecurityHeaders(NextResponse.next());
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
 * Self-hosters running curl-based integration tests can set
 * `process.env.SECURITY_ALLOW_NON_BROWSER_API=1` (development only)
 * to skip the check. Production code never sets this.
 */
function enforceCsrf(request: NextRequest): NextResponse | null {
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
