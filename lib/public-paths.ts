import { ROUTES, API_V2 } from "./constants"

/**
 * Public paths that don't require authentication
 * Used by middleware and client-side components to determine route access
 */
export const PUBLIC_PATHS = [
  // ─── Root & Landing ────────────────────────────────────────────
  ROUTES.HOME,
  ROUTES.LANDING,
  ROUTES.DONATE,

  // ─── Authentication Pages ──────────────────────────────────────
  ROUTES.LOGIN,
  ROUTES.SIGNUP,
  ROUTES.FORGOT_PASSWORD,
  ROUTES.RESET_PASSWORD,
  ROUTES.VERIFY_EMAIL,

  // ─── Authentication API Routes (v2) ────────────────────────────
  API_V2.AUTH?.LOGIN || "/api/v2/auth/login",
  API_V2.AUTH?.SIGNUP || "/api/v2/auth/signup",
  API_V2.AUTH?.FORGOT_PASSWORD || "/api/v2/auth/forgot-password",
  API_V2.AUTH?.RESET_PASSWORD || "/api/v2/auth/reset-password",
  API_V2.AUTH?.ACCEPT_TOS || "/api/v2/auth/accept-tos",
  API_V2.AUTH?.TWO_FA?.VERIFY || "/api/v2/auth/2fa/verify",
  API_V2.AUTH?.VERIFY_EMAIL || "/api/v2/auth/verify-email",
  API_V2.AUTH?.RESEND_VERIFICATION || "/api/v2/auth/resend-verification",

  // ─── Discord OAuth (must be public for OAuth flow) ─────────────
  "/api/v2/auth/discord",
  "/api/v2/auth/discord/callback",
  
  // ─── 2FA Email (needed for Discord login with email 2FA) ───────
  "/api/v2/auth/2fa/email-send",

  // ─── Legal Pages ───────────────────────────────────────────────
  ROUTES.LEGAL_TERMS,
  ROUTES.LEGAL_PRIVACY,
  ROUTES.LEGAL_DISCLAIMER,
  ROUTES.LEGAL_ACCEPTABLE_USE,

  // ─── Public Information Pages ──────────────────────────────────
  ROUTES.PRICING,
  ROUTES.DOCS,
  ROUTES.CHANGELOG,
  ROUTES.CONTACT,
  ROUTES.GDPR_REQUEST,

  // ─── Public System Endpoints ───────────────────────────────────
  "/api/version",
  "/api/security-txt",

  // ─── Stripe Webhooks (must be public for Stripe to call) ───────
  "/api/v2/webhooks/stripe",
  "/api/v2/stripe/setup-webhook",
  "/api/v2/stripe/setup-products",

  // ─── Shared Scan Reports ───────────────────────────────────────
  "/shared",
  "/api/v2/shared",

  // ─── Public Demo (v2) ──────────────────────────────────────────
  ROUTES.DEMO,
  API_V2.DEMO_SCAN || "/api/v2/demo-scan",

  // ─── Public Staff Page (v2) ────────────────────────────────────
  ROUTES.STAFF,
  API_V2.STAFF || "/api/v2/staff",

  // ─── Public API Endpoints (v2) ─────────────────────────────────
  API_V2.LANDING_CONTACT || "/api/v2/landing-contact",

  // ─── Public Badge Endpoints (v2) ────────────────────────────────
  "/api/v2/badge",

  // ─── Public Finding Types Endpoint (v2) ────────────────────────
  API_V2.FINDING_TYPES || "/api/v2/finding-types",
]
