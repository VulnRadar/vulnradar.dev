import { describe, it, expect } from "vitest";
import { isRecentScan } from "@/components/history/history-types";

/**
 * isRecentScan drives whether a history row draws its timestamp at full
 * strength, so the only thing worth pinning is the boundary and the bad-input
 * case: a row whose scanned_at cannot be parsed must not be promoted to
 * "scanned just now", which is what a NaN comparison would silently do if the
 * guard were dropped.
 */
describe("isRecentScan", () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");

  it("counts a scan from minutes ago as recent", () => {
    expect(isRecentScan("2026-09-01T11:30:00.000Z", now)).toBe(true);
  });

  it("counts a scan just inside 24 hours as recent", () => {
    expect(isRecentScan("2026-08-31T12:00:01.000Z", now)).toBe(true);
  });

  it("does not count a scan exactly 24 hours old", () => {
    expect(isRecentScan("2026-08-31T12:00:00.000Z", now)).toBe(false);
  });

  it("does not count an older scan", () => {
    expect(isRecentScan("2026-08-20T12:00:00.000Z", now)).toBe(false);
  });

  it("does not count an unparseable timestamp as recent", () => {
    expect(isRecentScan("not a date", now)).toBe(false);
  });

  it("does not count a future timestamp as stale", () => {
    // Clock skew between the server that stamped the row and the browser
    // reading it. now - at is negative, which is still under a day.
    expect(isRecentScan("2026-09-01T12:05:00.000Z", now)).toBe(true);
  });
});
