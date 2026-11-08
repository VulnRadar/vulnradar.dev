/**
 * 51 code-category pages shipped one templated sentence as their explanation.
 * It named the check id back at the reader, said "the server" about code that
 * runs in a browser, and described SQL injection and a missing header the same
 * way. The check pages hide it now, but the same text is what a scan result
 * and the AI chat read, so it stays out of the data.
 */

import { describe, expect, it } from "vitest";

import { GENERATED_FILLER, loadCheckPages } from "./_page-prose";

const pages = loadCheckPages();

describe("checks-data: no generated filler", () => {
  it("reads the real data", () => {
    expect(pages.length).toBeGreaterThan(500);
  });

  it("matches the sentence the pages used to carry", () => {
    expect(
      GENERATED_FILLER.test(
        "The `code-x` check verifies that the server does not expose the `x` weakness in the code category.",
      ),
    ).toBe(true);
    expect(
      GENERATED_FILLER.test(
        "The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.",
      ),
    ).toBe(true);
    expect(GENERATED_FILLER.test("exec hands one string to a shell.")).toBe(
      false,
    );
  });

  it("is absent from every prose field of every check", () => {
    const hits = pages.flatMap((page) =>
      (
        [
          ["description", page.description],
          ["riskImpact", page.riskImpact],
          ["explanation", page.explanation],
          ...page.fixSteps.map((step) => ["fixSteps", step]),
        ] as [string, string | undefined][]
      )
        .filter(([, text]) => text && GENERATED_FILLER.test(text))
        .map(([field]) => `${page.id}.${field}`),
    );
    expect(hits).toEqual([]);
  });
});
