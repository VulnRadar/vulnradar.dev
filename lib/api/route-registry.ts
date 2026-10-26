// The one place that knows which API paths are public, exempt, maintenance
// allowed, aliased or permanent. Middleware reads it; nothing else may keep a
// second list of the same facts, because every earlier copy of one drifted
// from the route it described.
//
// Imports nothing on purpose. Middleware compiles to the edge bundle, so this
// file has to stay a leaf: anything it imports is shipped there too, and a
// constants module that reads server-only environment variables would take
// the build down with it. The prefixes are therefore spelled out here, and
// tests/lib/config/api-config.test.ts keeps them equal to the CONFIG_* values.
//
// Paths are matched on the raw, still percent-encoded pathname, by whole
// segment. `:name` stands for exactly one non-empty segment; there are no
// wildcards and no prefix matching, so an entry for /scan can never swallow
// /scan/crawl/discover.

export const PREFIX = {
  V3: "/api/v3",
  V4: "/api/v4",
  INTERNAL: "/api/internal",
} as const;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface V4Route {
  /** Relative to /api/v4, for example "/history/:id/report". */
  template: string;
  /**
   * What the middleware demands before the handler runs. "required" is the one
   * route that is Bearer only (auth/me); "none" is an anonymous operation.
   */
  bearer: "required" | "optional" | "none";
  /** operationId per exported method; the closed OpName union is built from these. */
  operations: Readonly<Partial<Record<HttpMethod, string>>>;
  /** Demo scan only: no Origin check, its limiter is keyed on the caller's IP. */
  csrfExempt?: true;
  /** finding-types only: its v3 alias never gets Deprecation, Sunset or a 410. */
  sunsetExempt?: true;
}

export interface Permalink {
  /** The full path, for example "/api/v3/auth/oauth/:provider/callback". */
  template: string;
  /**
   * Static segments that must NOT match a ":param" of this template. A static
   * route beats a dynamic one, and this is the one permalink with static
   * siblings (badge/scans, badge/site are session routes beside the token).
   */
  except?: readonly string[];
  csrfExempt?: true;
  /** Reachable while the environment break-glass maintenance mode is on. */
  maintenance?: true;
  /** Exempt from the plain-HTTP redirect (container health probes). */
  plainHttpExempt?: true;
  /** Gets Cross-Origin-Resource-Policy: cross-origin (embeddable images). */
  corpCrossOrigin?: true;
}

export type Resolved =
  | { kind: "page" }
  | { kind: "permalink"; path: string; link: Permalink }
  | { kind: "v4"; path: string; route: V4Route | null }
  | { kind: "internal"; path: string; anonymous: boolean }
  | {
      kind: "alias";
      from: string;
      to: string;
      target: "v4" | "internal";
      route?: V4Route;
      documentedSessionOnly: boolean;
    }
  | { kind: "legacy-v3"; path: string }
  | { kind: "unsupported-version"; version: string }
  | { kind: "other-api"; path: string };

/** The 19 operations a third party may depend on. */
export const V4_ROUTES: readonly V4Route[] = [
  {
    template: "/auth/me",
    bearer: "required",
    operations: { GET: "auth.me" },
  },
  {
    template: "/demo-scan",
    bearer: "none",
    csrfExempt: true,
    operations: { POST: "demoScan.create" },
  },
  {
    template: "/finding-types",
    bearer: "none",
    sunsetExempt: true,
    operations: { GET: "findingTypes.list" },
  },
  {
    template: "/openapi.json",
    bearer: "none",
    operations: { GET: "openapi.get" },
  },
  {
    template: "/history",
    bearer: "optional",
    operations: { GET: "history.list", DELETE: "history.clear" },
  },
  {
    template: "/history/:id",
    bearer: "optional",
    operations: {
      GET: "history.get",
      PATCH: "history.update",
      DELETE: "history.delete",
    },
  },
  {
    template: "/history/:id/report",
    bearer: "optional",
    operations: { GET: "history.report" },
  },
  {
    template: "/history/:id/summary",
    bearer: "optional",
    operations: { POST: "history.summarize" },
  },
  {
    template: "/scan",
    bearer: "optional",
    operations: { POST: "scan.create" },
  },
  {
    template: "/scan/authenticated",
    bearer: "optional",
    operations: { POST: "scan.createAuthenticated" },
  },
  {
    template: "/scan/bulk",
    bearer: "optional",
    operations: { POST: "scan.createBulk" },
  },
  {
    template: "/scan/crawl",
    bearer: "optional",
    operations: { POST: "scan.createCrawl" },
  },
  {
    template: "/scan/crawl/discover",
    bearer: "optional",
    operations: { POST: "scan.discoverCrawl" },
  },
  {
    template: "/scan/discover",
    bearer: "optional",
    operations: { POST: "scan.discover" },
  },
  {
    template: "/scan/discover/progress/:requestId",
    bearer: "optional",
    operations: { GET: "scan.discoverProgress" },
  },
  {
    template: "/scan/reputation",
    bearer: "optional",
    operations: { GET: "scan.reputation" },
  },
  {
    template: "/scan/status/:id",
    bearer: "optional",
    operations: { GET: "scan.status", DELETE: "scan.cancel" },
  },
  {
    template: "/scan/verify",
    bearer: "optional",
    operations: { POST: "scan.verify" },
  },
  {
    template: "/scan/verify-batch",
    bearer: "optional",
    operations: { POST: "scan.verifyBatch" },
  },
];

/**
 * The 12 URLs that never move: each is registered or stored outside this
 * codebase (OAuth consoles, Stripe, mail already sent, load balancers, nginx on
 * the IPv4-only host, image URLs in the database and on other people's pages).
 * Each stays a file at its own URL; none gets an alias row.
 */
export const PERMALINKS: readonly Permalink[] = [
  { template: "/api/v3/health", maintenance: true, plainHttpExempt: true },
  { template: "/api/v3/webhooks/stripe", csrfExempt: true },
  { template: "/api/v3/account/unsubscribe", csrfExempt: true },
  {
    template: "/api/v3/auth/discord/callback",
    csrfExempt: true,
    maintenance: true,
  },
  { template: "/api/v3/auth/oauth/:provider/callback", maintenance: true },
  { template: "/api/v3/auth/staff-oidc/callback", maintenance: true },
  { template: "/api/v3/whoami-ip" },
  { template: "/api/v3/avatar/:userId" },
  {
    template: "/api/v3/badge/:token",
    except: ["scans", "site"],
    corpCrossOrigin: true,
  },
  { template: "/api/v3/openapi.json" },
  { template: "/api/version", csrfExempt: true, maintenance: true },
  { template: "/api/security-txt", csrfExempt: true, maintenance: true },
];

/**
 * Internal routes the middleware lets through without a credential. "Anonymous"
 * means only that the middleware does not demand one before the handler runs:
 * it is a routing hint, and every handler that needs a user still calls
 * getSession() itself. Exact templates, so a path that merely shares a prefix
 * with an entry is never anonymous. Adding an entry needs a CODEOWNERS review.
 */
export const INTERNAL_ANONYMOUS: readonly { template: string; why: string }[] =
  [
    { template: "/auth/login", why: "The sign-in form has no session yet." },
    { template: "/auth/signup", why: "The sign-up form has no session yet." },
    {
      template: "/auth/forgot-password",
      why: "A signed-out user asks for a reset link.",
    },
    {
      template: "/auth/reset-password",
      why: "The emailed reset link carries its own token.",
    },
    {
      template: "/auth/accept-tos",
      why: "Public in 3.9.1; the handler checks the session itself.",
    },
    {
      template: "/auth/verify-email",
      why: "The emailed verification link carries its own token.",
    },
    {
      template: "/auth/resend-verification",
      why: "A user who cannot sign in yet asks for another email.",
    },
    {
      template: "/auth/2fa/verify",
      why: "Runs between the password and the session, on the pending-2FA cookie.",
    },
    {
      template: "/auth/2fa/email-send",
      why: "Sends the email code during a login that has no session yet.",
    },
    {
      template: "/auth/oauth/info",
      why: "The login and signup forms poll it before any session exists.",
    },
    {
      template: "/auth/oauth/:provider",
      why: "Starts a sign-in with Google, GitHub or Discord.",
    },
    {
      template: "/auth/discord",
      why: "Starts the Discord flow, a top-level navigation.",
    },
    {
      template: "/auth/staff-oidc",
      why: "Starts staff single sign-on, a top-level navigation.",
    },
    {
      template: "/auth/staff-oidc/info",
      why: "The login form polls it to decide whether to show the SSO link.",
    },
    {
      template: "/auth/staff-invite/:token",
      why: "An invited staff member has no account yet; the token is the credential.",
    },
    {
      template: "/account/language",
      why: "A signed-out visitor can choose the site language.",
    },
    {
      template: "/ai/info",
      why: "The support widget names its provider before sign-in.",
    },
    {
      template: "/billing/plan-limits",
      why: "The pricing page quotes the live limits to anonymous visitors.",
    },
    {
      template: "/config/client",
      why: "Client configuration is needed before any session exists.",
    },
    {
      template: "/contact",
      why: "The public contact form; limited by IP and a Turnstile check.",
    },
    {
      template: "/host/:hostname",
      why: "The public host report page loads it for anyone.",
    },
    {
      template: "/host/:hostname/trend",
      why: "The danger-score trend on the public host report.",
    },
    {
      template: "/shared/:token",
      why: "A shared report is gated by its unguessable token.",
    },
    {
      template: "/shared/:token/screenshot",
      why: "The screenshot of a shared report, gated by the same token.",
    },
    {
      template: "/public-scans",
      why: "The public scan directory is open by design.",
    },
  ];

/**
 * Segment-boundary prefixes under /api/internal that stay reachable while the
 * environment break-glass maintenance mode is on: the staff way back in.
 */
export const INTERNAL_MAINTENANCE: readonly string[] = ["/auth", "/admin"];

/**
 * The 18 session-only routes the 3.9.1 docs and OpenAPI advertised. They are
 * internal now, but a script holding a cookie may still call the v3 URL, so
 * their v3 aliases emit Deprecation and Sunset for the window like public ones.
 */
export const DOCUMENTED_SESSION_ONLY: readonly string[] = [
  "/browser/sessions",
  "/browser/sessions/logs",
  "/domains",
  "/domains/:id",
  "/domains/:id/verify",
  "/keys",
  "/keys/:id/reset-binding",
  "/keys/:id/revoke",
  "/keys/:id/rotate",
  "/public-scans",
  "/scan/remediation",
  "/scan/remediation/bulk",
  "/schedules",
  "/teams",
  "/webhooks",
  "/webhooks/:id",
  "/webhooks/:id/deliveries",
  "/webhooks/:id/rotate-secret",
];

/**
 * Migration ratchet. Every /api/v3 route file that is not a permalink, as it
 * was before the move. A path in this list is decided by the 3.9.1 rules
 * (LEGACY_PUBLIC_API, a Bearer pass-through, the Bearer CSRF waiver) because
 * its file has not moved yet and a rewrite would 404. Each batch of moves
 * deletes its tails here; the list is empty when the last batch lands, and the
 * "legacy-v3" kind goes with it.
 */
export const LEGACY_V3_TAILS: readonly string[] = [
  "/account/ai-config",
  "/account/delete",
  "/account/discord",
  "/account/github",
  "/account/github/connect",
  "/account/github/repos",
  "/account/language",
  "/account/notifications",
  "/account/oauth/:provider",
  "/account/posture-digest",
  "/account/privacy",
  "/account/share-privacy",
  "/admin",
  "/admin/activity",
  "/admin/audit-log/export",
  "/admin/backup",
  "/admin/billing-overview",
  "/admin/blocked-data",
  "/admin/cleanup",
  "/admin/contact-submissions",
  "/admin/content",
  "/admin/email-logs",
  "/admin/engine-feedback/ai-tag-candidates",
  "/admin/engine-feedback/checks",
  "/admin/engine-feedback/checks/verdicts",
  "/admin/engine-feedback/promoted-tags",
  "/admin/engine-feedback/tags",
  "/admin/error-logs",
  "/admin/features",
  "/admin/health",
  "/admin/notifications",
  "/admin/notifications/:id",
  "/admin/queue-status",
  "/admin/queue-status/cancel",
  "/admin/scans/:id",
  "/admin/staff-invites",
  "/admin/support-tickets",
  "/admin/teams",
  "/admin/teams/:id",
  "/admin/updater/apply",
  "/admin/updater/status",
  "/ai/chat",
  "/ai/conversations",
  "/ai/feedback",
  "/ai/info",
  "/assets",
  "/auth/2fa/backup-codes",
  "/auth/2fa/disable",
  "/auth/2fa/email-send",
  "/auth/2fa/email-setup",
  "/auth/2fa/setup",
  "/auth/2fa/verify",
  "/auth/accept-tos",
  "/auth/discord",
  "/auth/forgot-password",
  "/auth/impersonation-stop",
  "/auth/login",
  "/auth/logout",
  "/auth/me",
  "/auth/oauth/:provider",
  "/auth/oauth/info",
  "/auth/onboarding",
  "/auth/resend-verification",
  "/auth/reset-password",
  "/auth/sessions",
  "/auth/sessions/:id",
  "/auth/sessions/ipv4",
  "/auth/signup",
  "/auth/staff-invite/:token",
  "/auth/staff-oidc",
  "/auth/staff-oidc/info",
  "/auth/trusted-devices",
  "/auth/trusted-devices/:id",
  "/auth/update",
  "/auth/verify-email",
  "/badge/scans",
  "/badge/site",
  "/billing",
  "/billing/plan-limits",
  "/billing/subscription/cancel",
  "/billing/subscription/reactivate",
  "/billing/verify",
  "/billing/verify/send",
  "/browser/sessions",
  "/browser/sessions/logs",
  "/checkout/verify-subscription",
  "/compare",
  "/config/client",
  "/contact",
  "/dashboard",
  "/data-request",
  "/demo-scan",
  "/domains",
  "/domains/:id",
  "/domains/:id/block",
  "/domains/:id/scans",
  "/domains/:id/verify",
  "/finding-types",
  "/history",
  "/history/:id",
  "/history/:id/delete",
  "/history/:id/dns",
  "/history/:id/ports",
  "/history/:id/report",
  "/history/:id/screenshot",
  "/history/:id/share",
  "/history/:id/share/publicly-listed",
  "/history/:id/summary",
  "/host/:hostname",
  "/host/:hostname/trend",
  "/keys",
  "/keys/:id/reset-binding",
  "/keys/:id/revoke",
  "/keys/:id/rotate",
  "/notifications",
  "/notifications/active",
  "/public-scans",
  "/scan",
  "/scan/authenticated",
  "/scan/bulk",
  "/scan/crawl",
  "/scan/crawl/discover",
  "/scan/discover",
  "/scan/discover/progress/:requestId",
  "/scan/feedback",
  "/scan/github",
  "/scan/github-issue",
  "/scan/github/history",
  "/scan/import-spec",
  "/scan/remediation",
  "/scan/remediation/bulk",
  "/scan/reputation",
  "/scan/screenshot/:id",
  "/scan/status/:id",
  "/scan/tags",
  "/scan/verify",
  "/scan/verify-batch",
  "/schedules",
  "/shared/:token",
  "/shared/:token/screenshot",
  "/shares",
  "/stripe/setup-products",
  "/stripe/setup-webhook",
  "/support-tickets",
  "/support-tickets/:id",
  "/support-tickets/:id/shares",
  "/support-tickets/:id/translate",
  "/teams",
  "/teams/accept-invite",
  "/teams/avatar/:teamId",
  "/teams/invitations",
  "/teams/member-scans",
  "/teams/members",
  "/teams/teammates",
  "/webhooks",
  "/webhooks/:id",
  "/webhooks/:id/deliveries",
  "/webhooks/:id/rotate-secret",
];

/**
 * The API entries of PUBLIC_PATHS in 3.9.1, verbatim, for the paths still
 * decided by the old rules. Each is a prefix: isLegacyPublicApi() is the
 * `startsWith` the middleware applied to the whole list, including the
 * over-broad ones ("/api/v3/badge" also covers badge/scans) that the exact
 * INTERNAL_ANONYMOUS list deliberately does not carry forward.
 */
export const LEGACY_PUBLIC_API: readonly string[] = [
  "/api/v3/auth/login",
  "/api/v3/auth/signup",
  "/api/v3/auth/forgot-password",
  "/api/v3/auth/reset-password",
  "/api/v3/auth/accept-tos",
  "/api/v3/auth/2fa/verify",
  "/api/v3/auth/verify-email",
  "/api/v3/auth/resend-verification",
  "/api/v3/auth/discord",
  "/api/v3/auth/discord/callback",
  "/api/v3/auth/oauth",
  "/api/v3/auth/staff-oidc",
  "/api/v3/auth/2fa/email-send",
  "/api/v3/health",
  "/api/version",
  "/api/security-txt",
  "/api/v3/whoami-ip",
  "/api/v3/account/language",
  "/api/v3/openapi.json",
  "/api/v3/billing/plan-limits",
  "/api/v3/config/client",
  "/api/v3/webhooks/stripe",
  "/api/v3/stripe/setup-webhook",
  "/api/v3/stripe/setup-products",
  "/api/v3/shared",
  "/api/v3/public-scans",
  "/api/v3/demo-scan",
  "/api/v3/contact",
  "/api/v3/badge",
  "/api/v3/avatar",
  "/api/v3/finding-types",
  "/api/v3/ai/info",
  "/api/v3/account/unsubscribe",
  "/api/v3/auth/staff-invite",
  "/api/v3/host",
];

export function isLegacyPublicApi(pathname: string): boolean {
  return LEGACY_PUBLIC_API.some((entry) => pathname.startsWith(entry));
}

/** The one tail served by two handlers, split on whether a Bearer header came. */
const BEARER_SPLIT_TAIL = "/auth/me";

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

function segmentsOf(path: string): string[] {
  return path.split("/").slice(1);
}

const isParam = (segment: string) => segment.startsWith(":");

/**
 * Whether `path` is an instance of `template`. A ":name" segment matches
 * exactly one non-empty segment; every other segment must be equal.
 */
export function matchTemplate(template: string, path: string): boolean {
  const want = segmentsOf(template);
  const have = segmentsOf(path);
  if (want.length !== have.length) return false;
  return want.every((segment, i) =>
    isParam(segment) ? have[i] !== "" : segment === have[i],
  );
}

/** Whether `a` is the more specific of two templates that both match one path. */
function moreSpecific(a: string, b: string): boolean {
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  for (let i = 0; i < left.length; i++) {
    const leftStatic = !isParam(left[i]);
    if (leftStatic !== !isParam(right[i])) return leftStatic;
  }
  return false;
}

function bestMatch<T>(
  rows: readonly T[],
  templateOf: (row: T) => string,
  path: string,
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!matchTemplate(templateOf(row), path)) continue;
    if (best === null || moreSpecific(templateOf(row), templateOf(best))) {
      best = row;
    }
  }
  return best;
}

function matchesAny(templates: readonly string[], tail: string): boolean {
  return templates.some((template) => matchTemplate(template, tail));
}

export function matchV4(tail: string): V4Route | null {
  return bestMatch(V4_ROUTES, (route) => route.template, tail);
}

function matchPermalink(path: string): Permalink | null {
  const candidates = PERMALINKS.filter((link) => {
    if (!matchTemplate(link.template, path)) return false;
    if (!link.except) return true;
    const have = segmentsOf(path);
    return segmentsOf(link.template).every(
      (segment, i) => !isParam(segment) || !link.except?.includes(have[i]),
    );
  });
  return bestMatch(candidates, (link) => link.template, path);
}

/**
 * Resolves a request path to the space that decides it. The order is the
 * contract and tests/lib/api/route-registry.test.ts pins it:
 *
 *   1. not /api: a page
 *   2. a permalink, before anything else, so /api/v3/webhooks/stripe can never
 *      fall into the webhooks/:id alias; a ":param" never matches one of the
 *      row's `except` segments, so /api/v3/badge/scans is not the badge token
 *   3. /api/v4: unsupported while "v4" is not in `supportedVersions`
 *   4. /api/internal
 *   5. /api/v3: legacy while the file has not moved, otherwise an alias
 *   6. any other /api/v<digits>: unsupported
 *   7. anything else under /api
 *
 * `supportedVersions` defaults to none, so a caller that forgets it keeps
 * /api/v4 dark instead of exposing it early.
 */
export function resolveApiPath(
  pathname: string,
  bearer: boolean,
  supportedVersions: readonly string[] = [],
): Resolved {
  const path = stripTrailingSlash(pathname);
  if (!path.startsWith("/api/")) {
    return path === "/api" ? { kind: "other-api", path } : { kind: "page" };
  }

  const link = matchPermalink(path);
  if (link) return { kind: "permalink", path, link };

  const rest = path.slice("/api/".length);
  const slash = rest.indexOf("/");
  const head = slash === -1 ? rest : rest.slice(0, slash);
  const tail = slash === -1 ? "" : rest.slice(slash);

  if (head === "v4") {
    return supportedVersions.includes("v4")
      ? { kind: "v4", path, route: matchV4(tail) }
      : { kind: "unsupported-version", version: head };
  }

  if (head === "internal") {
    return {
      kind: "internal",
      path,
      anonymous: INTERNAL_ANONYMOUS.some((entry) =>
        matchTemplate(entry.template, tail),
      ),
    };
  }

  if (head === "v3") {
    if (matchesAny(LEGACY_V3_TAILS, tail)) return { kind: "legacy-v3", path };

    const route = matchV4(tail);
    if (route && (tail !== BEARER_SPLIT_TAIL || bearer)) {
      return {
        kind: "alias",
        from: path,
        to: `${PREFIX.V4}${tail}`,
        target: "v4",
        route,
        documentedSessionOnly: false,
      };
    }
    return {
      kind: "alias",
      from: path,
      to: `${PREFIX.INTERNAL}${tail}`,
      target: "internal",
      documentedSessionOnly: matchesAny(DOCUMENTED_SESSION_ONLY, tail),
    };
  }

  if (/^v\d+$/.test(head))
    return { kind: "unsupported-version", version: head };
  return { kind: "other-api", path };
}
