import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { PUBLIC_PATHS } from "./lib/config/public-paths";
import { AUTH_SESSION_COOKIE_NAME, ROUTES, API } from "./lib/config/constants";
import { SOCIAL_REDIRECTS } from "./lib/config/client-constants";
import { CONFIG_API_SUPPORTED_VERSIONS } from "./lib/config/config-values";
import { RETIRED_CHECK_REDIRECTS } from "./lib/seo/retired-checks";
import { parseBearer } from "./lib/api/bearer";
import { buildError, type ErrorSpace } from "./lib/api/error-envelope";
import type { ErrorCode } from "./lib/api/error-codes";
import { FROZEN } from "./lib/api/frozen-paths";
import { aliasRewrite } from "./lib/api/rewrite";
import {
  INTERNAL_MAINTENANCE,
  PREFIX,
  isLegacyPublicApi,
  matchTemplate,
  matchV4,
  resolveApiPath,
  type Resolved,
} from "./lib/api/route-registry";
import { API_VERSION_HEADER, type ApiMarker } from "./lib/api/versions";
import {
  MAX_REQUEST_BODY_BYTES,
  BODY_CARRYING_METHODS,
} from "./lib/api/request-limits";

/** Server Components read this back via headers() to nonce their own inline scripts. */
const NONCE_HEADER = "x-nonce";

/**
 * Per-request correlation id. Spelled out here rather than imported from
 * lib/database/request-context.ts (which owns the Node-side half) because
 * this file compiles to the edge bundle and that module imports
 * node:async_hooks. Same arrangement as NONCE_HEADER above.
 */
const REQUEST_ID_HEADER = "x-request-id";

/** 128 bits of entropy, base64-encoded -- the standard CSP nonce shape. */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Builds every security header for one request. This used to be a static
 * const object, duplicated (and drifting) between here and next.config.mjs's
 * `headers()` -- now it's the single source of truth, since CSP needs a
 * fresh nonce per request and next.config.mjs's headers() is resolved
 * statically, not per-request.
 *
 * CSP script-src used to carry 'unsafe-inline' 'unsafe-eval', which lets any
 * injected inline script or eval() run regardless of the rest of the
 * policy -- confirmed by a real scan finding. Replaced with a nonce +
 * 'strict-dynamic', verified against every real script source this app
 * actually has:
 *   - Next.js's own framework/hydration scripts and next/script components
 *     (Turnstile's loader in signup-form.tsx, contact-form.tsx,
 *     browser-login.ts): Next.js automatically reads the nonce out of this
 *     header and stamps it on these itself (documented Next.js behavior,
 *     which the Self-host CI job's nonce probe,
 *     scripts/ci/next16-runtime-probes.mjs, checks on every build) -- no
 *     nonce prop-threading needed anywhere else.
 *   - Stripe.js (@stripe/stripe-js's loadStripe() in stripe-checkout.tsx):
 *     injected via document.createElement from our own nonce'd bundle, so
 *     'strict-dynamic' propagates trust to it -- exactly the case
 *     'strict-dynamic' exists for. (js.stripe.com is also now explicitly
 *     allowlisted below as a graceful-degradation fallback -- it was
 *     missing entirely before this change.)
 *   - BrowserBase live-view (app/browser/[id]/page.tsx): a plain
 *     <iframe src=...>, governed by frame-src below, completely unaffected.
 *   - Cloudflare Web Analytics (static.cloudflareinsights.com): not
 *     referenced anywhere in our own code, so if it's injected by
 *     Cloudflare's edge proxy rather than our app, a browser that
 *     understands 'strict-dynamic' ignores the host-source allowlist
 *     entirely for script-src, and this beacon may stop firing. Kept in
 *     the allowlist for older browsers without strict-dynamic support.
 *     Non-functional impact only (analytics, not app behavior) -- worth
 *     confirming empirically rather than blocking this change on it.
 */
/**
 * Opt-out for a deployment that genuinely has no TLS in front of it: a bare
 * LAN install behind a plain-HTTP reverse proxy, which docker-compose.yml
 * documents as supported (HOST_BIND=0.0.0.0) and app/docs/setup tells
 * operators to configure with NEXT_PUBLIC_APP_URL=http://localhost:3000.
 * Without it the middleware 301'd every request to https, the CSP sent
 * `upgrade-insecure-requests` and HSTS pinned the browser to https for two
 * years, so such an install was simply unreachable and stayed unreachable
 * after the mistake was undone.
 *
 * Off by default, so nothing changes for the hosted instance or for any
 * self-host that does terminate TLS. Only set it on a trusted internal
 * network: with it on, traffic to this app is unencrypted and the session
 * cookie travels in the clear.
 */
const ALLOW_INSECURE_HTTP = process.env.ALLOW_INSECURE_HTTP === "1";

/**
 * The path the request arrived on, forwarded to Server Components. Same
 * arrangement as NONCE_HEADER: app/layout.tsx needs it to decide whether the
 * maintenance gate applies to this page, and a Server Component has no other
 * way to read its own URL. Overwritten with .set on every request, never
 * appended, so a handler can trust it.
 */
const PATHNAME_HEADER = "x-pathname";

/**
 * Break-glass maintenance mode.
 *
 * The real switch is the MAINTENANCE_MODE registry setting, enforced in
 * app/layout.tsx and lib/admin/service-state.ts. This file cannot read it:
 * middleware compiles to the Edge bundle and the settings resolver imports
 * node-postgres.
 *
 * So this is the other half, and it is the half that matters in the
 * situation that motivated the switch. When the database is down, the admin
 * panel is unreachable, no setting can be written, and every page render
 * fails: the app cannot serve a maintenance page from Node because it cannot
 * boot far enough to know it should. An environment variable read at the
 * edge has none of those dependencies.
 *
 * `=== "true"` and nothing else, because the registry's bool schema accepts
 * exactly "true"/"false". Spelling it MAINTENANCE_MODE=1 here while
 * getSetting("MAINTENANCE_MODE") ignored the same value would be a switch
 * that half works, which is worse than one that does not.
 */
function maintenanceEnvEnabled(): boolean {
  return process.env.MAINTENANCE_MODE === "true";
}

/**
 * Pages that stay reachable while maintenance is on.
 *
 * The route back in: /login lets a staff member sign in, /admin lets them
 * turn this off (or, since the break-glass form is an environment variable,
 * confirm the database is back before removing it). /_next serves the chunks
 * those two pages are made of, so without it they render blank. The API half
 * of the list is the registry's (isApiMaintenanceAllowed).
 */
const MAINTENANCE_ALWAYS_ALLOWED_PAGES = [
  "/.well-known/security.txt",
  "/security.txt",
  "/login",
  "/admin",
  "/_next",
  "/manifest.webmanifest",
  "/robots.txt",
] as const;

const MAINTENANCE_MESSAGE =
  "This service is down for maintenance. Nothing has been lost, and it will be back shortly.";

/** Seconds a client is asked to wait before trying a paused deployment again. */
const MAINTENANCE_RETRY_AFTER = 300;

function underSegment(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Whether an API request stays up during break-glass maintenance, judged on
 * the path that decides it, so an old alias behaves exactly like its target.
 *
 * The health endpoint is the load-bearing row: a container orchestrator that
 * gets a 503 from its readiness probe restarts the container, so a
 * maintenance page that covered it would put the deployment into a restart
 * loop for as long as maintenance lasted. It is one of the permalinks flagged
 * `maintenance`, beside the three sign-in callbacks, the version and
 * security.txt. The Stripe webhook and the unsubscribe link are not: they get
 * the 503 and its Retry-After, which both senders honour by trying again.
 *
 * The auth and admin trees are the staff way back in. A legacy v3 path is
 * judged by the same two segments under /api/v3, which is the 3.9.1 list.
 */
function isApiMaintenanceAllowed(r: Resolved, decisionPath: string): boolean {
  if (r.kind === "permalink") return r.link.maintenance === true;
  const base =
    r.kind === "legacy-v3"
      ? PREFIX.V3
      : r.kind === "internal" || (r.kind === "alias" && r.target === "internal")
        ? PREFIX.INTERNAL
        : null;
  if (base === null) return false;
  const tail = decisionPath.slice(base.length);
  return INTERNAL_MAINTENANCE.some((prefix) => underSegment(tail, prefix));
}

function isMaintenanceAllowed(r: Resolved, decisionPath: string): boolean {
  return r.kind === "page"
    ? MAINTENANCE_ALWAYS_ALLOWED_PAGES.some((p) =>
        underSegment(decisionPath, p),
      )
    : isApiMaintenanceAllowed(r, decisionPath);
}

/**
 * The maintenance page. Hand-written HTML rather than a rewrite to a page,
 * because a rewrite renders through app/layout.tsx, and the break-glass form
 * exists precisely for the case where rendering is what is broken. Styled
 * inline for the same reason: it must not depend on a stylesheet chunk being
 * served.
 */
function maintenancePageResponse(): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Down for maintenance</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fafafa;font-family:ui-sans-serif,system-ui,sans-serif"><main style="max-width:28rem;padding:1rem;text-align:center"><p style="font-family:ui-monospace,monospace;font-size:3.75rem;font-weight:600;margin:0">503</p><h1 style="font-size:1.125rem;font-weight:600;margin:0.75rem 0">Down for maintenance</h1><p style="font-size:0.875rem;line-height:1.6;color:#a1a1aa;margin:0">This service is down for maintenance. Nothing has been lost, and it will be back shortly.</p></main></body></html>`;
  return new NextResponse(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(MAINTENANCE_RETRY_AFTER),
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The admin panel's MAINTENANCE_MODE registry switch, as far as middleware can
 * know it.
 *
 * app/layout.tsx enforces the switch by rendering the maintenance screen in
 * place of the page, but a layout cannot change the status, so a crawl during
 * maintenance read a 200 carrying that page's own title, canonical and
 * robots, and indexed the maintenance text as the page. Only middleware can
 * answer 503, and middleware cannot read the registry: it compiles to the
 * edge bundle and the settings resolver imports node-postgres. Running
 * middleware on the Node runtime instead would put the database pool in front
 * of every request and invalidate what the routing spike measured about
 * rewrites, so the switch is read the way any other client reads it, from the
 * public client-config route, and kept for a few seconds.
 *
 * The answer is shared by every visitor, so it is fetched from a fixed
 * origin: this server's own loopback port, never the request's Host or
 * X-Forwarded-Host, which a client chooses. X-Forwarded-Proto is set because
 * Next fills in "http" for a direct request and the plain-HTTP redirect above
 * would otherwise answer the probe with a 301.
 *
 * Stale-while-revalidate: a request never waits for the probe. The first
 * anonymous page after the cache goes stale starts one refresh (in flight at
 * most once) and is answered from the previous value, so the switch takes
 * effect within a few seconds and a slow or dead app server costs nothing but
 * the 503. Any failure reads as off; the environment break-glass is the form
 * for a database that is down, and the layout still gates the page body.
 */
const REGISTRY_MAINTENANCE_TTL_MS = 5_000;
const REGISTRY_MAINTENANCE_TIMEOUT_MS = 2_000;

let registryMaintenance: { on: boolean; checkedAt: number } | null = null;
let registryMaintenanceProbe: Promise<void> | null = null;

function refreshRegistryMaintenance(): Promise<void> {
  if (registryMaintenanceProbe) return registryMaintenanceProbe;
  const origin = `http://127.0.0.1:${process.env.PORT || "3000"}`;
  registryMaintenanceProbe = (async () => {
    let on = false;
    try {
      const res = await fetch(`${origin}${API.CONFIG_CLIENT}`, {
        cache: "no-store",
        headers: { "x-forwarded-proto": "https" },
        signal: AbortSignal.timeout(REGISTRY_MAINTENANCE_TIMEOUT_MS),
      });
      if (res.ok) {
        const body = (await res.json()) as { maintenance?: unknown } | null;
        on = body?.maintenance === true;
      }
    } catch {
      // Unreachable, slow or not JSON: off, as the comment above explains.
    }
    registryMaintenance = { on, checkedAt: Date.now() };
  })().finally(() => {
    registryMaintenanceProbe = null;
  });
  return registryMaintenanceProbe;
}

function registryMaintenanceOn(event: NextFetchEvent | undefined): boolean {
  const cached = registryMaintenance;
  const age = cached ? Date.now() - cached.checkedAt : Infinity;
  // A negative age is a clock that went backwards; refresh rather than trust it.
  if (age < 0 || age >= REGISTRY_MAINTENANCE_TTL_MS) {
    const probe = refreshRegistryMaintenance();
    event?.waitUntil(probe);
  }
  return cached?.on === true;
}

function buildSecurityHeaders(nonce: string): Record<string, string> {
  // next dev's bundler runtime (hot reload / fast refresh module loading)
  // may call eval() to evaluate updated modules -- a next-dev-only mechanism,
  // never used by a production build. Without 'unsafe-eval' here, that
  // eval() call is blocked by CSP, main-app.js never finishes initializing,
  // and React never hydrates -- every click on the page silently does
  // nothing. Scoped to non-production so the real, strict policy below is
  // exactly what ships.
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https://challenges.cloudflare.com",
    "https://static.cloudflareinsights.com",
    "https://www.browserbase.com",
    "https://js.stripe.com",
    // Cloudflare's "Email Address Obfuscation" (Scrape Shield) feature
    // injects a small inline bootstrap snippet at the edge -- after this
    // response leaves our server, so it never carries our nonce. Its
    // content is stable enough to allowlist by hash. This does NOT fix the
    // separate /cdn-cgi/scripts/.../email-decode.min.js <script src> tag
    // Cloudflare injects alongside it: under strict-dynamic, host-based
    // allowlisting (even for our own origin) is ignored in favor of
    // nonces/hashes, and Cloudflare doesn't give that external file a
    // matching one. That one only goes away by turning off Email Address
    // Obfuscation in the Cloudflare dashboard (Scrape Shield settings) for
    // this zone -- there's nothing left to fix from this codebase.
    "'sha256-zjP2BXYgSCCnXNMXI2IL1yRydoQdsGR/uCCr6kyKsD0='",
    ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
  ].join(" ");

  // If IPv4 capture is configured, a page on the main origin fetches the
  // IPv4-only echo host (a different subdomain), so it must be allowed in
  // connect-src. Off (empty) unless NEXT_PUBLIC_IPV4_ECHO_URL is set.
  let ipv4EchoOrigin = "";
  try {
    if (process.env.NEXT_PUBLIC_IPV4_ECHO_URL) {
      ipv4EchoOrigin = new URL(process.env.NEXT_PUBLIC_IPV4_ECHO_URL).origin;
    }
  } catch {
    ipv4EchoOrigin = "";
  }

  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      `script-src-elem ${scriptSrc}`,
      // style-src keeps 'unsafe-inline': styled-jsx needs it, and CSS
      // injection is a far weaker primitive than script injection -- not
      // part of this pass.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.browserbase.com",
      "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.browserbase.com",
      "font-src 'self' https://fonts.gstatic.com https://static.cloudflareinsights.com https://www.browserbase.com",
      // avatars.githubusercontent.com/*.googleusercontent.com: the avatar
      // URL OAuth sign-in returns as-is from GitHub/Google (lib/auth/
      // oauth-userinfo.ts) and renders in the profile Social tab and
      // wherever else an OAuth-linked identity's photo shows up.
      "img-src 'self' data: blob: https://www.browserbase.com https://static.cloudflareinsights.com https://cdn.discordapp.com https://www.gravatar.com https://avatars.githubusercontent.com https://*.googleusercontent.com",
      // BrowserBase: the live-view iframe connects to
      // wss://connect.{region}.browserbase.com/. connect-src
      // https://api.browserbase.com is for the popup calling
      // /api/v3/browser/sessions.
      `connect-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://api.browserbase.com wss://*.browserbase.com https://api.stripe.com${
        ipv4EchoOrigin ? ` ${ipv4EchoOrigin}` : ""
      }`,
      // js.stripe.com: Stripe Elements/Checkout renders its card-input and
      // 3DS-challenge UI inside its own iframes -- without it here, the
      // payment form fails to open at all (frame-src blocks the iframe
      // load, independent of script-src already allowing the JS itself).
      "frame-src https://challenges.cloudflare.com https://www.browserbase.com https://js.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      // Would rewrite every same-origin request to https on a deployment that
      // deliberately has no TLS, breaking it. See ALLOW_INSECURE_HTTP.
      ...(ALLOW_INSECURE_HTTP ? [] : ["upgrade-insecure-requests"]),
    ].join("; "),
    // Trusted Types: report-only, not enforced. Enforcing
    // require-trusted-types-for blind risks breaking any third-party
    // script that writes innerHTML internally (Stripe.js, Turnstile) with
    // no way to verify that from source. Report-only surfaces real
    // violations in devtools without breaking anything -- flip this to a
    // real Content-Security-Policy directive once a real browsing session
    // across the app shows zero violations.
    "Content-Security-Policy-Report-Only":
      "require-trusted-types-for 'script'; trusted-types default",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
    "X-Permitted-Cross-Domain-Policies": "none",
    // X-XSS-Protection removed: the browser XSS auditor it controlled was
    // removed from Chrome/Edge and never existed in Firefox. It has no
    // effect in any modern browser; CSP is the real XSS mitigation.
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    // 'unsafe-none': tried 'credentialless' here on the theory that it
    // would load the non-cooperating BrowserBase live-view iframe without
    // credentials instead of blocking it like 'require-corp' does. Real
    // testing in Firefox showed the opposite: the iframe's own
    // devtools-fullscreen/inspector.html got blocked with a
    // Cross-Origin-Resource-Policy error, breaking live browser sessions
    // entirely. Nothing in this app needs cross-origin isolation
    // (SharedArrayBuffer, high-resolution timers), so there is no upside
    // worth a broken feature -- reverted to 'unsafe-none', which is what
    // this app ran with before this was ever touched.
    "Cross-Origin-Embedder-Policy": "unsafe-none",
    "X-DNS-Prefetch-Control": "off",
    // Two years of forced https, remembered by the browser long after the
    // header stops being sent, so it must not go out on a deployment that
    // serves plain HTTP on purpose. See ALLOW_INSECURE_HTTP.
    ...(ALLOW_INSECURE_HTTP
      ? {}
      : {
          "Strict-Transport-Security":
            "max-age=63072000; includeSubDomains; preload",
        }),
    // No Expect-CT. It was sent monitor-only, with the reasoning that it
    // signalled to scanners that Certificate Transparency "had been
    // considered". Our own scanner disagrees, in writing: the
    // `expect-ct-missing` check is info-level and its text says Chrome
    // removed support in 107, that CT is enforced unconditionally at
    // certificate validation regardless of any header, and that there is no
    // meaningful action to take. We were sending a header we tell users not
    // to bother with, on every response, forever. A deprecated header that
    // no browser reads is not a signal, it is bytes.
    "Origin-Agent-Cluster": "?1",
    // No Document-Policy. It used to carry force-load-at-top, which tells
    // Chromium not to scroll to the URL fragment on load, so every #anchor
    // deep link (docs sections, changelog entries, check pages) opened at the
    // top of the page.
  };
}

/**
 * The two routes that answer with screenshot bytes declare
 * `default-src 'none'; sandbox` themselves. A header middleware sets on its
 * response wins over the handler's (the routing spike measured it for CSP and
 * for x-request-id), so without this the page policy, which allows scripts,
 * replaced the stricter one on a response that is never meant to run as a
 * document. Sending the same value here makes the handler's policy the one
 * that arrives. tests/middleware.test.ts checks it against both handlers.
 */
const SCREENSHOT_CSP = "default-src 'none'; sandbox";
const SCREENSHOT_TAILS = ["/scan/screenshot/:id", "/shared/:token/screenshot"];

function servesScreenshot(r: Resolved, decisionPath: string): boolean {
  const base =
    r.kind === "legacy-v3"
      ? PREFIX.V3
      : r.kind === "internal" || (r.kind === "alias" && r.target === "internal")
        ? PREFIX.INTERNAL
        : null;
  if (base === null) return false;
  const tail = decisionPath.slice(base.length);
  return SCREENSHOT_TAILS.some((template) => matchTemplate(template, tail));
}

/**
 * The one response in this app whose entire job is to be loaded by a browser
 * on somebody else's origin: GET /api/v3/badge/[token], the "Secured by
 * VulnRadar" SVG that app/docs/sharing hands people an `<img src>` for.
 *
 * applySecurityHeaders sends Cross-Origin-Resource-Policy: same-origin on
 * every response, and CORP is enforced on exactly the no-cors subresource
 * loads an `<img>` makes, so a badge pasted onto the user's own site was
 * fetched and then discarded by the browser before it painted. README badges
 * hid it: GitHub proxies images through camo, a server-side fetch that has no
 * origin to compare against and never applies CORP, so the surface everyone
 * checks kept working while the one the docs show HTML for did not.
 *
 * Narrow on purpose: the request has to have resolved to the badge
 * permalink, whose row carries `corpCrossOrigin`. That row is a single
 * segment under FROZEN.BADGE with `except: ["scans", "site"]`, so
 * /badge/scans and /badge/site, both session-authenticated JSON that has no
 * business being embeddable, never resolve to it. The prefix is the frozen
 * one, not the API map's: the image URL lives in other people's pages and
 * does not move with the API version.
 */
function isEmbeddableBadgeImage(r: Resolved): boolean {
  return (
    r.kind === "permalink" &&
    r.link.corpCrossOrigin === true &&
    r.path.startsWith(`${FROZEN.BADGE}/`)
  );
}

function applySecurityHeaders(
  response: NextResponse,
  nonce: string,
  requestId: string,
): NextResponse {
  // Echoed on every response, including the redirects and the 413/403 that
  // never reach a route handler, so the id an operator can see in the
  // browser is the same one system_error_logs recorded. Set before the
  // DISABLE_CSP branch below: this is a correlation id, not a security
  // header, and turning CSP off to debug an embed must not also take away
  // the thing that makes the resulting errors findable.
  response.headers.set(REQUEST_ID_HEADER, requestId);
  // Set DISABLE_CSP=1 in .env.local to ship the app without any
  // security headers. Useful when debugging a third-party embed
  // (BrowserBase, Turnstile, etc.) and you want to confirm whether
  // CSP/CORP/COOP is the blocker. Self-hosters: leave it unset.
  if (process.env.DISABLE_CSP === "1") {
    response.headers.delete("X-Powered-By");
    response.headers.delete("Server");
    response.headers.delete("X-AspNet-Version");
    response.headers.delete("X-AspNetMvc-Version");
    response.headers.delete("X-Runtime");
    response.headers.delete("X-Version");
    response.headers.delete("X-Nextjs-Cache");
    return response;
  }
  for (const [key, value] of Object.entries(buildSecurityHeaders(nonce))) {
    response.headers.set(key, value);
  }
  // Remove all server technology disclosure headers
  response.headers.delete("X-Powered-By");
  response.headers.delete("Server");
  response.headers.delete("X-AspNet-Version");
  response.headers.delete("X-AspNetMvc-Version");
  response.headers.delete("X-Runtime");
  response.headers.delete("X-Version");
  // Next.js's own ISR/SSG cache-state header (HIT/MISS/STALE/BYPASS) --
  // useful for debugging, not for a stranger's browser.
  response.headers.delete("X-Nextjs-Cache");

  return response;
}

/**
 * The space a resolved request belongs to, for the error envelope: v4 never
 * carries the legacy `paused` key, and a v3 alias of a v4 operation is still
 * a v3 caller.
 */
function errorSpaceOf(r: Resolved): ErrorSpace {
  switch (r.kind) {
    case "v4":
      return "v4";
    case "alias":
      return r.target === "v4" ? "v3" : "internal";
    case "legacy-v3":
      return "v3";
    case "internal":
      return "internal";
    case "permalink":
      return "permalink";
    default:
      return "other";
  }
}

/**
 * The trusted marker a handler reads to pick its response shape. A v3 alias
 * of a v4 operation and a legacy v3 path are both v3 callers. Paths no route
 * serves get "internal", which no projection reads; the point is that
 * whatever the client sent is overwritten.
 */
function markerOf(r: Resolved): ApiMarker {
  switch (r.kind) {
    case "v4":
      return "v4";
    case "alias":
      return r.target === "v4" ? "v3" : "internal";
    case "legacy-v3":
      return "v3";
    case "permalink":
      return "permalink";
    default:
      return "internal";
  }
}

/** The tail of a legacy v3 path, relative to /api/v3. */
function legacyTail(r: Resolved & { kind: "legacy-v3" }): string {
  return r.path.slice(PREFIX.V3.length);
}

/**
 * Whether a legacy v3 path is a v4 operation once its file moves, which is
 * what decides the Bearer challenge on its 401: the credential it is missing
 * is the same one. auth/me only with a Bearer, exactly as resolveApiPath
 * splits it.
 */
function legacyIsV4Operation(
  r: Resolved & { kind: "legacy-v3" },
  bearer: boolean,
): boolean {
  const tail = legacyTail(r);
  return matchV4(tail) !== null && (tail !== "/auth/me" || bearer);
}

/** The spaces a Bearer key belongs to: v4, its v3 aliases, and legacy v3. */
function acceptsBearer(r: Resolved): boolean {
  return (
    r.kind === "v4" ||
    r.kind === "legacy-v3" ||
    (r.kind === "alias" && r.target === "v4")
  );
}

/**
 * Exact canonical paths only, so an adjacent path (webhooks/stripe/x,
 * webhooks/123) is checked like any other. Each exemption authenticates the
 * caller some other way, so the Origin header is not a useful signal there:
 *
 * - the Stripe webhook is signed with STRIPE_WEBHOOK_SECRET;
 * - the Discord callback carries an HMAC-signed state token;
 * - unsubscribe is the RFC 8058 One-Click endpoint named in the
 *   List-Unsubscribe header of every message we send, so Gmail and Yahoo
 *   POST to it from their own servers with no Origin and no cookie; its
 *   credential is the unguessable token in the query string, and a
 *   cross-site page that does not have it can do nothing with the route;
 * - the version and security.txt are anonymous and read-only;
 * - the demo scan is anonymous and limited by the caller's IP.
 *
 * A legacy v3 path is exempt when its tail is the exempt v4 operation, which
 * is the 3.9.1 entry for /api/v3/demo-scan and what its alias will be.
 */
function isExemptFromCsrf(r: Resolved): boolean {
  switch (r.kind) {
    case "permalink":
      return r.link.csrfExempt === true;
    case "v4":
      return r.route?.csrfExempt === true;
    case "alias":
      return r.target === "v4" && r.route?.csrfExempt === true;
    case "legacy-v3":
      return matchV4(legacyTail(r))?.csrfExempt === true;
    default:
      return false;
  }
}

/**
 * Whether the middleware lets an API request through without demanding a
 * credential. A routing hint, not authentication: the gate below only checks
 * that a session cookie is present, and every handler that needs a user still
 * calls getSession() itself.
 */
function isAnonymous(r: Resolved): boolean {
  switch (r.kind) {
    case "permalink":
      return true;
    case "v4":
      return r.route?.bearer === "none";
    case "internal":
      return r.anonymous;
    case "alias": {
      if (r.target === "v4") return r.route?.bearer === "none";
      const target = resolveApiPath(r.to, false, CONFIG_API_SUPPORTED_VERSIONS);
      return target.kind === "internal" && target.anonymous;
    }
    case "legacy-v3":
      return isLegacyPublicApi(r.path);
    default:
      return false;
  }
}

/** auth/me in v4 answers a key and nothing else. */
function requiresBearer(r: Resolved): boolean {
  return (
    (r.kind === "v4" || (r.kind === "alias" && r.target === "v4")) &&
    r.route?.bearer === "required"
  );
}

/**
 * The web app navigates to a few API routes (GitHub and Discord connect, the
 * OAuth starts), and a signed-out browser there should land on the login
 * page, not on a JSON body. Only the spaces those routes live in.
 */
function redirectsNavigations(r: Resolved): boolean {
  return (
    r.kind === "internal" ||
    r.kind === "legacy-v3" ||
    (r.kind === "alias" && r.target === "internal")
  );
}

function isNavigation(request: NextRequest): boolean {
  return (
    request.headers.get("sec-fetch-mode")?.toLowerCase() === "navigate" ||
    request.headers.get("sec-fetch-dest")?.toLowerCase() === "document"
  );
}

const UNRESERVED = /^[A-Za-z0-9._~-]$/;

/**
 * Decodes the percent-escapes of unreserved characters (RFC 3986 2.3), which
 * mean the same as the character itself. The registry matches the raw
 * pathname, and the router may serve /api/v3/%61dmin as /api/v3/admin, so
 * without this an escaped spelling was judged as some other path: the
 * maintenance allowlist missed it and an alias would have been decided on a
 * target the router never serves. Reserved escapes (%2F and the rest) stay
 * as they are, because decoding one changes what the path is.
 */
function normalizeUnreservedEscapes(pathname: string): string {
  return pathname.replace(/%([0-9A-Fa-f]{2})/g, (escape, hex: string) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return UNRESERVED.test(char) ? char : escape;
  });
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function decodedOrSelf(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function middleware(request: NextRequest, event?: NextFetchEvent) {
  // This used to only be enforced at next.config.mjs build time, which a
  // pre-built Docker image started with a new env var would never
  // re-trigger. Middleware re-evaluates on every request in production, so
  // this is actually a more reliable place for the guard, not just a
  // relocated duplicate.
  if (
    process.env.DISABLE_CSP === "1" &&
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      "DISABLE_CSP=1 is not allowed in production. Remove it from your environment before deploying.",
    );
  }

  const nonce = generateNonce();
  // AUDIT-012#obs-07: one correlation id per request. Generated here, never
  // taken from the inbound header: it is written verbatim into
  // system_error_logs (an admin-facing table) and is what an operator
  // filters on, so letting a caller choose it would let anyone plant
  // arbitrary text there or deliberately collide two unrelated requests.
  // The forwarded REQUEST header below is how it reaches Node route
  // handlers -- middleware runs on the Edge runtime, so there is no shared
  // AsyncLocalStorage to hand it over in (see lib/database/request-context.ts).
  // Minted before anything can answer, so every response carries it.
  const requestId = crypto.randomUUID();
  const finish = (response: NextResponse) =>
    applySecurityHeaders(response, nonce, requestId);

  // Normalize pathname: remove trailing slash except for root '/'
  const { pathname: rawPathname } = request.nextUrl;
  const trimmed =
    rawPathname.endsWith("/") && rawPathname !== "/"
      ? rawPathname.slice(0, -1)
      : rawPathname;
  // The prefix itself can be escaped: /%61pi/v3/scan is served as
  // /api/v3/scan, so it is an API request and is judged as one.
  const unescaped = normalizeUnreservedEscapes(trimmed);
  const pathname = isApiPath(unescaped) ? unescaped : trimmed;

  // Which space the path belongs to, and the path that decides it: an alias
  // is judged as its target, so an old URL can never be treated differently
  // from the route it reaches. Every rule below reads `r` and
  // `decisionPath`, never a hand-written prefix. The same reader the route
  // handlers use for the Authorization header, so middleware and a handler
  // never disagree about whether this is a key call.
  const bearer = parseBearer(request.headers.get("authorization")) !== null;
  const r = resolveApiPath(pathname, bearer, CONFIG_API_SUPPORTED_VERSIONS);
  const decisionPath = r.kind === "alias" ? r.to : pathname;
  const isApi = r.kind !== "page";
  const space = errorSpaceOf(r);
  const fail = (
    status: number,
    code: ErrorCode,
    message: string,
    extra: { retryAfter?: number; bearerChallenge?: boolean } = {},
  ) =>
    finish(
      buildError({
        version: space,
        status,
        code,
        message,
        requestId,
        ...extra,
      }),
    );

  // An escaped separator can hide the prefix too: a production router looks a
  // static route up by its decoded path as well, so /api%2Fv3%2Fscan reaches
  // /api/v3/scan while everything below would have judged a page, with no
  // Origin check and no body cap. Nothing legitimate spells a path that way.
  if (!isApi && isApiPath(decodedOrSelf(pathname))) {
    return fail(404, "NOT_FOUND", "No API route at this path.");
  }

  // A reverse proxy in front of this app (Cloudflare, nginx, Caddy -- see
  // docker-compose.yml) is expected to redirect plain HTTP to HTTPS itself,
  // but not every self-hosted deployment gets that configured. X-Forwarded-
  // Proto reflects what the client actually connected with, trusted the
  // same way requestSelfOrigin() below trusts it -- redirect here as a
  // fallback whenever it says "http". A no-op for any proxy that already
  // upgrades before forwarding.
  //
  // It is NOT a no-op for a direct request with no proxy at all, which this
  // comment used to claim: Next.js's server fills in x-forwarded-proto itself
  // (`??= "http"`) before middleware runs, so every direct plain-HTTP request
  // is redirected. That includes the image's own HEALTHCHECK and compose's,
  // which call the health endpoint over plain HTTP from inside the container:
  // wget followed the 301 to https://localhost:3000, where nothing speaks
  // TLS, and every install reported unhealthy. A health probe always connects
  // directly, so the permalink flagged plainHttpExempt is never redirected.
  // ALLOW_INSECURE_HTTP=1 turns this off for a deployment that has no TLS at
  // all (see the constant's own comment); without an opt-out, such an install
  // was redirected to an https URL that nothing was listening on.
  //
  // An API write is refused rather than redirected. A client that follows a
  // 301 re-sends a POST as a GET without its body, or not at all, and the
  // credentials and body have already crossed the network in the clear, so
  // the honest answer is a JSON 403 that says what to change.
  if (
    !ALLOW_INSECURE_HTTP &&
    !(r.kind === "permalink" && r.link.plainHttpExempt) &&
    request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase() === "http"
  ) {
    const method = request.method.toUpperCase();
    if (isApi && method !== "GET" && method !== "HEAD") {
      return fail(
        403,
        "FORBIDDEN",
        "HTTPS required. Send this request to the https:// address of this server.",
      );
    }
    const httpsUrl = new URL(request.url);
    httpsUrl.protocol = "https:";
    return finish(NextResponse.redirect(httpsUrl, 301));
  }

  // Server Components (app/layout.tsx) read this back via headers() from
  // next/headers to nonce the one raw inline <script> the app renders
  // itself. Requires rewriting the *request* headers, not just the
  // response's -- NextResponse.next({ request: { headers } }) is what
  // actually threads a value through to the server-rendering pass.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  // .set, not .append: this overwrites any x-request-id the client sent, so
  // a route handler can trust the value it reads.
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  // Do NOT also set content-security-policy on requestHeaders. It looks
  // necessary from Next's source (app-render.js reads the REQUEST header and
  // feeds it to getScriptNonceFromHeader), but production disproves it: the
  // live site serves this exact enforcing strict-dynamic policy and Next's
  // own chunk and flight-payload scripts already carry the matching nonce.
  // Verified against https://vulnradar.dev/landing, 73 of 77 script tags
  // nonced; the four without are two ld+json blocks, the app's own inline
  // script, and Cloudflare's edge-injected email-decode.js (the case the
  // sha256 entry in scriptSrc exists for). The Self-host CI job's nonce probe
  // (scripts/ci/next16-runtime-probes.mjs) now fails the build if Next ever
  // stops copying this response CSP onto the request.

  // app/layout.tsx reads this back to decide whether the database-backed
  // maintenance gate applies to the page being rendered. For an alias it is
  // the canonical path, the one every rule here was decided on.
  requestHeaders.set(PATHNAME_HEADER, decisionPath);

  // The version marker selects a response shape and nothing else. Set (never
  // appended) on every API request, so a client-sent value is overwritten,
  // and deleted on every page request: next.config.mjs rewrites
  // /security.txt into /api, so a page-kind request can still reach an API
  // handler and must not carry a value the client chose there either.
  if (isApi) requestHeaders.set(API_VERSION_HEADER, markerOf(r));
  else requestHeaders.delete(API_VERSION_HEADER);

  // Outside v4, its aliases and the legacy v3 paths no handler reads a key,
  // so the header is dropped before any of them runs. That turns "internal
  // routes never take a Bearer" from a convention into something a route
  // cannot get wrong.
  if (!acceptsBearer(r)) requestHeaders.delete("authorization");

  const passThrough = () => {
    const response =
      r.kind === "alias"
        ? aliasRewrite(request, decisionPath, {
            request: { headers: requestHeaders },
          })
        : NextResponse.next({ request: { headers: requestHeaders } });
    finish(response);
    if (isEmbeddableBadgeImage(r)) {
      response.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    }
    if (servesScreenshot(r, decisionPath)) {
      response.headers.set("Content-Security-Policy", SCREENSHOT_CSP);
    }
    return response;
  };

  const sessionCookie = request.cookies.get(AUTH_SESSION_COOKIE_NAME);

  // Maintenance, before anything that could touch the app. Deliberately
  // ahead of the body-size and CSRF checks: a deployment in this state
  // should be answering exactly one thing on every path that is not the way
  // back in.
  //
  // The environment break-glass covers everything; the registry switch
  // covers anonymous pages, which is what a crawler is, and leaves anyone
  // with a session cookie to the layout's staff check.
  if (
    !isMaintenanceAllowed(r, decisionPath) &&
    (maintenanceEnvEnabled() ||
      (!isApi && !sessionCookie && registryMaintenanceOn(event)))
  ) {
    if (!isApi) return finish(maintenancePageResponse());
    return fail(503, "SERVICE_PAUSED", MAINTENANCE_MESSAGE, {
      retryAfter: MAINTENANCE_RETRY_AFTER,
    });
  }

  // Request-body ceiling for the whole API surface. The 1 MiB cap was written
  // down as a security property of this API but was only ever enforced inside
  // parseBody, which 54 of the 73 body-reading routes never call -- the entire
  // scan surface, teams, support tickets, both contact forms and the
  // session-less unsubscribe endpoint read their body raw, with nothing
  // underneath them (Next's App Router has no default body limit, unlike the
  // Pages Router). Any signed-in account could POST an arbitrarily large body
  // to any of them and the process buffered it before a single validation ran.
  // Enforced here, ahead of the CSRF check, so a route cannot opt out by
  // forgetting to call the helper. ref: AUDIT-013#dup-04
  //
  // Content-Length only: middleware cannot measure a chunked body without
  // consuming the stream the route handler still needs. That is not a hole a
  // client picks: dropping the header does not remove the cap parseBody-backed
  // routes still apply, and an unbounded chunked upload is bounded by the
  // reverse proxy every deployment doc puts in front of this app.
  if (isApi && BODY_CARRYING_METHODS.has(request.method.toUpperCase())) {
    const declaredLength = Number.parseInt(
      request.headers.get("content-length") ?? "",
      10,
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_REQUEST_BODY_BYTES
    ) {
      return fail(
        413,
        "PAYLOAD_TOO_LARGE",
        `Request body exceeds the ${MAX_REQUEST_BODY_BYTES} byte limit.`,
      );
    }
  }

  // Our own short links for the social accounts: /discord, /youtube, /github
  // and the rest, redirected to the real profile.
  //
  // Before the public-path check on purpose, and therefore before the auth
  // gate. These are not pages, so listing them in PUBLIC_PATHS would be
  // describing them as something they are not, and leaving them out of it (as
  // the first version of this did) sent a signed-out visitor to /login instead
  // of to the account they asked for. A redirect that behaves differently
  // depending on whether you happen to be signed in is not a link you can
  // print on a sticker.
  //
  // 307, not 308: the destination is somebody else's URL and an account can
  // move. Browsers cache a permanent redirect indefinitely, which would
  // outlive our ability to change it.
  const socialTarget = SOCIAL_REDIRECTS[pathname];
  if (socialTarget) {
    return finish(NextResponse.redirect(socialTarget, 307));
  }

  // A check page this release removed. 301, unlike the short links above:
  // the old URL is gone for good and search engines should move its standing
  // to the target. Own-origin target, so there is nothing to move later.
  const retiredCheck = pathname.startsWith("/checks/")
    ? Object.hasOwn(RETIRED_CHECK_REDIRECTS, pathname.slice(8))
      ? RETIRED_CHECK_REDIRECTS[pathname.slice(8)]
      : undefined
    : undefined;
  if (retiredCheck) {
    return finish(
      NextResponse.redirect(new URL(retiredCheck, request.url), 301),
    );
  }

  // csrf: enforce CSRF for state-changing requests to every API path,
  // whatever its space and whether or not a route exists there yet, so a
  // prefix is protected before its first file lands. We require that the
  // request carries an Origin / Referer header matching the app's own origin
  // AND a Sec-Fetch-Site header (when present) that is "same-origin" or
  // "same-site". Without this, a malicious site can submit cross-origin POSTs
  // against VulnRadar on behalf of an authenticated user.
  //
  // IMPORTANT: this runs BEFORE the anonymous-path pass below, and that
  // ordering is the point. It used to sit after it, which made PUBLIC_PATHS
  // the real exemption list rather than the deliberately narrow
  // isExemptFromCsrf() one: POST /api/v3/auth/login was exempt, so a
  // cross-site text/plain form could post valid JSON to it and log a victim
  // into the attacker's account, and POST /api/v3/badge/site (session
  // authenticated, under the public badge prefix) was exempt with it
  // (AUDIT-012#auth-04). Nothing anonymous needs the exemption: every
  // same-origin fetch from this app carries an Origin header.
  //
  // IMPORTANT: the CSRF check also runs BEFORE the Bearer pass below.
  // A fake "Authorization: Bearer anything" header must not suppress
  // Origin validation for session-authenticated routes (AUDIT-005#csrf-01),
  // and outside v4, its aliases and legacy v3 a Bearer waives nothing at all.
  if (isApi && !isExemptFromCsrf(r)) {
    const refusal = enforceCsrf(request, bearer && acceptsBearer(r));
    if (refusal) return fail(403, "CSRF_REJECTED", refusal);
  }

  // After CSRF, so a cross-site write to a made-up version is still refused
  // first. /api/v4 answers this until it is switched on.
  if (r.kind === "unsupported-version") {
    return fail(
      404,
      "UNSUPPORTED_API_VERSION",
      `API version ${r.version} is not served by this instance.`,
    );
  }

  if (!isApi) {
    // Check if path is public (exact match for "/" and "/landing", startsWith for others)
    const isPublicPath = PUBLIC_PATHS.some((p) => {
      if (p === ROUTES.HOME || p === ROUTES.LANDING) {
        return pathname === p;
      }
      return pathname.startsWith(p);
    });

    if (isPublicPath) {
      // If logged in and trying to access login/signup, redirect to dashboard
      if (
        sessionCookie &&
        (pathname === ROUTES.LOGIN || pathname === ROUTES.SIGNUP)
      ) {
        return finish(
          NextResponse.redirect(new URL(ROUTES.DASHBOARD, request.url)),
        );
      }
      const publicResponse = passThrough();
      // A protected page bounces an anonymous visitor (and a crawler following
      // a footer link) to /login?redirect=<path>. Each of those is the login
      // page again under another URL. The header keeps them out of the index
      // while the clean /login stays in it; robots.txt used to Disallow them,
      // which only made Search Console list them as blocked.
      if (
        (pathname === ROUTES.LOGIN || pathname === ROUTES.SIGNUP) &&
        request.nextUrl.searchParams.has("redirect")
      ) {
        publicResponse.headers.set("X-Robots-Tag", "noindex");
      }
      // Shared reports and per-host pages describe somebody's site, and robots.txt
      // no longer blocks them so that their noindex can be read. The header
      // carries it for every crawler, including the ones that get page metadata
      // streamed into the body, and covers their generated preview images too.
      // Link-preview bots ignore it, so a pasted report still unfurls.
      if (pathname.startsWith("/shared/") || pathname.startsWith("/host/")) {
        publicResponse.headers.set("X-Robots-Tag", "noindex, nofollow");
      }
      return publicResponse;
    }

    if (!sessionCookie) return loginRedirect(request, pathname, finish);
    return passThrough();
  }

  // The API auth gate. It only asks whether a credential is present; whether
  // it is valid is each handler's question. API key auth is handled inside
  // each route handler, which is why a Bearer in the right space passes here.
  if (
    isAnonymous(r) ||
    (bearer && acceptsBearer(r)) ||
    (sessionCookie && !requiresBearer(r))
  ) {
    return passThrough();
  }

  // A credential-less API call is answered in JSON. It used to be a 307 to
  // the login page, which fetch follows: res.ok came back true on the login
  // HTML, res.json() threw, and a signed-out tab could not tell "not signed
  // in" from "the server is broken".
  if (redirectsNavigations(r) && isNavigation(request)) {
    return loginRedirect(request, decisionPath, finish);
  }
  const challenge =
    r.kind === "v4" ||
    (r.kind === "alias" && r.target === "v4") ||
    (r.kind === "legacy-v3" && legacyIsV4Operation(r, bearer));
  return fail(401, "UNAUTHENTICATED", "Authentication required.", {
    bearerChallenge: challenge,
  });
}

/** 307 to /login, keeping the original destination to return to after it. */
function loginRedirect(
  request: NextRequest,
  path: string,
  finish: (response: NextResponse) => NextResponse,
): NextResponse {
  const loginUrl = new URL(ROUTES.LOGIN, request.url);
  const intended = path + request.nextUrl.search;
  if (intended && intended !== ROUTES.DASHBOARD) {
    loginUrl.searchParams.set("redirect", intended);
  }
  return finish(NextResponse.redirect(loginUrl));
}

/**
 * csrf: enforce that mutating requests (POST / PUT / PATCH / DELETE)
 * to the API carry an Origin / Referer matching this app and (when
 * present) a same-site Sec-Fetch-Site. Returns why the check failed, or
 * null if it passes.
 *
 * bearerAllowed: when true, true API clients (Bearer present, no Origin)
 * are exempted. Browsers always include an Origin on cross-site requests,
 * so Bearer + Origin still goes through the full check (AUDIT-005#csrf-01).
 * The caller passes true only in the spaces that accept a key.
 *
 * Self-hosters running curl-based integration tests can set
 * `process.env.SECURITY_ALLOW_NON_BROWSER_API=1` (development only)
 * to skip the check. Production code never sets this.
 */
function enforceCsrf(
  request: NextRequest,
  bearerAllowed: boolean,
): string | null {
  const method = request.method.toUpperCase();
  const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  if (!MUTATING.has(method)) {
    return null;
  }

  if (
    process.env.NODE_ENV !== "production" &&
    process.env.SECURITY_ALLOW_NON_BROWSER_API === "1"
  ) {
    return null;
  }

  const appOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL || "");
  // csrf: NEXT_PUBLIC_APP_URL is a NEXT_PUBLIC_ var, which Next.js inlines
  // into the compiled output at `next build` time -- including here in
  // middleware, a server-only file. .github/workflows/docker-publish.yml
  // builds the published ghcr.io/vulnradar/vulnradar image once with no
  // `--build-arg NEXT_PUBLIC_APP_URL`, so appOrigin above is "" in that
  // image no matter what a self-hoster sets in docker-compose.yml's
  // `environment:` section at container *runtime* -- that value was never
  // part of the build this code was compiled from. Every mutating request
  // (login included) was rejected for every self-hoster following the
  // documented quick start, since `!appOrigin` was always true below.
  // selfOrigin is read fresh from this request's own Host header, which
  // the reverse proxy docker-compose.yml assumes sits in front of the app
  // forwards unmodified by default (nginx/Caddy/Cloudflare Tunnel), so it
  // reflects the real domain on every request regardless of what was true
  // at image build time -- the standard OWASP Origin-vs-Host same-origin
  // check. Kept as an addition to appOrigin, not a replacement, so a
  // self-built image (where build-time and runtime agree) still matches.
  const selfOrigin = requestSelfOrigin(request);

  // Origin header (sent on cross-origin + same-origin fetch/XHR).
  const origin = request.headers.get("origin")?.trim().toLowerCase();
  let requestOrigin: string | null = origin || null;
  if (!requestOrigin) {
    const referer = request.headers.get("referer")?.trim();
    if (referer) {
      try {
        requestOrigin = new URL(referer).origin.toLowerCase();
      } catch {
        requestOrigin = null;
      }
    }
  }

  // True API clients (curl, SDK, server-to-server) send no Origin or
  // Referer. Browsers always include Origin on cross-site requests, so
  // a request with Bearer AND no Origin is a genuine non-browser API
  // call — exempt from CSRF. Bearer + Origin must still be validated
  // because a cross-site page could set a fake Bearer header.
  if (!requestOrigin && bearerAllowed) {
    return null;
  }

  // Browser extensions always send Origin: chrome-extension:// or
  // moz-extension:// — a scheme webpages cannot spoof. Combined with a
  // valid Bearer token (validated by the route handler), this is a
  // legitimate API call from the VulnRadar extension, not a CSRF forgery.
  if (
    bearerAllowed &&
    requestOrigin &&
    (requestOrigin.startsWith("chrome-extension://") ||
      requestOrigin.startsWith("moz-extension://"))
  ) {
    return null;
  }

  if (!requestOrigin) {
    return (
      "CSRF check failed: missing both Origin and Referer headers. " +
      "Mutating requests must originate from this site."
    );
  }

  const originMatchesApp =
    (!!appOrigin && requestOrigin === appOrigin) ||
    (!!selfOrigin && requestOrigin === selfOrigin);
  if (!originMatchesApp) {
    return "CSRF check failed: request origin does not match this app.";
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return `CSRF check failed: Sec-Fetch-Site is ${fetchSite}.`;
  }

  return null;
}

function normalizeOrigin(url: string): string {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * csrf: the origin this request itself arrived on, built from the Host
 * header (falling back to X-Forwarded-Host for a proxy that rewrites Host
 * to an internal upstream name) and X-Forwarded-Proto from the reverse
 * proxy docker-compose.yml assumes is in front of the app. See
 * enforceCsrf's appOrigin comment for why this exists alongside
 * NEXT_PUBLIC_APP_URL instead of replacing it.
 *
 * Trusting these headers unconditionally matches this codebase's existing
 * proxy-trust model (lib/api/request-utils.ts's getClientIp does the same
 * for X-Forwarded-For). It is not a CSRF weakening: a genuine cross-site
 * attack is mediated by the victim's own browser, which sets both Origin
 * and Host truthfully and cannot be scripted to spoof either -- a request
 * with attacker-controlled headers implies direct network access to the
 * app, a strictly worse position than bypassing this check.
 */
function requestSelfOrigin(request: NextRequest): string {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const host =
    forwardedHost || request.headers.get("host")?.trim().toLowerCase();
  if (!host) return "";
  const proto =
    request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase() || request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
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
    // The pattern above skips any path ending in an image suffix, which let
    // PATCH /api/v3/support-tickets/12.png past CSRF, the body cap, the auth
    // gate and maintenance mode while a handler that parsed the id with
    // parseInt still served it as ticket 12. No API URL legitimately ends in
    // one, so every /api/ path runs middleware regardless of its last segment.
    "/api/:path*",
  ],
};
