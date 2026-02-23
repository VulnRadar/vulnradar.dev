import { ROUTES, API } from "./constants"

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

  // ─── Authentication API Routes ─────────────────────────────────
  API.AUTH.LOGIN,
  API.AUTH.SIGNUP,
  API.AUTH.FORGOT_PASSWORD,
  API.AUTH.RESET_PASSWORD,
  API.AUTH.ACCEPT_TOS,
  API.AUTH.TWO_FA.VERIFY,
  API.AUTH.VERIFY_EMAIL,
  API.AUTH.RESEND_VERIFICATION,

  // ─── Legal Pages ───────────────────────────────────────────────
  ROUTES.LEGAL_TERMS,
  ROUTES.LEGAL_PRIVACY,
  ROUTES.LEGAL_DISCLAIMER,
  ROUTES.LEGAL_ACCEPTABLE_USE,

  // ─── Shared Scan Reports ───────────────────────────────────────
  "/shared",
  "/api/shared",

  // ─── Public Demo ────────────────────────────────────────────────
  ROUTES.DEMO,
  API.DEMO_SCAN,

  // ─── Public Staff Page ─────────────────────────────────────────
  ROUTES.STAFF,
  API.STAFF,

  // ─── Public API Endpoints ──────────────────────────────────────
  API.LANDING_CONTACT,

  // ─── Public Badge Endpoints ────────────────────────────────────
  "/api/badge",
]
