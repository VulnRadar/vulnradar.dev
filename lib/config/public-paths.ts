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

  // ─── Google/GitHub/Discord sign-in OAuth (must be public: hit by
  // logged-out users, and /info is polled by the login/signup forms
  // before any session exists) ────────────────────────────────────
  "/api/v3/auth/oauth",

  // ─── 2FA Email (needed for Discord login with email 2FA) ───────
  "/api/v3/auth/2fa/email-send",

  // ─── Legal Pages ───────────────────────────────────────────────
  // "/legal" (the bare index) was missing here -- only its sub-pages were
  // listed -- so a logged-out visitor landing on /legal itself got 307'd
  // to /login instead of the page whose whole point is to be public.
  // Prefix-matched below (see middleware.ts), so this one entry also
  // covers every /legal/* sub-page; the individual ones stay listed too
  // rather than being pulled out, to keep this a purely additive fix.
  "/legal",
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

  // ─── SEO Files ───────────────────────────────────────────────────
  // Crawlers (Googlebot etc.) never carry a session cookie. Without
  // these, a request for /sitemap.xml or /robots.txt fell through to
  // the "protect everything else" branch below and 307'd to /login --
  // Search Console then reports the sitemap as "is HTML" because it
  // followed the redirect and got the login page back instead of XML.
  "/sitemap.xml",
  "/robots.txt",

  // ─── Public System Endpoints ───────────────────────────────────
  // Readiness probe. Must be reachable without a session cookie or the
  // container HEALTHCHECK and any upstream load balancer get a 307 to
  // /login and mark the container down.
  "/api/v3/health",
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

  // ─── Public Scans Directory ─────────────────────────────────────
  // Unauthenticated by design (app/public-scans/page.tsx, app/api/v3/
  // public-scans/route.ts) -- same class of bug as the /sitemap.xml and
  // /robots.txt fix above: without these, a logged-out visitor (and
  // Googlebot, since this page is in the sitemap) gets 307'd to /login
  // before ever reaching a page whose entire point is to be public.
  ROUTES.PUBLIC_SCANS,
  "/api/v3/public-scans",

  // ─── Public Demo (v2) ──────────────────────────────────────────
  ROUTES.DEMO,
  API_V2.DEMO_SCAN || "/api/v3/demo-scan",

  // ─── Public API Endpoints (v2) ─────────────────────────────────
  API_V2.LANDING_CONTACT || "/api/v3/landing-contact",

  // ─── Public Badge Endpoints (v2) ────────────────────────────────
  "/api/v3/badge",
  // The BADGE *page* itself (app/badge/page.tsx, where a site owner
  // configures/copies their embed snippet) was missing -- only the API
  // route was listed -- so a logged-out visitor got 307'd to /login
  // before ever seeing it.
  ROUTES.BADGE,

  // ─── Public Avatar Files ────────────────────────────────────────
  // Avatars already render on logged-out surfaces (shared scan reports)
  // whether they're a Discord CDN URL, a Gravatar URL, or now a locally
  // stored file served from here — see app/api/v3/avatar/[userId]/route.ts.
  "/api/v3/avatar",

  // ─── Public Finding Types Endpoint (v2) ────────────────────────
  API_V2.FINDING_TYPES || "/api/v3/finding-types",

  // ─── AI Support Chat ──────────────────────────────────────────
  // /info is public so the widget can show provider name before sign-in.
  // /chat, /context, /conversations require auth (checked inside each
  // route via getSession() returning 401 JSON — not a middleware redirect).
  "/api/v3/ai/info",

  // ─── Email Unsubscribe (token-authenticated, no session needed) ──
  "/unsubscribe",
  "/api/v3/account/unsubscribe",

  // ─── Post-Checkout Confirmation ─────────────────────────────────
  // Stripe redirects here after a successful purchase; the page itself
  // just renders a confirmation, no session needed to see it. Was missing
  // here, so it 307'd to /login instead.
  "/checkout/success",

  // ─── Team Invite Links ───────────────────────────────────────────
  // Invite links are meant to work for people who don't have an account
  // yet -- that's the entire point of an invite. Was missing here, so an
  // invitee without an existing account got 307'd to /login before ever
  // seeing the invite.
  ROUTES.TEAMS_JOIN,

  // ─── Public Host Reports ─────────────────────────────────────────
  // app/host/[hostname]/page.tsx is a public host-report lookup for any
  // hostname string, no session needed. Was missing here entirely.
  "/host",
];
