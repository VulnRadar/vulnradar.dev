import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { listApiRouteFiles } from "../_helpers/api-routes";

/**
 * versioned() has one home, lib/api/v4/wrap. A re-export shim existed for a
 * while to keep the specifier clear of the no-api-version-literals guard, which
 * then learned to skip module specifiers, leaving one route importing the shim
 * and twenty-one importing the wrapper.
 */
describe("versioned() import", () => {
  it("every route that wraps its handler imports it from lib/api/v4/wrap", () => {
    const offenders = listApiRouteFiles()
      .filter(({ abs }) => /\bversioned\(/.test(readFileSync(abs, "utf8")))
      .filter(
        ({ abs }) =>
          !/import\s*\{\s*versioned\s*\}\s*from\s*"@\/lib\/api\/v4\/wrap"/.test(
            readFileSync(abs, "utf8"),
          ),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
