/**
 * The scan lifecycle's focus and announcements, pinned from the markup.
 *
 * Starting a scan unmounts the control that had focus, and the scan then
 * finishes or fails with nothing said. There is no DOM here to watch focus
 * move, so the behaviour is split the way the repo splits everything it cannot
 * mount: the decisions are pure and tested on their own (canTakeFocus,
 * currentAnnouncement, errorKindForFailure), and these assertions hold the
 * wiring that connects them to the markup, which is where this regressed.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const INDICATOR = read("components/scanner/scanning-indicator.tsx");
const ERROR_STATE = read("components/scanner/dashboard-error-state.tsx");
const RESULTS = read("components/scanner/dashboard-results.tsx");
const PAGE = read("app/dashboard/page.tsx");

/** Source with comments removed, so prose about a bug does not match it. */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("scanning card", () => {
  it("is not aria-busy", () => {
    // aria-busy on an ancestor of the status region, never set back to false,
    // lets assistive tech hold that region's updates until the card unmounts.
    expect(code(INDICATOR)).not.toContain("aria-busy");
  });

  it("keeps its progress status region", () => {
    expect(code(INDICATOR)).toContain('role="status"');
  });

  it("gives its heading somewhere for focus to wait", () => {
    expect(code(INDICATOR)).toMatch(
      /<h1 ref=\{headingRef\} tabIndex=\{-1\} className="sr-only">/,
    );
  });

  it("moves focus to Cancel as soon as Cancel exists, and to the heading until then", () => {
    const c = code(INDICATOR);
    expect(c).toMatch(/hasCancel \? cancelRef\.current : headingRef\.current/);
    expect(c).toMatch(/<button\s+ref=\{cancelRef\}/);
    // Re-runs when Cancel appears, not only on mount: the page offers it a
    // moment after this card does, once the POST has answered.
    expect(c).toMatch(/\}, \[hasCancel\]\)/);
  });

  it("does not take focus from somebody who has gone elsewhere", () => {
    expect(code(INDICATOR)).toContain("canTakeFocus(active, document.body)");
  });
});

describe("failure screen", () => {
  const c = code(ERROR_STATE);

  it("has one h1, the visible title, and no sr-only duplicate of it", () => {
    expect(c.match(/<h1\b/g)).toHaveLength(1);
    expect(c).not.toMatch(/<h1 className="sr-only"/);
    expect(c).toMatch(/<h1\s+ref=\{headingRef\}\s+tabIndex=\{-1\}/);
    expect(c).not.toContain("<h2");
  });

  it("moves focus to that heading when it appears", () => {
    expect(c).toContain("useFocusOnMount<HTMLHeadingElement>()");
  });

  it("announces itself by the same title the heading carries", () => {
    expect(c).toContain("export function describeFailure(");
    expect(c).toMatch(/return \{ kind, title: ERROR_META\[kind\]\.title \}/);
  });
});

describe("result view", () => {
  it("moves focus to the scanned URL heading when the result appears", () => {
    const c = code(RESULTS);
    expect(c).toContain("useFocusOnMount<HTMLDivElement>(");
    expect(c).toMatch(/root\.querySelector\("h1"\)/);
    // The ref sits on the wrapper that holds the heading.
    expect(c).toMatch(
      /<div ref=\{headingRef\} className="[^"]*">\s*<CopyableHeading/,
    );
  });

  it("makes the heading focusable without giving it a tab stop", () => {
    expect(code(RESULTS)).toMatch(/heading\.tabIndex = -1/);
  });
});

describe("dashboard page", () => {
  const c = code(PAGE);

  it("keeps one polite live region mounted outside every status branch", () => {
    const regions = c.match(/role="status"/g) ?? [];
    expect(regions).toHaveLength(1);
    const at = c.indexOf('role="status"');
    // Before the first branch that mounts and unmounts with `status`...
    expect(at).toBeLessThan(c.indexOf('status === "idle" &&'));
    // ...and not itself conditional: the nearest thing before the element is
    // the fragment opening, not an `&&` or a ternary arm.
    expect(c.slice(Math.max(0, at - 40), at)).toMatch(/<>\s*<p\s*$/);
    expect(c).toMatch(/aria-live="polite"/);
  });

  it("writes the announcement for the current state into it, in the reader's language", () => {
    expect(c).toContain('useTranslations("dashboard")');
    expect(c).toContain("currentAnnouncement({");
    expect(c).toMatch(/t\(announced\.key, announced\.values\)/);
  });

  it("announces the failure by the title the failure screen shows", () => {
    expect(c).toMatch(/describeFailure\(\s*error,/);
  });

  it("counts findings once, when the result appears", () => {
    // Reading result.findings at render would re-announce completion whenever
    // the list is replaced by a verdict or an AI review.
    expect(c).toContain("setCompletedFindings(effectiveFindings.length)");
    expect(c).not.toMatch(/findings:\s*result\??\.findings/);
  });

  it("uses the failure kind the status route sent when there is one", () => {
    expect(c).toContain("errorKindForFailure(statusData.failureKind)");
  });

  it("notes a Stop, which returns to the form with nothing else to say why", () => {
    const stop = c.slice(c.indexOf("function handleCancelScan()"));
    expect(stop.slice(0, 400)).toContain("setCancelledNotice(true)");
  });
});
