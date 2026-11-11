import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * AdminPanelHeader's `hint` slot. The header has two layout contracts that
 * tests/components/shared/mobile-layout-invariants.test.ts pins (the title is
 * the h2's own text child with no truncate, and the row stacks below sm); this
 * pins the third thing a hint needs, which is to sit beside the heading and
 * not inside it, so the button is never part of the heading's text.
 */

const ROOT = path.resolve(__dirname, "../../..");
const src = fs
  .readFileSync(
    path.join(ROOT, "components/admin/shared/panel-header.tsx"),
    "utf8",
  )
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("AdminPanelHeader hint", () => {
  it("accepts an optional ReactNode hint", () => {
    expect(src).toMatch(/\bhint,\n/);
    expect(src).toMatch(/hint\?: ReactNode;/);
  });

  it("renders the hint after the h2 and before the status", () => {
    const h2End = src.indexOf("</h2>");
    const hintAt = src.indexOf("{hint}");
    const statusAt = src.indexOf("{status}");
    expect(h2End).toBeGreaterThan(-1);
    expect(hintAt).toBeGreaterThan(h2End);
    expect(statusAt).toBeGreaterThan(hintAt);
  });

  it("keeps the hint out of the h2 so it is not part of the heading's text", () => {
    const h2 = src.slice(src.indexOf("<h2"), src.indexOf("</h2>"));
    expect(h2).not.toContain("{hint}");
  });

  it("keeps the title as the h2's own text child, untruncated", () => {
    const h2 = src.slice(src.indexOf("<h2"), src.indexOf("</h2>"));
    expect(h2).toContain("{title}");
    expect(h2).not.toContain("truncate");
  });

  it("keeps the row stacked below sm", () => {
    expect(src).toContain("sm:flex-row");
  });

  it("puts the hint in the same wrapping row as the title", () => {
    const row = src.slice(
      src.indexOf("flex flex-wrap items-center gap-2 min-w-0"),
      src.indexOf("{status}"),
    );
    expect(row).toContain("<h2");
    expect(row).toContain("{hint}");
  });
});
