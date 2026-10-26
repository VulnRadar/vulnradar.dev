// URLs that other people hold, and therefore the only API paths this codebase
// may spell out by hand. Each one is registered or stored outside our
// control: an OAuth redirect URI in a provider console, a Stripe webhook
// endpoint, the List-Unsubscribe header of mail already delivered, a health
// probe in somebody's compose file, an avatar URL saved in the database, a
// badge pasted into a README. Changing any of them breaks something we cannot
// reach, so they are written once here and every place that emits or checks
// one reads this file.
//
// The "v3" inside these strings is history, not a lifecycle. These paths do
// not follow API_VERSION and are not retired with API v3; they are files at
// exactly these URLs. tests/lib/api/frozen-paths.test.ts ties every entry to a
// row of PERMALINKS in route-registry.ts.
//
// Imports nothing: middleware, client-constants, the email and upload helpers
// and the OAuth routes all use it, and the first of those compiles to the edge.

export const FROZEN = {
  HEALTH: "/api/v3/health",
  STRIPE_WEBHOOK: "/api/v3/webhooks/stripe",
  UNSUBSCRIBE: "/api/v3/account/unsubscribe",
  DISCORD_CALLBACK: "/api/v3/auth/discord/callback",
  OAUTH_CALLBACK: (provider: string) =>
    `/api/v3/auth/oauth/${provider}/callback`,
  STAFF_OIDC_CALLBACK: "/api/v3/auth/staff-oidc/callback",
  WHOAMI_IP: "/api/v3/whoami-ip",
  AVATAR: (userId: number | string) => `/api/v3/avatar/${userId}`,
  BADGE: "/api/v3/badge",
  OPENAPI_V3: "/api/v3/openapi.json",
  VERSION: "/api/version",
  SECURITY_TXT: "/api/security-txt",
} as const;
