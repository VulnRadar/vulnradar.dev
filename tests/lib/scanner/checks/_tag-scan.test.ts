/**
 * Unit tests for the tag-scanning helpers the markup detectors were rewritten
 * onto. These used to sit at the bottom of _tag-scan-perf.test.ts, whose
 * execution-time half now lives in tests/lib/scanner/_perf-budget.test.ts with
 * the rest of the budget suite; the correctness half is here.
 *
 * The helpers exist for two reasons at once. Matching the tag first and then
 * testing attributes against that tag's own text is what removed the quadratic
 * `<tag[^>]{0,2000}ATTR[^>]{0,2000}>` shape, and it is also what stopped one
 * tag's name pairing with a later tag's attribute.
 */
import { describe, it, expect } from "vitest";
import {
  hasTagWith,
  openTags,
  openingTagOf,
  tagElements,
  tagsWith,
} from "@/lib/scanner/checks/_tag-scan";

describe("_tag-scan helpers", () => {
  const page = `
    <form id="a" method="POST"><input type="password" name="p"></form>
    <form id="b"><input type="text"></form>
  `;

  it("openTags returns each opening tag, case-insensitively", () => {
    expect(openTags(page, "form")).toHaveLength(2);
    expect(openTags("<FORM ID=1>", "form")).toEqual(["<FORM ID=1>"]);
  });

  it("does not match a longer tag name that merely starts the same", () => {
    expect(openTags("<formfield x>", "form")).toEqual([]);
  });

  it("tagsWith requires every attribute pattern on the SAME tag", () => {
    // The bug the whole helper exists to remove: the old single-regex form
    // could pair one tag's name with a later tag's attribute.
    expect(tagsWith(page, "form", /method="POST"/i, /id="b"/i)).toHaveLength(0);
    expect(tagsWith(page, "form", /method="POST"/i)).toHaveLength(1);
  });

  it("tagsWith is not confused by a caller's global regex", () => {
    const g = /id=/gi;
    expect(tagsWith(page, "form", g)).toHaveLength(2);
    expect(tagsWith(page, "form", g)).toHaveLength(2);
  });

  it("hasTagWith answers the boolean form", () => {
    expect(hasTagWith(page, "input", /type="password"/i)).toBe(true);
    expect(hasTagWith(page, "input", /type="email"/i)).toBe(false);
  });

  it("tagElements pairs each opening tag with its own closing tag", () => {
    const els = tagElements(page, "form");
    expect(els).toHaveLength(2);
    expect(els[0]).toContain('type="password"');
    expect(els[1]).not.toContain('type="password"');
    expect(openingTagOf(els[0])).toBe('<form id="a" method="POST">');
  });

  it("tagElements stops when an opening tag has no closing tag after it", () => {
    expect(tagElements("<form><b></form><form>", "form")).toHaveLength(1);
  });

  it("returns nothing for an empty body", () => {
    expect(openTags("", "form")).toEqual([]);
    expect(tagElements("", "form")).toEqual([]);
  });
});
