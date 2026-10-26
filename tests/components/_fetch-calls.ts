import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");

export interface FetchCall {
  /** Source text of the first argument, exactly as written. */
  target: string;
  /** Source text of the second argument, or "" when there is none. */
  options: string;
}

/**
 * Every `fetch(...)` call in a source file, read from its syntax tree.
 *
 * For the client components the suite cannot render (no DOM): what a handler
 * requests is a property of the code, and this reads it without running the
 * handler. Comments cannot match, which a regex over the text could not
 * promise.
 */
export function fetchCalls(relativePath: string): FetchCall[] {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  const sf = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const calls: FetchCall[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch" &&
      node.arguments.length > 0
    ) {
      calls.push({
        target: node.arguments[0].getText(sf),
        options: node.arguments[1]?.getText(sf) ?? "",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}
