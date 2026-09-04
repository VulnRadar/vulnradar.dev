// CLIENT-ONLY CONSTANTS (Source of Truth for Client-Safe Values)

// These constants are safe to use in client components and don't depend
// on server-only config loading. Role definitions, routes, UI styles, and
// every compiled config value a browser is allowed to see.
//
// THIS IS THE ONLY CONFIG MODULE A `"use client"` FILE MAY IMPORT.
// lib/config/constants.ts is its server-side superset: it re-exports
// everything here and adds the values that read non-public environment
// variables (SMTP_*, the server-resolved SUPPORT_EMAIL/LOGO_URL overrides).
// A client component that imports constants.ts drags those reads into the
// browser bundle, which is exactly what AUDIT-012#fe-15 measured: the
// committed build had `i.env.SMTP_PASS` and `i.env.BROWSERBASE_API_KEY` as
// bare expression statements in the /layout chunk, on all 311 routes. No
// secret leaked (Next only inlines NEXT_PUBLIC_*, so they evaluate to
// undefined) but the read sites shipped, one careless rename away from
// being real.
//
// The rule for adding something here: it may read `process.env.NEXT_PUBLIC_*`
// and nothing else. Anything that consults a bare server variable belongs in
// constants.ts or lib/config/server-constants.ts instead.
//
// The CONFIG_* values below come from lib/config/config-values.ts, which is
// pure data with no environment reads of its own. config-values.ts must not
// import from this file (see CONFIG_API_VERSION there): the dependency runs
// one way only, or the two deadlock at module init.

import {
  CONFIG_API_VERSION,
  CONFIG_AI_BOT_NAME,
  CONFIG_APP_NAME,
  CONFIG_APP_SLUG,
  CONFIG_APP_VERSION,
  CONFIG_APP_URL,
  CONFIG_APP_REPO,
  CONFIG_ENGINE_VERSION,
  CONFIG_TOTAL_CHECKS_LABEL,
  CONFIG_SUPPORT_EMAIL,
  CONFIG_LOGO_URL,
  CONFIG_DISCORD_INVITE_URL,
  CONFIG_SOCIAL_YOUTUBE_URL,
  CONFIG_SOCIAL_TIKTOK_URL,
  CONFIG_SOCIAL_INSTAGRAM_URL,
  CONFIG_SOCIAL_X_URL,
  CONFIG_SOCIAL_MASTODON_URL,
  CONFIG_SOCIAL_BLUESKY_URL,
  CONFIG_SOCIAL_LINKEDIN_URL,
  CONFIG_SOCIAL_REDDIT_URL,
  CONFIG_SOCIAL_RSS_URL,
  CONFIG_VERSION_COOKIE_NAME,
  CONFIG_VERSION_COOKIE_MAX_AGE_DAYS,
  CONFIG_TOTP_VALIDITY_SECONDS,
  CONFIG_PASSWORD_MIN_LENGTH,
  CONFIG_PASSWORD_RESET_HOURS,
  CONFIG_EMAIL_VERIFICATION_HOURS,
  CONFIG_DEVICE_TRUST_DAYS,
  CONFIG_NOTIFICATION_POLL_INTERVAL_MS,
  CONFIG_NOTIFICATION_DEFAULT_DISMISS_DAYS,
  CONFIG_MAX_URL_LENGTH,
  CONFIG_MAX_URLS_BULK,
  CONFIG_SCAN_TIMEOUT_SECONDS,
  CONFIG_BULK_SCAN_TIMEOUT_SECONDS,
  CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS,
  CONFIG_SCAN_STATUS_POLL_INTERVAL_MS,
  CONFIG_DEFAULT_SEVERITY_THRESHOLD,
  CONFIG_BILLING_ENABLED,
  CONFIG_BILLING_FREE_LIMIT,
  CONFIG_BILLING_CORE_SUPPORTER_LIMIT,
  CONFIG_BILLING_PRO_SUPPORTER_LIMIT,
  CONFIG_BILLING_ELITE_SUPPORTER_LIMIT,
  CONFIG_BILLING_FREE_RETENTION,
  CONFIG_BILLING_CORE_SUPPORTER_RETENTION,
  CONFIG_BILLING_PRO_SUPPORTER_RETENTION,
  CONFIG_BILLING_ELITE_SUPPORTER_RETENTION,
  CONFIG_API_CURRENT_VERSION,
  CONFIG_BROWSERBASE_LOGS_POLL_INTERVAL_MS,
  CONFIG_BROWSERBASE_VIEWPORT_WIDTH,
  CONFIG_BROWSERBASE_VIEWPORT_HEIGHT,
  CONFIG_DEMO_SCAN_LIMIT,
  CONFIG_AI_CHAT_HISTORY_DAYS,
  CONFIG_AI_CHAT_MAX_INPUT_LENGTH,
  CONFIG_AI_USAGE_WINDOW_HOURS,
  CONFIG_GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS,
  CONFIG_MAX_AVATAR_UPLOAD_BYTES,
  CONFIG_BULK_SCAN_CLIENT_URL_LIMIT,
  CONFIG_SCAN_AUTH_ENABLED,
  CONFIG_SCAN_AUTH_MAX_SECRET_LENGTH,
  CONFIG_SCAN_AUTH_MAX_COOKIES,
  CONFIG_SCAN_AUTH_VERIFY_TIMEOUT_MS,
  CONFIG_SCAN_AUTH_MAX_LOGIN_BODY_BYTES,
  CONFIG_SCAN_AUTH_MAX_COOKIE_AGE_SECONDS,
  CONFIG_SCAN_AUTH_BASELINE_DIFF_BYTES,
  CONFIG_SCAN_AUTH_BROWSER_NAV_TIMEOUT_MS,
  CONFIG_SCAN_AUTH_BROWSER_SETTLE_MS,
  CONFIG_SCAN_AUTH_BROWSER_MAX_WAIT_MS,
  CONFIG_SCAN_AUTH_BROWSER_SESSION_TIMEOUT_SECONDS,
  CONFIG_SCAN_AUTH_BROWSER_MAX_HTML_CHARS,
  CONFIG_FEATURE_DEMO_MODE,
  CONFIG_FEATURE_TEAMS,
  CONFIG_FEATURE_API_KEYS,
  CONFIG_FEATURE_WEBHOOKS,
  CONFIG_FEATURE_SCHEDULED_SCANS,
  CONFIG_FEATURE_BULK_SCANS,
  CONFIG_FEATURE_PDF_REPORTS,
  CONFIG_FEATURE_EMAIL_NOTIFICATIONS,
} from "./config-values";

// STAFF / ADMIN ROLES

export const STAFF_ROLES = {
  USER: "user",
  SUPPORT: "support",
  // The four roles below all sit at the same hierarchy tier (between
  // SUPPORT and MODERATOR) -- lateral specialists scoped to one nav
  // section each via STAFF_PERMISSIONS, not a step up the same ladder.
  // See lib/auth/permissions-client.ts's ROLE_PERMISSION_MAP for what
  // each actually grants.
  BILLING: "billing",
  SECURITY_ANALYST: "security_analyst",
  CONTENT_MANAGER: "content_manager",
  OPS: "ops",
  MODERATOR: "moderator",
  ADMIN: "admin",
  // super-admin: automatically assigned to the first user ever created
  // (see lib/auth/auth.ts::createUser and the 5.5.0-to-5.6.0 migration).
  // Sits above ADMIN in the hierarchy and is un-assignable through the
  // admin panel, see app/api/v3/admin/route.ts's set_role handler.
  SUPER_ADMIN: "super_admin",
} as const;

export type StaffRole = (typeof STAFF_ROLES)[keyof typeof STAFF_ROLES];

// Gaps of 10 between tiers leave room to insert future roles without
// renumbering everything else -- every comparison against this table goes
// through a named key (STAFF_ROLE_HIERARCHY.support, .moderator, etc.),
// never a hardcoded number, so the actual values here are free to shift.
export const STAFF_ROLE_HIERARCHY: Record<string, number> = {
  user: 0,
  support: 10,
  billing: 20,
  security_analyst: 20,
  content_manager: 20,
  ops: 20,
  moderator: 30,
  admin: 40,
  super_admin: 50,
};

export const STAFF_ROLE_LABELS: Record<string, string> = {
  user: "User",
  support: "Support",
  billing: "Billing",
  security_analyst: "Security Analyst",
  content_manager: "Content Manager",
  ops: "Ops",
  moderator: "Moderator",
  admin: "Admin",
  super_admin: "Super Admin",
};

// ROLE BADGE STYLES (used across admin, shared, staff pages)
//
// WARNING, and this has already cost three badges: THIS FILE IS NOT SCANNED
// BY TAILWIND. tailwind.config.mjs's `content` globs cover pages/,
// components/, app/ and root-level files only, not lib/, so a utility class
// that appears ONLY in this object generates no CSS at all. The failure is
// silent in every direction: the class name is still in the DOM, the build
// succeeds, nothing warns, and the badge simply renders with no background,
// no text colour and no border. That is exactly what happened to
// super_admin (violet-500), security_analyst (rose-500) and content_manager
// (indigo-500), none of which appear anywhere under app/ or components/.
//
// So: any class string added or changed here must also be listed in the
// `@source inline(...)` safelist at the top of app/globals.css. Classes
// built from CSS variables (bg-primary, text-muted-foreground, the
// hsl(var(--severity-*)) forms) are exempt only because they are used
// elsewhere in scanned files; do not assume a new one is.
export const ROLE_BADGE_STYLES: Record<string, string> = {
  // super-admin: a distinct color from admin's (not a reuse) so the badge
  // stands out at a glance in the users list, user detail panel, and the
  // active-staff panel.
  super_admin: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  admin: "bg-primary/10 text-primary border-primary/20",
  moderator:
    "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20",
  billing: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  security_analyst: "bg-rose-500/10 text-rose-500 border-rose-500/20",
  content_manager: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  ops: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  support: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  user: "bg-muted text-muted-foreground border-border",
};

// API VERSION - Change CONFIG_API_VERSION in config-values.ts to switch all
// API calls between versions; every entry of the API map below is built from
// it.

export const API_VERSION = CONFIG_API_VERSION;

// API ENDPOINTS (dynamically versioned)

export const API = {
  AUTH: {
    ME: `/api/${API_VERSION}/auth/me`,
    LOGIN: `/api/${API_VERSION}/auth/login`,
    SIGNUP: `/api/${API_VERSION}/auth/signup`,
    LOGOUT: `/api/${API_VERSION}/auth/logout`,
    UPDATE: `/api/${API_VERSION}/auth/update`,
    FORGOT_PASSWORD: `/api/${API_VERSION}/auth/forgot-password`,
    RESET_PASSWORD: `/api/${API_VERSION}/auth/reset-password`,
    VERIFY_EMAIL: `/api/${API_VERSION}/auth/verify-email`,
    RESEND_VERIFICATION: `/api/${API_VERSION}/auth/resend-verification`,
    ACCEPT_TOS: `/api/${API_VERSION}/auth/accept-tos`,
    ONBOARDING: `/api/${API_VERSION}/auth/onboarding`,
    OAUTH_INFO: `/api/${API_VERSION}/auth/oauth/info`,
    OAUTH_START: (provider: string) =>
      `/api/${API_VERSION}/auth/oauth/${provider}`,
    /** One staff invite, addressed by its token: GET reads the invite back
     *  (role, inviter, expiry) so the page can render it, POST accepts it and
     *  creates the account. Token-authenticated, no session: the invitee does
     *  not have an account yet, which is why "/staff-invite" and this route
     *  are both in lib/config/public-paths.ts. */
    STAFF_INVITE: (token: string) =>
      `/api/${API_VERSION}/auth/staff-invite/${token}`,
    STAFF_OIDC_INFO: `/api/${API_VERSION}/auth/staff-oidc/info`,
    STAFF_OIDC_START: `/api/${API_VERSION}/auth/staff-oidc`,
    IMPERSONATION_STOP: `/api/${API_VERSION}/auth/impersonation-stop`,
    TWO_FA: {
      SETUP: `/api/${API_VERSION}/auth/2fa/setup`,
      VERIFY: `/api/${API_VERSION}/auth/2fa/verify`,
      DISABLE: `/api/${API_VERSION}/auth/2fa/disable`,
      EMAIL_SETUP: `/api/${API_VERSION}/auth/2fa/email-setup`,
      BACKUP_CODES: `/api/${API_VERSION}/auth/2fa/backup-codes`,
    },
    SESSIONS: `/api/${API_VERSION}/auth/sessions`,
    SESSION_REVOKE: (id: string) => `/api/${API_VERSION}/auth/sessions/${id}`,
    /** Record the IPv4 the IPv4-only echo host observed onto the current
     *  session (POST { token }). See components/shared/ipv4-capture.tsx. */
    SESSION_IPV4: `/api/${API_VERSION}/auth/sessions/ipv4`,
    TRUSTED_DEVICES: `/api/${API_VERSION}/auth/trusted-devices`,
    TRUSTED_DEVICE_REVOKE: (id: number | string) =>
      `/api/${API_VERSION}/auth/trusted-devices/${id}`,
  },
  SCAN: `/api/${API_VERSION}/scan`,
  SCAN_STATUS: (id: string | number) => `/api/${API_VERSION}/scan/status/${id}`,
  /** Opt-in page screenshot bytes for one scan (owner/team/public gate). */
  SCAN_SCREENSHOT: (id: string | number) =>
    `/api/${API_VERSION}/scan/screenshot/${id}`,
  /** Owner-only: re-run just the DNS capture for one scan and update its
   *  result_meta, returning the fresh records (cheap, best-effort). */
  SCAN_REFRESH_DNS: (id: string | number) =>
    `/api/${API_VERSION}/history/${id}/dns`,
  /** Owner-only: re-run the curated port sweep for one scan (enforces the same
   *  verified-domain ownership gate the scan-time sweep uses). */
  SCAN_REFRESH_PORTS: (id: string | number) =>
    `/api/${API_VERSION}/history/${id}/ports`,
  /** Owner-only: re-capture the opt-in page screenshot for one scan (consumes
   *  the browser-minutes meter, same gate as the scan-time capture). */
  SCAN_REFRESH_SCREENSHOT: (id: string | number) =>
    `/api/${API_VERSION}/history/${id}/screenshot`,
  SCAN_TAGS: `/api/${API_VERSION}/scan/tags`,
  SCAN_DISCOVER: `/api/${API_VERSION}/scan/discover`,
  SCAN_DISCOVER_PROGRESS: (requestId: string) =>
    `/api/${API_VERSION}/scan/discover/progress/${requestId}`,
  SCAN_CRAWL: `/api/${API_VERSION}/scan/crawl`,
  /** Parse an uploaded API spec (OpenAPI/Swagger/Postman) into scan targets. */
  SCAN_IMPORT_SPEC: `/api/${API_VERSION}/scan/import-spec`,
  SCAN_CRAWL_DISCOVER: `/api/${API_VERSION}/scan/crawl/discover`,
  SCAN_AUTHENTICATED: `/api/${API_VERSION}/scan/authenticated`,
  DEMO_SCAN: `/api/${API_VERSION}/demo-scan`,
  HISTORY: `/api/${API_VERSION}/history`,
  /** Server-generated report for one scan: ?format=sarif|pdf|md|compliance|json. */
  HISTORY_REPORT: (id: number | string, format: string) =>
    `/api/${API_VERSION}/history/${id}/report?format=${format}`,
  /** Every distinct host the caller has scanned, grouped from their own
   *  scan_history, most-recently-scanned first (app/assets/page.tsx). */
  ASSETS: `/api/${API_VERSION}/assets`,
  DASHBOARD: `/api/${API_VERSION}/dashboard`,
  SHARES: `/api/${API_VERSION}/shares`,
  SHARED: `/api/${API_VERSION}/shared`,
  /** Toggle one share's Public Scans directory listing on/off (Shared page row menu). */
  SHARE_PUBLICLY_LISTED: (id: string | number) =>
    `/api/${API_VERSION}/history/${id}/share/publicly-listed`,
  /** Public, unauthenticated: paginated directory of publicly-listed shares (app/public-scans/page.tsx). */
  PUBLIC_SCANS: `/api/${API_VERSION}/public-scans`,
  KEYS: `/api/${API_VERSION}/keys`,
  WEBHOOKS: `/api/${API_VERSION}/webhooks`,
  SCHEDULES: `/api/${API_VERSION}/schedules`,
  DOMAINS: `/api/${API_VERSION}/domains`,
  TEAMS: `/api/${API_VERSION}/teams`,
  TEAMS_MEMBERS: `/api/${API_VERSION}/teams/members`,
  TEAMS_MEMBER_SCANS: `/api/${API_VERSION}/teams/member-scans`,
  /** Everyone the caller shares a team with (for the remediation assignee
   *  picker). GET only. */
  TEAMS_TEAMMATES: `/api/${API_VERSION}/teams/teammates`,
  TEAMS_ACCEPT_INVITE: `/api/${API_VERSION}/teams/accept-invite`,
  /** The caller's own pending team invitations: GET to list, DELETE to
   *  decline (accept stays TEAMS_ACCEPT_INVITE by inviteId). */
  TEAMS_INVITATIONS: `/api/${API_VERSION}/teams/invitations`,
  NOTIFICATIONS: `/api/${API_VERSION}/notifications`,
  CONTACT: `/api/${API_VERSION}/contact`,
  LANDING_CONTACT: `/api/${API_VERSION}/landing-contact`,
  /** In-app support tickets: GET the caller's own tickets, POST to open one. */
  SUPPORT_TICKETS: `/api/${API_VERSION}/support-tickets`,
  /** One ticket + its thread: GET (owner or staff), POST a reply, PATCH status. */
  SUPPORT_TICKET: (id: number | string) =>
    `/api/${API_VERSION}/support-tickets/${id}`,
  /** Owner-only sharing of a ticket with specific teammates: GET/POST/DELETE. */
  SUPPORT_TICKET_SHARES: (id: number | string) =>
    `/api/${API_VERSION}/support-tickets/${id}/shares`,
  /** Staff inbox listing every user's ticket (MANAGE_SUPPORT_TICKETS). */
  ADMIN_SUPPORT_TICKETS: `/api/${API_VERSION}/admin/support-tickets`,
  ADMIN: `/api/${API_VERSION}/admin`,
  BADGE: `/api/${API_VERSION}/badge`,
  BADGE_SCANS: `/api/${API_VERSION}/badge/scans`,
  /** Create/fetch (POST) or revoke (DELETE) the stable, auto-updating
   *  badge token for one of the caller's own scans' URL. */
  BADGE_SITE: `/api/${API_VERSION}/badge/site`,
  DATA_REQUEST: `/api/${API_VERSION}/data-request`,
  ACCOUNT_NOTIFICATIONS: `/api/${API_VERSION}/account/notifications`,
  ACCOUNT_PRIVACY: `/api/${API_VERSION}/account/privacy`,
  /** Account-level "list new shares in Public Scans by default" setting. */
  ACCOUNT_SHARE_PRIVACY: `/api/${API_VERSION}/account/share-privacy`,
  /** Account-level posture-digest email opt-in. */
  ACCOUNT_POSTURE_DIGEST: `/api/${API_VERSION}/account/posture-digest`,
  ACCOUNT_AI_CONFIG: `/api/${API_VERSION}/account/ai-config`,
  ACCOUNT_GITHUB: `/api/${API_VERSION}/account/github`,
  ACCOUNT_GITHUB_CONNECT: `/api/${API_VERSION}/account/github/connect`,
  ACCOUNT_GITHUB_REPOS: `/api/${API_VERSION}/account/github/repos`,
  SCAN_GITHUB: `/api/${API_VERSION}/scan/github`,
  SCAN_GITHUB_HISTORY: `/api/${API_VERSION}/scan/github/history`,
  /** File a scan's findings as a GitHub issue (VulnRadar GitHub Scanner). */
  SCAN_GITHUB_ISSUE: `/api/${API_VERSION}/scan/github-issue`,
  SCAN_VERIFY: `/api/${API_VERSION}/scan/verify`,
  /** Mark a single finding false_positive / confirmed / not_applicable
   *  (app/api/v3/scan/feedback/route.ts). GET reads back the caller's own
   *  verdicts; POST upserts one. */
  SCAN_FEEDBACK: `/api/${API_VERSION}/scan/feedback`,
  /** The owner's per-finding remediation status (Open / In progress / Fixed
   *  / Accepted risk / Won't fix) with an optional note + free-text
   *  assignee, keyed on the stable finding_id so it persists across rescans
   *  (app/api/v3/scan/remediation/route.ts). GET reads the caller's own
   *  statuses for a target/finding; POST upserts one (status 'open' clears
   *  it); DELETE clears one. Distinct from SCAN_FEEDBACK's accuracy verdict. */
  SCAN_REMEDIATION: `/api/${API_VERSION}/scan/remediation`,
  /** Apply one remediation change (status + optional assignee/due) to many
   *  findings at once (the results-list bulk bar). POST only. */
  SCAN_REMEDIATION_BULK: `/api/${API_VERSION}/scan/remediation/bulk`,
  /** Public, unauthenticated: the whole check catalogue (id, type, title,
   *  category, severity, description) plus per-category counts. */
  FINDING_TYPES: `/api/${API_VERSION}/finding-types`,
  AI_INFO: `/api/${API_VERSION}/ai/info`,
  ACCOUNT: `/api/${API_VERSION}/account/delete`,
  COMPARE: `/api/${API_VERSION}/compare`,
  BILLING: `/api/${API_VERSION}/billing`,
  SUBSCRIPTION_CANCEL: `/api/${API_VERSION}/billing/subscription/cancel`,
  SUBSCRIPTION_REACTIVATE: `/api/${API_VERSION}/billing/subscription/reactivate`,
  BROWSER_SESSIONS: `/api/${API_VERSION}/browser/sessions`,
  BROWSER_SESSION_LOGS: `/api/${API_VERSION}/browser/sessions/logs`,
  VERSION: "/api/version",
  /** Public OpenAPI 3.1 description of the v3 API (for API clients + the docs
   *  explorer). */
  OPENAPI: "/api/v3/openapi.json",
  /** Public, unauthenticated: the latest public scan of a host, if any (app/host/[hostname]/page.tsx). */
  HOST: (hostname: string) => `/api/${API_VERSION}/host/${hostname}`,
  /** Public, unauthenticated: up to the last 30 public/completed scans' risk scores for a host, oldest first (components/host/danger-score-trend.tsx). */
  HOST_TREND: (hostname: string) =>
    `/api/${API_VERSION}/host/${hostname}/trend`,
} as const;

// APPLICATION ROUTES

export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  SIGNUP: "/signup",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",
  VERIFY_EMAIL: "/verify-email",
  DASHBOARD: "/dashboard",
  PROFILE: "/profile",
  TEAMS: "/teams",
  TEAMS_JOIN: "/teams/join",
  HISTORY: "/history",
  /** Browsable, searchable index of every host/URL the caller has scanned,
   *  each row linking to its /host/[hostname] aggregate report. */
  ASSETS: "/assets",
  /** Verified-domain portfolio / attack-surface view (app/attack-surface). */
  ATTACK_SURFACE: "/attack-surface",
  REPOS: "/repos",
  COMPARE: "/compare",
  SHARES: "/shares",
  /** Public, no-login directory of shares someone chose to list (see app/public-scans/page.tsx). */
  PUBLIC_SCANS: "/public-scans",
  BADGE: "/badge",
  DEMO: "/demo",
  CONTACT: "/contact",
  DONATE: "/donate",
  PRICING: "/pricing",
  LANDING: "/landing",
  LEGAL_TERMS: "/legal/terms",
  LEGAL_PRIVACY: "/legal/privacy",
  LEGAL_DISCLAIMER: "/legal/disclaimer",
  LEGAL_ACCEPTABLE_USE: "/legal/acceptable-use",
  GDPR_REQUEST: "/legal/privacy#gdpr",
  CHANGELOG: "/changelog",
  DOCS: "/docs",
  DOCS_API: "/docs/api",
  /** Interactive API explorer (app/docs/api/playground). */
  API_PLAYGROUND: "/docs/api/playground",
  DOCS_SETUP: "/docs/setup",
  DOCS_DEVELOPERS: "/docs/developers",
  ADMIN: "/admin",
  BROWSER: (id: string) => `/browser/${id}`,
  /** Public, no-login scan report for a host's latest public scan (see app/host/[hostname]/page.tsx). */
  HOST: (hostname: string) => `/host/${hostname}`,
} as const;

// SEVERITY LEVELS & COLORS

export const SEVERITY_LEVELS = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
} as const;

// A fifth severity colour map used to live here with no importers at all,
// while components/scanner/severity-badge.tsx (SEVERITY_TONE),
// components/docs/docs-types.ts, lib/seo/seo-ui.tsx and lib/reports/
// pdf-report.ts each kept their own. Removed rather than left as a tempting
// "shared" table for someone to consolidate onto, since three of those four
// encode severity order under mutually incompatible numeric conventions.

// API KEY SCOPES
//
// Deliberately small: three scopes covering the real capability boundaries
// that exist today (create work vs. read data vs. destroy data), not a
// per-endpoint permission matrix. See lib/api/api-key-scopes.ts for the
// server-side check and lib/api/api-keys.ts for where a key's scopes are
// resolved from the database.

export const API_KEY_SCOPES = {
  SCAN_WRITE: "scan:write",
  SCAN_READ: "scan:read",
  SCAN_DELETE: "scan:delete",
} as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[keyof typeof API_KEY_SCOPES];

export const ALL_API_KEY_SCOPES: ApiKeyScope[] = Object.values(API_KEY_SCOPES);

// What a newly created key gets when the caller doesn't specify scopes
// explicitly (e.g. the "Create key" button's default state). Write + read
// covers the common CI/CD integration -- trigger a scan, read the result --
// without handing out delete-all-history power a fresh integration token
// has no business holding by default.
export const DEFAULT_NEW_KEY_SCOPES: ApiKeyScope[] = [
  API_KEY_SCOPES.SCAN_WRITE,
  API_KEY_SCOPES.SCAN_READ,
];

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "scan:write": "Trigger scans",
  "scan:read": "Read history & results",
  "scan:delete": "Delete scan history",
};

export const API_KEY_SCOPE_DESCRIPTIONS: Record<ApiKeyScope, string> = {
  "scan:write":
    "Start scans -- POST /scan, /scan/bulk, /scan/crawl, and the discovery/verification endpoints that support them.",
  "scan:read": "Read scan history, individual results, and scan status.",
  "scan:delete": "Delete an individual scan or clear all scan history.",
};

// A key with no scopes column value (NULL) predates scoping entirely --
// grandfathered in as full access so it keeps working exactly as it did
// before this column existed. Any other non-array shape is treated the
// same way rather than as "zero scopes", so a malformed value fails open
// to "no more than it already had" instead of breaking the key outright.
// The only place this should be called from is
// lib/api/api-key-scopes.ts's hasApiKeyScope -- kept here (not there)
// because it's pure and client-safe, matching every other constant in
// this file.
export function resolveApiKeyScopes(scopes: unknown): ApiKeyScope[] {
  return Array.isArray(scopes) ? (scopes as ApiKeyScope[]) : ALL_API_KEY_SCOPES;
}

// EXTERNAL LINK-OUTS

/**
 * Third-party inspector for a scanned URL's Open Graph / social-share tags.
 * `{url}` is replaced with the URL-encoded target. This is a deliberate
 * link-out (we send the user to the service, we do not fetch OG data
 * ourselves), keeping the social-preview surface off our own engine. Set to an
 * empty string to hide the link, or point it at a different service per
 * deployment.
 */
export const OG_INSPECT_URL_TEMPLATE: string =
  "https://www.opengraph.xyz/url/{url}";

// APPLICATION METADATA (from config-values.ts -> config.yaml)
//
// These moved down from constants.ts (AUDIT-012#fe-15). Thirty-seven client
// components read APP_NAME alone, and every one of them was importing the
// server config module to get a string literal. constants.ts re-exports the
// whole block, so server callers are unaffected.

export const APP_NAME = CONFIG_APP_NAME;
export const APP_SLUG = CONFIG_APP_SLUG;
export const AI_BOT_NAME = CONFIG_AI_BOT_NAME;
export const APP_VERSION = CONFIG_APP_VERSION;
export const ENGINE_VERSION = CONFIG_ENGINE_VERSION;
export const TOTAL_CHECKS_LABEL = CONFIG_TOTAL_CHECKS_LABEL;
export const APP_REPO = CONFIG_APP_REPO;
export const API_CURRENT_VERSION = CONFIG_API_CURRENT_VERSION;

// Self-hosters set NEXT_PUBLIC_APP_URL (see the Dockerfile's build ARG and
// .env.example); read it here so it actually reaches this constant instead
// of always resolving to the hardcoded CONFIG_APP_URL placeholder. Every
// consumer of APP_URL (emails, sitemap.xml, robots.txt, canonical/OG tags,
// PDF/SARIF reports, webhook payloads, docs) picks this up too.
//
// Still fully synchronous, so it has no idea about a database admin
// override: an admin-panel APP_URL change reaches THIS export -- and
// therefore every client bundle, since Next.js inlines NEXT_PUBLIC_* at
// `next build` time -- only after a rebuild and redeploy. Server code that
// needs the live, no-rebuild-required value (currently only the
// OAuth/Discord/GitHub sign-in routes, which must get their redirect_uri
// right on every request) should call resolveAppUrl(request) from
// lib/config/runtime-config.ts instead.
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || CONFIG_APP_URL;

// Scan note with version info
export const DEFAULT_SCAN_NOTE = `${APP_NAME} v${APP_VERSION} (Detection Engine v${ENGINE_VERSION})`;

/**
 * The browser half of the support address.
 *
 * constants.ts declares its own SUPPORT_EMAIL that also honours the bare
 * `SUPPORT_EMAIL` server variable, so an operator gets their own address in
 * outgoing mail without a rebuild. That branch cannot work here: Next only
 * inlines `NEXT_PUBLIC_*` into client code, so a bare `process.env.SUPPORT_EMAIL`
 * read in a browser bundle is always `undefined` and only ever shipped the
 * variable name. The two declarations therefore resolve to exactly the same
 * value they always did on each side; the difference is that this one no
 * longer carries a dead server-variable read into every page.
 *
 * Self-hosters set both, or neither.
 */
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || CONFIG_SUPPORT_EMAIL;

// Same split as SUPPORT_EMAIL above: constants.ts layers the bare `LOGO_URL`
// server variable on top of this for email templates and report headers,
// which is a read the browser can never satisfy. Client code gets the
// deployment's own APP_URL joined to the shipped logo path.
export const LOGO_URL = `${APP_URL}${CONFIG_LOGO_URL}`;

// Same reasoning as the extension store URLs in constants.ts: this is
// VulnRadar's own server and it lands in the JSON-LD sameAs array, the
// footer, and llms.txt.
export const DISCORD_INVITE_URL =
  process.env.NEXT_PUBLIC_DISCORD_INVITE_URL || CONFIG_DISCORD_INVITE_URL;

// SOCIAL ACCOUNTS
//
// One registry, read by the footer, by the landing page's open-source
// section, and by the JSON-LD Organization node's sameAs array, so those
// three can never disagree about which accounts exist. A platform with no URL
// is dropped once, here, instead of being guarded at each render site.
//
// Icons are deliberately NOT in this table: it is data, and this module is
// imported by server code and by tests. components/shared/social-links.tsx
// owns the id -> mark mapping and is exhaustive over SocialPlatformId, so a
// new id below fails typecheck there until it has a mark.

export const SOCIAL_PLATFORM_IDS = [
  "youtube",
  "tiktok",
  "instagram",
  "x",
  "discord",
  "mastodon",
  "bluesky",
  "linkedin",
  "reddit",
  "rss",
] as const;

export type SocialPlatformId = (typeof SOCIAL_PLATFORM_IDS)[number];

export interface SocialLink {
  id: SocialPlatformId;
  /** Accessible name for the icon-only link, and its tooltip. */
  label: string;
  url: string;
  /**
   * Whether this URL identifies the organisation, which is what schema.org's
   * sameAs means. True for a profile. False for the RSS feed: a document the
   * site publishes is not an account that is the site.
   */
  identity: boolean;
}

// Render order, most-used first. Discord reads DISCORD_INVITE_URL rather than
// a CONFIG_SOCIAL_DISCORD_URL of its own, so the invite lives in exactly one
// place (see the note in config-values.ts).
const DECLARED_SOCIAL_LINKS: SocialLink[] = [
  {
    id: "youtube",
    label: "YouTube",
    url:
      process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE_URL || CONFIG_SOCIAL_YOUTUBE_URL,
    identity: true,
  },
  {
    id: "tiktok",
    label: "TikTok",
    url: process.env.NEXT_PUBLIC_SOCIAL_TIKTOK_URL || CONFIG_SOCIAL_TIKTOK_URL,
    identity: true,
  },
  {
    id: "instagram",
    label: "Instagram",
    url:
      process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM_URL ||
      CONFIG_SOCIAL_INSTAGRAM_URL,
    identity: true,
  },
  {
    id: "x",
    label: "X",
    url: process.env.NEXT_PUBLIC_SOCIAL_X_URL || CONFIG_SOCIAL_X_URL,
    identity: true,
  },
  { id: "discord", label: "Discord", url: DISCORD_INVITE_URL, identity: true },
  {
    id: "mastodon",
    label: "Mastodon",
    url:
      process.env.NEXT_PUBLIC_SOCIAL_MASTODON_URL || CONFIG_SOCIAL_MASTODON_URL,
    identity: true,
  },
  {
    id: "bluesky",
    label: "Bluesky",
    url:
      process.env.NEXT_PUBLIC_SOCIAL_BLUESKY_URL || CONFIG_SOCIAL_BLUESKY_URL,
    identity: true,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    url:
      process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN_URL || CONFIG_SOCIAL_LINKEDIN_URL,
    identity: true,
  },
  {
    id: "reddit",
    label: "Reddit",
    url: process.env.NEXT_PUBLIC_SOCIAL_REDDIT_URL || CONFIG_SOCIAL_REDDIT_URL,
    identity: true,
  },
  {
    id: "rss",
    label: "RSS feed",
    url: process.env.NEXT_PUBLIC_SOCIAL_RSS_URL || CONFIG_SOCIAL_RSS_URL,
    identity: false,
  },
];

/**
 * The platforms this deployment actually has, in render order. Empty on a
 * deployment that configured none, and every consumer renders nothing at all
 * in that case rather than an empty container.
 *
 * "Configured" means an absolute https URL, not merely a non-empty string.
 * These values reach an `href` and can be set by whoever deploys this, so a
 * relative path, an http origin, or a `javascript:` payload all collapse to
 * the same safe outcome as leaving the platform unset: it does not render.
 */
export const SOCIAL_LINKS: SocialLink[] = DECLARED_SOCIAL_LINKS.filter((link) =>
  link.url.startsWith("https://"),
);

/**
 * The configured profile URLs, deduplicated, for the JSON-LD Organization
 * node's sameAs array. Not simply every configured URL: sameAs asserts
 * identity, so the RSS feed is excluded by its `identity: false`.
 */
export const SOCIAL_PROFILE_URLS: string[] = [
  ...new Set(
    SOCIAL_LINKS.filter((link) => link.identity).map((link) => link.url),
  ),
];

// TURNSTILE / CAPTCHA
//
// Site key, not secret key: NEXT_PUBLIC_ by design, since the widget itself
// renders in the browser. The secret half (TURNSTILE_SECRET_KEY) is read
// only by the verification helper on the server and never appears here.
export const TURNSTILE_ENABLED = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// VERSION NOTIFICATION COOKIE

export const VERSION_COOKIE_NAME = CONFIG_VERSION_COOKIE_NAME;
export const VERSION_COOKIE_MAX_AGE =
  60 * 60 * 24 * CONFIG_VERSION_COOKIE_MAX_AGE_DAYS;

// AUTH TIMINGS SHOWN IN THE UI
//
// These are the compiled defaults the auth forms quote back to the user
// ("the link expires in N hours", "codes rotate every N seconds"). The
// enforcing checks read the live admin setting; these only render copy.

export const TOTP_CODE_VALIDITY = CONFIG_TOTP_VALIDITY_SECONDS;
export const PASSWORD_MIN_LENGTH = CONFIG_PASSWORD_MIN_LENGTH;
export const PASSWORD_RESET_TOKEN_LIFETIME =
  60 * 60 * CONFIG_PASSWORD_RESET_HOURS;
export const EMAIL_VERIFICATION_TOKEN_LIFETIME =
  60 * 60 * CONFIG_EMAIL_VERIFICATION_HOURS;
export const DEVICE_TRUST_DURATION = 60 * 60 * 24 * CONFIG_DEVICE_TRUST_DAYS;

// NOTIFICATION BELL

export const NOTIFICATION_POLL_INTERVAL_MS =
  CONFIG_NOTIFICATION_POLL_INTERVAL_MS;
export const NOTIFICATION_DEFAULT_DISMISS_MAX_AGE =
  60 * 60 * 24 * CONFIG_NOTIFICATION_DEFAULT_DISMISS_DAYS;

// BROWSER SESSION VIEWER
//
// The TTL ceilings that actually cap a session live in constants.ts next to
// the Browserbase credential check. The two values here are the ones the
// browser needs: how often the network dock polls, and the resolution the
// remote browser was created at, which is what the viewer sizes its embed
// frame from so the live view keeps the remote screen's aspect ratio.
export const BROWSERBASE_LOGS_POLL_INTERVAL_MS =
  CONFIG_BROWSERBASE_LOGS_POLL_INTERVAL_MS;

export const BROWSERBASE_VIEWPORT = {
  WIDTH: CONFIG_BROWSERBASE_VIEWPORT_WIDTH,
  HEIGHT: CONFIG_BROWSERBASE_VIEWPORT_HEIGHT,
} as const;

// SCAN LIMITS SHOWN IN THE UI

export const SCANNING = {
  MAX_URL_LENGTH: CONFIG_MAX_URL_LENGTH,
  MAX_URLS_IN_BULK: CONFIG_MAX_URLS_BULK,
  TIMEOUT_SECONDS: CONFIG_SCAN_TIMEOUT_SECONDS,
  BULK_TIMEOUT_SECONDS: CONFIG_BULK_SCAN_TIMEOUT_SECONDS,
  CRAWL_TIMEOUT_SECONDS: CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS,
  STATUS_POLL_INTERVAL_MS: CONFIG_SCAN_STATUS_POLL_INTERVAL_MS,
  DEFAULT_SEVERITY_THRESHOLD: CONFIG_DEFAULT_SEVERITY_THRESHOLD,
};

export const BULK_SCAN_CLIENT_URL_LIMIT = CONFIG_BULK_SCAN_CLIENT_URL_LIMIT;
export const MAX_AVATAR_UPLOAD_BYTES = CONFIG_MAX_AVATAR_UPLOAD_BYTES;
export const DEMO_SCAN_LIMIT = CONFIG_DEMO_SCAN_LIMIT;

// AUTHENTICATED SCANNING (fully ephemeral: see lib/scanner/auth/types.ts and
// app/api/v3/scan/authenticated/route.ts). The client form reads the same
// caps the server enforces so it can validate before submitting.

export const SCAN_AUTH = {
  ENABLED: CONFIG_SCAN_AUTH_ENABLED,
  MAX_SECRET_LENGTH: CONFIG_SCAN_AUTH_MAX_SECRET_LENGTH,
  MAX_COOKIES: CONFIG_SCAN_AUTH_MAX_COOKIES,
  VERIFY_TIMEOUT_MS: CONFIG_SCAN_AUTH_VERIFY_TIMEOUT_MS,
  MAX_LOGIN_BODY_BYTES: CONFIG_SCAN_AUTH_MAX_LOGIN_BODY_BYTES,
  MAX_COOKIE_AGE_SECONDS: CONFIG_SCAN_AUTH_MAX_COOKIE_AGE_SECONDS,
  BASELINE_DIFF_BYTES: CONFIG_SCAN_AUTH_BASELINE_DIFF_BYTES,
  BROWSER_NAV_TIMEOUT_MS: CONFIG_SCAN_AUTH_BROWSER_NAV_TIMEOUT_MS,
  BROWSER_SETTLE_MS: CONFIG_SCAN_AUTH_BROWSER_SETTLE_MS,
  BROWSER_MAX_WAIT_MS: CONFIG_SCAN_AUTH_BROWSER_MAX_WAIT_MS,
  BROWSER_SESSION_TIMEOUT_SECONDS:
    CONFIG_SCAN_AUTH_BROWSER_SESSION_TIMEOUT_SECONDS,
  BROWSER_MAX_HTML_CHARS: CONFIG_SCAN_AUTH_BROWSER_MAX_HTML_CHARS,
};

// AI CHAT / AI USAGE (values the UI quotes back to the user)

export const AI_CHAT_HISTORY_DAYS = CONFIG_AI_CHAT_HISTORY_DAYS;
export const AI_CHAT_MAX_INPUT_LENGTH = CONFIG_AI_CHAT_MAX_INPUT_LENGTH;
export const AI_USAGE_WINDOW_HOURS = CONFIG_AI_USAGE_WINDOW_HOURS;

// Shipped default only, for the /pricing comparison table's "1 free review /
// Nhr" cell. The enforcement path resolves the live setting
// (getSetting("GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS") in
// lib/billing/github-review-usage.ts); that whole table is documented as
// showing what this deployment ships with, not what an admin has since
// edited, exactly like AI_USAGE_WINDOW_HOURS above.
export const GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS =
  CONFIG_GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS;

// BILLING / PREMIUM
//
// When BILLING_ENABLED is false, all users get unlimited access.
// Self-hosters can disable this to remove all premium restrictions.

export const BILLING_ENABLED = CONFIG_BILLING_ENABLED;
export const BILLING_PLAN_LIMITS = {
  free: CONFIG_BILLING_FREE_LIMIT,
  core_supporter: CONFIG_BILLING_CORE_SUPPORTER_LIMIT,
  pro_supporter: CONFIG_BILLING_PRO_SUPPORTER_LIMIT,
  elite_supporter: CONFIG_BILLING_ELITE_SUPPORTER_LIMIT,
};
export const BILLING_HISTORY_RETENTION = {
  free: CONFIG_BILLING_FREE_RETENTION,
  core_supporter: CONFIG_BILLING_CORE_SUPPORTER_RETENTION,
  pro_supporter: CONFIG_BILLING_PRO_SUPPORTER_RETENTION,
  elite_supporter: CONFIG_BILLING_ELITE_SUPPORTER_RETENTION,
};

// FEATURE FLAGS

export const FEATURES = {
  DEMO_MODE: CONFIG_FEATURE_DEMO_MODE,
  TEAMS: CONFIG_FEATURE_TEAMS,
  API_KEYS: CONFIG_FEATURE_API_KEYS,
  WEBHOOKS: CONFIG_FEATURE_WEBHOOKS,
  SCHEDULED_SCANS: CONFIG_FEATURE_SCHEDULED_SCANS,
  BULK_SCANS: CONFIG_FEATURE_BULK_SCANS,
  PDF_REPORTS: CONFIG_FEATURE_PDF_REPORTS,
  EMAIL_NOTIFICATIONS: CONFIG_FEATURE_EMAIL_NOTIFICATIONS,
} as const;

// VULNERABILITY SEVERITY ORDER
//
// The single ordering. Everything that sorts, compares or iterates severities
// reads one of these two exports.
//
// SEVERITY_ORDER is worst-first, which is the order a results list, a report
// section and an AI prompt all render in. SEVERITY_PRIORITY is the numeric
// form of the same thing, higher meaning worse, so a worst-first sort is
// always `SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity]` and
// "at least this bad" is always `>=`.
//
// This used to be nine private tables under three mutually incompatible
// numeric conventions: critical counted down from 5 in two of them, up from 0
// in four, and up from 0 with info at the bottom in three, with two of the
// nine sharing the identifier SEVERITY_RANK. A comparator copied from one
// file into another silently inverted, and nothing typechecked differently.
// ref: AUDIT-013#dup-02
export const SEVERITY_ORDER = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;

/** The severity names, in the order above. Structurally the same union as
 *  `Severity` in lib/scanner/types.ts, declared here so this module (which
 *  every `"use client"` file may import) stays free of scanner imports. */
export type SeverityName = (typeof SEVERITY_ORDER)[number];

export const SEVERITY_PRIORITY: Record<SeverityName, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

// TEAM ROLES
//
// Client-side too: the members list, the invite form and the scan actions
// menu all gate controls on hasTeamPermission, and they must agree with the
// server checks in app/api/v3/teams/**, which is why there is one table.
//
// MANAGER and OPERATOR are the two other real combinations of the 4
// underlying capabilities (manage_team/manage_members/manage_scans, all on
// top of view_reports, which every role gets) besides the pre-existing
// ADMIN (members+scans) and MEMBER (scans only): a people/settings admin
// who isn't a scan operator, and a scan operator who can also adjust team
// settings but doesn't handle onboarding/offboarding. delete_team is its
// own permission, owner-only -- deleting a team is a strictly bigger blast
// radius than renaming it, so it doesn't just ride along with manage_team.
export const TEAM_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MANAGER: "manager",
  OPERATOR: "operator",
  MEMBER: "member",
  VIEWER: "viewer",
};

export const TEAM_ROLE_PERMISSIONS = {
  [TEAM_ROLES.OWNER]: [
    "manage_team",
    "delete_team",
    "manage_members",
    "manage_scans",
    "view_reports",
  ],
  [TEAM_ROLES.ADMIN]: [
    "manage_team",
    "manage_members",
    "manage_scans",
    "view_reports",
  ],
  [TEAM_ROLES.MANAGER]: ["manage_team", "manage_members", "view_reports"],
  [TEAM_ROLES.OPERATOR]: ["manage_team", "manage_scans", "view_reports"],
  [TEAM_ROLES.MEMBER]: ["manage_scans", "view_reports"],
  [TEAM_ROLES.VIEWER]: ["view_reports"],
};

// Grammatically correct "as a/an X" phrasing per role -- a plain
// TEAM_ROLES.MANAGER -> "as an manager" string-concat would read wrong,
// since the right article depends on the role name's own first sound.
// Excludes OWNER: never assigned through an invite (see
// app/api/v3/teams/members/route.ts's INVITABLE_TEAM_ROLES), so no
// invite-notification copy ever needs to say "as the owner".
export const TEAM_ROLE_INVITE_LABELS: Record<string, string> = {
  [TEAM_ROLES.ADMIN]: "an admin",
  [TEAM_ROLES.MANAGER]: "a manager",
  [TEAM_ROLES.OPERATOR]: "an operator",
  [TEAM_ROLES.MEMBER]: "a member",
  [TEAM_ROLES.VIEWER]: "a viewer",
};

/**
 * Whether a team role grants a given team permission. Pure and client-safe
 * (no DB import) so both server routes (app/api/v3/teams/route.ts,
 * teams/members/route.ts, lib/auth/team-resource-access.ts) and client
 * components (components/teams/team-members-list.tsx) can share one
 * implementation instead of drifting copies.
 */
export function hasTeamPermission(
  role: string | undefined,
  permission: string,
): boolean {
  if (!role) return false;
  const perms =
    TEAM_ROLE_PERMISSIONS[role as keyof typeof TEAM_ROLE_PERMISSIONS];
  return Array.isArray(perms) && perms.includes(permission);
}

/**
 * Role ceiling: a caller may only grant, or act on, a team role whose
 * permission set is a SUBSET of the caller's own. The team roles are a partial
 * order, not a strict ladder (manager has manage_members but not manage_scans;
 * operator is the reverse), so a plain numeric rank can't express it -- subset
 * is the correct relation. Without this, a manager (manage_members, NOT
 * manage_scans) could promote a member to admin and thereby hand out
 * manage_scans, a capability the manager itself lacks (escalation by proxy), or
 * demote/remove an admin that outranks them. Owner holds every permission, so
 * owner can assign or act on any role; nobody can act on a role that holds a
 * permission they don't (returns false for an unknown role on either side).
 */
export function canAssignTeamRole(
  callerRole: string | undefined,
  otherRole: string | undefined,
): boolean {
  if (!callerRole || !otherRole) return false;
  const callerPerms =
    TEAM_ROLE_PERMISSIONS[callerRole as keyof typeof TEAM_ROLE_PERMISSIONS];
  const otherPerms =
    TEAM_ROLE_PERMISSIONS[otherRole as keyof typeof TEAM_ROLE_PERMISSIONS];
  if (!Array.isArray(callerPerms) || !Array.isArray(otherPerms)) return false;
  return otherPerms.every((p) => callerPerms.includes(p));
}
