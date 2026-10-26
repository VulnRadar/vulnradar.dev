import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * "Signed in" on the pricing page is `isLoggedIn`, which is `!!me?.userId`.
 * The call-to-action at the bottom read `me` itself. That held only while a
 * signed-out /auth/me left `me` empty; whenever it held an object without a
 * userId (the old fetcher parsed a 401 body into one) a visitor was offered
 * "Go to Scanner" instead of "Create an account".
 *
 * The page needs a DOM to render, so the check is on its syntax tree: no
 * condition in the file tests `me` bare, and the CTA branches on isLoggedIn.
 */
const FILE = "app/pricing/page.tsx";
const source = fs.readFileSync(
  path.resolve(__dirname, "../../..", FILE),
  "utf8",
);
const sf = ts.createSourceFile(
  FILE,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

/** The expression each conditional, `if` and `&&` in the file branches on. */
function conditions(): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isConditionalExpression(node)) out.push(node.condition.getText(sf));
    else if (ts.isIfStatement(node)) out.push(node.expression.getText(sf));
    else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      out.push(node.left.getText(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("pricing page", () => {
  it("defines signed-in once, from the user id", () => {
    expect(source).toContain("const isLoggedIn = !!me?.userId;");
  });

  it("never branches on `me` itself", () => {
    expect(conditions().filter((c) => c === "me" || c === "!me")).toEqual([]);
  });

  it("sends a signed-in visitor to the scanner and a signed-out one to sign up", () => {
    expect(source).toContain(
      "<Link href={isLoggedIn ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>",
    );
    expect(source).toContain(
      '{isLoggedIn ? "Go to Scanner" : "Create an account"}',
    );
  });
});
