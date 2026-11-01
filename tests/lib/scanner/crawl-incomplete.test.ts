import { describe, it, expect } from "vitest";
import {
  CRAWL_INCOMPLETE_LABELS,
  CRAWL_PAGES_CHALLENGED_INCOMPLETE,
  CRAWL_QUOTA_LIMIT_INCOMPLETE,
  CRAWL_TIME_LIMIT_INCOMPLETE,
} from "@/lib/scanner/crawl-incomplete";
import {
  INCOMPLETE_LABELS,
  describeIncompleteAreas,
} from "@/lib/scanner/incomplete-labels";

/**
 * The slugs are what lands in result_meta.incomplete, and rows already stored
 * carry them, so a rename is a data migration. The labels are what a reader is
 * shown in their place; an unlabelled slug is shown as itself.
 */
describe("crawl incomplete markers", () => {
  it("keeps the slugs stored results already carry", () => {
    expect(CRAWL_TIME_LIMIT_INCOMPLETE).toBe("crawl-time-limit");
    expect(CRAWL_QUOTA_LIMIT_INCOMPLETE).toBe("crawl-quota-limit");
    expect(CRAWL_PAGES_CHALLENGED_INCOMPLETE).toBe("crawl-pages-challenged");
  });

  it("labels every marker in words, without an em dash", () => {
    expect(Object.keys(CRAWL_INCOMPLETE_LABELS).sort()).toEqual([
      CRAWL_PAGES_CHALLENGED_INCOMPLETE,
      CRAWL_QUOTA_LIMIT_INCOMPLETE,
      CRAWL_TIME_LIMIT_INCOMPLETE,
    ]);
    for (const label of Object.values(CRAWL_INCOMPLETE_LABELS)) {
      expect(label.length).toBeGreaterThan(10);
      expect(label).not.toContain("—");
    }
  });

  it("reaches a reader as words, not as the slug", () => {
    // The result views map result.incomplete through INCOMPLETE_LABELS; a
    // marker missing from it is shown as itself ("crawl-time-limit").
    expect(INCOMPLETE_LABELS[CRAWL_TIME_LIMIT_INCOMPLETE]).toBe(
      CRAWL_INCOMPLETE_LABELS[CRAWL_TIME_LIMIT_INCOMPLETE],
    );
    expect(
      describeIncompleteAreas([
        CRAWL_QUOTA_LIMIT_INCOMPLETE,
        CRAWL_TIME_LIMIT_INCOMPLETE,
      ]),
    ).toEqual([
      CRAWL_INCOMPLETE_LABELS[CRAWL_QUOTA_LIMIT_INCOMPLETE],
      CRAWL_INCOMPLETE_LABELS[CRAWL_TIME_LIMIT_INCOMPLETE],
    ]);
  });
});
