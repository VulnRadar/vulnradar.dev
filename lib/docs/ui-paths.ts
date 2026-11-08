import { ROUTES } from "@/lib/config/client-constants";

export interface UiPath {
  /** The labels a reader follows, exactly as the app draws them. */
  segments: readonly string[];
  /** Deep link to where those labels lead. */
  href: string;
}

const profileTab = (tab: string) => `${ROUTES.PROFILE}?tab=${tab}`;
const developerTab = (dtab: string) =>
  `${ROUTES.PROFILE}?tab=developer&dtab=${dtab}`;

/**
 * Every place the docs send a reader in the UI, in one table. Typed by hand
 * these drifted from the real labels on five pages;
 * tests/lib/docs/ui-paths.test.ts checks each label against the component that
 * draws it, so a renamed tab fails the build instead of the docs.
 */
export const UI_PATHS = {
  "profile.general": {
    segments: ["Profile", "General"],
    href: profileTab("general"),
  },
  "profile.security": {
    segments: ["Profile", "Security"],
    href: profileTab("security"),
  },
  "profile.social": {
    segments: ["Profile", "Social"],
    href: profileTab("social"),
  },
  "profile.notifications": {
    segments: ["Profile", "Notifications"],
    href: profileTab("notifications"),
  },
  "profile.privacy": {
    segments: ["Profile", "Privacy"],
    href: profileTab("privacy"),
  },
  "profile.developer.apiKeys": {
    segments: ["Profile", "Developer", "API Keys"],
    href: developerTab("api-keys"),
  },
  "profile.developer.webhooks": {
    segments: ["Profile", "Developer", "Webhooks"],
    href: developerTab("webhooks"),
  },
  "profile.developer.schedules": {
    segments: ["Profile", "Developer", "Scheduled Scans"],
    href: developerTab("schedules"),
  },
  // These two keys name where the sections used to be. Verified domains moved
  // to their own page and repo access to the Social tab's GitHub card, so the
  // label has to say where they are now.
  "profile.developer.domains": {
    segments: ["Attack Surface"],
    href: ROUTES.ATTACK_SURFACE,
  },
  "profile.developer.github": {
    segments: ["Profile", "Social", "GitHub"],
    href: profileTab("social"),
  },
  "profile.ai": { segments: ["Profile", "AI"], href: profileTab("ai") },
  "profile.billing": {
    segments: ["Profile", "Billing"],
    href: profileTab("billing"),
  },
  teams: { segments: ["Teams"], href: ROUTES.TEAMS },
  repos: { segments: ["Repos"], href: ROUTES.REPOS },
  compare: { segments: ["Compare"], href: ROUTES.COMPARE },
  shared: { segments: ["Shared"], href: ROUTES.SHARES },
  badge: { segments: ["Badge"], href: ROUTES.BADGE },
  history: { segments: ["History"], href: ROUTES.HISTORY },
  scanner: { segments: ["Scanner"], href: ROUTES.DASHBOARD },
  "admin.settings": {
    segments: ["Admin", "Settings"],
    href: `${ROUTES.ADMIN}?tab=settings`,
  },
} as const satisfies Record<string, UiPath>;

export type UiPathKey = keyof typeof UI_PATHS;
