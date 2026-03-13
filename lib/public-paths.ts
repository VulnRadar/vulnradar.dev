import { ROUTES, API, API_V2 } from "./constants"

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

  // ─── Authentication API Routes (v1) ────────────────────────────
  // Removed - v1 API deprecated, use v2 only

  // ─── Authentication API Routes (v2) ────────────────────────────
  API_V2.AUTH.LOGIN,
  API_V2.AUTH.SIGNUP,
  API_V2.AUTH.FORGOT_PASSWORD,
  API_V2.AUTH.RESET_PASSWORD,
  API_V2.AUTH.ACCEPT_TOS,
  API_V2.AUTH.TWO_FA.VERIFY,
  API_V2.AUTH.VERIFY_EMAIL,
  API_V2.AUTH.RESEND_VERIFICATION,

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
  API_V2.DEMO_SCAN,

  // ─── Public Staff Page (v2) ────────────────────────────────────
  ROUTES.STAFF,
  API_V2.STAFF,

  // ─── Public API Endpoints (v2) ─────────────────────────────────
  API_V2.LANDING_CONTACT,

  // ─── Public Badge Endpoints (v2) ────────────────────────────────
  "/api/v2/badge",

  // ─── Public Finding Types Endpoint (v2) ────────────────────────
  API_V2.FINDING_TYPES,
]
