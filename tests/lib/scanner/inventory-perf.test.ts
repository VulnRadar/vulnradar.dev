import { describe, it, expect, vi } from "vitest";

// Both modules reach a pool through their import chains (osv-check imports
// the registry, which reaches settings). Neither function under test touches
// it, so the pool is faked rather than requiring a DATABASE_URL, the same way
// the rest of the unit tier does.
vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

const { fingerprintSoftware } =
  await import("@/lib/scanner/software-inventory");
const { extractDetectedLibraries } = await import("@/lib/scanner/osv-check");

/**
 * Two modules that parse the response body and are not in `allChecks`.
 *
 * `tests/lib/scanner/_perf-budget.test.ts` sweeps every registered check over
 * a corpus of adversarial shapes, and it is thorough. These two run on the
 * same 1 MiB body and are not registered checks, so it never saw them, and
 * both carried the exact `<tag[^>]*ATTR[^>]*>` splice that checks/_tag-scan.ts
 * was written to remove, with the runs left unbounded. On markup that never
 * closes a tag the first run backtracks to every offset where the attribute
 * matches and the second scans to the end of the document from each one:
 *
 *   <meta name="generator"      36s at 32KB
 *   <meta content="x"           54s at 32KB
 *   <script src="               88s at 32KB
 *
 * Neither has an await in it, so nothing interrupts them. The scan watchdog,
 * the async-branch races and the yield points all wait, and the process
 * serving every other user waits with them.
 *
 * A guard here rather than an entry in the budget suite because that suite is
 * built around the registered-check signature, and the gap that let this
 * through was precisely "not a registered check".
 */

const CEILING_MS = 2_000;

/** Markup that opens a tag and never closes it, which is the whole trick. */
const SHAPES: Record<string, string> = {
  unterminatedGeneratorMeta: '<meta name="generator" '.repeat(1_400),
  unterminatedContentMeta: '<meta content="x" '.repeat(1_800),
  unterminatedScriptSrc: '<script src="'.repeat(2_500),
  unterminatedAnyTag: "<meta ".repeat(5_000),
  openAngleRun: "<".repeat(32_768),
  attrSoup: '<script src="a" src="b" '.repeat(1_400),
};

describe("body parsers outside the check registry stay linear", () => {
  for (const [shape, body] of Object.entries(SHAPES)) {
    it(`fingerprintSoftware is not slowed by: ${shape}`, () => {
      const started = Date.now();
      fingerprintSoftware(
        new Headers({ "content-type": "text/html" }),
        body,
        "https://example.com/",
      );
      const elapsed = Date.now() - started;
      expect(
        elapsed,
        `fingerprintSoftware took ${elapsed}ms on ${shape}: a page can stall every scan on the server`,
      ).toBeLessThan(CEILING_MS);
    });

    it(`extractDetectedLibraries is not slowed by: ${shape}`, () => {
      const started = Date.now();
      extractDetectedLibraries(body, "https://example.com/");
      const elapsed = Date.now() - started;
      expect(
        elapsed,
        `extractDetectedLibraries took ${elapsed}ms on ${shape}`,
      ).toBeLessThan(CEILING_MS);
    });
  }

  it("still reads a generator tag in either attribute order", () => {
    // The two orders needed two regexes before, which is half of why there
    // were two patterns to get wrong. Reading the tag's own attributes does
    // not care which came first.
    const nameFirst = fingerprintSoftware(
      new Headers({ "content-type": "text/html" }),
      '<meta name="generator" content="WordPress 6.4.2">',
      "https://example.com/",
    );
    const contentFirst = fingerprintSoftware(
      new Headers({ "content-type": "text/html" }),
      '<meta content="WordPress 6.4.2" name="generator">',
      "https://example.com/",
    );
    for (const items of [nameFirst, contentFirst]) {
      expect(items.some((i) => /wordpress/i.test(i.name))).toBe(true);
    }
  });

  it("still reads a script src", () => {
    const found = extractDetectedLibraries(
      '<script src="https://cdn.example.com/jquery-3.4.1.min.js"></script>',
      "https://example.com/",
    );
    expect(found.some((l) => /jquery/i.test(l.name))).toBe(true);
  });
});
