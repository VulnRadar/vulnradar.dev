import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Authorization header is parsed in one place, lib/api/bearer.ts.
 *
 * Seventeen call sites each tested `startsWith(BEARER_PREFIX)` and two more
 * had their own "Bearer " literal. All of them were case-sensitive, so a client
 * that sent `bearer <key>` (RFC 9110 says the scheme is case-insensitive) was
 * treated as sending no key at all, and any fix had to be made nineteen times.
 * This keeps the nineteen from growing back. ESLint carries the same ban as a
 * warning for the editor; this one fails the build.
 */
const ROOT = path.resolve(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...sourceFiles(rel));
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

// A comment that explains what the old code did is not the old code.
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function read(rel: string): string {
  return codeOnly(readFileSync(path.join(ROOT, rel), "utf8"));
}

const APP_API = sourceFiles("app/api");

describe("Authorization: Bearer parsing", () => {
  it("finds the route files it is meant to guard", () => {
    expect(APP_API.length).toBeGreaterThan(100);
  });

  it("leaves no hand-rolled Bearer test in any route under app/api", () => {
    const forbidden: Array<[string, RegExp]> = [
      ["the BEARER_PREFIX constant", /\bBEARER_PREFIX\b/],
      ['startsWith("Bearer ...")', /startsWith\(\s*["'`]\s*bearer/i],
      ['a bare "Bearer " literal', /["'`]Bearer ["'`]/],
    ];
    const offenders: string[] = [];
    for (const file of APP_API) {
      const code = read(file);
      for (const [name, pattern] of forbidden) {
        if (pattern.test(code)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("makes every route that reads the authorization header use parseBearer", () => {
    const reads = /\.get\(\s*["'`]authorization["'`]\s*\)/i;
    const offenders: string[] = [];
    let readers = 0;
    for (const file of APP_API) {
      const code = read(file);
      if (!reads.test(code)) continue;
      readers++;
      const imported =
        /import\s*\{[^}]*\bparseBearer\b[^}]*\}\s*from\s*["']@\/lib\/api\/bearer["']/.test(
          code,
        );
      if (!imported || !/\bparseBearer\(/.test(code)) offenders.push(file);
    }
    // Sixteen route files read the header today; fewer would mean the scan
    // stopped seeing them rather than that someone removed Bearer auth.
    expect(readers).toBeGreaterThanOrEqual(16);
    expect(offenders).toEqual([]);
  });

  it("has no importer of BEARER_PREFIX and no hand-rolled test outside lib/api/bearer.ts", () => {
    // middleware.ts still matches the scheme itself: it is converted, with the
    // rest of the middleware hardening, after the handlers above, so that the
    // two never disagree about who is authenticated. Drop it from this list
    // when that lands.
    const allowed = new Set(["lib/api/bearer.ts", "middleware.ts"]);
    const files = [
      ...sourceFiles("app"),
      ...sourceFiles("components"),
      ...sourceFiles("hooks"),
      ...sourceFiles("lib"),
      "middleware.ts",
    ].filter((f) => !allowed.has(f));
    const offenders: string[] = [];
    for (const file of files) {
      const code = read(file);
      if (/import\s*\{[^}]*\bBEARER_PREFIX\b[^}]*\}/.test(code)) {
        offenders.push(`${file}: imports BEARER_PREFIX`);
      }
      if (/startsWith\(\s*["'`]\s*bearer/i.test(code)) {
        offenders.push(`${file}: tests the Bearer scheme by hand`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
