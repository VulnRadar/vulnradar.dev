/**
 * A Set-Cookie line in a fix example is copied into production, so it has to
 * be one the browser accepts. The __Host- prefix is the easy one to get wrong:
 * it needs Secure, Path=/ and no Domain, and a browser drops the cookie
 * silently when any of those is missing. One page shipped
 * `__Host-admin-token=...; Path=/admin` as its recommended fix for years, which
 * is a cookie that never sets.
 */

import { describe, expect, it } from "vitest";

import { loadCheckPages } from "./_page-prose";

interface CookieLine {
  where: string;
  line: string;
}

/** The problems with one `Set-Cookie:` value, empty when it is a valid example. */
function cookieProblems(line: string): string[] {
  const value = line.replace(/^\s*Set-Cookie:\s*/i, "");
  const [pair = "", ...attrs] = value.split(";").map((part) => part.trim());
  const name = pair.split("=")[0] ?? "";
  const attr = (key: string) =>
    attrs.find((a) => a.toLowerCase().split("=")[0] === key.toLowerCase());
  const problems: string[] = [];

  if (/^__host-/i.test(name)) {
    if (!attr("Secure")) problems.push("__Host- cookie without Secure");
    if (attr("Domain")) problems.push("__Host- cookie with a Domain");
    const path = attr("Path");
    if (path?.split("=")[1] !== "/") {
      problems.push("__Host- cookie without Path=/");
    }
  }
  if (/^__secure-/i.test(name) && !attr("Secure")) {
    problems.push("__Secure- cookie without Secure");
  }
  if (attr("SameSite")?.toLowerCase() === "samesite=none" && !attr("Secure")) {
    problems.push("SameSite=None without Secure");
  }
  if (attr("Partitioned") && !attr("Secure")) {
    problems.push("Partitioned without Secure");
  }
  return problems;
}

/**
 * Examples that are deliberately wrong, keyed by `<check id>: <label>`. A page
 * that shows the broken cookie next to the fix belongs here; a recommended fix
 * never does.
 */
const KNOWN_BAD_EXAMPLES: ReadonlySet<string> = new Set([]);

function setCookieLines(): CookieLine[] {
  const lines: CookieLine[] = [];
  for (const page of loadCheckPages()) {
    for (const example of page.codeExamples) {
      for (const line of example.code.split("\n")) {
        if (/^\s*Set-Cookie:/i.test(line)) {
          lines.push({ where: `${page.id}: ${example.label}`, line });
        }
      }
    }
  }
  return lines;
}

describe("cookieProblems", () => {
  it("accepts a correct __Host- cookie", () => {
    expect(
      cookieProblems("Set-Cookie: __Host-sid=1; Secure; HttpOnly; Path=/"),
    ).toEqual([]);
  });

  it("rejects a __Host- cookie with a path other than /", () => {
    expect(
      cookieProblems("Set-Cookie: __Host-admin=1; Secure; Path=/admin"),
    ).toEqual(["__Host- cookie without Path=/"]);
  });

  it("rejects a __Host- cookie with no Path at all", () => {
    expect(cookieProblems("Set-Cookie: __Host-sid=1; Secure")).toEqual([
      "__Host- cookie without Path=/",
    ]);
  });

  it("rejects a __Host- cookie with a Domain", () => {
    expect(
      cookieProblems("Set-Cookie: __Host-sid=1; Secure; Path=/; Domain=a.com"),
    ).toEqual(["__Host- cookie with a Domain"]);
  });

  it("rejects a __Host- cookie without Secure", () => {
    expect(cookieProblems("Set-Cookie: __Host-sid=1; Path=/")).toEqual([
      "__Host- cookie without Secure",
    ]);
  });

  it("allows a path on a __Secure- cookie", () => {
    expect(
      cookieProblems("Set-Cookie: __Secure-admin=1; Secure; Path=/admin"),
    ).toEqual([]);
  });

  it("rejects SameSite=None and Partitioned without Secure", () => {
    expect(cookieProblems("Set-Cookie: a=1; SameSite=None")).toEqual([
      "SameSite=None without Secure",
    ]);
    expect(cookieProblems("Set-Cookie: a=1; Partitioned")).toEqual([
      "Partitioned without Secure",
    ]);
  });

  it("leaves an unprefixed cookie alone", () => {
    expect(cookieProblems("Set-Cookie: a=1; Path=/admin")).toEqual([]);
  });
});

describe("Set-Cookie examples in the check pages", () => {
  const lines = setCookieLines();

  it("finds the examples it is meant to lint", () => {
    expect(lines.length).toBeGreaterThan(10);
  });

  it("only recommends cookies a browser accepts", () => {
    const bad = lines
      .filter(({ where }) => !KNOWN_BAD_EXAMPLES.has(where))
      .flatMap(({ where, line }) =>
        cookieProblems(line).map((problem) => `${where}: ${problem}: ${line}`),
      );
    expect(bad).toEqual([]);
  });
});
