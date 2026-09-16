import { describe, it, expect } from "vitest";
import { CHANGELOG } from "@/lib/changelog/data";

/**
 * Release dates must be real, and must be in release order.
 *
 * 31 of 65 were wrong, most by a day and some by four, because each one was
 * typed when the entry was drafted rather than when the release actually went
 * out. They are now set from each GitHub release's own `publishedAt`, which is
 * the only authority for when a version shipped.
 *
 * This cannot re-check them against GitHub without a network call, which would
 * make the suite flaky and offline-hostile. What it can do is catch the shapes
 * that made the drift visible in the first place: a date that does not parse,
 * a date in the future, and a version dated before the version it supersedes.
 * The last one is what a hand-typed date gets wrong: 1.6.3 and 1.6.4 both
 * claimed February 14 when they shipped on the 16th, and 1.6.0 through 1.6.5
 * were spread across four days they were not released on.
 */
/**
 * The one entry allowed to have no date.
 *
 * A release that has not shipped has no publishedAt to take a date from, and
 * writing today's date into it would be exactly the thing this file exists to
 * catch: a hand-typed date asserting a ship day that never happened. So the
 * top entry may say "Unreleased", and only the top entry, and only one of
 * them. Every other rule below still applies to every other release.
 */
const UNRELEASED = "Unreleased";

describe("changelog release dates", () => {
  const releases = CHANGELOG;
  const dated = releases.filter((r) => r.date !== UNRELEASED);

  it("has entries", () => {
    expect(releases.length).toBeGreaterThan(10);
  });

  it("allows at most one Unreleased entry, and only at the top", () => {
    const unreleased = releases
      .map((r, i) => ({ ...r, i }))
      .filter((r) => r.date === UNRELEASED);
    expect(unreleased.length).toBeLessThanOrEqual(1);
    for (const r of unreleased) {
      expect(
        r.i,
        `${r.version} is marked ${UNRELEASED} but is not the newest entry. ` +
          `A shipped release below an unshipped one means the order is wrong.`,
      ).toBe(0);
    }
  });

  it.each(dated.map((r) => [r.version, r.date] as const))(
    "%s has a parseable date",
    (version, date) => {
      const parsed = new Date(`${date} UTC`);
      expect(
        Number.isNaN(parsed.getTime()),
        `${version} has an unparseable date: "${date}". The format is ` +
          `"Month D, YYYY", matching every other entry.`,
      ).toBe(false);
    },
  );

  it("dates no release in the future", () => {
    // A day of slack: the dates are UTC and a contributor may be behind it.
    const cutoff = Date.now() + 24 * 60 * 60 * 1000;
    const future = dated.filter(
      (r) => new Date(`${r.date} UTC`).getTime() > cutoff,
    );
    expect(
      future.map((r) => `${r.version} (${r.date})`),
      "a release cannot have shipped in the future; this is a typed date " +
        "that does not match the GitHub release",
    ).toEqual([]);
  });

  it("lists releases newest first, with dates that never go forwards", () => {
    // CHANGELOG is rendered in array order, so the array order IS the claim
    // being made to the reader. A later entry dated after an earlier one means
    // either the order or the date is wrong.
    const offenders: string[] = [];
    // Walks the dated entries in their original order, so an Unreleased top
    // entry is skipped rather than breaking the chain between its neighbours.
    for (let i = 1; i < dated.length; i++) {
      const prev = new Date(`${dated[i - 1].date} UTC`).getTime();
      const cur = new Date(`${dated[i].date} UTC`).getTime();
      if (Number.isNaN(prev) || Number.isNaN(cur)) continue;
      if (cur > prev) {
        offenders.push(
          `${dated[i].version} (${dated[i].date}) is dated after ` +
            `${dated[i - 1].version} (${dated[i - 1].date}), but is ` +
            `listed below it`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
