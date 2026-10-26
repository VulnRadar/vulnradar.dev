import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * /profile used to import all eight tabs statically (about 9,500 lines with the
 * Developer tab's sections, plus the QR-code library behind Security) to render
 * the one the URL names. They load on demand now.
 *
 * Source-text assertions, like the rest of this tier: there is no bundler to
 * ask which chunk a module landed in, but the contract that decides it is
 * visible in the page source, and a static import sneaking back in is exactly
 * the regression to catch.
 */

const ROOT = path.resolve(__dirname, "../../..");
const page = readFileSync(path.join(ROOT, "app/profile/page.tsx"), "utf8");
const compact = page.replace(/\s+/g, "");

// The ids the page switches on, and the file and export each one lives in.
const TABS = [
  ["general", "profile-general-tab", "ProfileGeneralTab"],
  ["security", "profile-security-tab", "ProfileSecurityTab"],
  ["social", "profile-social-tab", "ProfileSocialTab"],
  ["billing", "profile-billing-tab", "ProfileBillingTab"],
  ["developer", "profile-developer-tab", "ProfileDeveloperTab"],
  ["notifications", "profile-notifications-tab", "ProfileNotificationsTab"],
  ["privacy", "profile-privacy-tab", "ProfilePrivacyTab"],
  ["ai", "profile-ai-settings-tab", "ProfileAiSettingsTab"],
] as const;

describe("app/profile/page.tsx tab loading", () => {
  it("has no static import of any tab module", () => {
    const staticImports = page
      .split("\n")
      .filter((line) => /^import\b/.test(line))
      .filter((line) => !/^import type\b/.test(line))
      .filter((line) => line.includes("components/profile/tabs/"));
    expect(staticImports).toEqual([]);
  });

  it.each(TABS)(
    "%s is loaded with a dynamic import",
    (id, file, exportName) => {
      expect(page).toContain(`import("@/components/profile/tabs/${file}")`);
      // The chunk map entry, and the component built from it.
      expect(page).toMatch(new RegExp(`\\b${id}:\\s*\\(\\)\\s*=>`));
      // Whitespace-free, so prettier wrapping a long chain cannot fail it.
      expect(compact).toContain(
        `const${exportName}=dynamic(()=>tabChunks.${id}().then((m)=>({default:m.${exportName}})),{ssr:false,loading:tabLoading}`,
      );
    },
  );

  it("covers every tab the page can render, so none can be added statically", () => {
    // Every <XTab ...> the JSX renders is one of the dynamic consts above.
    const rendered = [...page.matchAll(/<(Profile\w+Tab)\b/g)].map((m) => m[1]);
    expect(new Set(rendered)).toEqual(new Set(TABS.map((t) => t[2])));
    for (const name of new Set(rendered)) {
      expect(page).toMatch(new RegExp(`const ${name} = dynamic\\(`));
    }
  });

  it("falls back to the page's own skeleton and never server-renders a tab", () => {
    expect(page).toContain("const tabLoading = () => <ProfileDataSkeleton />;");
    // One options object per tab, each inline: next/dynamic reads them at
    // build time, so they have to be literals rather than a shared variable.
    expect(page.match(/\{ ssr: false, loading: tabLoading \}/g)).toHaveLength(
      TABS.length,
    );
  });

  it("starts the URL's tab downloading before the account has loaded", () => {
    // Without this the chunk request begins only once the account data has
    // landed and the tab first renders, which puts it behind the fetch.
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*const fromUrl = getQueryParam\("tab"\);\s*prefetchTab\(/,
    );
  });

  it("prefetches a tab on hover and focus of its sidebar entry", () => {
    expect(page).toContain("onMouseEnter={() => prefetchTab(tab.id)}");
    expect(
      page.match(/onFocus=\{\(\) => prefetchTab\(tab\.id\)\}/g),
    ).toHaveLength(2);
  });
});
