import { NextRequest, NextResponse } from "next/server"

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
    "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https:",
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; "),
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "X-XSS-Protection": "1; mode=block",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "on",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  // Remove server info
  response.headers.delete("X-Powered-By")
  response.headers.delete("Server")
  return response
}

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/legal/terms",
  "/legal/privacy",
  "/legal/disclaimer",
  "/legal/acceptable-use",
  "/api/auth/accept-tos",
  "/api/auth/2fa/verify",
  "/shared",
  "/api/shared",
  "/demo",
  "/changelog",
  "/contact",
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie = request.cookies.get("vulnradar_session")

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    // If logged in and trying to access login/signup, redirect to home
    if (sessionCookie && (pathname === "/login" || pathname === "/signup")) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/", request.url)))
    }
    return applySecurityHeaders(NextResponse.next())
  }

  // Allow API scan requests with Bearer tokens (API key auth handled in route)
  if (pathname === "/api/scan" && request.headers.get("authorization")?.startsWith("Bearer ")) {
    return applySecurityHeaders(NextResponse.next())
  }

  // Protect everything else - redirect to login if no session
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url)
    return applySecurityHeaders(NextResponse.redirect(loginUrl))
  }

  return applySecurityHeaders(NextResponse.next())
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
}
