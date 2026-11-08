import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Scanner strings carry no em dash.
 *
 * Evidence and fix text is the most-read copy in the product, and it does not
 * stop at the results page: it goes into the PDF, CSV and Markdown exports and
 * into the AI prompts that are told never to write one.
 * checks-data-no-em-dash.test.ts keeps the JSON metadata clean; this is the
 * same rule for the strings the code builds itself.
 *
 * Parsed with the TypeScript compiler so a comment is not a hit and a template
 * literal is read piece by piece. Runtime output is covered separately:
 * tests/lib/scanner/checks/_test-harness.ts runs every detector against its
 * fixtures and fails on a returned em dash.
 *
 * DEBT is every file still carrying one, by exact count, so the list only
 * shrinks and a new string in a listed file still fails. When cookies.ts
 * reaches zero, remove its detectors from EM_DASH_PENDING_DETECTORS in the
 * harness too.
 */

const ROOT = path.resolve(__dirname, "../..");
const SCANNER_DIR = path.join(ROOT, "lib/scanner");
const EM_DASH = "—";

const DEBT: Record<string, number> = {
  "lib/scanner/async-checks.ts": 7,
  "lib/scanner/checks/code.ts": 7,
  "lib/scanner/checks/cookies.ts": 7,
  "lib/scanner/protocols/index.ts": 9,
};

/** The detector files whose count strings go through pluralize(). */
const NO_PAREN_PLURAL = [
  "lib/scanner/checks/client-side.ts",
  "lib/scanner/checks/configuration.ts",
  "lib/scanner/checks/content.ts",
  "lib/scanner/checks/headers.ts",
  "lib/scanner/checks/information-disclosure.ts",
  "lib/scanner/checks/vibe-code.ts",
];
const PAREN_PLURAL = /[\w>}]\((?:s|es)\)/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

interface Literal {
  line: number;
  text: string;
}

function stringLiterals(source: string): Literal[] {
  const sf = ts.createSourceFile(
    "source.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const found: Literal[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddleOrTemplateTail(node)
    ) {
      found.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        text: node.getText(sf),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const relative = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");

describe("lib/scanner string literals", () => {
  const files = sourceFiles(SCANNER_DIR);

  it("finds the scanner source", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.map(relative)).toContain("lib/scanner/checks/content.ts");
  });

  it("the parser sees every kind of string, and not a comment", () => {
    const sample = [
      `// a comment ${EM_DASH} ignored`,
      `const a = "plain ${EM_DASH} one";`,
      "const b = `head " +
        EM_DASH +
        " ${a} mid " +
        EM_DASH +
        " ${a} tail " +
        EM_DASH +
        "`;",
      "const c = `whole " + EM_DASH + " template`;",
    ].join("\n");
    const hits = stringLiterals(sample).filter((l) => l.text.includes(EM_DASH));
    expect(hits.map((h) => h.line)).toEqual([2, 3, 3, 3, 4]);
  });

  it("carry no em dash outside the listed files", () => {
    const counts: Record<string, number> = {};
    const firstHit: Record<string, string> = {};
    for (const file of files) {
      const hits = stringLiterals(fs.readFileSync(file, "utf8")).filter((l) =>
        l.text.includes(EM_DASH),
      );
      if (hits.length === 0) continue;
      const name = relative(file);
      counts[name] = hits.length;
      firstHit[name] = `line ${hits[0].line}: ${hits[0].text.slice(0, 80)}`;
    }
    expect(
      counts,
      `Use a colon, or a full stop and a capitalised sentence. First hits: ${JSON.stringify(firstHit, null, 2)}`,
    ).toEqual(DEBT);
  });

  it.each(NO_PAREN_PLURAL)("%s pluralises its counts", (name) => {
    const hits = stringLiterals(
      fs.readFileSync(path.join(ROOT, name), "utf8"),
    ).filter((l) => PAREN_PLURAL.test(l.text));
    expect(hits).toEqual([]);
  });
});
