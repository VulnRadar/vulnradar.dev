/**
 * What a search engine reads to decide what this site is called and what its
 * icon looks like: the favicon files, the manifest, and the Organization and
 * WebSite structured data. Each of these was wrong in a way nothing caught:
 * the only raster favicon was 32px, the apple-touch-icon was a 1024px PNG,
 * the manifest had no 192 or 512 icon, the Organization logo was an SVG, and
 * WebSite markup sat on every page instead of the home page.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import manifest from "@/app/manifest";
import { SITE_ICONS } from "@/lib/brand/kit";
import {
  alphaAt,
  cornerAlphas,
  coverage,
  decodePng,
  pngSize as pngBytesSize,
} from "../../_helpers/png";

const ROOT = process.cwd();
const publicFile = (url: string) =>
  join(ROOT, "public", url.replace(/^\//, ""));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  return pngBytesSize(readFileSync(file));
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

/** Each image inside favicon.ico, with the size its directory entry claims. */
function icoImages(): { size: number; bytes: Buffer }[] {
  const ico = readFileSync(publicFile("/favicon.ico"));
  expect(ico.readUInt16LE(2)).toBe(1);
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const entry = 6 + 16 * i;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    return { size: ico[entry], bytes: ico.subarray(offset, offset + length) };
  });
}

/**
 * The rule the owner set: every icon is the round mark on a transparent
 * square, exactly as public/favicon.svg draws it, never a tile behind it.
 * The site shipped an opaque navy tile for a while (and this file required
 * it); the corners are the part that tells the two apart.
 */
function expectRoundMark(label: string, bytes: Buffer) {
  const png = decodePng(bytes);
  expect(cornerAlphas(png), `${label} corners`).toEqual([0, 0, 0, 0]);
  // The mark itself is there: the centre is solid, and the disc covers
  // pi/4 * (22/24)^2, about 66%, of the square.
  const mid = Math.floor(png.width / 2);
  expect(alphaAt(png, mid, mid), `${label} centre`).toBe(255);
  expect(coverage(png), `${label} coverage`).toBeGreaterThan(0.6);
}

describe("icons", () => {
  it.each(SITE_ICONS.png.map((icon) => [icon.path, icon.size] as const))(
    "%s is the round mark on a transparent square, %i px",
    (path, size) => {
      const bytes = readFileSync(publicFile(path));
      expect(pngBytesSize(bytes)).toEqual([size, size]);
      expectRoundMark(path, bytes);
    },
  );

  it("ships a favicon.ico holding 16, 32 and 48 px images of the same mark", () => {
    const images = icoImages();
    expect(images.map((i) => i.size)).toEqual([16, 32, 48]);
    expect(images.map((i) => i.size)).toEqual([...SITE_ICONS.ico.sizes]);
    for (const { size, bytes } of images) {
      expect(pngBytesSize(bytes)).toEqual([size, size]);
      expectRoundMark(`favicon.ico ${size}`, bytes);
    }
  });

  it("keeps favicon.png, the README's logo, as the same transparent mark", () => {
    expectRoundMark("favicon.png", readFileSync(publicFile("/favicon.png")));
  });

  it("ships no maskable icon and no tile, since both are a background", () => {
    const icons = manifest().icons ?? [];
    expect(icons.some((i) => i.purpose?.includes("maskable"))).toBe(false);
    expect(existsSync(publicFile("/icon-maskable-512.png"))).toBe(false);
    expect(existsSync(publicFile("/icon.svg"))).toBe(false);
  });

  it("names favicon.svg, the one master, as the SVG icon everywhere", () => {
    const icons = manifest().icons ?? [];
    expect(
      icons.filter((i) => i.type === "image/svg+xml").map((i) => i.src),
    ).toEqual(["/favicon.svg"]);
    const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
    expect(layout).toContain('{ url: "/favicon.svg", type: "image/svg+xml" }');
    expect(layout).toContain('{ url: "/favicon.ico", sizes: "32x32" }');
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
