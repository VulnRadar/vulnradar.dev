import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * /shared/[token] fetches the share by the token in its own URL. The token was
 * put into the request path as it came out of useParams, so a slash or a
 * question mark in it could open another segment and send the reader's
 * same-origin request to a different API route. It is encoded now, like the
 * ids the API map's helpers take.
 *
 * Source-text assertions, like the rest of tests/app: tsconfig keeps
 * `jsx: preserve`, so a .tsx page cannot be imported into a test.
 */

const PAGE = path.resolve(__dirname, "../../../app/shared/[token]/page.tsx");

function code(): string {
  return fs
    .readFileSync(PAGE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("/shared/[token] request paths", () => {
  it("never puts the raw token after API.SHARED", () => {
    expect(code()).not.toMatch(/\$\{API\.SHARED\}\/\$\{token\}/);
  });

  it("encodes the token for the share and its screenshot", () => {
    const uses =
      code().match(/\$\{API\.SHARED\}\/\$\{encodeURIComponent\(token\)\}/g) ??
      [];
    expect(uses.length).toBe(2);
  });
});
