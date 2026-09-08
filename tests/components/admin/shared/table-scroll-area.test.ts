/**
 * The admin tables cap their height in `vh`, and `vh` is a fraction of the
 * whole viewport: it knows nothing about the browser chrome above the page or
 * about how far down the page the table starts. On a short viewport the cap
 * lands near the 40px header height, and the table collapses into a pinned
 * header with a sliver of one row beneath it, with the rest of the rows
 * spilling out of a box that is no longer tall enough to hold them.
 *
 * Measured at 43.55px of container against a 40px header before this was
 * floored. It reads exactly as reported: "it's not tall enough and stuff
 * bleeds behind it when scrolling, because of a little line that shows up".
 *
 * Source-text assertions, same reasoning as the other component suites here:
 * this Vitest config runs plain node, with no DOM and no layout engine.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const SOURCE = read("components/admin/shared/data-table.tsx");

describe("TableScrollArea height cap", () => {
  it("floors the cap so a short viewport cannot collapse the table", () => {
    expect(SOURCE).toContain("const MIN_TABLE_CAP");
    // CSS max(), applied to whatever the caller asked for.
    expect(SOURCE).toContain(
      "maxHeight: `max(${maxHeight}, ${MIN_TABLE_CAP})`",
    );
  });

  it("keeps the floor comfortably above one header row", () => {
    // The header cells are h-10 (40px) or h-9. A floor that is merely bigger
    // than the header still shows a sliver; it has to hold several rows.
    const m = SOURCE.match(/const MIN_TABLE_CAP = "(\d+(?:\.\d+)?)rem"/);
    expect(m, "MIN_TABLE_CAP should be declared in rem").not.toBeNull();
    const px = parseFloat(m![1]) * 16;
    expect(px).toBeGreaterThan(200);
  });

  it("caps rather than reserves, so a two-row table gains no dead space", () => {
    // max-height only ever shrinks a box. A min-height would pad every short
    // table in the panel out to the floor.
    expect(SOURCE).not.toMatch(/minHeight/);
    expect(SOURCE).not.toMatch(/\bmin-h-\[/);
  });

  it("still lets a caller ask for a smaller cap than the default", () => {
    // The prop is preserved and composed, not overridden: max() takes the
    // larger of the caller's value and the floor, so `65vh` on a tall screen
    // is still 65vh.
    expect(SOURCE).toMatch(/maxHeight = "70vh"/);
    expect(SOURCE).toContain("${maxHeight}");
  });

  it("records the two fixes that were tried and did not work", () => {
    // Both were shipped and reverted. The comment is what stops a third
    // attempt at the same two things.
    expect(SOURCE).toMatch(/elementFromPoint/);
    expect(SOURCE).toMatch(/scroll-snap-type/);
  });
});
