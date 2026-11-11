import { describe, it, expect } from "vitest";
import { CHANGELOG } from "@/lib/changelog/data";

/**
 * The 4.0.0 notes are appended to as waves land, so an entry written in one
 * wave can be made untrue by a later one. These phrases were each true when
 * written and false by the end of wave 3; an entry that repeats one has to be
 * rewritten to the end state rather than left beside the entry that
 * contradicts it.
 */
const STALE_PHRASES: [RegExp, string][] = [
  [
    /Only the bot challenge result changes a scan so far/,
    "refused pages (401, 403, 407, 429, 451, 5xx, redirects) are no longer graded",
  ],
  [
    /take effect once those endpoints start using them/,
    "the reputation and auth/me routes enforce their limits",
  ],
  [
    /still covers every request/,
    "the AI verification probe sends VulnRadar-AI/1.0, not VulnRadar/1.0",
  ],
];

describe("the unreleased changelog", () => {
  const unreleased = CHANGELOG.find((r) => r.date === "Unreleased");

  it("finds the unreleased release", () => {
    expect(unreleased).toBeDefined();
  });

  it.each(STALE_PHRASES)("does not say %s", (phrase, why) => {
    const hits = unreleased!.changes
      .filter((c) => phrase.test(c.desc))
      .map((c) => c.label);
    expect(hits, `now untrue because ${why}`).toEqual([]);
  });
});
