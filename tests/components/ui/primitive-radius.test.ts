/**
 * The radius ladder (STYLE.md) for the shared primitives that drifted off it.
 *
 *   rounded-md    control: input, button-shaped thing, chip, badge
 *   rounded-full  icon button, pill
 *
 * A bare `rounded` is not a rung. It was on the webhook type and Paused chips
 * (beside a team chip that was rounded-md, in the same row), on InlineAlert's
 * dismiss button, and the pagination primitive's arrows and page numbers were
 * rounded-lg (the card rung) while its own page-size buttons, one row over,
 * were rounded-md.
 *
 * Scoped to the files this was fixed in rather than all of components/ and
 * app/: about seventy bare `rounded` remain elsewhere, owned by surfaces that
 * are not done yet, and a repo-wide guard would fail on them today. Widen
 * FILES as they are brought onto the ladder.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const FILES = [
  "components/ui/pagination-control.tsx",
  "components/shared/inline-alert.tsx",
  "components/profile/tabs/developer/webhooks-section.tsx",
];

/** `rounded` as a whole class, not the start of rounded-md or a variant of it. */
const BARE_ROUNDED = /(?:^|[\s"'`])rounded(?=[\s"'`])/m;

describe("shared primitives sit on the radius ladder", () => {
  it.each(FILES)("%s has no bare `rounded`", (rel) => {
    expect(read(rel)).not.toMatch(BARE_ROUNDED);
  });

  it("pagination buttons are controls (rounded-md), not cards", () => {
    const src = read("components/ui/pagination-control.tsx");
    // First, previous, next, last and every page number.
    expect(src.match(/sm:h-8 sm:w-8 rounded-md/g)).toHaveLength(4);
    expect(src).toContain("sm:min-w-8 px-2 rounded-md");
    // The one rounded-lg left is the segmented page-size group, which holds
    // rounded-md buttons and so is correctly the larger radius.
    expect(src.match(/rounded-lg/g)).toHaveLength(1);
  });

  it("the alert's dismiss is an icon button (rounded-full)", () => {
    const src = read("components/shared/inline-alert.tsx");
    expect(src).toMatch(/justify-center rounded-full opacity-70/);
  });

  it("every webhook chip is rounded-md", () => {
    const src = read("components/profile/tabs/developer/webhooks-section.tsx");
    const chips = src.match(/text-\[10px\] font-semibold uppercase/g) ?? [];
    expect(chips.length).toBeGreaterThanOrEqual(4);
    for (const chip of src.matchAll(
      /"?[^"\n]*text-\[10px\] font-semibold uppercase[^"\n]*"?/g,
    )) {
      expect(chip[0]).toContain("rounded-md");
    }
  });
});
