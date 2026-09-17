import { describe, it, expect } from "vitest";
import { CHANGELOG } from "@/lib/changelog/data";
import { GENERATED_CHECKS_LABEL } from "@/lib/config/check-stats.generated";

/**
 * The unreleased entry states how many checks a scan runs. That number is
 * generated from the check data at every build, and the changelog's copy of it
 * is prose, so nothing connected the two: the retirement entry was written the
 * day the retirements landed and said 855+, then three later commits in the
 * same cycle added checks and the entry kept saying 855+ while the site,
 * the docs and the scanner all said 860+.
 *
 * The compiler that turns this file into the AI knowledge corpus renders
 * `${INTERPOLATION}` as an empty string, so the changelog cannot simply import
 * the constant and interpolate it. This test is what holds the prose to the
 * generated number instead.
 */
describe("changelog check-count claim", () => {
  it("quotes the generated total in the unreleased entry", () => {
    const unreleased = CHANGELOG.find((r) => r.date === "Unreleased");
    if (!unreleased) return; // Nothing unreleased: the claim is already shipped.

    const claims = unreleased.changes.filter((c) =>
      /\d{3}\+ ?(?:checks|, the number a scan actually runs)/.test(c.desc),
    );
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      const numbers = claim.desc.match(/\d{3}\+/g) ?? [];
      // A number the entry quotes as history ("moves from 905+") is allowed;
      // the LAST one is the total the release ends on.
      expect(numbers[numbers.length - 1]).toBe(GENERATED_CHECKS_LABEL);
    }
  });
});
