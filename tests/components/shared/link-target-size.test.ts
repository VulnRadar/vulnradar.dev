import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * A control's tappable area is at least 24x24 CSS pixels (WCAG 2.2 SC 2.5.8,
 * CLAUDE.md "Target size"). The trap is a standalone link in a roomy row: the
 * row is 44px and the <a> inside it is 20px, so the target is 20px. The
 * padding has to be on the link, with a negative margin to give the row back
 * its height.
 *
 * /checks and /docs got that fix on their index pages. It did not reach
 * /legal, the ~750 /checks/<id> pages, or the breadcrumb, "propose a check"
 * and scan call-to-action links in lib/seo/seo-ui.tsx that render on every SEO
 * page. This reads the real JSX of those files, so a link added later to any of
 * them has to meet the floor or be named below as inline-in-a-sentence.
 *
 * It has since grown to the tools pages, the alternatives pages, the category
 * index, the docs breadcrumb, the legal clause numbers and the changelog
 * version chip. A link inside a sentence on those pages is padded as an inline
 * box (`rounded-sm py-1.5`), which grows the tappable area to the floor
 * without moving a line of the prose or stopping the link wrapping.
 *
 * Source analysis rather than a render: the suite runs under `node` with no
 * DOM and no layout engine, and vitest cannot transform this repo's
 * `jsx: preserve` components, so what can be pinned is the class contract.
 */

const ROOT = path.resolve(__dirname, "../../..");

interface Link {
  tag: string;
  text: string;
  classText: string;
  line: number;
  /** Enclosing JSX elements, nearest first, with their className text. */
  ancestors: { tag: string; classText: string }[];
}

function classTextOf(
  opening: ts.JsxOpeningLikeElement,
  sf: ts.SourceFile,
): string {
  const attr = opening.attributes.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText(sf) === "className",
  );
  return attr?.initializer?.getText(sf) ?? "";
}

function linksIn(rel: string): Link[] {
  const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const sf = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: Link[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (tag === "a" || tag === "Link") {
        const parent = node.parent;
        const text = ts.isJsxElement(parent)
          ? parent.children
              .map((c) => c.getText(sf))
              .join("")
              .replace(/\s+/g, " ")
              .trim()
          : "";
        // An opening element's own JsxElement is its direct parent; a
        // self-closing one has no element of its own.
        const ancestors: Link["ancestors"] = [];
        let up: ts.Node | undefined = ts.isJsxOpeningElement(node)
          ? node.parent.parent
          : node.parent;
        for (; up; up = up.parent) {
          if (ts.isJsxElement(up)) {
            ancestors.push({
              tag: up.openingElement.tagName.getText(sf),
              classText: classTextOf(up.openingElement, sf),
            });
          }
        }
        found.push({
          tag,
          text,
          classText: classTextOf(node, sf),
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          ancestors,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Every class token written as a string literal inside the className value. */
function tokens(classText: string): string[] {
  const out: string[] = [];
  for (const m of classText.matchAll(/["'`]([^"'`]*)["'`]/g)) {
    out.push(...m[1].split(/\s+/).filter(Boolean));
  }
  return out;
}

/**
 * 24px or more of height from the link's own box: vertical padding of 1.5 or
 * more (6px a side on a 12px line is the floor; every link here is text-xs or
 * larger), or an explicit minimum height of 6 (24px) or more.
 */
function clearsTargetFloor(classText: string): boolean {
  return tokens(classText).some((t) => {
    const m = t.match(/^(py|p|min-h|h)-(\d+(?:\.\d+)?)$/);
    if (!m) return false;
    const n = Number(m[2]);
    return m[1] === "min-h" || m[1] === "h" ? n >= 6 : n >= 1.5;
  });
}

function hasFocusRing(classText: string): boolean {
  return /focus-visible:ring|focus\.ring/.test(classText);
}

function makesFormattingContext(classText: string): boolean {
  return tokens(classText).some((t) =>
    /^(flex|inline-flex|grid|inline-grid|flow-root)$/.test(t),
  );
}

/**
 * `-my-1.5 block py-1.5` only keeps its row's height when the negative margin
 * stays inside the link's parent. In a plain block parent (an <li> in a
 * space-y list) the margins collapse out through it and into the list's own
 * spacing: measured, three reference links came out 34px apart instead of 28.
 * The parent has to be a flex or grid container or item, or `flow-root`.
 * Links that are not `block` (flex items, inline-block) cannot collapse.
 */
function marginsStayInside(link: Link): boolean {
  const t = tokens(link.classText);
  if (!t.includes("block") || !t.some((x) => x.startsWith("-my-"))) return true;
  const [parent, grandparent] = link.ancestors;
  if (!parent) return false;
  return (
    makesFormattingContext(parent.classText) ||
    (grandparent !== undefined && makesFormattingContext(grandparent.classText))
  );
}

/**
 * Links that sit inside a sentence. WCAG 2.5.8 exempts them (the "inline"
 * exception), and CLAUDE.md says they stay inline. Keyed by the link's text so
 * a new standalone link cannot hide behind one of these.
 */
const INLINE_IN_SENTENCE: Record<string, string[]> = {
  "app/legal/page.tsx": ["documentation", "contact"],
  "app/checks/[id]/page.tsx": [],
  "lib/seo/seo-ui.tsx": [],
  "app/checks/category/[category]/page.tsx": [],
  "app/alternatives/page.tsx": [],
  "app/alternatives/[competitor]/page.tsx": [],
  "app/tools/page.tsx": [],
  "app/tools/api-scanner/page.tsx": [],
  "app/tools/link-checker/page.tsx": [],
  "components/docs/docs-pager.tsx": [],
  "components/legal/legal-section.tsx": [],
  "components/changelog/changelog-release.tsx": [],
};

/** A floor on how many links each file is expected to hold, so a parser miss
 *  cannot turn this into a test that checks nothing. */
const MIN_LINKS: Record<string, number> = {
  "app/legal/page.tsx": 3,
  "app/checks/[id]/page.tsx": 5,
  "lib/seo/seo-ui.tsx": 5,
  "app/checks/category/[category]/page.tsx": 2,
  "app/alternatives/page.tsx": 1,
  "app/alternatives/[competitor]/page.tsx": 1,
  "app/tools/page.tsx": 1,
  "app/tools/api-scanner/page.tsx": 1,
  "app/tools/link-checker/page.tsx": 1,
  "components/docs/docs-pager.tsx": 1,
  "components/legal/legal-section.tsx": 1,
  "components/changelog/changelog-release.tsx": 1,
};

describe.each(Object.keys(INLINE_IN_SENTENCE))("%s", (rel) => {
  const all = linksIn(rel);
  const inline = new Set(INLINE_IN_SENTENCE[rel]);
  const standalone = all.filter((l) => !inline.has(l.text));

  it("is actually being read", () => {
    expect(all.length).toBeGreaterThanOrEqual(MIN_LINKS[rel]);
  });

  it("every named inline link really is in the file", () => {
    for (const text of inline) {
      expect(
        all.some((l) => l.text === text),
        `no link with text "${text}" in ${rel}`,
      ).toBe(true);
    }
  });

  it("every standalone link clears 24px", () => {
    const offenders = standalone
      .filter((l) => !clearsTargetFloor(l.classText))
      .map((l) => `${rel}:${l.line} <${l.tag}> "${l.text}"`);
    expect(offenders).toEqual([]);
  });

  it("a block link pulled back with a negative margin does not sit in a plain block parent", () => {
    const offenders = all
      .filter((l) => !marginsStayInside(l))
      .map((l) => `${rel}:${l.line} <${l.tag}> "${l.text}"`);
    expect(offenders).toEqual([]);
  });

  it("every standalone link draws a focus ring", () => {
    const offenders = standalone
      .filter((l) => !hasFocusRing(l.classText))
      .map((l) => `${rel}:${l.line} <${l.tag}> "${l.text}"`);
    expect(offenders).toEqual([]);
  });
});

describe("the helpers", () => {
  const link = (classText: string, ancestors: Link["ancestors"]): Link => ({
    tag: "a",
    text: "x",
    classText,
    line: 1,
    ancestors,
  });

  it("flags a pulled-back block link in a plain <li> inside a space-y list", () => {
    expect(
      marginsStayInside(
        link('"-my-1.5 block py-1.5"', [
          { tag: "li", classText: "" },
          { tag: "ul", classText: '"space-y-2 text-sm"' },
        ]),
      ),
    ).toBe(false);
  });

  it("accepts flow-root, a flex or grid parent, and a grid item", () => {
    const cls = '"-my-1.5 block py-1.5"';
    expect(
      marginsStayInside(link(cls, [{ tag: "li", classText: '"flow-root"' }])),
    ).toBe(true);
    expect(
      marginsStayInside(
        link(cls, [{ tag: "li", classText: '"flex items-start gap-2"' }]),
      ),
    ).toBe(true);
    expect(
      marginsStayInside(
        link(cls, [
          { tag: "dt", classText: "" },
          { tag: "div", classText: '"grid grid-cols-1"' },
        ]),
      ),
    ).toBe(true);
  });

  it("does not apply to links that are not block", () => {
    expect(
      marginsStayInside(
        link('"-my-1.5 inline-block py-1.5"', [{ tag: "p", classText: "" }]),
      ),
    ).toBe(true);
  });

  it("tell a padded link from a bare one", () => {
    expect(clearsTargetFloor('"-my-1.5 block py-1.5 text-sm"')).toBe(true);
    expect(clearsTargetFloor('"min-h-6 inline-flex"')).toBe(true);
    expect(clearsTargetFloor('"text-sm text-primary hover:underline"')).toBe(
      false,
    );
    // Padding that is too small for a text-sm line, and variant-only padding.
    expect(clearsTargetFloor('"py-1 text-sm"')).toBe(false);
    expect(clearsTargetFloor('"sm:py-2 text-sm"')).toBe(false);
  });

  it("finds a focus ring written out or taken from the focus recipe", () => {
    expect(hasFocusRing('"focus-visible:ring-2"')).toBe(true);
    expect(hasFocusRing('cn("py-1.5", focus.ring)')).toBe(true);
    expect(hasFocusRing('"hover:underline"')).toBe(false);
  });
});
