/**
 * A page bigger than the scanner's body cap is read up to the cap, and the cut
 * usually lands inside a Next.js flight-data script: the payload is most of a
 * large server-rendered page. That last script has no closing tag and its
 * final statement stops mid-string, so it used to fail the flight-payload
 * test and be read as the site's own code. When the cut fell just after a
 * phrase like "eval() usage", our own /checks page failed the self-scan with
 * eval-in-client-script, dangerous-inline-js and code-csp-no-trustedtypes,
 * none of which describe anything the page runs.
 *
 * The fix is narrow on purpose: only a cut-off script that opens the way a
 * push does is data. Any other unterminated script is still read as code.
 */
import { describe, it, expect } from "vitest";
import { runSyncChecks } from "@/lib/scanner/engine";
import { checkIdOf } from "@/lib/scanner/dedupe";

const EVAL_CHECKS = [
  "eval-in-client-script",
  "eval-in-scripts",
  "dangerous-inline-js",
  "code-csp-no-trustedtypes",
];

const push = (chunk: string) =>
  `self.__next_f.push(${JSON.stringify([1, chunk])})`;

/** `text` cut just after the first `marker`, the way the body cap cuts. */
const cutAfter = (text: string, marker: string) =>
  text.slice(0, text.indexOf(marker) + marker.length + 8);

const page = (scripts: string) =>
  `<!doctype html><html><head><title>Checks</title></head><body><p>Check reference</p>${scripts}`;

function evalFindings(body: string): string[] {
  const { findings } = runSyncChecks(
    "https://example.com/checks",
    new Headers({ "content-type": "text/html; charset=utf-8" }),
    body,
    null,
    undefined,
    "https://example.com/checks",
  );
  return findings
    .map((f) => checkIdOf(f))
    .filter((id) => EVAL_CHECKS.includes(id));
}

describe("a body cut off inside a flight payload", () => {
  const titles = push(
    '7:["$","li",null,{"children":"eval() usage in inline scripts"}]',
  );

  it("is not read as the site's own eval", () => {
    const complete = push('6:["$","p",null,{"children":"Checks"}]');
    const body = page(
      `<script>${complete}</script><script>${cutAfter(titles, "eval(")}`,
    );
    expect(evalFindings(body)).toEqual([]);
  });

  it("is not read as code even when several pushes share the cut script", () => {
    const body = page(`<script>${push("1:x")};${cutAfter(titles, "eval(")}`);
    expect(evalFindings(body)).toEqual([]);
  });

  it("still reads a cut-off script that is not a flight payload", () => {
    const body = page("<script>const out = eval(location.hash.slice(1)); var");
    expect(evalFindings(body).length).toBeGreaterThan(0);
  });

  it("still reads code that sits in front of a push in the cut script", () => {
    const body = page(
      `<script>eval(location.hash.slice(1));${cutAfter(titles, "eval(")}`,
    );
    expect(evalFindings(body).length).toBeGreaterThan(0);
  });

  it("still reads a complete authored script before the cut", () => {
    const body = page(
      `<script>const out = eval(userInput);</script><script>${cutAfter(titles, "eval(")}`,
    );
    expect(evalFindings(body).length).toBeGreaterThan(0);
  });
});
