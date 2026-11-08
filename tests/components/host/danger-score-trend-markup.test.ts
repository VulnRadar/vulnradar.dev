import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * An sr-only <table> is not visually hidden the way an sr-only <div> is: a table
 * ignores width: 1px and overflow: hidden, so it kept its natural width of about
 * 470px. Positioned absolute with nothing to contain it, it widened the layout
 * viewport to 501px on a 390px phone, and every host report with two or more
 * public scans rendered zoomed out. Measured in research/mobile-ui.md (M1).
 */
const FILE = path.resolve(
  __dirname,
  "../../../components/host/danger-score-trend.tsx",
);
const source = fs.readFileSync(FILE, "utf8");
const sf = ts.createSourceFile(
  FILE,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

interface Seen {
  tag: string;
  classes: string[];
  srOnlyAncestor: boolean;
}

function classesOf(opening: ts.JsxOpeningLikeElement): string[] {
  for (const prop of opening.attributes.properties) {
    if (ts.isJsxAttribute(prop) && prop.name.getText(sf) === "className") {
      const text = prop.initializer?.getText(sf) ?? "";
      return text
        .replace(/["'`{}]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
    }
  }
  return [];
}

const seen: Seen[] = [];
function walk(node: ts.Node, srOnlyAncestor: boolean): void {
  let inside = srOnlyAncestor;
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const classes = classesOf(opening);
    seen.push({
      tag: opening.tagName.getText(sf),
      classes,
      srOnlyAncestor,
    });
    inside = inside || classes.includes("sr-only");
  }
  ts.forEachChild(node, (child) => walk(child, inside));
}
walk(sf, false);

describe("danger-score trend text alternative", () => {
  const BLOCK_TAGS = new Set(["table", "ul", "ol", "dl", "section"]);

  it("never puts sr-only on an element that ignores its width", () => {
    const offenders = seen.filter(
      (el) => BLOCK_TAGS.has(el.tag) && el.classes.includes("sr-only"),
    );
    expect(offenders).toEqual([]);
  });

  it("hides the table through an sr-only ancestor", () => {
    const tables = seen.filter((el) => el.tag === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0].srOnlyAncestor).toBe(true);
  });
});
