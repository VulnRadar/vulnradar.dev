/**
 * Three layout details on /teams that were each a small break from the house
 * rules, pinned so a copy of the nearest file does not bring them back.
 *
 * Source-text assertions, because this Vitest config runs plain node with no
 * jsdom and a `.tsx` cannot be imported into a suite. The rename row was also
 * measured in a browser at 360, 375 and 390px, with and without a team
 * picture, which is the only way the overflow shows: it reads fine in markup.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const HEADER = read("components/teams/team-detail-header.tsx");
const MEMBERS = read("components/teams/team-members-list.tsx");
const INVITATIONS = read("components/teams/team-invitations.tsx");

describe("the rename row on a phone", () => {
  it("lets the input shrink so Cancel stays on the card", () => {
    // w-48 could not shrink: Cancel ended up past the card edge, cut off by
    // the body's overflow-x: clip, so on a phone it could not be reached.
    expect(HEADER).not.toContain("font-semibold w-48");
    expect(HEADER).toContain("min-w-0 flex-1");
    expect(HEADER).toContain("sm:w-64 sm:flex-none");
  });

  it("wraps the buttons under the input instead of squeezing it to a sliver", () => {
    // A team with a picture also carries a Remove button beside the avatar,
    // which left the input 43-73px wide at phone widths without this.
    expect(HEADER).toContain(
      '<div className="flex flex-wrap items-center gap-2">',
    );
    expect(HEADER).toContain("min-w-0 flex-1 basis-32");
  });

  it("keeps the icon buttons at the 44px phone target", () => {
    expect(HEADER).toContain("h-11 w-11 sm:h-9 sm:w-9");
  });
});

describe("the staff badge in the members list", () => {
  it("sits at the 11px floor on the control rung, not 9px on a bare rounded", () => {
    expect(MEMBERS).not.toContain("text-[9px]");
    expect(MEMBERS).toMatch(
      /inline-flex items-center px-1\.5 py-0\.5 rounded-md text-\[11px\] font-semibold uppercase/,
    );
  });
});

describe("the invitations heading", () => {
  it("is the panel tier: text-base, tracking-tight, text-foreground", () => {
    expect(INVITATIONS).toContain(
      '<h2 className="text-base font-semibold tracking-tight text-foreground">',
    );
  });
});
