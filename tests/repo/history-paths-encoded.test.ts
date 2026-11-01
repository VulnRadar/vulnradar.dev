import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * A per-scan history path built by hand, `${API.HISTORY}/${id}`, puts the id
 * into the request path unencoded, and the browser resolves the path before
 * it sends it. With an id taken from a URL the visitor followed, that walked a
 * same-origin, cookie-bearing request into another API route. Every client
 * call site now goes through API.HISTORY_ITEM or historyItemPath, which encode
 * it; this keeps a new one from coming back by copying an old line.
 */
const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["app", "components", "hooks", "lib"];
const HAND_BUILT = /\$\{API\.HISTORY\}\//;

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

describe("per-scan history paths", () => {
  it("the pattern catches the hand-built shape", () => {
    expect(HAND_BUILT.test("fetch(`${API.HISTORY}/${id}`)")).toBe(true);
    expect(HAND_BUILT.test("fetch(API.HISTORY_ITEM(id))")).toBe(false);
    expect(HAND_BUILT.test("fetch(API.HISTORY)")).toBe(false);
  });

  it("are never built by hand from API.HISTORY", () => {
    const offenders = DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)))
      .filter((file) => HAND_BUILT.test(code(file)))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"));
    expect(offenders).toEqual([]);
  });
});
