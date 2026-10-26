import { describe, it, expect } from "vitest";
import { RETIRED_CHECK_REDIRECTS } from "@/lib/seo/retired-checks";
import { PUBLIC_ROUTES } from "@/lib/seo/routes";
import { getAllChecks } from "@/lib/seo/checks-content";

/**
 * Check pages the previous release published and this one removed. Each must
 * land somewhere real: a 301 to a 404 is worse than the 404, because it also
 * throws away the old URL's standing.
 */
describe("retired check redirects", () => {
  const live = new Set(PUBLIC_ROUTES.map((r) => r.path));
  const liveIds = new Set(getAllChecks().map((c) => c.id));

  it("points every retired check at a page in the sitemap", () => {
    const dead = Object.entries(RETIRED_CHECK_REDIRECTS).filter(
      ([, target]) => !live.has(target),
    );
    expect(dead).toEqual([]);
  });

  it("never shadows a check that is live again", () => {
    const shadowed = Object.keys(RETIRED_CHECK_REDIRECTS).filter((id) =>
      liveIds.has(id),
    );
    expect(shadowed).toEqual([]);
  });
});
