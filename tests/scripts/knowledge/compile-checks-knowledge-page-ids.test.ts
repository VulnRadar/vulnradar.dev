import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  collectPageIds,
  renderPageIdsModule,
} from "../../../scripts/knowledge/check-page-ids.mjs";

/**
 * The /checks id space written out for client code. The compiler runs on every
 * build and rewrites lib/seo/check-page-ids.generated.ts, so what matters is
 * that the pure functions are right and that the committed file is what they
 * produce today (a stale one would link findings to pages that 404, or miss
 * pages that exist).
 */

const DATA_DIR = path.join(process.cwd(), "lib", "scanner", "checks-data");

function loadAll(): Record<
  string,
  { id: string; title: string; emittedAs?: string[] }[]
> {
  const out: Record<
    string,
    { id: string; title: string; emittedAs?: string[] }[]
  > = {};
  for (const file of readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"))) {
    out[file.replace(/\.json$/, "")] = JSON.parse(
      readFileSync(path.join(DATA_DIR, file), "utf8"),
    );
  }
  return out;
}

describe("collectPageIds", () => {
  it("lists every id, sorted, and skips disabled duplicates", () => {
    const { ids } = collectPageIds({
      b: [{ id: "zeta", title: "Zeta" }],
      a: [
        { id: "beta", title: "Beta" },
        { id: "alpha-old", title: "Alpha (disabled duplicate)" },
        { id: "alpha", title: "Alpha" },
      ],
    });
    expect(ids).toEqual(["alpha", "beta", "zeta"]);
  });

  it("maps each async id to the page that documents it, first one winning", () => {
    const { asyncPageIds } = collectPageIds({
      dns: [
        { id: "dns-b", title: "B", emittedAs: ["async-shared", "async-b"] },
        { id: "dns-a", title: "A", emittedAs: ["async-shared"] },
      ],
      email: [{ id: "email-c", title: "C", emittedAs: ["async-c"] }],
    });
    // Category order first, then file order inside it.
    expect(asyncPageIds).toEqual({
      "async-b": "dns-b",
      "async-c": "email-c",
      "async-shared": "dns-b",
    });
    expect(Object.keys(asyncPageIds)).toEqual([
      "async-b",
      "async-c",
      "async-shared",
    ]);
  });

  it("does not map an async id to a page that does not exist", () => {
    const { asyncPageIds } = collectPageIds({
      dns: [{ id: "dns-x", title: "X (disabled duplicate)", emittedAs: ["a"] }],
    });
    expect(asyncPageIds).toEqual({});
  });
});

describe("renderPageIdsModule", () => {
  it("wraps a long entry the way Prettier does, so format:check stays green", () => {
    const long = "async-" + "x".repeat(70);
    const out = renderPageIdsModule({
      ids: ["a"],
      asyncPageIds: { [long]: "page", "async-short": "p" },
    });
    expect(out).toContain(`  "${long}":\n    "page",`);
    expect(out).toContain(`  "async-short": "p",`);
  });

  it("emits both exports and ends with a newline", () => {
    const out = renderPageIdsModule({ ids: ["a", "b"], asyncPageIds: {} });
    expect(out).toContain("export const CHECK_PAGE_IDS: readonly string[] = [");
    expect(out).toContain("export const ASYNC_CHECK_PAGE_IDS");
    expect(out.endsWith("};\n")).toBe(true);
  });
});

describe("the committed check-page-ids.generated.ts", () => {
  it("is what the compiler writes for the checks-data on disk", () => {
    const expected = renderPageIdsModule(collectPageIds(loadAll()));
    const committed = readFileSync(
      path.join(process.cwd(), "lib", "seo", "check-page-ids.generated.ts"),
      "utf8",
    );
    expect(committed).toBe(expected);
  });
});
