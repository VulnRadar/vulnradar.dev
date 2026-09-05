/**
 * Which UI surface each client feature flag turns off.
 *
 * Every one of these features already has a server-side kill switch on its own
 * API (app/api/v3/keys, webhooks, schedules, scan/bulk, domains, demo-scan, and
 * lib/teams/feature-gate.ts for the whole teams surface). What was missing was
 * the last hop: nine flags were resolved, serialised, shipped to the browser
 * and parsed into a typed ClientConfig, and exactly one of them was ever read
 * by a component. So turning a feature off left its nav item, tab and form
 * fully present, and the user discovered the flag from a 403 on submit.
 *
 * The table is here, as plain .ts rather than inside a component, for the same
 * reason components/history/history-filter-utils.ts is: tsconfig sets
 * "jsx": "preserve" for Next's own pipeline, which vitest's transform cannot
 * parse, so a .tsx module with real JSX in it cannot be imported from a test at
 * all. This keeps "which flag hides what" in one readable place and under test.
 *
 * These decide what is DRAWN. They are not a security boundary: the server
 * check is, and it stays the thing that actually refuses the work.
 */

/** The subset of ClientConfig these predicates read. */
export interface FeatureFlags {
  featureTeams: boolean;
  featureApiKeys: boolean;
  featureWebhooks: boolean;
  featureScheduledScans: boolean;
  featureBulkScans: boolean;
  featureDemoMode: boolean;
  featureEmailNotifications: boolean;
  featureDomainVerification: boolean;
}

/**
 * A surface is a thing a user can click into, named after the feature rather
 * than after the page, because the same feature is reachable from several
 * places (Teams from the header, the command palette and a scan's share menu).
 */
export type FeatureSurface =
  | "teams"
  | "apiKeys"
  | "webhooks"
  | "schedules"
  | "bulkScans"
  | "demoMode"
  | "emailNotifications"
  | "domainVerification";

const SURFACE_FLAG: Record<FeatureSurface, keyof FeatureFlags> = {
  teams: "featureTeams",
  apiKeys: "featureApiKeys",
  webhooks: "featureWebhooks",
  schedules: "featureScheduledScans",
  bulkScans: "featureBulkScans",
  demoMode: "featureDemoMode",
  emailNotifications: "featureEmailNotifications",
  domainVerification: "featureDomainVerification",
};

export function isSurfaceEnabled(
  surface: FeatureSurface,
  flags: FeatureFlags,
): boolean {
  return flags[SURFACE_FLAG[surface]];
}

/**
 * Drop the entries whose feature is off, keeping the ones that declare no
 * feature at all.
 *
 * Used by every list-shaped entry point: the header nav, the History/Assets/
 * Attack Surface tab strip, the Developer sub-tabs. Returns the same array
 * identity when nothing is filtered out, so a caller can pass it straight into
 * a memo without a needless re-render.
 */
export function visibleSurfaces<T extends { feature?: FeatureSurface }>(
  items: readonly T[],
  flags: FeatureFlags,
): T[] {
  return items.filter(
    (item) =>
      item.feature === undefined || isSurfaceEnabled(item.feature, flags),
  );
}

/** The Developer tab's three sub-tabs, in strip order. */
export const DEVELOPER_SURFACES = ["apiKeys", "webhooks", "schedules"] as const;

/**
 * The Developer tab is three independent features sharing one panel, so it
 * survives while any one of them is on and goes when all three are off. Its
 * sub-tab strip has no meaning on its own.
 */
export function developerTabEnabled(flags: FeatureFlags): boolean {
  return DEVELOPER_SURFACES.some((s) => isSurfaceEnabled(s, flags));
}

/**
 * Is this top-level profile tab worth showing?
 *
 * Notifications is nothing but email preferences, and
 * lib/notifications/notifications.ts returns early for every category when
 * FEATURE_EMAIL_NOTIFICATIONS is off, so with that flag down every switch on
 * that tab changes nothing that will ever be read.
 */
export function profileTabEnabled(tab: string, flags: FeatureFlags): boolean {
  if (tab === "developer") return developerTabEnabled(flags);
  if (tab === "notifications")
    return isSurfaceEnabled("emailNotifications", flags);
  return true;
}

/**
 * Where a `?dtab=` lands once the flags are applied.
 *
 * "api-keys" was the unconditional fallback, which is exactly wrong when API
 * keys is the flag that is off: it would drop every visitor onto the one
 * section the deployment has disabled. Falls back to the first section that is
 * actually on, and to null when none are.
 *
 * "domains" is not a real section (it renders a pointer at /attack-surface, so
 * an old bookmark still lands somewhere useful), which is why it is resolved
 * against domain verification rather than against the strip.
 */
export function resolveDeveloperSection(
  requested: string | null,
  flags: FeatureFlags,
): string | null {
  const enabled = DEVELOPER_SURFACES.filter((s) => isSurfaceEnabled(s, flags));
  const ids: Record<(typeof DEVELOPER_SURFACES)[number], string> = {
    apiKeys: "api-keys",
    webhooks: "webhooks",
    schedules: "schedules",
  };
  const fallback = enabled.length > 0 ? ids[enabled[0]] : null;
  if (requested === "domains") {
    return isSurfaceEnabled("domainVerification", flags) ? "domains" : fallback;
  }
  const enabledIds = enabled.map((s) => ids[s]);
  return requested !== null && enabledIds.includes(requested)
    ? requested
    : fallback;
}

/**
 * Where a `?mode=` lands. Bulk is the only scan mode behind a flag, and
 * POST /api/v3/scan/bulk refuses every request when it is off, so selecting it
 * meant pasting a hundred URLs and only then being told.
 */
export function resolveScanMode<T extends string>(
  requested: T,
  flags: FeatureFlags,
  quick: T,
): T {
  return requested === "bulk" && !isSurfaceEnabled("bulkScans", flags)
    ? quick
    : requested;
}
