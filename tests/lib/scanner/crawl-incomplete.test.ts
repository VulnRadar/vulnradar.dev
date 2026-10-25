import { describe, it, expect } from "vitest";
import {
  CRAWL_INCOMPLETE_LABELS,
  CRAWL_QUOTA_LIMIT_INCOMPLETE,
  CRAWL_TIME_LIMIT_INCOMPLETE,
} from "@/lib/scanner/crawl-incomplete";

/**
 * The slugs are what lands in result_meta.incomplete, and rows already stored
 * carry them, so a rename is a data migration. The labels are what a reader is
 * shown in their place; an unlabelled slug is shown as itself.
 */
describe("crawl incomplete markers", () => {
  it("keeps the slugs stored results already carry", () => {
    expect(CRAWL_TIME_LIMIT_INCOMPLETE).toBe("crawl-time-limit");
    expect(CRAWL_QUOTA_LIMIT_INCOMPLETE).toBe("crawl-quota-limit");
  });

  it("labels both markers in words, without an em dash", () => {
    expect(Object.keys(CRAWL_INCOMPLETE_LABELS).sort()).toEqual([
      CRAWL_QUOTA_LIMIT_INCOMPLETE,
      CRAWL_TIME_LIMIT_INCOMPLETE,
    ]);
    for (const label of Object.values(CRAWL_INCOMPLETE_LABELS)) {
      expect(label.length).toBeGreaterThan(10);
      expect(label).not.toContain("—");
    }
  });
});
