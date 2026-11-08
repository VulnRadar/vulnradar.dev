import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DOCS_PAGES } from "@/components/docs/docs-nav";
import type { DocsTemplate } from "@/components/docs/docs-types";

/**
 * A page's template says what it may contain. Warn mode: a page that does not
 * fit yet is reported in the run's output and the test passes, because most
 * pages are still to be migrated. It starts failing at the end of the docs
 * rewrite, when STRICT goes true.
 */
const STRICT = false;

const ROOT = path.resolve(__dirname, "../..");

/** Component names the page's JSX uses, not just imports. */
function renders(source: string, component: string): boolean {
  return new RegExp(`<${component}\\b`).test(source);
}

export function templateProblems(
  template: DocsTemplate,
  source: string,
): string[] {
  const problems: string[] = [];
  if (template === "guide") {
    for (const banned of ["EndpointCard", "ParamTable"]) {
      if (renders(source, banned)) problems.push(`guide renders ${banned}`);
    }
  }
  if (template === "concept" && renders(source, "DocsSteps")) {
    problems.push("concept renders DocsSteps");
  }
  if (template === "quickstart" || template === "guide") {
    for (const required of ["DocsNextSteps", "DocsRelated"]) {
      if (!renders(source, required)) {
        problems.push(`${template} is missing ${required}`);
      }
    }
  }
  return problems;
}

describe("docs page templates", () => {
  const report = DOCS_PAGES.flatMap((page) =>
    templateProblems(
      page.template,
      readFileSync(path.join(ROOT, page.source), "utf8"),
    ).map((problem) => `${page.href}: ${problem}`),
  );

  it("every page fits its template (warn mode)", () => {
    if (report.length > 0 && !STRICT) {
      process.stderr.write(
        `docs-templates: ${report.length} page problems (warn mode)\n${report.join("\n")}\n`,
      );
    }
    expect(STRICT ? report : []).toEqual([]);
  });

  it("flags what a guide must not render and what it must", () => {
    expect(templateProblems("guide", "<EndpointCard {...e} />")).toContain(
      "guide renders EndpointCard",
    );
    expect(templateProblems("guide", "<ParamTable params={p} />")).toContain(
      "guide renders ParamTable",
    );
    expect(templateProblems("guide", "<DocsSection />")).toEqual([
      "guide is missing DocsNextSteps",
      "guide is missing DocsRelated",
    ]);
  });

  it("flags steps on a concept page and passes a clean reference", () => {
    expect(templateProblems("concept", "<DocsSteps />")).toEqual([
      "concept renders DocsSteps",
    ]);
    expect(templateProblems("reference", "<EndpointCard />")).toEqual([]);
  });

  it("accepts a guide that has both closers", () => {
    expect(
      templateProblems("guide", "<DocsRelated /><DocsNextSteps steps={s} />"),
    ).toEqual([]);
  });
});
