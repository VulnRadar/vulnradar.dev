/**
 * The broadcast composer must not describe its default audience as unfiltered.
 *
 * Its default category read "No filter (everyone in segment)", and the server
 * did exactly that: no preference check, so the Unsubscribe link in one
 * broadcast did not stop the next. The server now gates every audience but a
 * single named address on Product Updates, and the composer has to say so,
 * or an admin picks the default believing it reaches people who opted out.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MassEmailManager,
  audienceFilterNote,
} from "@/components/admin/features/mass-email-manager";

describe("audienceFilterNote", () => {
  it("names Product Updates for a segment sent with no category", () => {
    for (const segment of ["all", "premium", "free"]) {
      expect(audienceFilterNote(segment, "none")).toBe(
        "Only users who have not turned off Product Updates.",
      );
    }
  });

  it("names the chosen category when there is one", () => {
    expect(audienceFilterNote("all", "email_tips_guides")).toBe(
      "Only users opted into Tips & Guides.",
    );
    expect(audienceFilterNote("specific", "email_tips_guides")).toBe(
      "Only users opted into Tips & Guides.",
    );
  });

  it("says a single address is sent regardless of preferences, but not to a disabled account", () => {
    const note = audienceFilterNote("specific", "none");
    expect(note).toMatch(/whatever this address's email preferences are/);
    expect(note).toMatch(/disabled account is still skipped/);
  });
});

describe("MassEmailManager composer", () => {
  const html = renderToStaticMarkup(<MassEmailManager />);

  it("no longer offers a category that reads as everyone in the segment", () => {
    expect(html).not.toMatch(/everyone in segment/i);
    expect(html).not.toMatch(/No filter/);
    expect(html).toContain(
      '<option value="none" selected="">General announcement (Product Updates opt-ins)</option>',
    );
  });

  it("states the preference gate under the default All Users audience", () => {
    expect(html).toContain("Every verified, active account, free and paid.");
    expect(html).toContain(
      "Only users who have not turned off Product Updates.",
    );
  });
});
