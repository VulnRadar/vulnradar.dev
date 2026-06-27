import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_PATHS } from "./lib/config/public-paths";
import { AUTH_SESSION_COOKIE_NAME, ROUTES } from "./lib/config/constants";

const SECURITY_HEADERS: Record<string, string> = {
  // L-1: CSP tightened to remove the broad `https:` wildcards. We
  // keep only the explicit origins each integration actually needs.
  // Note: 'unsafe-eval' and 'unsafe-inline' are still required for
  // Next.js to function in dev/prod.
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
