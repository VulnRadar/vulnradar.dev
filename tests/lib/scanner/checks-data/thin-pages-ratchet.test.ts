/**
 * A critical or high finding sends someone to its page with a real problem, so
 * that page has to say what happened, how to confirm it and how to fix it. A
 * flat floor would have failed on the day it was added, so the pages still
 * under it are listed here and the list only shrinks: a new thin page fails, a
 * listed page that loses words fails, and a page that clears the floor (or
 * stops being critical or high) has to come off.
 */

import { describe, expect, it } from "vitest";

import { type CheckPage, loadCheckPages, pageProseWords } from "./_page-prose";

const FLOOR = 80;

/** Id to the words the page had when it was listed. */
const BASELINE: Readonly<Record<string, number>> = {
  "csp-unsafe-inline-script": 34,
  "form-action-http": 67,
  "tls-protocol-version": 79,
  "x-frame-options-allowall": 47,
};

type RatchetPage = Pick<
  CheckPage,
  "id" | "severity" | "description" | "riskImpact" | "explanation" | "fixSteps"
>;

function ratchet(
  pages: readonly RatchetPage[],
  baseline: Readonly<Record<string, number>>,
) {
  const thin = new Map(
    pages
      .filter(
        (page) => page.severity === "critical" || page.severity === "high",
      )
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

const page = (id: string, words: number, severity = "high"): RatchetPage => ({
  id,
  severity,
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

  it("leaves a thin page below high alone", () => {
    expect(ratchet([page("low", 5, "medium")], {}).added).toEqual([]);
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

  it("wants a demoted or deleted page off the list", () => {
    expect(ratchet([page("a", 10, "medium")], { a: 10 }).cleared).toEqual([
      "a",
    ]);
    expect(ratchet([], { gone: 10 }).cleared).toEqual(["gone"]);
  });
});

describe("thin-page ratchet", () => {
  const result = ratchet(loadCheckPages(), BASELINE);

  it("has no new critical or high page under the floor", () => {
    expect(result.added).toEqual([]);
  });

  it("has no listed page with fewer words than when it was listed", () => {
    expect(result.worse).toEqual([]);
  });

  it("has no listed page that no longer belongs on the list", () => {
    expect(result.cleared).toEqual([]);
  });
});
