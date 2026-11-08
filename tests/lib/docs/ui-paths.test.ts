import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { UI_PATHS, type UiPathKey } from "@/lib/docs/ui-paths";

/**
 * Every label in the table has to be what the app really draws, so a renamed
 * tab fails here instead of leaving the docs pointing at a tab that is gone.
 * The sub-tab labels live in components/profile/tabs; the top-level ones are
 * the tab strip in app/profile/page.tsx and the header's translation file.
 */

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const profilePage = read("app/profile/page.tsx");
const developerTab = read("components/profile/tabs/profile-developer-tab.tsx");
const socialTab = read("components/profile/tabs/profile-social-tab.tsx");
const nav = JSON.parse(read("lib/i18n/messages/en/nav.json")) as Record<
  string,
  string
>;

/** `{ id: "general" as ProfileTab, label: "General" }` in the profile tab strip. */
function profileTabLabel(id: string): string | undefined {
  return profilePage.match(
    new RegExp(`id: "${id}" as ProfileTab,\\s*label: "([^"]+)"`),
  )?.[1];
}

const PROFILE_TABS: [UiPathKey, string, string][] = [
  ["profile.general", "general", "General"],
  ["profile.security", "security", "Security"],
  ["profile.social", "social", "Social"],
  ["profile.notifications", "notifications", "Notifications"],
  ["profile.privacy", "privacy", "Privacy"],
  ["profile.ai", "ai", "AI"],
  ["profile.billing", "billing", "Billing"],
];

describe("profile tabs", () => {
  it.each(PROFILE_TABS)("%s", (key, id, label) => {
    expect(UI_PATHS[key].segments).toEqual(["Profile", label]);
    expect(profileTabLabel(id)).toBe(label);
    expect(UI_PATHS[key].href).toBe(`/profile?tab=${id}`);
  });
});

describe("developer sub-tabs", () => {
  it.each([
    ["profile.developer.apiKeys", "api-keys", "API Keys"],
    ["profile.developer.webhooks", "webhooks", "Webhooks"],
    ["profile.developer.schedules", "schedules", "Scheduled Scans"],
  ] as [UiPathKey, string, string][])("%s", (key, dtab, label) => {
    expect(UI_PATHS[key].segments).toEqual(["Profile", "Developer", label]);
    expect(profileTabLabel("developer")).toBe("Developer");
    expect(developerTab).toMatch(
      new RegExp(`id: "${dtab}",\\s*label: "${label}"`),
    );
    expect(UI_PATHS[key].href).toBe(`/profile?tab=developer&dtab=${dtab}`);
  });

  it("sends domains to the page they moved to", () => {
    expect(UI_PATHS["profile.developer.domains"].segments).toEqual([
      "Attack Surface",
    ]);
    expect(developerTab).toContain("Go to Attack Surface");
    expect(UI_PATHS["profile.developer.domains"].href).toBe("/attack-surface");
  });

  it("sends GitHub repo access to the Social tab's card", () => {
    expect(UI_PATHS["profile.developer.github"].segments).toEqual([
      "Profile",
      "Social",
      "GitHub",
    ]);
    expect(socialTab).toContain("GithubRepoAccessSection");
    expect(socialTab).toContain("GitHub");
  });
});

describe("header destinations", () => {
  it.each([
    ["teams", "teams"],
    ["repos", "repos"],
    ["compare", "compare"],
    ["shared", "shared"],
    ["badge", "badge"],
    ["history", "history"],
    ["scanner", "scanner"],
  ] as [UiPathKey, string][])("%s", (key, navKey) => {
    expect(UI_PATHS[key].segments).toEqual([nav[navKey]]);
  });
});

describe("admin settings", () => {
  it("is the settings panel the admin page renders", () => {
    expect(UI_PATHS["admin.settings"].href).toBe("/admin?tab=settings");
    expect(read("app/admin/page.tsx")).toContain('activeTab === "settings"');
  });
});

describe("the table", () => {
  it("has every key the docs were promised", () => {
    expect(Object.keys(UI_PATHS).sort()).toEqual(
      [
        "profile.general",
        "profile.security",
        "profile.social",
        "profile.notifications",
        "profile.privacy",
        "profile.developer.apiKeys",
        "profile.developer.webhooks",
        "profile.developer.schedules",
        "profile.developer.domains",
        "profile.developer.github",
        "profile.ai",
        "profile.billing",
        "teams",
        "repos",
        "compare",
        "shared",
        "badge",
        "history",
        "scanner",
        "admin.settings",
      ].sort(),
    );
  });
});
