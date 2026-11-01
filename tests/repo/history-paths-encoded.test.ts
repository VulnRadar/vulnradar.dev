import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * A per-scan history path built by hand, `${API.HISTORY}/${id}`, puts the id
 * into the request path unencoded, and the browser resolves the path before
 * it sends it. With an id taken from a URL the visitor followed, that walked a
 * same-origin, cookie-bearing request into another API route. Every client
 * call site now goes through an API entry or historyItemPath, which encode it;
 * this keeps a new one from coming back by copying an old line.
 */
const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["app", "components", "hooks", "lib"];
const HAND_BUILT = /\$\{API\.HISTORY\}\//;

// One level of nested parentheses inside the helper's argument list, enough
// for API.X(share.id), API.X(fn(a)) and API.X(a, b).
const ARGS = String.raw`\((?:[^()]|\([^()]*\))*\)`;
const HELPER = String.raw`API\.[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)*`;

/**
 * A path segment appended to what an API helper returned, in a template
 * (`${API.HISTORY_ITEM(id)}/share`) or by concatenation
 * (API.HISTORY_ITEM(id) + "/share"). The sub-route then follows the parent
 * entry's prefix, which is not where it lives once the entries split between
 * the public and the internal API. A query string after a helper is fine.
 */
const SUFFIXED = new RegExp(
  String.raw`\$\{\s*${HELPER}${ARGS}\s*\}\/|${HELPER}${ARGS}\s*\+\s*["'\x60]\/`,
);

/**
 * The helpers encode their argument themselves, so encoding it again at the
 * call site sends %252F where the route expects %2F and the lookup misses.
 */
const ENCODED_ARG = new RegExp(
  String.raw`${HELPER}\((?:[^()]|\([^()]*\))*?encodeURIComponent\b`,
);

/** Source without comments: a doc comment may quote the old shape. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function offenders(pattern: RegExp): string[] {
  return DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)))
    .filter((file) => pattern.test(code(file)))
    .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"));
}

describe("per-scan history paths", () => {
  it("the pattern catches the hand-built shape", () => {
    expect(HAND_BUILT.test("fetch(`${API.HISTORY}/${id}`)")).toBe(true);
    expect(HAND_BUILT.test("fetch(API.HISTORY_ITEM(id))")).toBe(false);
    expect(HAND_BUILT.test("fetch(API.HISTORY)")).toBe(false);
  });

  it("are never built by hand from API.HISTORY", () => {
    expect(offenders(HAND_BUILT)).toEqual([]);
  });
});

describe("sub-routes appended to an API helper's result", () => {
  it.each([
    "fetch(`${API.HISTORY_ITEM(share.id)}/share`, {",
    "fetch(`${ API.HISTORY_ITEM(scanId) }/share/publicly-listed`)",
    "fetch(`${API.SUPPORT_TICKET(Number(id))}/shares`)",
    "fetch(`${API.AUTH.SESSION_REVOKE(id)}/x`)",
    'fetch(API.HISTORY_ITEM(id) + "/delete")',
    "fetch(API.DOMAIN_SCANS(id) + '/x')",
  ])("the pattern catches %s", (line) => {
    expect(SUFFIXED.test(line)).toBe(true);
  });

  it.each([
    "fetch(API.HISTORY_SHARE(share.id), {",
    "fetch(`${API.SUPPORT_TICKET_SHARES(id)}?userId=${userId}`)",
    "`${API.AUTH.OAUTH_START(provider)}?intent=${intent}`",
    'API.AUTH.OAUTH_START(provider) + "?action=link"',
    "`${API.HISTORY}?page=2`",
  ])("the pattern leaves %s alone", (line) => {
    expect(SUFFIXED.test(line)).toBe(false);
  });

  it("no client code appends a path segment to an API helper's result", () => {
    expect(offenders(SUFFIXED)).toEqual([]);
  });
});

describe("API helper arguments", () => {
  it.each([
    "API.ADMIN_SCAN(encodeURIComponent(id))",
    "API.AUTH.STAFF_INVITE(encodeURIComponent(token))",
    "API.HISTORY_REPORT(String(id), encodeURIComponent(f))",
  ])("the pattern catches %s", (line) => {
    expect(ENCODED_ARG.test(line)).toBe(true);
  });

  it.each([
    "API.ADMIN_SCAN(id)",
    "`${API.SCAN_GITHUB}?repo=${encodeURIComponent(repo)}`",
    "fetch(API.HOST(hostname), { body: encodeURIComponent(x) })",
  ])("the pattern leaves %s alone", (line) => {
    expect(ENCODED_ARG.test(line)).toBe(false);
  });

  it("are never encoded at the call site, because the helper encodes them", () => {
    expect(offenders(ENCODED_ARG)).toEqual([]);
  });
});
