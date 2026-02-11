import { NextRequest, NextResponse } from "next/server"

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    // Note: 'unsafe-eval' and 'unsafe-inline' required for Next.js to function properly
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
    "script-src-elem 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; "),
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "X-XSS-Protection": "1; mode=block",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  // Remove all server technology disclosure headers
  response.headers.delete("X-Powered-By")
  response.headers.delete("Server")
  response.headers.delete("X-AspNet-Version")
  response.headers.delete("X-AspNetMvc-Version")
  response.headers.delete("X-Runtime")
  response.headers.delete("X-Version")

  return response
}

const PUBLIC_PATHS = [
  // ─── Root & Landing ────────────────────────────────────────────
  "/",
  "/landing",
  "/donate",

  // ─── Authentication Pages ──────────────────────────────────────
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",

  // ─── Authentication API Routes ─────────────────────────────────
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/accept-tos",
  "/api/auth/2fa/verify",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",

  // ─── Legal Pages ───────────────────────────────────────────────
  "/legal/terms",
  "/legal/privacy",
  "/legal/disclaimer",
  "/legal/acceptable-use",

  // ─── Shared Scan Reports ───────────────────────────────────────
  "/shared",
  "/api/shared",

  // ─── Public API Endpoints ──────────────────────────────────────
  "/api/landing-contact",
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie = request.cookies.get("vulnradar_session")

  // Check if path is public (exact match for "/" and "/landing", startsWith for others)
  const isPublicPath = PUBLIC_PATHS.some((p) => {
    if (p === "/" || p === "/landing") {
      return pathname === p
    }
    return pathname.startsWith(p)
  })

  // Allow public paths
  if (isPublicPath) {
    // If logged in and trying to access login/signup, redirect to dashboard
    if (sessionCookie && (pathname === "/login" || pathname === "/signup")) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)))
    }
    // If not logged in and on root, redirect to landing
    if (!sessionCookie && pathname === "/") {
      return applySecurityHeaders(NextResponse.redirect(new URL("/landing", request.url)))
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