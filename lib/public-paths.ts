/**
 * Public paths that don't require authentication
 * Used by middleware and client-side components to determine route access
 */
export const PUBLIC_PATHS = [
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

  // ─── Public Demo ────────────────────────────────────────────────
  "/demo",
  "/api/demo-scan",

  // ─── Public Staff Page ─────────────────────────────────────────
  "/staff",
  "/api/staff",

  // ─── Public API Endpoints ──────────────────────────────────────
  "/api/landing-contact",
]
