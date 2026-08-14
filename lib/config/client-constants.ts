// CLIENT-ONLY CONSTANTS (Source of Truth for Client-Safe Values)

// These constants are safe to use in client components and don't depend
// on server-only config loading. Role definitions, routes, and UI styles.
//
// NOTE: constants.ts re-exports these values for convenience. If you need
// client-safe constants in client components, import from here directly
// to avoid potential bundling issues with server-only code.

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

// API VERSION - Change this to switch all API calls between versions

export const API_VERSION = "v3";

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
    STAFF_OIDC_INFO: `/api/${API_VERSION}/auth/staff-oidc/info`,
    STAFF_OIDC_START: `/api/${API_VERSION}/auth/staff-oidc`,
    IMPERSONATION_STOP: `/api/${API_VERSION}/auth/impersonation-stop`,
    TWO_FA: {
      SETUP: `/api/${API_VERSION}/auth/2fa/setup`,
      VERIFY: `/api/${API_VERSION}/auth/2fa/verify`,
      DISABLE: `/api/${API_VERSION}/auth/2fa/disable`,
      EMAIL_SETUP: `/api/${API_VERSION}/auth/2fa/email-setup`,
      EMAIL_SEND: `/api/${API_VERSION}/auth/2fa/email-send`,
      BACKUP_CODES: `/api/${API_VERSION}/auth/2fa/backup-codes`,
    },
    SESSIONS: `/api/${API_VERSION}/auth/sessions`,
    SESSION_REVOKE: (id: string) => `/api/${API_VERSION}/auth/sessions/${id}`,
    TRUSTED_DEVICES: `/api/${API_VERSION}/auth/trusted-devices`,
    TRUSTED_DEVICE_REVOKE: (id: number | string) =>
      `/api/${API_VERSION}/auth/trusted-devices/${id}`,
  },
  SCAN: `/api/${API_VERSION}/scan`,
  SCAN_STATUS: (id: string | number) => `/api/${API_VERSION}/scan/status/${id}`,
  SCAN_BULK: `/api/${API_VERSION}/scan/bulk`,
  SCAN_TAGS: `/api/${API_VERSION}/scan/tags`,
  SCAN_DISCOVER: `/api/${API_VERSION}/scan/discover`,
  SCAN_DISCOVER_PROGRESS: (requestId: string) =>
    `/api/${API_VERSION}/scan/discover/progress/${requestId}`,
  SCAN_CRAWL: `/api/${API_VERSION}/scan/crawl`,
  SCAN_CRAWL_DISCOVER: `/api/${API_VERSION}/scan/crawl/discover`,
  SCAN_AUTHENTICATED: `/api/${API_VERSION}/scan/authenticated`,
  DEMO_SCAN: `/api/${API_VERSION}/demo-scan`,
  HISTORY: `/api/${API_VERSION}/history`,
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
  TEAMS: `/api/${API_VERSION}/teams`,
  TEAMS_MEMBERS: `/api/${API_VERSION}/teams/members`,
  TEAMS_MEMBER_SCANS: `/api/${API_VERSION}/teams/member-scans`,
  TEAMS_ACCEPT_INVITE: `/api/${API_VERSION}/teams/accept-invite`,
  NOTIFICATIONS: `/api/${API_VERSION}/notifications`,
  CONTACT: `/api/${API_VERSION}/contact`,
  LANDING_CONTACT: `/api/${API_VERSION}/landing-contact`,
  ADMIN: `/api/${API_VERSION}/admin`,
  BADGE: `/api/${API_VERSION}/badge`,
  BADGE_SCANS: `/api/${API_VERSION}/badge/scans`,
  /** Create/fetch (POST) or revoke (DELETE) the stable, auto-updating
   *  badge token for one of the caller's own scans' URL. */
  BADGE_SITE: `/api/${API_VERSION}/badge/site`,
  DATA_REQUEST: `/api/${API_VERSION}/data-request`,
  DATA_REQUEST_DOWNLOAD: `/api/${API_VERSION}/data-request/download`,
  ACCOUNT_DELETE: `/api/${API_VERSION}/account/delete`,
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
  SCAN_VERIFY: `/api/${API_VERSION}/scan/verify`,
  /** Mark a single finding false_positive / confirmed / not_applicable
   *  (app/api/v3/scan/feedback/route.ts). GET reads back the caller's own
   *  verdicts; POST upserts one. */
  SCAN_FEEDBACK: `/api/${API_VERSION}/scan/feedback`,
  AI_INFO: `/api/${API_VERSION}/ai/info`,
  ACCOUNT: `/api/${API_VERSION}/account/delete`,
  FINDING_TYPES: `/api/${API_VERSION}/finding-types`,
  COMPARE: `/api/${API_VERSION}/compare`,
  BILLING: `/api/${API_VERSION}/billing`,
  SUBSCRIPTION_CANCEL: `/api/${API_VERSION}/billing/subscription/cancel`,
  SUBSCRIPTION_REACTIVATE: `/api/${API_VERSION}/billing/subscription/reactivate`,
  BROWSER_SESSIONS: `/api/${API_VERSION}/browser/sessions`,
  BROWSER_SESSION_LOGS: `/api/${API_VERSION}/browser/sessions/logs`,
  VERSION: "/api/version",
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

export type SeverityLevel =
  (typeof SEVERITY_LEVELS)[keyof typeof SEVERITY_LEVELS];

export const SEVERITY_COLORS = {
  critical: "hsl(var(--severity-critical))",
  high: "hsl(var(--severity-high))",
  medium: "hsl(var(--severity-medium))",
  low: "hsl(var(--severity-low))",
  info: "hsl(var(--severity-info))",
};

export const SEVERITY_LABELS = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Informational",
};

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

// UI / DESIGN CONSTANTS

export const ANIMATION_DURATION = {
  FAST: 150,
  NORMAL: 300,
  SLOW: 500,
};

export const TOAST_DURATION = {
  SHORT: 3000,
  NORMAL: 4000,
  LONG: 6000,
};
