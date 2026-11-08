/**
 * /llms.txt and /llms-full.txt exist to be quoted by answer engines, so the
 * first sentence has to be the number the rest of the site states. They used
 * to open with getAllChecks().length, which counts the checks that have a page
 * of their own (a smaller number than the engine runs), and called it the total.
 */
import { describe, it, expect } from "vitest";
import { GET as getLlms } from "@/app/llms.txt/route";
import { GET as getLlmsFull } from "@/app/llms-full.txt/route";
import { DOCS_PAGES } from "@/components/docs/docs-nav";
import { API, APP_URL, TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { EXACT_CHECK_CATEGORY_COUNT } from "@/lib/config/check-stats.generated";
import { getAllChecks, SEO_CATEGORIES } from "@/lib/seo/checks-content";

const llms = await getLlms().text();
const full = await getLlmsFull().text();
const guideCount = getAllChecks().length;

function blockquote(text: string): string {
  const line = text.split("\n").find((l) => l.startsWith("> "));
  expect(line, "no blockquote headline").toBeDefined();
  return line!;
}

describe.each([
  ["/llms.txt", llms],
  ["/llms-full.txt", full],
])("%s", (_name, text) => {
  it("headlines the same total and category count as the rest of the site", () => {
    const headline = blockquote(text);
    expect(headline).toContain(TOTAL_CHECKS_LABEL);
    expect(headline).toContain(`${EXACT_CHECK_CATEGORY_COUNT} categories`);
  });

  it("only ever calls the page count a count of fix guides", () => {
    const hits = [...text.matchAll(new RegExp(`\\b${guideCount}\\b`, "g"))];
    expect(hits.length, "the fix guide count is not stated").toBeGreaterThan(0);
    for (const hit of hits) {
      expect(text.slice(hit.index, hit.index + 40)).toMatch(
        new RegExp(`^${guideCount} (checks )?with a fix guide`),
      );
    }
  });

  it("does not claim a page for every check", () => {
    expect(text).not.toMatch(/documented as its own page/i);
    expect(text).not.toMatch(/every single check/i);
    expect(text).not.toMatch(/every one of the/i);
  });
});

describe("the category set", () => {
  it("is the set the headline counts", () => {
    expect(SEO_CATEGORIES.length).toBe(EXACT_CHECK_CATEGORY_COUNT);
  });
});

describe("/llms-full.txt", () => {
  it("states the fix guide count it actually lists", () => {
    const links = full.match(/\/checks\/(?!category\/)[^)\s]+\)/g);
    expect(links?.length).toBe(guideCount);
  });
});

describe("/llms.txt documentation list", () => {
  it("links every page in the docs table, with its summary", () => {
    const section = llms.slice(
      llms.indexOf("## Documentation"),
      llms.indexOf("## Checks and fix guides"),
    );
    for (const page of DOCS_PAGES) {
      expect(section, page.href).toContain(
        `- [${page.label}](${APP_URL}${page.href})`,
      );
      if (page.summary) expect(section).toContain(page.summary);
    }
  });

  it("links the OpenAPI document by its current path", () => {
    expect(llms).toContain(`(${APP_URL}${API.OPENAPI})`);
  });
});
