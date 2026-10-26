import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * /changelog used to load the next four releases whenever the "Load more"
 * button came within 400px of the viewport, so the footer was out of reach
 * until all of the history had loaded. Loading is button-only now (owner
 * decision 15 of the v4.0.0 plan).
 *
 * Source-text assertions on purpose: the suite runs under `node` with no DOM,
 * so there is no IntersectionObserver to observe and no layout to scroll.
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("changelog loading is button-only", () => {
  const src = code("components/changelog/changelog-load-more.tsx");

  it("has no scroll-triggered loading", () => {
    expect(src).not.toContain("IntersectionObserver");
    expect(src).not.toContain("rootMargin");
    expect(src).not.toContain("sentinel");
    // The effect existed only to arm the observer. A new effect here would
    // need its own reason, and this is the place to be asked for it.
    expect(src).not.toMatch(/\buseEffect\b/);
  });

  it("advances only from the button's click", () => {
    expect(src).toMatch(/onClick=\{loadMore\}/);
    // loadMore is called from that one handler and nowhere else.
    expect(src.match(/\bloadMore\(/g) ?? []).toEqual([]);
    expect(src).toContain("Load more releases");
  });

  it("keeps the progress line and the retry message", () => {
    expect(src).toContain("Showing ${offset} of ${total}");
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain("Those releases could not be loaded. Try again.");
  });

  it("keeps the end-of-history line for when everything is loaded", () => {
    expect(src).toContain("The beginning of {APP_NAME}");
  });

  it("nothing else on the changelog route observes scroll position", () => {
    for (const rel of [
      "components/changelog/changelog-list.tsx",
      "components/changelog/changelog-release.tsx",
      "components/changelog/changelog-actions.tsx",
      "app/changelog/page.tsx",
    ]) {
      expect(code(rel), rel).not.toContain("IntersectionObserver");
    }
  });
});
