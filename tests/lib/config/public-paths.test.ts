import { describe, expect, it } from "vitest";

import { PUBLIC_PATHS } from "@/lib/config/public-paths";

/**
 * PUBLIC_PATHS is the page allowlist and nothing else. Its API entries were
 * prefixes ("/api/v3/badge" also made badge/scans and badge/site public) and
 * were matched before any rule about the space a path belongs to, so an API
 * path listed here could skip the auth gate whatever the registry said about
 * it. Which API paths are anonymous is the route registry's question now.
 */
describe("PUBLIC_PATHS", () => {
  it("holds no API path", () => {
    expect(PUBLIC_PATHS.filter((p) => p.startsWith("/api"))).toEqual([]);
  });

  it("holds only absolute page paths without a fragment or query", () => {
    for (const path of PUBLIC_PATHS) {
      expect(path).toMatch(/^\//);
      expect(path).not.toMatch(/[#?]/);
    }
  });
});
