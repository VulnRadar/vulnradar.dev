import { describe, expect, it } from "vitest";
import { isLiteralArgument } from "@/lib/scanner/checks/_sinks";

/** Call {@link isLiteralArgument} at the first `(` of the source. */
function literal(src: string): boolean {
  return isLiteralArgument(src, src.indexOf("("));
}

describe("isLiteralArgument", () => {
  it.each([
    ["double quotes", `eval("require('crypto')")`],
    ["single quotes", `eval('1 + 1')`],
    ["a template with no interpolation", "eval(`1 + 1`)"],
    ["an escaped quote", `eval("a\\"b")`],
    ["a dollar with no brace", "eval(`cost $5`)"],
    ["padding inside the parens", `eval(  "x"  )`],
    ["several literal arguments", `new Function("a", "b", "return a + b")`],
    ["no arguments at all", "new Function()"],
    ["a call with a trailing comma", `new Function("a", "return a",)`],
  ])("%s is literal", (_name, src) => {
    expect(literal(src)).toBe(true);
  });

  it.each([
    ["a variable", "eval(x)"],
    ["a call", "eval(getIt())"],
    ["concatenation", `eval("return " + data)`],
    ["concatenation on a later argument", `new Function("a", "b" + c)`],
    ["a non-literal later argument", `new Function("a", body)`],
    ["interpolation", "eval(`x${y}`)"],
    ["a member read on the literal", `eval("x".concat(y))`],
    ["a parenthesised expression", `eval(("x"))`],
    ["a string that never closes", `eval("abc`],
    ["a quoted string broken by a newline", `eval("abc\ndef")`],
    ["no closing paren", `eval("abc"`],
    ["an escape at the very end", `eval("abc\\`],
  ])("%s is not literal", (_name, src) => {
    expect(literal(src)).toBe(false);
  });

  it("allows a newline in a template, where it is legal", () => {
    expect(literal("eval(`a\nb`)")).toBe(true);
  });

  it("reads from the offset it is given", () => {
    const src = `eval(x); eval("y")`;
    expect(isLiteralArgument(src, src.lastIndexOf("("))).toBe(true);
    expect(isLiteralArgument(src, src.indexOf("("))).toBe(false);
  });
});
