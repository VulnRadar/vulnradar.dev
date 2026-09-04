/**
 * Tests for lib/scanner/evidence-excerpts.ts.
 *
 * These values are verbatim fragments of a scanned third party's response, so
 * this suite is mostly about what must NOT survive normalization: markup that
 * could be interpreted rather than shown, and invisible characters that let a
 * string lie about what it says. The rest is shape-tolerance, because the
 * input arrives as JSON from an API response and its type is a claim.
 */
import { describe, it, expect } from "vitest";
import {
  toDisplayExcerpts,
  sanitizeExcerptValue,
  truncateExcerpt,
  formatExcerptLine,
  MAX_EXCERPTS,
} from "@/lib/scanner/evidence-excerpts";

describe("sanitizeExcerptValue", () => {
  it("keeps markup as literal text rather than stripping or rewriting it", () => {
    // The point of an evidence excerpt is that it is exactly what was seen.
    // Escaping is the renderer's job (React text child, Markdown fence, JSON
    // string); mangling the value here would make the proof unverifiable.
    const raw = '<img src=x onerror="alert(1)">';
    expect(sanitizeExcerptValue(raw)).toBe(raw);
  });

  it("collapses newlines and tabs into single spaces", () => {
    expect(sanitizeExcerptValue("a\n\n\tb   c")).toBe("a b c");
  });

  it("replaces a NUL and an ESC with a visible replacement character", () => {
    // Written as escapes on purpose: a literal NUL byte in a source file
    // makes git treat the whole file as binary.
    expect(sanitizeExcerptValue("a\u0000b\u001bc")).toBe("a�b�c");
  });

  it("replaces a bidi override, which reorders what a human reads", () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE survives HTML escaping intact and flips
    // the display order of everything after it. Evidence whose whole job is
    // "here is what we saw" must not be able to render as something else.
    expect(sanitizeExcerptValue("safe\u202eevil")).toBe("safe�evil");
  });

  it("replaces a zero-width space, which hides in the value invisibly", () => {
    expect(sanitizeExcerptValue("ab\u200bcd")).toBe("ab�cd");
  });

  it("caps a runaway value", () => {
    expect(sanitizeExcerptValue("x".repeat(5000))).toHaveLength(400);
  });
});

describe("toDisplayExcerpts", () => {
  it("normalizes a well-formed list", () => {
    expect(
      toDisplayExcerpts([
        { label: "Set-Cookie", value: "sid=abc; Path=/", line: 12 },
      ]),
    ).toEqual([{ label: "Set-Cookie", value: "sid=abc; Path=/", line: 12 }]);
  });

  it("returns an empty list for anything that is not an array", () => {
    // The findings array is JSON off the wire, so "it is an array of objects"
    // is a claim. A .map over a string is how one malformed stored row takes
    // the whole result page down.
    for (const bad of [undefined, null, "excerpts", 7, {}]) {
      expect(toDisplayExcerpts(bad)).toEqual([]);
    }
  });

  it("drops entries with no usable value and keeps the rest", () => {
    expect(
      toDisplayExcerpts([
        { label: "a", value: "" },
        { label: "b", value: "   " },
        { label: "c", value: 42 },
        null,
        "nope",
        { label: "d", value: "kept" },
      ]),
    ).toEqual([{ label: "d", value: "kept" }]);
  });

  it("names an unlabelled excerpt rather than rendering 'undefined'", () => {
    expect(toDisplayExcerpts([{ value: "x" }])).toEqual([
      { label: "evidence", value: "x" },
    ]);
  });

  it("sanitizes the label too, since a check could pass anything", () => {
    expect(
      toDisplayExcerpts([{ label: "a\u202eb", value: "x" }])[0].label,
    ).toBe("a�b");
  });

  it("keeps only line numbers that are really line numbers", () => {
    const out = toDisplayExcerpts([
      { label: "a", value: "1", line: 3 },
      { label: "b", value: "2", line: 0 },
      { label: "c", value: "3", line: -4 },
      { label: "d", value: "4", line: "12" },
      { label: "e", value: "5", line: Number.NaN },
      { label: "f", value: "6", line: 7.9 },
    ]);
    expect(out.map((e) => e.line)).toEqual([
      3,
      undefined,
      undefined,
      undefined,
      undefined,
      7,
    ]);
  });

  it("caps how many excerpts one finding can contribute", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      label: "l",
      value: `v${i}`,
    }));
    expect(toDisplayExcerpts(many)).toHaveLength(MAX_EXCERPTS);
  });
});

describe("truncateExcerpt", () => {
  it("leaves a short value alone", () => {
    expect(truncateExcerpt("short")).toEqual({
      preview: "short",
      truncated: false,
    });
  });

  it("reports the cut so the UI can offer the whole value", () => {
    const { preview, truncated } = truncateExcerpt("x".repeat(300), 10);
    expect(preview).toHaveLength(10);
    expect(truncated).toBe(true);
  });
});

describe("formatExcerptLine", () => {
  it("names the line number when there is one", () => {
    expect(
      formatExcerptLine({ label: "script src", value: "/a.js", line: 4 }),
    ).toBe("script src (line 4): /a.js");
  });

  it("omits the parenthetical when there is not", () => {
    expect(formatExcerptLine({ label: "CSP", value: "'unsafe-inline'" })).toBe(
      "CSP: 'unsafe-inline'",
    );
  });
});
