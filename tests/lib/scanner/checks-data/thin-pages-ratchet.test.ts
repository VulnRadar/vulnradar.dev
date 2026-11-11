/**
 * Every check page sends someone to a real problem, so it has to say what
 * happened, how to confirm it and how to fix it. A flat floor would have failed
 * on the day it was added, so the pages still under it are listed and the lists
 * only shrink: a new thin page fails, a listed page that loses words fails, and
 * a page that clears the floor (or goes away) has to come off its list.
 *
 * There is one list per category, tests/lib/scanner/checks-data/thin-pages/
 * <category>.json, mapping a page id to the words it had when it was listed.
 * Whoever rewrites a category's pages shrinks only that category's file, so two
 * people working on different categories never touch the same lines. Every
 * severity counts: an info page is still the page a search result lands on.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type CheckPage, loadCheckPages, pageProseWords } from "./_page-prose";

const FLOOR = 80;

const BASELINE_DIR = join(
  process.cwd(),
  "tests",
  "lib",
  "scanner",
  "checks-data",
  "thin-pages",
);

/** One per checks-data file: a page's category is the file it lives in. */
const CATEGORIES = readdirSync(
  join(process.cwd(), "lib", "scanner", "checks-data"),
)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(/.json$/, ""))
  .sort();

type Baseline = Readonly<Record<string, number>>;

type RatchetPage = Pick<
  CheckPage,
  "id" | "description" | "riskImpact" | "explanation" | "fixSteps"
>;

function ratchet(pages: readonly RatchetPage[], baseline: Baseline) {
  const thin = new Map(
    pages
      .map((page) => [page.id, pageProseWords(page)] as const)
      .filter(([, words]) => words < FLOOR),
  );
  return {
    added: [...thin.keys()].filter((id) => !(id in baseline)).sort(),
    worse: [...thin]
      .filter(([id, words]) => id in baseline && words < baseline[id])
      .map(([id, words]) => `${id} (${words}, was ${baseline[id]})`)
      .sort(),
    cleared: Object.keys(baseline)
      .filter((id) => !thin.has(id))
      .sort(),
  };
}

const page = (id: string, words: number): RatchetPage => ({
  id,
  description: Array.from({ length: words }, (_, i) => `w${i}`).join(" "),
  fixSteps: [],
});

describe("thin-page ratchet logic", () => {
  it("reports a new page under the floor", () => {
    expect(ratchet([page("new", 10)], {}).added).toEqual(["new"]);
  });

  it("does not report a page at the floor", () => {
    expect(ratchet([page("ok", FLOOR)], {}).added).toEqual([]);
  });

  it("reports a listed page that lost words", () => {
    expect(ratchet([page("a", 10)], { a: 20 }).worse).toEqual([
      "a (10, was 20)",
    ]);
  });

  it("lets a listed page gain words and stay listed", () => {
    expect(ratchet([page("a", 30)], { a: 20 })).toEqual({
      added: [],
      worse: [],
      cleared: [],
    });
  });

  it("wants a page that cleared the floor off the list", () => {
    expect(ratchet([page("a", FLOOR)], { a: 20 }).cleared).toEqual(["a"]);
  });

  it("wants a deleted page off the list", () => {
    expect(ratchet([], { gone: 10 }).cleared).toEqual(["gone"]);
  });
});

function readBaseline(category: string): Baseline {
  const file = join(BASELINE_DIR, `${category}.json`);
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Baseline)
    : {};
}

describe("thin-page baseline files", () => {
  it("has exactly one file per category", () => {
    const files = readdirSync(BASELINE_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/, ""))
      .sort();
    expect(files).toEqual(CATEGORIES);
  });

  it("lists every id in its own category's file, in order", () => {
    for (const category of CATEGORIES) {
      const ids = Object.keys(readBaseline(category));
      expect(ids, category).toEqual([...ids].sort());
    }
  });

  it("only lists whole word counts below the floor", () => {
    for (const category of CATEGORIES) {
      for (const [id, words] of Object.entries(readBaseline(category))) {
        expect(Number.isInteger(words), `${category}/${id}`).toBe(true);
        expect(words, `${category}/${id}`).toBeLessThan(FLOOR);
      }
    }
  });
});

describe("thin-page ratchet", () => {
  const pages = loadCheckPages();

  for (const category of CATEGORIES) {
    describe(category, () => {
      const result = ratchet(
        pages.filter((p) => p.file === `${category}.json`),
        readBaseline(category),
      );

      it(`has no new page under ${FLOOR} words`, () => {
        expect(result.added).toEqual([]);
      });

      it("has no listed page with fewer words than when it was listed", () => {
        expect(result.worse).toEqual([]);
      });

      it("has no listed page that no longer belongs on the list", () => {
        expect(result.cleared).toEqual([]);
      });
    });
  }
});
