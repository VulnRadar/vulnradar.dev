import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { listApiRouteFiles } from "../_helpers/api-routes";

/**
 * A route that authenticates with an API key also refuses an account behind on
 * the Terms. Copying the check is how four routes ended up without it, so a
 * route either calls authenticateApiKey, which cannot forget, or calls
 * validateApiKey and reads needsTermsAcceptance itself.
 *
 * There is no baseline: the four routes that lacked the gate when this was
 * written all go through authenticateApiKey now, so a route that goes back to
 * validateApiKey without the check fails here instead of hiding in a list.
 */

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile(
    "x.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function usesKeyWithoutTermsGate(text: string): boolean {
  let validates = false;
  let checksTerms = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "validateApiKey"
    ) {
      validates = true;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "needsTermsAcceptance"
    ) {
      checksTerms = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return validates && !checksTerms;
}

describe("API key routes check the Terms", () => {
  it("flags a call with no check, and ignores comments and strings", () => {
    expect(
      usesKeyWithoutTermsGate(
        "export async function GET() { const k = await validateApiKey(t); return k; }",
      ),
    ).toBe(true);
    expect(
      usesKeyWithoutTermsGate(
        "export async function GET() { const k = await validateApiKey(t); if (k.needsTermsAcceptance) return x; }",
      ),
    ).toBe(false);
    expect(
      usesKeyWithoutTermsGate(
        '// validateApiKey(t)\nconst doc = "validateApiKey(t)";',
      ),
    ).toBe(false);
    expect(
      usesKeyWithoutTermsGate(
        "export async function GET() { const r = await authenticateApiKey(q, {}); }",
      ),
    ).toBe(false);
  });

  it("finds no route that skips the gate", () => {
    const offenders = listApiRouteFiles()
      .filter((route) => {
        const text = readFileSync(route.abs, "utf8");
        return text.includes("validateApiKey") && usesKeyWithoutTermsGate(text);
      })
      .map((route) => route.file);
    expect(offenders).toEqual([]);
  }, 60_000);

  it("is reading real route files", () => {
    // Routes on authenticateApiKey get the Terms check from it and never name
    // needsTermsAcceptance themselves, so either spelling proves the walk
    // reached real key-authenticated routes.
    const callers = listApiRouteFiles().filter((route) => {
      const text = readFileSync(route.abs, "utf8");
      return (
        text.includes("needsTermsAcceptance") ||
        /\bauthenticateApiKey\s*\(/.test(text)
      );
    });
    expect(listApiRouteFiles().length).toBeGreaterThan(100);
    expect(callers.length).toBeGreaterThan(0);
  });
});
