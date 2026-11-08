import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * A horizontal scroller clips its overflow only for descendants it contains. An
 * absolutely positioned or sr-only child of an unpositioned scroller escapes it
 * and is measured against the viewport, so it can widen the whole page on a
 * phone: that is how /pricing reached a 530px layout viewport while looking
 * fine at desktop width (research/mobile-ui.md). It reads fine in the markup,
 * so this walks the JSX.
 *
 * A scroller passes when it is positioned or contain-paint, or when the escaping
 * child has its own positioned ancestor inside the scroller.
 */
const ROOT = path.resolve(__dirname, "../../..");

const SCROLLER = new Set([
  "overflow-x-auto",
  "overflow-x-scroll",
  "overflow-auto",
  "scroll-x-only",
]);
const POSITIONED = new Set([
  "relative",
  "absolute",
  "fixed",
  "sticky",
  "contain-paint",
  "contain-strict",
  "contain-content",
]);
const ESCAPES = new Set(["sr-only", "absolute", "fixed"]);

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tsxFiles(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function classTokens(
  opening: ts.JsxOpeningLikeElement,
  sf: ts.SourceFile,
): string[] {
  for (const prop of opening.attributes.properties) {
    if (ts.isJsxAttribute(prop) && prop.name.getText(sf) === "className") {
      const text = prop.initializer?.getText(sf) ?? "";
      return [...text.matchAll(/["'`]([^"'`]*)["'`]/g)].flatMap((m) =>
        m[1].split(/\s+/).filter(Boolean),
      );
    }
  }
  return [];
}

function openingOf(node: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isJsxElement(node)) return node.openingElement;
  if (ts.isJsxSelfClosingElement(node)) return node;
  return null;
}

/** Every escaping descendant of `node` with no positioned ancestor inside it. */
function uncontained(node: ts.Node, sf: ts.SourceFile): string[] {
  const hits: string[] = [];
  const visit = (child: ts.Node, contained: boolean): void => {
    const opening = openingOf(child);
    let inside = contained;
    if (opening) {
      const tokens = classTokens(opening, sf);
      if (!inside && tokens.some((t) => ESCAPES.has(t))) {
        hits.push(opening.tagName.getText(sf));
      }
      inside = inside || tokens.some((t) => POSITIONED.has(t));
    }
    ts.forEachChild(child, (next) => visit(next, inside));
  };
  ts.forEachChild(node, (child) => visit(child, false));
  return hits;
}

function offendersIn(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  if (
    !/overflow-x-auto|overflow-x-scroll|overflow-auto|scroll-x-only/.test(
      source,
    )
  ) {
    return [];
  }
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const tokens = classTokens(node.openingElement, sf);
      if (
        tokens.some((t) => SCROLLER.has(t)) &&
        !tokens.some((t) => POSITIONED.has(t))
      ) {
        const line =
          sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        for (const hit of uncontained(node, sf)) {
          out.push(`${path.relative(ROOT, file)}:${line} contains ${hit}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("horizontal scrollers contain what they scroll", () => {
  it("has no unpositioned scroller holding an escaping child", () => {
    const offenders = ["app", "components"]
      .flatMap((dir) => tsxFiles(path.join(ROOT, dir)))
      .flatMap(offendersIn);
    expect(offenders).toEqual([]);
  });

  it("catches the shape it exists for", () => {
    const fixture = path.join(ROOT, "tests/components/shared/__scroller.tsx");
    const sf = ts.createSourceFile(
      fixture,
      `<div className="overflow-x-auto"><span className="sr-only">x</span></div>`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node)) found = uncontained(node, sf);
      else ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(found).toEqual(["span"]);
  });
});
