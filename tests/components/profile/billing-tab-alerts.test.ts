import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The billing tab drew its limit and cancellation notices as six hand-built
 * boxes: `flex items-center` around an icon and a paragraph. The AI, GitHub
 * review and live-browser notices run to two or three lines, and items-center
 * centres the icon against the whole paragraph instead of its first line, which
 * is what <InlineAlert> (through LeadingIcon) exists to get right. Four of the
 * six icons also had no aria-hidden.
 */

const ROOT = path.resolve(__dirname, "../../..");
const src = readFileSync(
  path.join(ROOT, "components/profile/tabs/profile-billing-tab.tsx"),
  "utf8",
);

/** Compare through a normaliser so a reflow by prettier cannot hide a match. */
const flat = src.replace(/\s+/g, " ");

describe("ProfileBillingTab alerts", () => {
  it("imports the shared InlineAlert", () => {
    expect(src).toContain(
      'import { InlineAlert } from "@/components/shared/inline-alert";',
    );
  });

  it("no longer hand-builds a destructive or warning notice", () => {
    // The two tints the hand-built boxes wore. A bordered tile that is NOT an
    // alert (the recommended-plan card, the selected-option highlight) uses
    // other combinations and is not matched.
    expect(flat).not.toMatch(
      /rounded-lg bg-destructive\/10 border border-destructive\/20/,
    );
    expect(flat).not.toMatch(
      /rounded-lg bg-\[hsl\(var\(--warning\)\)\]\/10 border border-\[hsl\(var\(--warning\)\)\]\/25/,
    );
  });

  it.each([
    ["cancel at period end", "warning", "Your subscription will end on"],
    ["daily scan limit", "error", "Daily scan limit reached."],
    ["running low on scans", "warning", "Running low on scans."],
    ["AI verification limit", "error", "AI verification limit reached"],
    ["AI review limit", "error", "AI review limit reached"],
    ["live-browser limit", "error", "Live-browser minute limit reached"],
  ])("%s is an InlineAlert (%s)", (_name, tone, text) => {
    const pattern = new RegExp(
      `<InlineAlert tone="${tone}"[^>]*> ${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    );
    expect(flat).toMatch(pattern);
  });
});
