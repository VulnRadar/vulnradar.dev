import { describe, it, expect, vi } from "vitest";

// async-checks reaches lib/config/runtime-config, which opens the pool at
// module load and throws without DATABASE_URL. Nothing here queries anything:
// the mock exists so the import graph resolves on a machine with no database,
// which is the rule the whole unit tier runs under (tests/README.md).
vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
}));

import {
  INCOMPLETE_LABELS,
  describeIncompleteAreas,
} from "@/lib/scanner/incomplete-labels";
import { getPlannedAsyncBranches } from "@/lib/scanner/async-checks";
import { PAGE_CHECKS_INCOMPLETE } from "@/lib/scanner/engine";

/**
 * `ScanResult.incomplete` carries engine slugs, and two surfaces render them
 * to a user. A branch added to async-checks.ts with no entry here does not
 * fail anything: describeIncompleteAreas passes the key through, so the page
 * quietly tells the reader that "osv-libraries did not finish". That is the
 * only failure mode this map has, and it is the one worth a test.
 */
describe("incomplete area labels", () => {
  it("names every async branch a full scan can plan", () => {
    const branches = getPlannedAsyncBranches(
      "https://example.com",
      null,
      "all",
    );
    expect(branches.length).toBeGreaterThan(0);
    const unlabelled = branches.filter((b) => !(b in INCOMPLETE_LABELS));
    expect(unlabelled).toEqual([]);
  });

  it("names the two areas that come from outside the async branches", () => {
    // engine.ts, when a page check throws instead of reaching a verdict.
    expect(INCOMPLETE_LABELS[PAGE_CHECKS_INCOMPLETE]).toBeTruthy();
    // POST /api/v3/scan/authenticated, when the login session was lost mid-run.
    expect(INCOMPLETE_LABELS["authenticated-session"]).toBeTruthy();
  });

  it("keeps an unknown area visible rather than dropping it", () => {
    expect(describeIncompleteAreas(["dns", "brand-new-branch"])).toEqual([
      INCOMPLETE_LABELS.dns,
      "brand-new-branch",
    ]);
    expect(describeIncompleteAreas(undefined)).toEqual([]);
  });
});
