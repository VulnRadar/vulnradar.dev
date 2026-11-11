import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * The TypeScript-AST scanner behind info-hint-usage.test.ts and the per-surface
 * suites under tests/components/info-hints/.
 *
 * Source analysis rather than a render: the suite runs under `node` with no
 * DOM, and vitest cannot transform this repo's `jsx: preserve` components, so
 * what can be pinned is what the JSX says. The functions take source text so
 * the rules can be proven against a snippet that breaks them; the `*In(rel)`
 * wrappers read a real file.
 */

export const ROOT = path.resolve(__dirname, "../../..");

export const HINT_TAG = "InfoHint";

export interface HintUse {
  line: number;
  /** The literal label, or null when it is an expression (a translated one). */
  label: string | null;
  hasLabel: boolean;
  /** The literal size, or null when absent or not a literal. */
  size: string | null;
  /** Enclosing JSX element tags in the same file, nearest first. */
  ancestors: string[];
  /** Tag names of every JSX element inside the hint's children. */
  childTags: string[];
  /** Every string that ends up as text inside the hint. */
  childText: string[];
}

export interface HandRolled {
  line: number;
  tag: string;
}

export interface TitleUse {
  line: number;
  tag: string;
  /** The first 30 characters of the long string in the title. */
  key: string;
}

export function parse(source: string, name = "snippet.tsx"): ts.SourceFile {
  return ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function tagOf(el: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return ts.isJsxElement(el)
    ? el.openingElement.tagName.getText()
    : el.tagName.getText();
}

function openingOf(
  el: ts.JsxElement | ts.JsxSelfClosingElement,
): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(el) ? el.openingElement : el;
}

function attrOf(
  opening: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | undefined {
  return opening.attributes.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}

/** Every string a node carries: literals, template pieces and JSX text. */
export function stringsIn(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      out.push(n.text);
    } else if (
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** The single string a simple attribute value holds, else null. */
function literalAttr(attr: ts.JsxAttribute | undefined): string | null {
  const init = attr?.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (
    ts.isJsxExpression(init) &&
    init.expression &&
    (ts.isStringLiteral(init.expression) ||
      ts.isNoSubstitutionTemplateLiteral(init.expression))
  ) {
    return init.expression.text;
  }
  return null;
}

function jsxAncestors(node: ts.Node): string[] {
  const tags: string[] = [];
  for (let up = node.parent; up; up = up.parent) {
    if (ts.isJsxElement(up)) tags.push(up.openingElement.tagName.getText());
  }
  return tags;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

export function findInfoHintsInSource(source: string): HintUse[] {
  const sf = parse(source);
  const found: HintUse[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagOf(node) === HINT_TAG
    ) {
      const opening = openingOf(node);
      const labelAttr = attrOf(opening, "label");
      const childTags: string[] = [];
      const childText: string[] = [];
      if (ts.isJsxElement(node)) {
        for (const child of node.children) {
          childText.push(...stringsIn(child));
          const walk = (n: ts.Node) => {
            if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
              childTags.push(tagOf(n));
            }
            ts.forEachChild(n, walk);
          };
          walk(child);
        }
      }
      found.push({
        line: lineOf(sf, node),
        label: literalAttr(labelAttr),
        hasLabel: labelAttr !== undefined,
        size: literalAttr(attrOf(opening, "size")),
        ancestors: jsxAncestors(node),
        childTags,
        childText,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export function findInfoHints(rel: string): HintUse[] {
  return findInfoHintsInSource(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

/**
 * The text a file prints outside every InfoHint: JSX text and string literals
 * in JSX expressions. A surface suite uses it to prove the opening words of a
 * paragraph it moved into a hint are no longer printed inline.
 */
export function textOutsideHintsInSource(source: string): string {
  const sf = parse(source);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) &&
      tagOf(n) === HINT_TAG
    ) {
      return;
    }
    if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    } else if (
      (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
      n.parent &&
      (ts.isJsxExpression(n.parent) ||
        ts.isConditionalExpression(n.parent) ||
        ts.isBinaryExpression(n.parent) ||
        ts.isParenthesizedExpression(n.parent))
    ) {
      out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out.join(" ");
}

export function textOutsideHints(rel: string): string {
  return textOutsideHintsInSource(
    fs.readFileSync(path.join(ROOT, rel), "utf8"),
  );
}

const HELP_ICONS = new Set([
  "HelpCircle",
  "CircleHelp",
  "Info",
  "CircleQuestionMark",
  "BadgeInfo",
]);

/**
 * A button that explains something, written by hand instead of with
 * InfoHint: a `button` (or a `PopoverTrigger`) with an aria-label that holds
 * one of the help icons.
 */
export function handRolledHintsInSource(source: string): HandRolled[] {
  const sf = parse(source);
  const found: HandRolled[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText();
      if (
        (tag === "button" || tag === "PopoverTrigger") &&
        attrOf(node.openingElement, "aria-label")
      ) {
        let hasIcon = false;
        const walk = (n: ts.Node) => {
          if (
            (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) &&
            HELP_ICONS.has(tagOf(n))
          ) {
            hasIcon = true;
          }
          ts.forEachChild(n, walk);
        };
        node.children.forEach(walk);
        if (hasIcon) found.push({ line: lineOf(sf, node), tag });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export const TITLE_TAGS = new Set([
  "span",
  "div",
  "p",
  "td",
  "li",
  "time",
  "svg",
]);

/** Where a title stops being a label and becomes an explanation. */
export const TITLE_MIN_LENGTH = 40;

export function hoverOnlyTitlesInSource(source: string): TitleUse[] {
  const sf = parse(source);
  const found: TitleUse[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      if (TITLE_TAGS.has(tag)) {
        const attr = attrOf(node, "title");
        // A focusable handle (the chat panel resize separators) is a control
        // whose title repeats its aria-label, not an explanation.
        const isControl = attrOf(node, "tabIndex") || attrOf(node, "role");
        if (attr?.initializer && !isControl) {
          const long = stringsIn(attr.initializer).find(
            (s) => s.length >= TITLE_MIN_LENGTH,
          );
          if (long) {
            found.push({
              line: lineOf(sf, node),
              tag,
              key: long.slice(0, 30),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

export function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/** Every .tsx file under app/ and components/, repo-relative. */
export function appSourceFiles(): string[] {
  return ["app", "components"]
    .flatMap((d) => sourceFiles(path.join(ROOT, d)))
    .map(rel);
}
