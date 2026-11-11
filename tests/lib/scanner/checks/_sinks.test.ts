import { describe, expect, it } from "vitest";
import {
  isLiteralArgument,
  looksBundled,
  UNTRUSTED_SOURCE,
} from "@/lib/scanner/checks/_sinks";

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

describe("UNTRUSTED_SOURCE", () => {
  it.each([
    "location.hash.slice(1)",
    "window.location.search",
    "new URLSearchParams(location.search).get('next')",
    "url.searchParams.get('q')",
    "document.referrer",
    "document.URL",
    "window.name",
    "localStorage.getItem('x')",
    "event.data.html",
    "e.data",
    "msg.data",
    "window.postMessage(x, '*')",
  ])("matches %s", (expr) => {
    expect(UNTRUSTED_SOURCE.test(expr)).toBe(true);
  });

  it.each([
    "tpl",
    "withReferral(href, code)",
    "img.getAttribute('data-src')",
    "thisThemeFix.css",
    "relocation.x",
    "allocation",
    "'<b>' + name + '</b>'",
  ])("does not match %s", (expr) => {
    expect(UNTRUSTED_SOURCE.test(expr)).toBe(false);
  });
});

describe("looksBundled", () => {
  const longLine = (n: number) => `var a=${"x+1,".repeat(n)}0;`;

  it("is true for a minified script: 4 KB or more on one line", () => {
    const code = longLine(1500);
    expect(code.length).toBeGreaterThan(4096);
    expect(looksBundled(code)).toBe(true);
  });

  it("is true for 4 KB or more in three lines or fewer", () => {
    const part = `var a=${"x+1,".repeat(500)}0;`;
    expect(looksBundled([part, part, part].join("\n"))).toBe(true);
  });

  it("is true for a long script that has one line over 2000 characters", () => {
    const filler = Array.from({ length: 200 }, (_, i) => `var v${i} = ${i};`);
    const code = [...filler, longLine(700), ...filler].join("\n");
    expect(code.length).toBeGreaterThan(4096);
    expect(looksBundled(code)).toBe(true);
  });

  it("is false for 4 KB of ordinary hand-written lines", () => {
    const code = Array.from(
      { length: 200 },
      (_, i) => `var value${i} = compute(${i}); // step ${i}`,
    ).join("\n");
    expect(code.length).toBeGreaterThan(4096);
    expect(looksBundled(code)).toBe(false);
  });

  it("is false for a short minified line: it has to be library-sized", () => {
    expect(looksBundled(`!function(){document.title="x"}();`)).toBe(false);
  });

  it("is true for a preserved /*! banner with a version, whatever the size", () => {
    expect(looksBundled(`/*! tiny v1.4.2 | MIT */\n!function(){}();`)).toBe(
      true,
    );
    expect(looksBundled(`  /*! lib 2.0.0 */ var a = 1;`)).toBe(true);
  });

  it("is false for a banner with no version or an ordinary comment", () => {
    expect(looksBundled(`/*! (c) Example Ltd */\nvar a = 1;`)).toBe(false);
    expect(looksBundled(`/* tiny v1.4.2 */\nvar a = 1;`)).toBe(false);
    expect(looksBundled(`var a = 1; /*! v1.4.2 */`)).toBe(false);
  });
});
