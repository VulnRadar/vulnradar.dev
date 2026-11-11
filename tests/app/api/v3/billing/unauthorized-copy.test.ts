import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * A signed-out request to a billing route gets the shared 401 from
 * ApiResponse.unauthorized(), whose message says to sign in, never a bare
 * "Unauthorized" (ux-copy-17). A session that expired on the Billing tab
 * reached the screen as that one word.
 */
const BILLING = path.resolve(__dirname, "../../../../../app/api/v3/billing");

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routes(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

const files = routes(BILLING);

describe("billing routes answer a missing session with ApiResponse.unauthorized()", () => {
  it("finds the billing routes", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(
    files.map((f) => [path.relative(BILLING, f).split(path.sep).join("/"), f]),
  )("%s", (_name, file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/error:\s*"Unauthorized"/);
    if (src.includes("getSession()")) {
      expect(src).toContain("ApiResponse.unauthorized()");
    }
  });
});
