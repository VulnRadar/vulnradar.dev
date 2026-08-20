import { ROUTES, API_V3 } from "./constants";

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
  API_V3.AUTH.LOGIN,
  API_V3.AUTH.SIGNUP,
  API_V3.AUTH.FORGOT_PASSWORD,
  API_V3.AUTH.RESET_PASSWORD,
  API_V3.AUTH.ACCEPT_TOS,
  API_V3.AUTH.TWO_FA.VERIFY,
  API_V3.AUTH.VERIFY_EMAIL,
  API_V3.AUTH.RESEND_VERIFICATION,

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
  // Human security & responsible-disclosure page (app/security/page.tsx).
  // Must be reachable logged-out: security researchers land here with no
  // session, and it's in the sitemap. Prefix-matched, but no protected
  // route starts with "/security" (the machine-readable /security.txt and
  // /.well-known/security.txt are listed separately below).
  "/security",

  // ─── SEO Content Pages ─────────────────────────────────────────
  // Prefix-matched below, so each entry also covers its sub-routes:
  // /checks (index + /checks/[id] + /checks/category/[category]),
  // /alternatives (index + /alternatives/[competitor]), and /tools
  // (index + /tools/api-scanner + /tools/link-checker). These are in
  // the sitemap and are meant to rank, so a logged-out visitor (and
  // Googlebot, which never carries a session) must reach them instead
  // of being 307'd to /login.
  "/checks",
  "/alternatives",
  "/tools",

  // ─── SEO Files ───────────────────────────────────────────────────
  // Crawlers (Googlebot etc.) never carry a session cookie. Without
  // these, a request for /sitemap.xml or /robots.txt fell through to
  // the "protect everything else" branch below and 307'd to /login --
  // Search Console then reports the sitemap as "is HTML" because it
  // followed the redirect and got the login page back instead of XML.
  "/sitemap.xml",
  "/robots.txt",

  // ─── AEO / GEO Files ─────────────────────────────────────────────
  // llms.txt (llmstxt.org convention) and its detailed companion are the
  // machine-readable site map AI answer engines read. Same reasoning as the
  // SEO files above: an AI crawler carries no session, so without these both
  // paths would 307 to /login and the engine would get the login page back
  // instead of the Markdown map. Listed separately because middleware
  // prefix-matches and "/llms-full.txt" does not start with "/llms.txt".
  "/llms.txt",
  "/llms-full.txt",

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

  // ─── Public Demo ───────────────────────────────────────────────
  ROUTES.DEMO,
  API_V3.DEMO_SCAN,

  // ─── Public API Endpoints ──────────────────────────────────────
  API_V3.LANDING_CONTACT,

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

  // ─── Public Finding Types Endpoint ─────────────────────────────
  API_V3.FINDING_TYPES,

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
