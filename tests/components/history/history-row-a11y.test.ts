/**
 * The History list's accessibility contract, asserted against the component
 * source.
 *
 * vitest.config.ts runs `node` with no DOM and tsconfig sets "jsx": "preserve",
 * so a .tsx component cannot be imported into a suite at all (see the header of
 * history-scan-row.test.ts). The contract is still checkable where it lives, in
 * the JSX, so this parses each file with the TypeScript compiler and walks the
 * tree instead of matching strings: a nested control is a structural fact, and
 * a regex over the file would pass it on the strength of a comment.
 *
 * What it pins, each of which was a live defect:
 *  - the row was role="button" with buttons, an input and a menu trigger inside
 *    it (axe: nested-interactive), so a screen reader read each row as one long
 *    button named after all of its contents;
 *  - a severity pill showed its severity by colour alone;
 *  - a filter trigger's aria-label REPLACED its visible value, so the current
 *    filter was in no accessible name and the menu did not mark it either.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../../..");

function parse(rel: string): ts.SourceFile {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

type JsxEl = ts.JsxElement | ts.JsxSelfClosingElement;

function opening(el: JsxEl): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(el) ? el.openingElement : el;
}

function tagOf(el: JsxEl): string {
  return opening(el).tagName.getText();
}

function attr(el: JsxEl, name: string): ts.JsxAttribute | undefined {
  for (const a of opening(el).attributes.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText() === name) return a;
  }
  return undefined;
}

function stringAttr(el: JsxEl, name: string): string | undefined {
  const init = attr(el, name)?.initializer;
  if (init && ts.isStringLiteral(init)) return init.text;
  return undefined;
}

function hasSpreadOf(el: JsxEl, fn: string): boolean {
  return opening(el).attributes.properties.some(
    (a) =>
      ts.isJsxSpreadAttribute(a) && a.expression.getText().startsWith(`${fn}(`),
  );
}

const NATIVE_INTERACTIVE = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
]);
// Components that render a focusable control. ScanTags is on the list because
// every one of its states ends in a button or an input. DropdownMenu itself is
// a provider, not a control, and a DropdownMenuTrigger with asChild is the
// control it wraps (Radix merges them into one element), so neither counts.
const COMPONENT_INTERACTIVE = new Set(["Button", "Link", "ScanTags"]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "menuitem",
  "tab",
  "switch",
]);

function isInteractive(el: JsxEl): boolean {
  const tag = tagOf(el);
  if (NATIVE_INTERACTIVE.has(tag) || COMPONENT_INTERACTIVE.has(tag))
    return true;
  if (tag === "DropdownMenuTrigger") return attr(el, "asChild") === undefined;
  const role = stringAttr(el, "role");
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  return attr(el, "tabIndex") !== undefined;
}

function elements(root: ts.Node): JsxEl[] {
  const out: JsxEl[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

/** Every string literal in the file, comments excluded by construction. */
function stringLiterals(root: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

/** Calls of `.name(...)` anywhere under a node. */
function methodCalls(root: ts.Node, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === name
    ) {
      out.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

/** Every interactive element that has an interactive element inside it. */
function nestedInteractive(file: ts.SourceFile): string[] {
  const offenders: string[] = [];
  for (const el of elements(file)) {
    if (!isInteractive(el)) continue;
    for (const d of elements(el)) {
      if (d !== el && isInteractive(d)) {
        offenders.push(`<${tagOf(el)}> contains <${tagOf(d)}>`);
      }
    }
  }
  return offenders;
}

describe("History row (components/history/history-scan-row.tsx)", () => {
  const file = parse("components/history/history-scan-row.tsx");
  const root = elements(file).find((el) => hasSpreadOf(el, "tourAnchor"))!;

  it("finds the row root by its tour anchor", () => {
    expect(root).toBeDefined();
    expect(tagOf(root)).toBe("div");
  });

  it("has no interactive control inside another", () => {
    expect(nestedInteractive(file)).toEqual([]);
  });

  it("is a plain container: no role, tabIndex or handler on the row", () => {
    expect(attr(root, "role")).toBeUndefined();
    expect(attr(root, "tabIndex")).toBeUndefined();
    expect(attr(root, "onClick")).toBeUndefined();
    expect(attr(root, "onKeyDown")).toBeUndefined();
  });

  it("opens the scan from one real button that stretches over the row", () => {
    const buttons = elements(file).filter((el) => tagOf(el) === "button");
    expect(buttons).toHaveLength(1);
    const [button] = buttons;
    expect(stringAttr(button, "type")).toBe("button");
    expect(attr(button, "onClick")).toBeDefined();
    const className = stringAttr(button, "className") ?? "";
    // The overlay is what keeps the whole row clickable now that the row is
    // not itself a button.
    expect(className).toContain("after:absolute");
    expect(className).toContain("after:inset-0");
    // Buttons are cursor:default, and the overlay inherits the cursor.
    expect(className).toContain("cursor-pointer");
    // The focus ring is drawn on the overlay, so it surrounds the row.
    expect(className).toContain("focus-visible:after:ring-2");
  });

  it("keeps the tags and the actions menu as siblings of that button", () => {
    const button = elements(file).find((el) => tagOf(el) === "button")!;
    const insideButton = new Set(elements(button));
    for (const name of ["ScanTags", "DropdownMenu"]) {
      const el = elements(file).find((e) => tagOf(e) === name);
      expect(el, `${name} is rendered`).toBeDefined();
      expect(insideButton.has(el!), `${name} is not inside the button`).toBe(
        false,
      );
    }
  });

  it("lifts the actions menu over the overlay and isolates the row's stacking", () => {
    const actions = elements(file).find((el) =>
      (stringAttr(el, "className") ?? "").includes("absolute right-3 top-3"),
    );
    expect(actions, "the actions wrapper").toBeDefined();
    expect(stringAttr(actions!, "className")).toContain("z-10");
    // Without isolation those z-10s would compete with the page's own layers.
    expect(attr(root, "className")!.getText()).toContain("isolate");
  });

  it("no longer stops click propagation to protect a row handler that is gone", () => {
    expect(methodCalls(file, "stopPropagation")).toEqual([]);
  });

  it("says a partly checked scan is partly checked, not clean", () => {
    expect(file.getFullText()).toContain("SCAN_ROW_STATE_LABEL.partial");
    const states = stringLiterals(file);
    expect(states).toContain("partial");
  });
});

describe("ScanTags (components/history/scan-tags.tsx)", () => {
  const file = parse("components/history/scan-tags.tsx");

  it("lifts every control above the row's overlay", () => {
    // Two remove buttons (auto and user tags), the add-tag button, and the
    // wrapper around the open input. Each has to be positioned with a z-index
    // or the URL button's ::after paints over it and swallows the click.
    const lifted = stringLiterals(file).filter((s) =>
      s.includes("relative z-10"),
    );
    expect(lifted.length).toBeGreaterThanOrEqual(4);
  });

  it("does not stop click propagation for a row that no longer has a click handler", () => {
    for (const el of elements(file)) {
      const onClick = attr(el, "onClick");
      if (onClick) {
        expect(methodCalls(onClick, "stopPropagation")).toEqual([]);
      }
    }
  });
});

describe("SeverityPill (components/history/severity-pill.tsx)", () => {
  const file = parse("components/history/severity-pill.tsx");

  it("carries the severity in text as well as colour", () => {
    const srOnly = elements(file).find((el) =>
      (stringAttr(el, "className") ?? "").includes("sr-only"),
    );
    expect(srOnly, "a visually hidden severity label").toBeDefined();
    expect(srOnly!.getText()).toContain("{name}");
    // The name is the tone's own label, lowercased, so the pill and the badge
    // everywhere else name a severity the same way.
    expect(file.getFullText()).toContain("tone.label.toLowerCase()");
  });

  it("gives sighted hover users the same words in a title", () => {
    const pill = elements(file).find(
      (el) => tagOf(el) === "span" && attr(el, "title") !== undefined,
    );
    expect(pill, "the pill span has a title").toBeDefined();
  });

  it("keeps the colour dot out of the accessible name", () => {
    const dot = elements(file).find(
      (el) => attr(el, "aria-hidden") !== undefined,
    );
    expect(dot).toBeDefined();
  });
});

describe("filter triggers", () => {
  it("FilterDropdown's name is the hidden label plus the visible value", () => {
    const file = parse("components/shared/list-filter-bar.tsx");
    const trigger = elements(file).find(
      (el) => tagOf(el) === "Button" && stringAttr(el, "variant") === "outline",
    );
    expect(trigger, "the filter trigger button").toBeDefined();
    // An aria-label here replaced the content, hiding the selected value.
    expect(attr(trigger!, "aria-label")).toBeUndefined();
    expect(trigger!.getText()).toContain("sr-only");
    expect(trigger!.getText()).toContain("{label}");
    expect(trigger!.getText()).toContain("{labels[value]}");
  });

  it("FilterDropdown marks the current option with a radio group", () => {
    const file = parse("components/shared/list-filter-bar.tsx");
    const tags = elements(file).map(tagOf);
    expect(tags).toContain("DropdownMenuRadioGroup");
    expect(tags).toContain("DropdownMenuRadioItem");
    expect(tags).not.toContain("DropdownMenuItem");
  });

  it("the history tag filter follows the same recipe", () => {
    const file = parse("components/history/history-filters.tsx");
    const tagTrigger = elements(file).find(
      (el) => tagOf(el) === "Button" && el.getText().includes("by tag"),
    );
    expect(tagTrigger, "the tag filter trigger").toBeDefined();
    expect(attr(tagTrigger!, "aria-label")).toBeUndefined();
    expect(tagTrigger!.getText()).toContain("query.tag ||");
    const tags = elements(file).map(tagOf);
    expect(tags).toContain("DropdownMenuRadioGroup");
    expect(tags).not.toContain("DropdownMenuItem");
  });
});

describe("History page (app/history/page.tsx)", () => {
  const file = parse("app/history/page.tsx");

  it("loads the detail-only panels lazily, each with a loading fallback", () => {
    const text = file.getFullText();
    for (const [name, mod] of [
      ["IssueDetail", "@/components/scanner/issue-detail"],
      ["SubdomainDiscovery", "@/components/scanner/subdomain-discovery"],
    ] as const) {
      // Not a static import...
      expect(text).not.toMatch(
        new RegExp(`^import \\{[^}]*\\b${name}\\b[^}]*\\} from "${mod}"`, "m"),
      );
      // ...but a dynamic() with a `loading` option. Without one the chunk
      // suspends the route's own loading.tsx instead of its own boundary.
      const decl = file.statements
        .filter(ts.isVariableStatement)
        .flatMap((s) => [...s.declarationList.declarations])
        .find((d) => d.name.getText() === name);
      expect(decl, `${name} is declared`).toBeDefined();
      const init = decl!.initializer!;
      expect(init.getText().startsWith("dynamic(")).toBe(true);
      expect(init.getText()).toContain(mod);
      expect(init.getText()).toContain("loading");
    }
  });
});
