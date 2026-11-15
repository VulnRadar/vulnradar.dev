/**
 * A small evaluator for GitHub Actions expressions, shared by the repo tests
 * that have to know what a workflow condition or a concurrency group is worth
 * for a given event: tests/repo/workflow-trust.test.ts evaluates the job
 * conditions of the release workflows, and tests/repo/ci-concurrency.test.ts
 * the group of ci.yml.
 */

/* ------------------------------------------------------------------------ */
/* A small evaluator for the subset of GitHub expressions these conditions   */
/* use: property paths, string literals, ==, !=, !, &&, || and parentheses.  */
/* Strings compare case-insensitively and a missing property is null, which  */
/* is how the Actions runtime treats both.                                   */
/* ------------------------------------------------------------------------ */

export type Value = string | boolean | null;
export type Ctx = Record<string, unknown>;

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  const re =
    /\s*(\|\||&&|==|!=|!|\(|\)|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.-]*)/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`cannot tokenize at: ${src.slice(pos)}`);
    tokens.push(m[1]);
    pos = re.lastIndex;
  }
  return tokens;
}

const truthy = (v: Value) => v !== null && v !== false && v !== "";

/** The expression's value: && and || return an operand, as in Actions. */
export function evaluateValue(expr: string, ctx: Ctx): Value {
  const src = expr.replace(/^\$\{\{\s*|\s*\}\}$/g, "");
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  const lookup = (path: string): Value => {
    let cur: unknown = ctx;
    for (const part of path.split(".")) {
      if (cur === null || typeof cur !== "object") return null;
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur === undefined) return null;
    return cur as Value;
  };
  const eq = (a: Value, b: Value) =>
    typeof a === "string" && typeof b === "string"
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;

  const primary = (): Value => {
    const t = next();
    if (t === "(") {
      const v = or();
      if (next() !== ")") throw new Error("expected )");
      return v;
    }
    if (t === "!") return !truthy(primary());
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    return lookup(t);
  };
  const comparison = (): Value => {
    const left = primary();
    if (peek() === "==") {
      next();
      return eq(left, primary());
    }
    if (peek() === "!=") {
      next();
      return !eq(left, primary());
    }
    return left;
  };
  const and = (): Value => {
    let v = comparison();
    while (peek() === "&&") {
      next();
      const r = comparison();
      v = truthy(v) ? r : v;
    }
    return v;
  };
  const or = (): Value => {
    let v = and();
    while (peek() === "||") {
      next();
      const r = and();
      v = truthy(v) ? v : r;
    }
    return v;
  };

  const result = or();
  if (i !== tokens.length) throw new Error(`trailing tokens in: ${expr}`);
  return result;
}

export function evaluate(expr: string, ctx: Ctx): boolean {
  return truthy(evaluateValue(expr, ctx));
}
