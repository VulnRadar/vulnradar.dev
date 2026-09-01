// `API` rather than the old API_V3 map: both listed the same routes, but
// API_V3 spelled "/api/v3" out by hand while API builds every entry from
// API_VERSION, so the allowlist now moves with the version instead of
// silently pointing at the old one (AUDIT-014#hc-10).
//
// From client-constants, not constants: middleware.ts imports this module, so
// whatever it pulls in is compiled into the edge bundle, and constants.ts is
// the server superset that reads non-public environment variables
// (AUDIT-012#fe-15). Both names it needs are declared there anyway.
import { ROUTES, API } from "./client-constants";

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

  // ─── Discord OAuth (must be public for OAuth flow) ─────────────
  "/api/v3/auth/discord",
  "/api/v3/auth/discord/callback",

  // ─── Google/GitHub/Discord sign-in OAuth (must be public: hit by
  // logged-out users, and /info is polled by the login/signup forms
  // before any session exists) ────────────────────────────────────
  "/api/v3/auth/oauth",

  // ─── Staff SSO / OIDC ──────────────────────────────────────────
  // Same reasoning as the OAuth entry above, and it was missing entirely,
  // which made the whole staff-SSO mechanism unreachable: all three halves
  // are only ever hit WITHOUT a session. /info is polled by the logged-out
  // login form (lib/hooks/use-staff-oidc.ts) to decide whether to render the
  // "Sign in with SSO" link at all, the bare route is a top-level navigation
  // that starts the flow, and /callback is where the IdP sends the browser
  // back. Each one was 307'd to /login, so the link never rendered, the
  // start URL bounced, and the authorization code was dropped. Prefix
  // match covers /info and /callback.
  "/api/v3/auth/staff-oidc",

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
  // The interactive API explorer now lives at /docs/api/playground, already
  // covered by the ROUTES.DOCS ("/docs") prefix match above, so it needs no
  // entry of its own. It is a tool a logged-out visitor can open; the calls it
  // makes still require the caller's own API key.
  ROUTES.CHANGELOG,
  ROUTES.CONTACT,
  // ROUTES.GDPR_REQUEST used to be listed here and could never match:
  // it is "/legal/privacy#gdpr", and middleware compares against
  // request.nextUrl.pathname, which never carries the fragment (browsers do
  // not send it). Harmless, because the "/legal" prefix entry above already
  // covers /legal/privacy, but an allowlist entry that cannot fire reads as
  // load-bearing to the next person auditing this file (AUDIT-011#drift-24).
  // Do not re-add a ROUTES value with a #fragment or a ?query here.
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
  // IPv4 echo. Must be public: it is fetched credential-less (no session)
  // from the IPv4-only host to observe the caller's own IPv4 for the session
  // list. Without this it 307'd to /login and the capture silently no-op'd.
  // It only ever returns the caller's own IP, so exposing it needs no auth.
  "/api/v3/whoami-ip",
  // OpenAPI spec: a public API description tools import without a session
  // (Postman, Insomnia, an explorer). Without this it 307'd to /login and
  // those tools got the login page back instead of the JSON spec.
  "/api/v3/openapi.json",
  // security.txt: public per RFC 9116, must be reachable without
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
  API.DEMO_SCAN,

  // ─── Public API Endpoints ──────────────────────────────────────
  API.LANDING_CONTACT,
  // The /contact page was listed above but its API was not, so a logged-out
  // visitor's POST from components/contact/contact-form.tsx was 307'd to
  // /login. A 307 preserves the method, so the browser re-POSTed to the
  // /login page route, got a 405, and the form reported a generic failure.
  // The route authenticates nobody by design: it rate-limits on the client
  // IP and gates on Turnstile, exactly like LANDING_CONTACT beside it.
  // /contact is the responsible-disclosure channel named in security.txt,
  // so a researcher's report was landing nowhere.
  API.CONTACT,

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
  // stored file served from here. See app/api/v3/avatar/[userId]/route.ts.
  "/api/v3/avatar",

  // ─── Public Finding Types Endpoint ─────────────────────────────
  API.FINDING_TYPES,

  // ─── AI Support Chat ──────────────────────────────────────────
  // /info is public so the widget can show provider name before sign-in.
  // /chat, /context, /conversations require auth (checked inside each
  // route via getSession() returning 401 JSON, not a middleware redirect).
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

  // ─── Staff Invite Links ──────────────────────────────────────────
  // Exactly the same reasoning as the team invite above, and the same
  // failure: a staff invite is sent to somebody who does not have an
  // account yet, so bouncing them to /login is bouncing them to a form
  // they cannot pass. app/staff-invite/[token]/page.tsx is the page the
  // emailed link points at and app/api/v3/auth/staff-invite/[token] is the
  // route it reads the invite from; both are token-authenticated and
  // neither looks at the session. Prefix match covers the [token] segment
  // (AUDIT-012#authz-10).
  "/staff-invite",
  "/api/v3/auth/staff-invite",

  // ─── Public Host Reports ─────────────────────────────────────────
  // app/host/[hostname]/page.tsx is a public host-report lookup for any
  // hostname string, no session needed. Was missing here entirely.
  "/host",
  // The page was allowlisted but its API was not, so the page loaded and
  // then its own client-side fetch of /api/v3/host/[hostname] (and of the
  // /trend child that feeds components/host/danger-score-trend.tsx) was
  // 307'd to /login. fetch follows the redirect, so res.ok was true, the
  // login page's HTML failed to parse as JSON, and every logged-out
  // visitor and crawler saw "Could not load this host's report." Both
  // routes document themselves as public. Prefix match covers /trend.
  "/api/v3/host",
];
