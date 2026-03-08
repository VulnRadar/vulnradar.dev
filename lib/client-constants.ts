// ============================================================================
// CLIENT-ONLY CONSTANTS
// ============================================================================
// These constants are safe to use in client components and don't depend
// on server-only config loading. Role definitions, routes, and UI styles.
// ============================================================================

// ============================================================================
// STAFF / ADMIN ROLES
// ============================================================================

export const STAFF_ROLES = {
  USER: "user",
  BETA_TESTER: "beta_tester",
  SUPPORT: "support",
  MODERATOR: "moderator",
  ADMIN: "admin",
} as const

export type StaffRole = (typeof STAFF_ROLES)[keyof typeof STAFF_ROLES]

export const STAFF_ROLE_HIERARCHY: Record<string, number> = {
  user: 0,
  beta_tester: 0,
  support: 1,
  moderator: 2,
  admin: 3,
}

export const STAFF_ROLE_LABELS: Record<string, string> = {
  user: "User",
  beta_tester: "Beta Tester",
  support: "Support",
  moderator: "Moderator",
  admin: "Admin",
}

// ============================================================================
// ROLE BADGE STYLES (used across admin, shared, staff pages)
// ============================================================================

export const ROLE_BADGE_STYLES: Record<string, string> = {
  admin: "bg-primary/10 text-primary border-primary/20",
  moderator: "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20",
  support: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  beta_tester: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  user: "bg-muted text-muted-foreground border-border",
}

// ============================================================================
// API VERSION - Change this to switch all API calls between versions
// ============================================================================

export const API_VERSION = "v2"

// ============================================================================
// API ENDPOINTS (dynamically versioned)
// ============================================================================

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
    TWO_FA: {
      SETUP: `/api/${API_VERSION}/auth/2fa/setup`,
      VERIFY: `/api/${API_VERSION}/auth/2fa/verify`,
      DISABLE: `/api/${API_VERSION}/auth/2fa/disable`,
      EMAIL_SETUP: `/api/${API_VERSION}/auth/2fa/email-setup`,
      EMAIL_SEND: `/api/${API_VERSION}/auth/2fa/email-send`,
      BACKUP_CODES: `/api/${API_VERSION}/auth/2fa/backup-codes`,
    },
  },
  SCAN: `/api/${API_VERSION}/scan`,
  SCAN_BULK: `/api/${API_VERSION}/scan/bulk`,
  SCAN_TAGS: `/api/${API_VERSION}/scan/tags`,
  SCAN_DISCOVER: `/api/${API_VERSION}/scan/discover`,
  SCAN_CRAWL: `/api/${API_VERSION}/scan/crawl`,
  SCAN_CRAWL_DISCOVER: `/api/${API_VERSION}/scan/crawl/discover`,
  DEMO_SCAN: `/api/${API_VERSION}/demo-scan`,
  HISTORY: `/api/${API_VERSION}/history`,
  DASHBOARD: `/api/${API_VERSION}/dashboard`,
  SHARES: `/api/${API_VERSION}/shares`,
  SHARED: `/api/${API_VERSION}/shared`,
  KEYS: `/api/${API_VERSION}/keys`,
  WEBHOOKS: `/api/${API_VERSION}/webhooks`,
  SCHEDULES: `/api/${API_VERSION}/schedules`,
  TEAMS: `/api/${API_VERSION}/teams`,
  TEAMS_MEMBERS: `/api/${API_VERSION}/teams/members`,
  TEAMS_MEMBER_SCANS: `/api/${API_VERSION}/teams/member-scans`,
  TEAMS_ACCEPT_INVITE: `/api/${API_VERSION}/teams/accept-invite`,
  CONTACT: `/api/${API_VERSION}/contact`,
  LANDING_CONTACT: `/api/${API_VERSION}/landing-contact`,
  ADMIN: `/api/${API_VERSION}/admin`,
  STAFF: `/api/${API_VERSION}/staff`,
  BADGE: `/api/${API_VERSION}/badge`,
  BADGE_SCANS: `/api/${API_VERSION}/badge/scans`,
  DATA_REQUEST: `/api/${API_VERSION}/data-request`,
  DATA_REQUEST_DOWNLOAD: `/api/${API_VERSION}/data-request/download`,
  ACCOUNT_DELETE: `/api/${API_VERSION}/account/delete`,
  ACCOUNT_NOTIFICATIONS: `/api/${API_VERSION}/account/notifications`,
  FINDING_TYPES: `/api/${API_VERSION}/finding-types`,
  COMPARE: `/api/${API_VERSION}/compare`,
} as const

// ============================================================================
// APPLICATION ROUTES
// ============================================================================

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
  COMPARE: "/compare",
  SHARES: "/shares",
  BADGE: "/badge",
  STAFF: "/staff",
  DEMO: "/demo",
  CONTACT: "/contact",
  DONATE: "/donate",
  LANDING: "/landing",
  LEGAL_TERMS: "/legal/terms",
  LEGAL_PRIVACY: "/legal/privacy",
  LEGAL_DISCLAIMER: "/legal/disclaimer",
  LEGAL_ACCEPTABLE_USE: "/legal/acceptable-use",
  CHANGELOG: "/changelog",
  DOCS: "/docs",
  DOCS_API: "/docs/api",
  DOCS_SETUP: "/docs/setup",
  DOCS_DEVELOPERS: "/docs/developers",
  ADMIN: "/admin",
} as const

// ============================================================================
// SEVERITY LEVELS & COLORS
// ============================================================================

export const SEVERITY_LEVELS = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
} as const

export type SeverityLevel = (typeof SEVERITY_LEVELS)[keyof typeof SEVERITY_LEVELS]

export const SEVERITY_COLORS = {
  critical: "hsl(var(--severity-critical))",
  high: "hsl(var(--severity-high))",
  medium: "hsl(var(--severity-medium))",
  low: "hsl(var(--severity-low))",
  info: "hsl(var(--severity-info))",
}

export const SEVERITY_LABELS = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Informational",
}

// ============================================================================
// UI / DESIGN CONSTANTS
// ============================================================================

export const ANIMATION_DURATION = {
  FAST: 150,
  NORMAL: 300,
  SLOW: 500,
}

export const TOAST_DURATION = {
  SHORT: 3000,
  NORMAL: 4000,
  LONG: 6000,
}
