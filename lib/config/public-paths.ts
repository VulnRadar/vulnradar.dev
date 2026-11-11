// From client-constants, not constants: middleware.ts imports this module, so
// whatever it pulls in is compiled into the edge bundle, and constants.ts is
// the server superset that reads non-public environment variables
// (AUDIT-012#fe-15).
import { ROUTES } from "./client-constants";

/**
 * Pages a signed-out visitor may open. Used by middleware and by client
 * components that need to know whether the current page is public.
 *
 * Pages only. The API paths that used to be listed here were prefixes
 * ("/api/v3/badge" also made the session routes badge/scans and badge/site
 * public), and middleware applied them before asking which space a path
 * belonged to. Which API paths need no credential is the route registry's
 * question (lib/api/route-registry.ts): exact templates for the new spaces,
 * and LEGACY_PUBLIC_API, the 3.9.1 entries verbatim, for the v3 routes that
 * have not moved yet. tests/lib/config/public-paths.test.ts keeps every
 * "/api" string out of this list.
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
  // The brand kit (app/brand/page.tsx) and its files. Prefix-matched, which
  // is the point: the PNGs and SVGs under public/brand/ skip middleware by
  // the matcher's image-suffix rule, but the ZIP and README.md do not, and
  // without this a signed-out visitor's "Download everything" would be a 307
  // to the login page. No protected route starts with "/brand".
  ROUTES.BRAND,

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

  // ─── Machine-readable files served from the app ─────────────────
  // security.txt: public per RFC 9116, must be reachable without
  // auth so security researchers + scanners can find our disclosure
  // contact. The middleware sees the request URL BEFORE the rewrite,
  // so list both public source paths here (not the internal route).
  "/.well-known/security.txt",
  "/security.txt",
  // Everything below is the same bug this file has now fixed four times: a
  // path meant for a machine, served from the app, that the middleware
  // matcher does not exempt, so an anonymous request is answered with a 307
  // to /login and the machine reads the login page as the document.
  //
  // The PWA manifest, which means no logged-out visitor can install the app
  // and every Lighthouse run scores it as having no manifest.
  "/manifest.webmanifest",
  // The MTA-STS policy. RFC 8461 puts it at mta-sts.<domain>, so this path
  // matters on a deployment that points that subdomain at the app itself,
  // which is the arrangement a self-hoster running one server will have.
  "/.well-known/mta-sts.txt",
  // The GitLab CI template. The docs tell people to reference it with
  // "include: - remote:", and GitLab fetched the login page instead.
  "/gitlab",

  // ─── Shared Scan Reports ───────────────────────────────────────
  "/shared",

  // ─── Public Scans Directory ─────────────────────────────────────
  // Unauthenticated by design (app/public-scans/page.tsx) -- same class of
  // bug as the /sitemap.xml and /robots.txt fix above: without it, a
  // logged-out visitor (and Googlebot, since this page is in the sitemap)
  // gets 307'd to /login before ever reaching a page whose entire point is to
  // be public.
  ROUTES.PUBLIC_SCANS,

  // ─── Public Demo ───────────────────────────────────────────────
  ROUTES.DEMO,

  // ─── Email Unsubscribe (token-authenticated, no session needed) ──
  "/unsubscribe",

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
  // emailed link points at; it is token-authenticated and does not look at
  // the session. Prefix match covers the [token] segment (AUDIT-012#authz-10).
  "/staff-invite",

  // ─── Public Host Reports ─────────────────────────────────────────
  // app/host/[hostname]/page.tsx is a public host-report lookup for any
  // hostname string, no session needed. Was missing here entirely.
  "/host",
];
