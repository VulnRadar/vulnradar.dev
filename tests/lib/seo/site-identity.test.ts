/**
 * What a search engine reads to decide what this site is called and what its
 * icon looks like: the favicon files, the manifest, and the Organization and
 * WebSite structured data. Each of these was wrong in a way nothing caught:
 * the only raster favicon was 32px, the apple-touch-icon was a 1024px PNG
 * with transparent corners, the manifest had no 192 or 512 icon, the
 * Organization logo was an SVG, and WebSite markup sat on every page instead
 * of the home page.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import manifest from "@/app/manifest";

const ROOT = process.cwd();
const publicFile = (url: string) =>
  join(ROOT, "public", url.replace(/^\//, ""));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString("ascii"), file).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("icons", () => {
  it("ships a favicon.ico holding 16, 32 and 48 px images", () => {
    const ico = readFileSync(publicFile("/favicon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + 16 * i]);
    expect(sizes).toEqual([16, 32, 48]);
  });

  it("ships a 180px apple-touch-icon and links it from the head", () => {
    expect(pngSize(publicFile("/apple-touch-icon.png"))).toEqual([180, 180]);
    const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
    expect(layout).toContain('url: "/apple-touch-icon.png", sizes: "180x180"');
    expect(layout).toContain('url: "/icon-192.png"');
    expect(layout).not.toContain("/favicon.png");
  });

  it("declares manifest icons whose files exist at the declared size", () => {
    const icons = manifest().icons ?? [];
    for (const icon of icons) {
      expect(existsSync(publicFile(icon.src)), icon.src).toBe(true);
      if (icon.type !== "image/png") continue;
      const [w, h] = pngSize(publicFile(icon.src));
      expect(icon.sizes, icon.src).toBe(`${w}x${h}`);
    }
    const pngSizes = icons
      .filter((i) => i.type === "image/png")
      .map((i) => i.sizes);
    expect(pngSizes).toContain("192x192");
    expect(pngSizes).toContain("512x512");
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    expect(manifest().start_url).toBe("/");
  });
});

describe("structured data", () => {
  it("uses a raster Organization logo of at least 112px", () => {
    // Read from source: the module is .tsx, which this node test runner
    // cannot import (see tests/components/shared/social-links.test.ts).
    const source = readFileSync(
      join(ROOT, "components/seo/structured-data.tsx"),
      "utf8",
    );
    const match = source.match(
      /ORGANIZATION_LOGO = \{\s*url: `\$\{APP_URL\}(\/[^`]+)`,\s*size: (\d+)/,
    );
    expect(match).not.toBeNull();
    const [, path, size] = match!;
    const [w, h] = pngSize(publicFile(path));
    expect([w, h]).toEqual([Number(size), Number(size)]);
    expect(w).toBeGreaterThanOrEqual(112);
    expect(source).toMatch(/url: ORGANIZATION_LOGO\.url/);
  });

  it("emits no retired FAQPage or HowTo markup", () => {
    const source = readFileSync(
      join(ROOT, "components/seo/structured-data.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/"@type": "(FAQPage|HowTo)"/);
  });

  it("puts WebSite markup on the home page only", () => {
    const users = sourceFiles(join(ROOT, "app")).filter((file) =>
      readFileSync(file, "utf8").includes("<WebSiteStructuredData"),
    );
    expect(
      users.map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/")),
    ).toEqual(["app/landing/page.tsx"]);
    // ...which is the page "/" serves.
    expect(readFileSync(join(ROOT, "app/page.tsx"), "utf8")).toContain(
      'from "./landing/page"',
    );
  });

  it("starts every breadcrumb trail at the home page, with at least two items", () => {
    const singleItem: string[] = [];
    const noHome: string[] = [];
    for (const file of sourceFiles(join(ROOT, "app"))) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("BreadcrumbStructuredData")) continue;
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
      if (/items=\{\[\s*\{[^}]*\}\s*\]\}/.test(source)) singleItem.push(rel);
      if (!/\{ name: "Home", path: "\/" \}/.test(source)) noHome.push(rel);
    }
    expect(singleItem).toEqual([]);
    expect(noHome).toEqual([]);
  });
});

describe("rendering without CSS", () => {
  // An <svg> with no width/height attributes is drawn at 300x150 when the
  // stylesheet has not loaded (a slow connection, a crawler that skips CSS, a
  // deploy that 404s the old CSS file), so a 16px icon fills the screen. The
  // icon libraries set both attributes; hand-written SVGs have to as well.
  it("gives every hand-written <svg> a width and height", () => {
    const missing: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      // .tsx only: a detector in lib/scanner matches "<svg" in a regex.
      for (const file of sourceFiles(join(ROOT, dir)).filter((f) =>
        f.endsWith(".tsx"),
      )) {
        const source = readFileSync(file, "utf8");
        for (const tag of source.match(/<svg\b[^>]*>/g) ?? []) {
          if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag))
            missing.push(file.slice(ROOT.length + 1).replace(/\\/g, "/"));
        }
      }
    }
    expect(missing).toEqual([]);
  }, 30_000);
});
