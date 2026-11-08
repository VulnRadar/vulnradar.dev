import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const page = read("app/docs/extension/page.tsx");
const flat = page.replace(/\s+/g, " ");

describe("the extension page's install section", () => {
  const start = page.indexOf('id="install"');
  const install = page.slice(start, page.indexOf("</DocsSection>", start));

  it("is three steps: store, key, paste", () => {
    const titles = [...install.matchAll(/title: "([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual([
      "Install from the store",
      "Create a key",
      "Paste the key into the extension",
    ]);
  });

  it("still says the store installs update themselves", () => {
    expect(install).toContain("Both update themselves.");
  });

  it("names the path to the key and the tab the profile page reads", () => {
    expect(install).toContain("Profile > Developer > API Keys");
    expect(install).toContain("?tab=developer&dtab=api-keys");
  });

  it("names controls the extension really has", () => {
    const popup = read("extension/src/popup/popup.ts").replace(/\s+/g, " ");
    expect(popup).toMatch(/class="footer-settings"[^>]*> Settings/);
    expect(read("extension/src/options/options.ts")).toContain("Test & Save");
    expect(install).toContain("open Settings from the popup's footer");
    expect(install).toContain("press Test & Save");
  });

  it("links the source from where a builder needs it", () => {
    expect(install).toContain("github.com/${APP_REPO}/tree/main/extension");
  });
});

describe("the extension page reads as a reference, not a history", () => {
  it("drops the three history sentences", () => {
    expect(flat).not.toMatch(/approved the listing/);
    expect(flat).not.toMatch(/used to render only/);
    expect(flat).not.toMatch(/old per-service panel/);
  });

  it("closes on a paragraph with a contact link, not a badge", () => {
    expect(page).toContain("href={ROUTES.CONTACT}");
    expect(flat).not.toMatch(/<Badge[^>]*>\s*Questions about/);
    expect(flat).toContain("Questions about a specific permission prompt?");
  });

  it("keeps every section id", () => {
    for (const id of [
      "overview",
      "install",
      "scanning",
      "reading-a-result",
      "scan-a-link",
      "reputation-card",
      "auto-scan",
      "notifications",
      "signed-in-pages",
      "settings",
      "permissions",
    ]) {
      expect(page, id).toContain(`id="${id}"`);
    }
  });
});
