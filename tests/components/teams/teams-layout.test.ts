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

describe("renaming from the header on a phone", () => {
  const headerBody = HEADER.slice(
    HEADER.indexOf("export function TeamDetailHeader"),
  );

  it("renders no Input in the header: the name is edited in a dialog", () => {
    // The row used to turn into an input and two buttons that had to be
    // squeezed onto the card at 360px; that whole layout problem went with it.
    expect(headerBody).not.toContain("<Input");
    expect(headerBody).not.toContain("<input");
    expect(headerBody).toContain("<RenameTeamDialog");
  });

  it("opens the one rename dialog the admin Teams tab also uses", () => {
    expect(HEADER).toContain('from "./rename-team-dialog"');
    expect(HEADER).not.toContain("function RenameTeamDialog");
  });

  it("keeps the Rename team trigger at the 44px phone target", () => {
    expect(headerBody).toContain('aria-label="Rename team"');
    expect(headerBody).toContain("h-11 w-11");
    expect(headerBody).toContain("sm:h-auto sm:w-auto sm:p-1.5");
  });

  it("keeps the Team actions button at the 44px phone target", () => {
    expect(headerBody).toContain("h-11 w-11 sm:h-9 sm:w-9");
  });
});

describe("the invite link card on a phone", () => {
  it("keeps its dismiss control at the 44px phone target", () => {
    const invite = read("components/teams/team-invite-form.tsx");
    expect(invite).toContain("h-11 w-11");
    expect(invite).toContain("sm:h-9 sm:w-9");
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
