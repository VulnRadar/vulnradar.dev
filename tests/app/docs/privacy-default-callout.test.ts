import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * New scans being public is the one fact a reader most needs before a first
 * scan, and the docs named switches that had been renamed. The callout is one
 * component on three pages, and the names in it are read from the real controls.
 */
const flat = (file: string) => readFileSync(file, "utf8").replace(/\s+/g, " ");
const callout = flat("components/docs/docs-public-by-default.tsx");

describe("the public-by-default callout", () => {
  it.each([
    "app/docs/page.tsx",
    "app/docs/sharing/page.tsx",
    "app/docs/account-security/page.tsx",
  ])("is on %s", (page) => {
    expect(flat(page)).toContain("<DocsPublicByDefault />");
  });

  it("sits directly under the home page's first-scan steps", () => {
    const home = flat("app/docs/page.tsx");
    const start = home.indexOf('id="quick-start"');
    const end = home.indexOf('id="documentation"');
    expect(home.slice(start, end)).toContain("<DocsPublicByDefault />");
  });

  it("opens the Who can see what section on sharing", () => {
    const sharing = flat("app/docs/sharing/page.tsx");
    expect(sharing).toMatch(
      /id="who-can-see" title="Who can see what"> <DocsPublicByDefault \/>/,
    );
  });

  it("names the switches the account page really has", () => {
    const privacyTab = flat("components/profile/tabs/profile-privacy-tab.tsx");
    for (const name of [
      "Scans are public by default",
      "List new shares in the Public Scans directory",
    ]) {
      expect(privacyTab).toContain(name);
      expect(callout).toContain(name.split(" ").slice(0, 3).join(" "));
    }
  });

  it("names the per-scan control the form really has", () => {
    const messages = JSON.parse(
      readFileSync("lib/i18n/messages/en/scan.json", "utf8"),
    ) as Record<string, string>;
    expect(callout).toContain(messages.keepPrivate);
  });
});
