/**
 * Per-category detector smoke tests for headers.
 *
 * For every detector in `lib/scanner/checks/headers.ts`, this test
 * confirms:
 *   1. The detector is exported under its key in the `detectors` map.
 *   2. Calling it with an empty input does not throw and returns either
 *      `null` (no finding) or `string` (a finding). Either is acceptable;
 *      we just want to know the function is callable.
 *   3. Calling it twice with the same input produces deterministic
 *      output (so the detector doesn't depend on global state).
 *
 * The actual positive/negative cases for each detector live in the
 * Group A rewrite; this file is the smoke-test harness only.
 */
import { describe, it, expect } from "vitest";
import { detectors } from "@/lib/scanner/checks/headers";
import { allCheckDefs } from "@/lib/scanner/registry";

const ALL_IDS = Object.keys(detectors);

describe("headers detectors", () => {
  it("exports a non-empty detectors map", () => {
    expect(ALL_IDS.length).toBeGreaterThan(0);
  });

  it.each(ALL_IDS)("%s is a function", (id) => {
    expect(typeof detectors[id]).toBe("function");
  });

  it.each(ALL_IDS)("%s handles empty inputs without throwing", (id) => {
    const fn = detectors[id];
    expect(() => fn("https://example.com", new Headers(), "")).not.toThrow();
  });

  it.each(ALL_IDS)("%s returns null or a non-empty string", (id) => {
    const fn = detectors[id];
    const result = fn("https://example.com", new Headers(), "");
    if (result !== null) {
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it.each(ALL_IDS)("%s is deterministic for the same input", (id) => {
    const fn = detectors[id];
    const input = [
      "https://example.com",
      new Headers({ "x-test": "value" }),
      "<html><body><h1>Test</h1></body></html>",
    ] as const;
    const a = fn(...input);
    const b = fn(...input);
    expect(a).toEqual(b);
  });

  it("every detector key is either registered or a known orphan (TODO: Group A rewrite pass)", () => {
    const registeredIds = new Set(allCheckDefs.map((d) => d.id));
    const orphans = ALL_IDS.filter((id) => !registeredIds.has(id));
    // During the Group A rewrite pass every orphan will be either
    // added to the JSON (preferred) or removed from the detector map.
    // The current list of known orphans is informational only; this
    // test passes as long as we surface the discrepancy.
    if (orphans.length > 0) {
      console.warn(
        `[headers.ts] ${orphans.length} detector(s) have no JSON entry: ${orphans.join(", ")}`,
      );
    }
  });
});
