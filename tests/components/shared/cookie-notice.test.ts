import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isCoveredByModal } from "@/components/shared/cookie-notice";

/**
 * The cookie bar is z-60, above the z-50 scrim, and mounted beside the page in
 * the root layout, so an open modal treats it as page content behind the
 * dialog. Radix marks it aria-hidden; our own shells add inert. Its buttons die
 * either way, and the bar stayed painted on top of the scrim looking
 * clickable. It now hides itself while either attribute is on it.
 *
 * Making the bar pass the modal's hiding through was the other option. It works
 * for the hand-rolled shells (OVERLAY_PASSTHROUGH) and cannot work for Radix:
 * the body goes pointer-events:none, focus is trapped in the dialog, and a
 * click on the bar would count as a click outside and close the dialog.
 */

const ROOT = path.resolve(__dirname, "../../..");
const src = readFileSync(
  path.join(ROOT, "components/shared/cookie-notice.tsx"),
  "utf8",
);

function fakeEl(attrs: Record<string, string>) {
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => name in attrs,
  };
}

describe("isCoveredByModal", () => {
  it("is false for a bar nothing has touched", () => {
    expect(isCoveredByModal(fakeEl({}))).toBe(false);
  });

  it("is true when Radix has marked the bar aria-hidden", () => {
    expect(isCoveredByModal(fakeEl({ "aria-hidden": "true" }))).toBe(true);
  });

  it("is true when a modal shell has made the bar inert", () => {
    expect(isCoveredByModal(fakeEl({ inert: "" }))).toBe(true);
  });

  it("does not treat aria-hidden=false as covered", () => {
    expect(isCoveredByModal(fakeEl({ "aria-hidden": "false" }))).toBe(false);
  });
});

describe("the bar's wiring", () => {
  it("watches its own aria-hidden and inert attributes, nothing wider", () => {
    expect(src).toContain("new MutationObserver");
    expect(src).toMatch(/attributeFilter:\s*\["aria-hidden",\s*"inert"\]/);
  });

  it("stays mounted and keeps its box while covered", () => {
    // `invisible` keeps layout, so --vr-cookie-h is still published and the
    // modal layer's bottom padding does not move as the dialog opens.
    expect(src).toMatch(/covered && "invisible"/);
    expect(src).not.toMatch(/covered && "hidden"/);
    expect(src).not.toMatch(/if \(covered\) return null/);
  });
});
