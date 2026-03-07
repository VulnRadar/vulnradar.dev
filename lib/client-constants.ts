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
