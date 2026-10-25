import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * RouteError is the body of every route-level error.tsx.
 *
 * Header, <main> and Footer are rendered by each page (AppPageShell), not by
 * the route layouts, so when a segment threw, its error.tsx replaced the page
 * and took all three with it: nothing to navigate with but the back button, no
 * <main> for the root skip link to land on, and a heading that was an
 * off-tier H2 on a page with no H1. These pin the fix.
 *
 * Source-text assertions, like the rest of tests/components: vitest.config.ts
 * runs `node` and tsconfig keeps `jsx: preserve`, so a .tsx component cannot
 * be imported into a test at all.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("RouteError keeps the page's chrome", () => {
  const src = code("components/shared/route-error.tsx");

  it("renders inside a page shell, so Header, <main> and Footer survive", () => {
    expect(src).toContain(
      'import { AppPageShell } from "@/components/shared/app-page-shell"',
    );
    expect(src).toContain(
      'import { PublicPageShell } from "@/components/shared/public-page-shell"',
    );
    expect(src).toMatch(
      /const Shell = chrome === "public" \? PublicPageShell : AppPageShell/,
    );
    expect(src).toMatch(/<Shell>[\s\S]*<\/Shell>/);
  });

  it("defaults to the app shell", () => {
    expect(src).toMatch(/chrome = "app"/);
  });

  it("titles the page with the Tier C H1 and has no H2", () => {
    expect(src).toContain(
      '<h1 className="text-lg font-semibold text-foreground">{title}</h1>',
    );
    expect(src).not.toContain("<h2");
  });

  it("still announces the failure and shows the digest", () => {
    expect(src).toContain('role="alert"');
    expect(src).toContain("ref: {error.digest}");
  });

  it("offers a way out by default, and lets a route replace it", () => {
    expect(src).toContain("{action ?? (");
    expect(src).toContain("ROUTES.DASHBOARD");
    expect(src).toContain("Back to scanner");
    // The public shell has no scanner to go back to.
    expect(src).toContain("ROUTES.LANDING");
    expect(src).toContain("Back to home");
  });

  it("goes back with a full navigation, not through the client router", () => {
    const action = src.slice(src.indexOf("{action ?? ("));
    expect(action).toMatch(/<a\s+href=/);
    expect(action).not.toContain("<Link");
    expect(src).not.toContain('from "next/link"');
  });
});

describe("each route boundary picks the chrome its page wears", () => {
  /** Boundaries whose page does not wear the signed-in app header: a logged-out
   *  visitor can reach it (/contact, /public-scans, /checkout/success), or it
   *  is the checkout funnel, which drops the app nav on purpose. */
  const PUBLIC = ["contact", "checkout", "public-scans"];

  const boundaries = fs
    .readdirSync(path.join(ROOT, "app"), { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        fs.existsSync(path.join(ROOT, "app", e.name, "error.tsx")),
    )
    .map((e) => e.name);

  it("is reading the tree, not an empty list that would pass everything below", () => {
    expect(boundaries.length).toBeGreaterThanOrEqual(14);
    for (const segment of PUBLIC) expect(boundaries).toContain(segment);
  });

  it.each(PUBLIC)("app/%s/error.tsx asks for the public shell", (segment) => {
    expect(read(`app/${segment}/error.tsx`)).toContain('chrome="public"');
  });

  it("every other boundary keeps the app shell", () => {
    for (const segment of boundaries.filter((b) => !PUBLIC.includes(b))) {
      expect(
        read(`app/${segment}/error.tsx`),
        `app/${segment}/error.tsx`,
      ).not.toContain("chrome=");
    }
  });

  it("the public routes' pages really do wear a shell of their own", () => {
    expect(read("app/contact/page.tsx")).toContain("<PublicPageShell");
    expect(read("app/checkout/[productId]/page.tsx")).toContain(
      "<CheckoutShell",
    );
    expect(read("app/public-scans/page.tsx")).toContain("<PublicPageShell");
  });

  it("the app routes' pages really do wear the app header", () => {
    const APP_HEADER = /<AppPageShell|<Header\b/;
    for (const segment of boundaries.filter((b) => !PUBLIC.includes(b))) {
      expect(
        read(`app/${segment}/page.tsx`),
        `app/${segment}/page.tsx`,
      ).toMatch(APP_HEADER);
    }
  });
});
