/**
 * /brand, rendered. The page's job is to hand people files, so what is
 * pinned is that every section is there and every download link points at a
 * file that exists, under its own name, with the kit's cache-busting hash.
 * The page is also only useful if a signed-out visitor can reach it, so the
 * route's wiring (sitemap, footer, middleware allowlist) is checked here too.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandKit } from "@/components/brand/brand-kit";
import {
  HIERARCHY,
  TEXT_PX,
  typeSizeLabel,
} from "@/components/brand/brand-guidelines";
import {
  BRAND_KIT_ZIP,
  CLEAR_SPACE,
  LOCKUP_SLOTS,
  LOGO_SIZES,
  PROFILE_NAVY_SIZES,
  PROFILE_SIZES,
  USE_TERMS,
  brandKitFiles,
} from "@/lib/brand/kit";
import { BRAND_KIT_HASH } from "@/lib/brand/kit.generated";
import { ROUTES } from "@/lib/config/client-constants";
import { PUBLIC_PATHS } from "@/lib/config/public-paths";
import { STATIC_PUBLIC_ROUTES } from "@/lib/seo/routes";

const ROOT = process.cwd();
const html = renderToStaticMarkup(<BrandKit />);
const text = html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ");

/** Every <a> on the page, with its href, download attribute and text. */
const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
  href: m[1].match(/href="([^"]+)"/)?.[1] ?? "",
  download: m[1].match(/download="([^"]*)"/)?.[1],
  name: m[2]
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim(),
}));
const kitLinks = links.filter((l) => l.href.startsWith("/brand/"));
const kitPath = (url: string) =>
  url
    .replace(/^\/brand\//, "")
    .replace(/\?.*$/, "")
    .replace(/&amp;/g, "&");

describe("the /brand page", () => {
  it("renders the H1 and every section, in order", () => {
    expect(html).toMatch(/<h1[^>]*>VulnRadar brand kit<\/h1>/);
    const order = [
      "logo",
      "clear-space",
      "download-mark",
      "download-lockup",
      "profile",
      "colour",
      "type",
      "voice",
      "do-dont",
      "accessibility",
    ].map((id) => html.indexOf(`id="${id}"`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(`href="${ROUTES.CONTACT}"`);
  });

  it("links every download to a file that exists, under its own name", () => {
    expect(kitLinks.length).toBeGreaterThan(0);
    for (const link of kitLinks) {
      const path = kitPath(link.href);
      expect(existsSync(join(ROOT, "public", "brand", path)), path).toBe(true);
      expect(link.href, path).toContain(`?v=${BRAND_KIT_HASH}`);
      expect(link.download, path).toBe(path.slice(path.lastIndexOf("/") + 1));
    }
  });

  it("offers every size of the mark, every slot of the lockup and every avatar", () => {
    const offered = new Set(kitLinks.map((l) => kitPath(l.href)));
    const files = brandKitFiles();
    const expected = files.filter(
      (f) =>
        f.kind === "logo" ||
        f.kind === "profile" ||
        f.kind === "source" ||
        // The lockup chips show one variant at a time; the server renders the
        // dark-background one first.
        (f.kind === "lockup" && f.variant === "on-dark"),
    );
    expect(expected).toHaveLength(
      LOGO_SIZES.length +
        PROFILE_SIZES.length +
        PROFILE_NAVY_SIZES.length +
        LOCKUP_SLOTS.length +
        6,
    );
    for (const file of expected)
      expect(offered, file.path).toContain(file.path);
    expect(offered).toContain(BRAND_KIT_ZIP);
    expect(offered).toContain("README.md");
  });

  it("draws every image from a file that exists", () => {
    const sources = [
      ...html.matchAll(
        /<(?:img|image)\b[^>]*?(?:src|href)="(\/brand\/[^"]+)"/g,
      ),
    ].map((m) => kitPath(m[1]));
    expect(sources.length).toBeGreaterThan(5);
    for (const path of sources) {
      expect(existsSync(join(ROOT, "public", "brand", path)), path).toBe(true);
    }
  });

  it("says how big the download is and how many files it holds", () => {
    expect(text).toMatch(
      new RegExp(`ZIP, \\d+(\\.\\d)? KB, ${brandKitFiles().length} files`),
    );
  });

  it("names what each download is, not only its size", () => {
    const named = (path: string) =>
      kitLinks.find((l) => kitPath(l.href) === path)?.name;
    expect(named("logo/vulnradar-logo-512x512.png")).toMatch(
      /^512 × 512, PNG, \d+(\.\d)? KB, the mark$/,
    );
    expect(named("profile/vulnradar-profile-1024x1024.png")).toMatch(
      /^1024 × 1024, Transparent PNG, .+, transparent profile picture$/,
    );
    expect(named("lockup/vulnradar-lockup-on-dark-970x250.png")).toMatch(
      /^970 × 250, Horizontal PNG, .+, lockup for dark backgrounds$/,
    );
    expect(named(BRAND_KIT_ZIP)).toMatch(
      /^Download everything, ZIP, \d+(\.\d)? KB$/,
    );
  });

  it("states the terms and the clear space from kit.ts", () => {
    expect(text).toContain(USE_TERMS);
    expect(text).toContain(`X is ${CLEAR_SPACE * 100}% of the disc`);
  });

  it("uses no em dash, en dash or middle dot in its copy", () => {
    expect(text).not.toMatch(/[–—·]/);
  });
});

describe("the /brand route", () => {
  it("is in the sitemap", () => {
    expect(STATIC_PUBLIC_ROUTES.map((r) => r.path)).toContain(ROUTES.BRAND);
  });

  it("is linked from the footer, next to Security", () => {
    const footer = readFileSync(
      join(ROOT, "components", "scanner", "footer.tsx"),
      "utf8",
    );
    const security = footer.indexOf('t("security")');
    const brand = footer.indexOf('t("brand")');
    expect(footer).toContain("href={ROUTES.BRAND}");
    expect(brand).toBeGreaterThan(security);
    expect(brand - security).toBeLessThan(400);
  });

  it("is allowlisted as a prefix, so the page and its files are public", () => {
    expect(PUBLIC_PATHS).toContain(ROUTES.BRAND);
    // A standalone page and directory of its own, not a prefix of anything
    // private: the app has no other route starting with "/brand".
    expect(ROUTES.BRAND).toBe("/brand");
  });
});

describe("the type hierarchy", () => {
  it("knows the px of each Tailwind text size it labels", () => {
    const theme = readFileSync(
      join(ROOT, "node_modules", "tailwindcss", "theme.css"),
      "utf8",
    );
    for (const [step, px] of Object.entries(TEXT_PX)) {
      const rem = theme.match(new RegExp(`--text-${step}:\\s*([\\d.]+)rem;`));
      expect(rem, step).not.toBeNull();
      expect(Number(rem![1]) * 16, step).toBe(px);
    }
  });

  it("labels every level from its own class names", () => {
    expect(HIERARCHY.map((level) => typeSizeLabel(level.className))).toEqual([
      "30 px, 36 px from sm",
      "24 px, 30 px from sm",
      "20 px, 24 px from sm",
      "18 px",
      "16 px",
    ]);
  });
});
