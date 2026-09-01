import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Pins the layout invariants a phone depends on. Everything here was a live
 * bug at some point and every one of them is invisible on a desktop browser,
 * which is why they kept coming back.
 *
 * Source-text assertions on purpose, same reasoning as
 * tests/components/shared/public-page-shells.test.ts: vitest.config.ts runs
 * `node`, there is no DOM and no jsdom, and there would be no layout engine to
 * measure even if there were. What is worth pinning is the class contract, and
 * that is visible in the source.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Source with comments stripped. Several of these files explain the bug they
 * fixed in a comment that names the very class the assertion looks for, so
 * matching the prose would let a regression pass on its own documentation.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Everything pinned to the bottom edge of the viewport. The cookie notice is
 * z-60 and mounted last in the root layout, so at a flat `bottom-0`/`bottom-4`
 * it painted over every one of these: on a phone it is roughly 125px tall,
 * which is enough to bury a save bar completely.
 * components/shared/cookie-notice.tsx publishes its measured height as
 * --vr-cookie-h for exactly this, so anything anchored to that edge has to
 * read it.
 */
const BOTTOM_PINNED = [
  "app/profile/page.tsx",
  "components/admin/users/user-detail-panel.tsx",
  "components/admin/features/system-settings-manager.tsx",
  "components/admin/shared/admin-mobile-toc.tsx",
  "components/admin/shared/toast.tsx",
  "components/shared/offline-banner.tsx",
  "components/shared/site-notifications.tsx",
  "components/scanner/results-list.tsx",
  "components/docs/docs-mobile-nav.tsx",
  "components/ai-chat/chat-widget.tsx",
  "components/ui/toast.tsx",
];

/**
 * Files with a sticky or fixed element anchored to the TOP edge. Two banners
 * can be up there at once and both publish their height: --vr-banner-h
 * (components/shared/site-notifications.tsx) and --vr-imp-banner-h
 * (components/admin/impersonation-banner.tsx). The impersonation banner is
 * z-60, above every header in the app, so a consumer that offset by only the
 * first variable had the amber banner painted straight over its nav for the
 * whole impersonation session.
 */
const TOP_PINNED = [
  "components/scanner/header.tsx",
  "components/landing/landing-nav.tsx",
  "components/pricing/pricing-skeleton.tsx",
  "components/billing/checkout-skeleton.tsx",
  "app/checkout/[productId]/page.tsx",
  "app/checkout/credits/page.tsx",
  "app/checkout/github-credits/page.tsx",
  "app/checkout/browser-credits/page.tsx",
  "app/profile/page.tsx",
  "app/admin/page.tsx",
];

/**
 * The scanner result panels that open onto a sticky bar carrying the scanned
 * hostname. A hostname is a single unbreakable token, so without `truncate` it
 * sets the bar's min width and pushes the summary line, the count and the
 * refresh control out of a card whose root is overflow-hidden. The content is
 * not clipped by a scrollbar, it is simply gone.
 *
 * `truncate` alone is the whole contract: its `overflow: hidden` is what makes
 * the flex item's automatic minimum size zero, since `min-width: auto` only
 * applies while `overflow` is `visible`. A `min-w-0` beside it is belt and
 * braces, not a requirement, so this does not insist on one.
 */
const HOST_BAR_PANELS = [
  "components/scanner/dns-records-panel.tsx",
  "components/scanner/port-scan-panel.tsx",
  "components/scanner/threat-intel-panel.tsx",
  "components/scanner/software-inventory-panel.tsx",
];

describe("bottom-pinned overlays clear the cookie notice", () => {
  it.each(BOTTOM_PINNED)("%s offsets by --vr-cookie-h", (rel) => {
    expect(code(rel)).toContain("--vr-cookie-h");
  });

  it("cookie-notice.tsx is the one publishing that height", () => {
    const src = code("components/shared/cookie-notice.tsx");
    expect(src).toContain('setProperty("--vr-cookie-h"');
    expect(src).toContain("ResizeObserver");
  });
});

describe("top-pinned headers clear both banners", () => {
  it.each(TOP_PINNED)("%s offsets by --vr-imp-banner-h too", (rel) => {
    const src = code(rel);
    expect(src).toContain("--vr-banner-h");
    expect(src).toContain("--vr-imp-banner-h");
  });

  it("impersonation-banner.tsx is the one publishing that height", () => {
    const src = code("components/admin/impersonation-banner.tsx");
    expect(src).toContain('setProperty("--vr-imp-banner-h"');
  });
});

describe("scanner panel host bars truncate", () => {
  it.each(HOST_BAR_PANELS)("%s truncates the host", (rel) => {
    // The bar is the only place in these files where a `.host` value is
    // rendered into a span of its own, so pinning the class on that span is
    // enough without parsing the JSX.
    const src = read(rel);
    const bar = src.match(
      /<span\s+className="([^"]*font-mono[^"]*uppercase[^"]*)"/,
    );
    expect(bar, `no host bar span found in ${rel}`).not.toBeNull();
    expect(bar![1]).toContain("truncate");
  });
});

describe("no h-screen where mobile browser chrome would cut content", () => {
  it("app/ uses min-h-screen or 100dvh, never a bare h-screen", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), {
        withFileTypes: true,
      })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (entry.name.endsWith(".tsx")) {
          // `min-h-screen` only sets a floor, so the page still scrolls and
          // the chrome costs nothing. `h-screen` pins the box to the LARGE
          // viewport, which on iOS Safari is taller than what is visible.
          if (/(?<!min-)\bh-screen\b/.test(code(rel))) offenders.push(rel);
        }
      }
    };
    walk("app");
    expect(offenders).toEqual([]);
  });
});

describe("the AI chat markdown renderer cannot widen the panel", () => {
  const src = read("components/ai-chat/message-content.tsx");

  it("wraps markdown tables in a horizontal scroller", () => {
    // A table cell will not shrink below its own min-content width, so w-full
    // alone does not hold a table inside a phone-width bubble.
    expect(src).toMatch(/overflow-x-auto[\s\S]{0,120}<table/);
  });

  it("breaks long links and inline code", () => {
    expect(src).toMatch(/<a\s+className="break-words/);
    expect(src).toMatch(/<code\s+className="[^"]*break-all/);
  });
});
