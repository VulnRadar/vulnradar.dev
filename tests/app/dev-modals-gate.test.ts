/**
 * app/dev/ holds development-only workbenches (currently the modal workbench).
 * It is a debugging surface: it renders every dialog in the product on demand,
 * including admin ones, with no regard for who is looking. It must never be
 * reachable in production, and "must never" in a codebase with no branch
 * protection means a test, not a convention.
 *
 * Four independent layers are asserted here, because each one fails
 * differently:
 *
 *  1. The filename. Pages under app/dev are named `page.dev.tsx`, and `dev.tsx`
 *     is only in `pageExtensions` outside production, so the route does not
 *     exist in a production build and neither the page nor the workbench is
 *     emitted. This layer was added after the first `npm run build` still
 *     listed /dev/modals at 14.6 kB with only the NODE_ENV guard in place: the
 *     route 404'd, but it and its bundle shipped.
 *  2. The page's own `process.env.NODE_ENV === "production"` guard. Next inlines
 *     that constant at build time, so the component body is `notFound()` and the
 *     workbench is behind a dynamic import the branch never reaches. This is the
 *     layer that survives somebody reordering pageExtensions.
 *  3. The middleware. "/dev" is absent from PUBLIC_PATHS, so an unauthenticated
 *     request is redirected to /login before the route runs at all.
 *  4. robots.txt. "/dev" is in DISALLOWED_PATHS, so it is never crawled and
 *     cannot reach the sitemap.
 *
 * The walk over app/dev is deliberate: it catches a SECOND workbench added
 * later without a guard, which is exactly how this kind of route starts
 * shipping silently.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { DISALLOWED_PATHS } from "@/lib/seo/routes";
import { PUBLIC_PATHS } from "@/lib/config/public-paths";
import { ROUTES } from "@/lib/config/client-constants";

const DEV_DIR = join(process.cwd(), "app", "dev");

/** Every page or route module under app/dev, as a repo-relative path. */
function devPageFiles(): string[] {
  if (!existsSync(DEV_DIR)) return [];
  const found: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/^(?:page|route|layout)\.(?:dev\.)?[jt]sx?$/.test(entry)) {
        found.push(full);
      }
    }
  }
  walk(DEV_DIR);
  return found.map((f) => relative(process.cwd(), f).split(sep).join("/"));
}

/** The middleware's own rule, copied so the test fails if /dev is added. */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => {
    if (p === ROUTES.HOME || p === ROUTES.LANDING) return pathname === p;
    return pathname.startsWith(p);
  });
}

describe("app/dev is development only", () => {
  it("has at least one page, so the rest of this suite is not vacuous", () => {
    expect(devPageFiles().length).toBeGreaterThan(0);
  });

  it("names every page under app/dev with the dev-only extension", () => {
    for (const file of devPageFiles()) {
      expect(file, `${file} would be a route in production`).toMatch(
        /\/(?:page|route|layout)\.dev\.tsx$/,
      );
    }
  });

  it("only adds the dev-only extension outside production", () => {
    const config = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");
    // The whole mechanism is this one conditional. If it becomes
    // unconditional, every app/dev page silently becomes a production route
    // again and only the NODE_ENV guard is left standing.
    expect(config).toMatch(/pageExtensions/);
    expect(config).toMatch(
      /process\.env\.NODE_ENV === "production" \? \[\] : \["dev\.tsx"\]/,
    );
  });

  it("gates every page under app/dev on NODE_ENV and calls notFound()", () => {
    for (const file of devPageFiles()) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(
        /process\.env\.NODE_ENV\s*===\s*["']production["']/.test(source),
        `${file} has no production guard`,
      ).toBe(true);
      expect(source, `${file} does not call notFound()`).toMatch(/notFound\(/);
    }
  });

  it("keeps the workbench behind a dynamic import, not a static one", () => {
    // A static `import { ModalWorkbench } from "./workbench"` would pull the
    // whole workbench into the production bundle even though the route 404s.
    const page = readFileSync(
      join(process.cwd(), "app", "dev", "modals", "page.dev.tsx"),
      "utf8",
    );
    expect(page).toMatch(/await import\(\s*["']\.\/workbench["']\s*\)/);
    expect(page).not.toMatch(/^import .*from ["']\.\/workbench["']/m);
  });

  it("is not a public path, so the middleware redirects anonymous visitors", () => {
    expect(isPublicPath("/dev")).toBe(false);
    expect(isPublicPath("/dev/modals")).toBe(false);
  });

  it("is disallowed in robots.txt", () => {
    expect(DISALLOWED_PATHS).toContain("/dev");
  });

  it("is not in the sitemap", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const entries = await sitemap();
    for (const entry of entries) {
      expect(new URL(entry.url).pathname.startsWith("/dev")).toBe(false);
    }
  });
});
