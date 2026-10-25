/**
 * The finding view's heading, focus and the sort control's name, pinned from
 * the markup.
 *
 * Opening a finding replaced the report, including its h1, with a view whose
 * outline began at an h2 and which left focus on <body>; Back restored the
 * scroll position and not the focus. The sort button's accessible name was the
 * opposite of its visible text. The focus hand-off is behavioural and has its
 * own suite (finding-focus.test.ts); these hold the wiring.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Source with comments removed, so prose about a bug does not match it. */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DETAIL = code(read("components/scanner/issue-detail.tsx"));
const LIST = code(read("components/scanner/results-list.tsx"));

describe("finding view heading", () => {
  it("has one h1, and it is the finding's title", () => {
    expect(DETAIL.match(/<h1\b/g)).toHaveLength(1);
    expect(DETAIL).toMatch(
      /<h1\s+ref=\{titleRef\}\s+tabIndex=\{-1\}[\s\S]*?>\s*\{issue\.title\}\s*<\/h1>/,
    );
  });

  it("steps the section headings down so the outline is h1 then h2, never h1 then h3", () => {
    for (const title of [
      "What the scanner saw",
      "What this means",
      "If left unfixed",
      "How to fix it",
      "Working example",
    ]) {
      expect(DETAIL, `${title} should be an h2`).toMatch(
        new RegExp(`<h2[^>]*>\\s*${title}\\s*</h2>`),
      );
    }
    expect(DETAIL).toMatch(/<h3[^>]*>\s*Verbatim proof\s*<\/h3>/);
    expect(DETAIL).not.toMatch(/<h4\b/);
  });

  it("moves focus to the title when a finding opens or changes", () => {
    const effect = DETAIL.slice(DETAIL.indexOf("window.scrollTo(0, 0)"));
    expect(effect.slice(0, 200)).toContain("titleRef.current?.focus(");
    expect(effect.slice(0, 260)).toMatch(/\[issue\.id\]/);
  });

  it("tells the list when it closes so the list can take focus back", () => {
    expect(DETAIL).toMatch(/useEffect\(\(\) => noteFindingClosed, \[\]\)/);
  });
});

describe("findings list", () => {
  it("marks every row with its finding id", () => {
    expect(LIST).toContain("data-finding-id={issue.id}");
  });

  it("remembers which row was opened", () => {
    const open = LIST.slice(LIST.indexOf("const handleSelectIssue"));
    expect(open.slice(0, 400)).toContain("rememberOpenedFinding(issue.id)");
  });

  it("puts focus back on that row when it mounts as a finding closes", () => {
    const restore = LIST.slice(
      LIST.indexOf("window.scrollTo(0, savedListScrollY)"),
    );
    const body = restore.slice(0, 700);
    expect(body).toContain("takeFindingToRefocus()");
    // Only for the same list the finding was opened from.
    expect(body).toMatch(/reopened && sameList/);
    expect(body).toContain("focusFindingRow(document, reopened)");
  });
});

describe("severity sort button", () => {
  const start = LIST.indexOf("onClick={() => setSortAsc(!sortAsc)}");
  const button = LIST.slice(start, LIST.indexOf("</button>", start));

  it("is found", () => {
    expect(start).toBeGreaterThan(-1);
  });

  it("is named by its visible text, not by an aria-label that contradicts it", () => {
    // The label named the action ("most severe first") while the button showed
    // the state ("Least severe first"), so the name was the opposite of the
    // screen and a voice user saying the visible words matched nothing.
    expect(button).not.toContain("aria-label");
    expect(button).toContain('Least severe first"');
    expect(button).toContain('"Most severe first"');
  });

  it("says what it sorts with a screen-reader-only prefix inside the same name", () => {
    expect(button).toMatch(
      /<span className="sr-only">Sort by severity: <\/span>/,
    );
    // The prefix comes before the visible state, so the name reads
    // "Sort by severity: Most severe first".
    expect(button.indexOf("Sort by severity:")).toBeLessThan(
      button.indexOf("Least severe first"),
    );
  });
});
