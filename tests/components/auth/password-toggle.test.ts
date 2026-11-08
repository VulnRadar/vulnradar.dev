/**
 * aria-pressed already says whether the toggle is on. A label that changes as
 * well makes the two contradict each other: "Hide password, pressed".
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { PasswordToggle } from "@/components/auth/password-toggle";

const ROOT = path.resolve(__dirname, "../../..");

function button(shown: boolean, label?: string): string {
  return renderToStaticMarkup(
    React.createElement(PasswordToggle, { shown, onToggle: vi.fn(), label }),
  );
}

describe("PasswordToggle", () => {
  it("keeps one name and reports the state through aria-pressed", () => {
    expect(button(false)).toContain('aria-label="Show password"');
    expect(button(true)).toContain('aria-label="Show password"');
    expect(button(false)).toContain('aria-pressed="false"');
    expect(button(true)).toContain('aria-pressed="true"');
  });

  it("names what it reveals", () => {
    expect(button(true, "cookie value")).toContain(
      'aria-label="Show cookie value"',
    );
  });
});

const JSX_DIRS = ["app", "components"];
// The staff-invite page adopts the shared toggle with the OAuth and identity
// work; the API playground and the results list still have to be fixed. Each
// comes off this list when it is, and nothing new goes on it.
const NOT_YET_ADOPTED = new Set([
  path.join("app", "staff-invite", "[token]", "page.tsx"),
  path.join("app", "docs", "api", "playground", "page.tsx"),
  path.join("components", "scanner", "results-list.tsx"),
]);

function tsxFiles(dir: string): string[] {
  return fs
    .readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) return tsxFiles(rel);
      return entry.name.endsWith(".tsx") ? [rel] : [];
    });
}

function containsConditional(node: ts.Node): boolean {
  if (ts.isConditionalExpression(node)) return true;
  return (
    ts.forEachChild(node, (child) => containsConditional(child) || undefined) ??
    false
  );
}

/** Every element carrying aria-pressed whose aria-label depends on a condition. */
function contradictions(rel: string): string[] {
  const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const sf = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const attribute = (attrs: ts.JsxAttributes, name: string) =>
    attrs.properties.find(
      (p): p is ts.JsxAttribute =>
        ts.isJsxAttribute(p) && p.name.getText(sf) === name,
    );
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const label = attribute(node.attributes, "aria-label");
      if (
        attribute(node.attributes, "aria-pressed") &&
        label?.initializer &&
        containsConditional(label.initializer)
      ) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        found.push(`${rel}:${line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("toggles that report state through aria-pressed", () => {
  it("never change their aria-label as well", () => {
    const offenders = JSX_DIRS.flatMap(tsxFiles)
      .filter((rel) => !NOT_YET_ADOPTED.has(rel))
      .flatMap(contradictions);
    expect(offenders).toEqual([]);
  });
});

describe("the password fields use the shared toggle", () => {
  it.each([
    "components/auth/login-form.tsx",
    "components/auth/signup-form.tsx",
    "components/auth/reset-password-form.tsx",
    "components/scanner/inline-auth-form.tsx",
  ])("%s", (rel) => {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    expect(source).toContain("<PasswordToggle");
    expect(source).not.toMatch(/\bEyeOff\b/);
  });
});
