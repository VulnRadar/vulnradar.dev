import { ROUTES, API_V2 } from "./constants";

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
  API_V2.AUTH?.LOGIN || "/api/v3/auth/login",
  API_V2.AUTH?.SIGNUP || "/api/v3/auth/signup",
  API_V2.AUTH?.FORGOT_PASSWORD || "/api/v3/auth/forgot-password",
  API_V2.AUTH?.RESET_PASSWORD || "/api/v3/auth/reset-password",
  API_V2.AUTH?.ACCEPT_TOS || "/api/v3/auth/accept-tos",
  API_V2.AUTH?.TWO_FA?.VERIFY || "/api/v3/auth/2fa/verify",
  API_V2.AUTH?.VERIFY_EMAIL || "/api/v3/auth/verify-email",
  API_V2.AUTH?.RESEND_VERIFICATION || "/api/v3/auth/resend-verification",

  // ─── Discord OAuth (must be public for OAuth flow) ─────────────
  "/api/v3/auth/discord",
  "/api/v3/auth/discord/callback",

  // ─── 2FA Email (needed for Discord login with email 2FA) ───────
  "/api/v3/auth/2fa/email-send",

  // ─── Legal Pages ───────────────────────────────────────────────
  ROUTES.LEGAL_TERMS,
  ROUTES.LEGAL_PRIVACY,
  ROUTES.LEGAL_DISCLAIMER,
  ROUTES.LEGAL_ACCEPTABLE_USE,
  "/legal/dmca",
  "/legal/accessibility",

  // ─── Public Information Pages ──────────────────────────────────
  ROUTES.PRICING,
  ROUTES.DOCS,
  ROUTES.CHANGELOG,
  ROUTES.CONTACT,
  ROUTES.GDPR_REQUEST,

  // ─── Public System Endpoints ───────────────────────────────────
  "/api/version",
  "/api/security-txt",
  // security.txt: public per RFC 9116 — must be reachable without
  // auth so security researchers + scanners can find our disclosure
  // contact. The middleware sees the request URL BEFORE the rewrite,
  // so list both public source paths here (not the internal route).
  "/.well-known/security.txt",
  "/security.txt",

  // ─── Stripe Webhooks (must be public for Stripe to call) ───────
  "/api/v3/webhooks/stripe",
  "/api/v3/stripe/setup-webhook",
  "/api/v3/stripe/setup-products",

  // ─── Shared Scan Reports ───────────────────────────────────────
  "/shared",
  "/api/v3/shared",

  // ─── Public Demo (v2) ──────────────────────────────────────────
  ROUTES.DEMO,
  API_V2.DEMO_SCAN || "/api/v3/demo-scan",

  // ─── Public Staff Page (v2) ────────────────────────────────────
  ROUTES.STAFF,
  API_V2.STAFF || "/api/v3/staff",

  // ─── Public API Endpoints (v2) ─────────────────────────────────
  API_V2.LANDING_CONTACT || "/api/v3/landing-contact",

  // ─── Public Badge Endpoints (v2) ────────────────────────────────
  "/api/v3/badge",

  // ─── Public Finding Types Endpoint (v2) ────────────────────────
  API_V2.FINDING_TYPES || "/api/v3/finding-types",

  // ─── AI Support Chat (available to guests and logged-in users) ──
  "/api/v3/ai/chat",
];
