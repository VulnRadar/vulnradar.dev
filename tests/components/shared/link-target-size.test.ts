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
        const attr = node.attributes.properties.find(
          (p): p is ts.JsxAttribute =>
            ts.isJsxAttribute(p) && p.name.getText(sf) === "className",
        );
        const parent = node.parent;
        const text = ts.isJsxElement(parent)
          ? parent.children
              .map((c) => c.getText(sf))
              .join("")
              .replace(/\s+/g, " ")
              .trim()
          : "";
        found.push({
          tag,
          text,
          classText: attr?.initializer?.getText(sf) ?? "",
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
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

/**
 * Links that sit inside a sentence. WCAG 2.5.8 exempts them (the "inline"
 * exception), and CLAUDE.md says they stay inline. Keyed by the link's text so
 * a new standalone link cannot hide behind one of these.
 */
const INLINE_IN_SENTENCE: Record<string, string[]> = {
  "app/legal/page.tsx": ["documentation", "contact"],
  "app/checks/[id]/page.tsx": [],
  "lib/seo/seo-ui.tsx": [],
};

/** A floor on how many links each file is expected to hold, so a parser miss
 *  cannot turn this into a test that checks nothing. */
const MIN_LINKS: Record<string, number> = {
  "app/legal/page.tsx": 3,
  "app/checks/[id]/page.tsx": 5,
  "lib/seo/seo-ui.tsx": 5,
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

  it("every standalone link draws a focus ring", () => {
    const offenders = standalone
      .filter((l) => !hasFocusRing(l.classText))
      .map((l) => `${rel}:${l.line} <${l.tag}> "${l.text}"`);
    expect(offenders).toEqual([]);
  });
});

describe("the helpers", () => {
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
