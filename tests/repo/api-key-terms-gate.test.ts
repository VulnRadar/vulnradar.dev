import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { listApiRouteFiles, routeFile } from "../_helpers/api-routes";

/**
 * A route that authenticates with an API key also refuses an account behind on
 * the Terms. Copying the check is how four routes ended up without it, so a
 * route either calls authenticateApiKey, which cannot forget, or calls
 * validateApiKey and reads needsTermsAcceptance itself.
 *
 * The baseline is the four routes that lacked the gate when this was written.
 * It is keyed by route (the directory under app/api/v3 before the move, so the
 * move needs no edit here), and a route only ever leaves it.
 */
const BASELINE = new Set(
  [
    "history/[id]/summary",
    "scan/discover/progress/[requestId]",
    "scan/verify-batch",
    "scan/verify",
  ].map(routeFile),
);

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

  it("finds no new route that skips the gate", () => {
    const offenders = listApiRouteFiles()
      .filter((route) => {
        const text = readFileSync(route.abs, "utf8");
        return text.includes("validateApiKey") && usesKeyWithoutTermsGate(text);
      })
      .map((route) => route.file)
      .filter((file) => !BASELINE.has(file));
    expect(offenders).toEqual([]);
  }, 60_000);

  it("is reading real route files", () => {
    const callers = listApiRouteFiles().filter((route) =>
      readFileSync(route.abs, "utf8").includes("needsTermsAcceptance"),
    );
    expect(listApiRouteFiles().length).toBeGreaterThan(100);
    expect(callers.length).toBeGreaterThan(0);
  });
});
