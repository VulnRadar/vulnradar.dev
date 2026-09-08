/**
 * The two social cards that answer from the database -- the shared report at
 * /shared/[token] and the public host report at /host/[hostname] -- must not
 * ship next/og's default `public, immutable, no-transform, max-age=31536000`.
 *
 * Both are revocable. A share link can be revoked or expire, and a host row is
 * deleted the moment the scan behind it is made private. A year of `immutable`
 * tells every cache the answer will never change, so the unfurl in Slack keeps
 * showing the host and its severity counts long after the page itself stops
 * answering.
 *
 * The two generators are read as text rather than imported, the same trick and
 * for the same reason as tests/middleware.test.ts's read of app/layout.tsx:
 * they are `.tsx`, tsconfig sets `jsx: "preserve"`, and this config has no JSX
 * transform, so importing one is a parse error rather than a test. What is
 * asserted is still the thing that regresses: passing `size` instead of the
 * options object is how the default header comes back.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OG_LIVE_DATA_HEADERS } from "@/app/_og/cache";

function readSource(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../${relative}`, import.meta.url)),
    "utf8",
  );
}

const CARD_SOURCES = [
  "app/shared/[token]/opengraph-image.tsx",
  "app/host/[hostname]/opengraph-image.tsx",
];

describe("dynamic social cards: cache headers", () => {
  it("declares a bounded cache and never `immutable`", () => {
    const value = OG_LIVE_DATA_HEADERS["cache-control"];
    expect(value).not.toContain("immutable");
    const maxAge = Number(/max-age=(\d+)/.exec(value)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    // Long enough to absorb an unfurl burst, short enough that a revoked link
    // stops unfurling in minutes rather than in a year.
    expect(maxAge).toBeLessThanOrEqual(3600);
  });

  it("caps shared caches too, not just the viewer's browser", () => {
    // A social unfurl is fetched by the platform's own crawler through its
    // cache, so max-age alone would not bound anything an intermediary keeps.
    expect(OG_LIVE_DATA_HEADERS["cache-control"]).toMatch(/s-maxage=\d+/);
  });

  it("passes the header on every ImageResponse both data-backed cards build", () => {
    for (const relative of CARD_SOURCES) {
      const source = readSource(relative);
      expect(source).toContain("OG_LIVE_DATA_HEADERS");
      expect(source).toContain("headers: OG_LIVE_DATA_HEADERS");

      // Every construction site takes the options object. `new ImageResponse(
      // el, size)` is the shape that silently restores next/og's year of
      // `immutable`, so no ImageResponse may be built with a bare `size`.
      const constructions = source.match(/new ImageResponse\(/g) ?? [];
      expect(constructions.length).toBeGreaterThan(0);
      const withOptions = source.match(/^\s*options,$/gm) ?? [];
      expect(withOptions.length).toBe(constructions.length);
      expect(source).not.toMatch(/^\s*size,$/m);
    }
  });
});
