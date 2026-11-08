import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DOCS_PAGES } from "@/components/docs/docs-nav";
import { REPO_DIRS } from "@/app/docs/architecture/repo-dirs.generated";
import { WHERE_THINGS_LIVE } from "@/app/docs/architecture/where-things-live";
import { listRepoDirs } from "../../../scripts/docs/generate-repo-dirs.mjs";

/**
 * The hand-drawn tree this table replaced listed a little over half of lib/ and
 * components/ and nothing at all about extension/, cli/, tests/ or audits/.
 * Each directory it named did exist, which is all its old test could ask, so a
 * new folder never made it wrong.
 */

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const page = read("app/docs/architecture/page.tsx");
const allRows = Object.values(WHERE_THINGS_LIVE).flat();

describe("Where things live", () => {
  it("lists exactly the directories the repo has", () => {
    // Run `node scripts/docs/generate-repo-dirs.mjs` when this fails, and add
    // the new directory's row in app/docs/architecture/where-things-live.ts.
    expect(REPO_DIRS).toEqual(listRepoDirs(ROOT));
  });

  it("reads the listing rather than guarding against a miss", () => {
    expect(REPO_DIRS.top).toEqual(
      expect.arrayContaining(["tests", "extension", "cli", "audits"]),
    );
    expect(REPO_DIRS.lib.length).toBeGreaterThan(20);
    expect(REPO_DIRS.components.length).toBeGreaterThan(20);
  });

  it("gives every directory a line and a doc", () => {
    for (const row of allRows) {
      expect(row.what, row.dir).toBeTruthy();
      expect(row.doc, row.dir).toBeTruthy();
    }
    const dirs = (group: keyof typeof REPO_DIRS) =>
      WHERE_THINGS_LIVE[group].map((row) => row.dir);
    expect(dirs("top")).toEqual(REPO_DIRS.top.map((d) => `${d}/`));
    expect(dirs("lib")).toEqual(REPO_DIRS.lib.map((d) => `lib/${d}/`));
    expect(dirs("components")).toEqual(
      REPO_DIRS.components.map((d) => `components/${d}/`),
    );
  });

  it("describes tests/ as mirroring the source tree", () => {
    const row = WHERE_THINGS_LIVE.top.find((r) => r.dir === "tests/");
    expect(row?.what).toContain("Mirrors the source tree");
    expect(row?.doc).toBe("tests/README.md");
  });

  it("points every row at a docs page and anchor, or a file, that exists", () => {
    const known = new Set(DOCS_PAGES.map((p) => p.href));
    for (const { dir, doc } of allRows) {
      if (!doc.startsWith("/docs")) {
        expect(existsSync(path.join(ROOT, doc)), `${dir}: ${doc}`).toBe(true);
        continue;
      }
      const [href, anchor] = doc.split("#");
      expect(known.has(href), `${dir}: ${href} is not a docs page`).toBe(true);
      if (anchor) {
        const source = read(`app${href}/page.tsx`);
        expect(source.includes(`id="${anchor}"`), `${dir}: #${anchor}`).toBe(
          true,
        );
      }
    }
  });

  it("is what the page renders, and the drawn tree is gone", () => {
    for (const group of ["top", "lib", "components"]) {
      expect(page).toContain(`data={WHERE_THINGS_LIVE.${group}}`);
    }
    expect(page).not.toContain("vulnradar.dev/\n├──");
    expect(page).toContain(
      '<DocsSection id="layout" title="Where things live">',
    );
  });
});

describe("the CI/CD block", () => {
  // Job ids at two spaces, each followed by its display name.
  const ciJobs = [
    ...read(".github/workflows/ci.yml").matchAll(
      /^ {2}[a-z][a-z0-9_-]*:\n {4}name: (.+)$/gm,
    ),
  ].map((m) => m[1].trim());

  it("parsed the workflow", () => {
    expect(ciJobs).toContain("Integration");
    expect(ciJobs.length).toBeGreaterThan(4);
  });

  it("names exactly the jobs ci.yml runs, in order", () => {
    const start = page.indexOf("On push to main / PR");
    const end = page.indexOf("\n\n", start);
    expect(start).toBeGreaterThan(-1);
    const named = [
      ...page
        .slice(start, end)
        .matchAll(/[├└]── ([A-Za-z][A-Za-z -]*?)(?: \(|$)/gm),
    ].map((m) => m[1]);
    expect(named).toEqual(ciJobs);
  });
});
