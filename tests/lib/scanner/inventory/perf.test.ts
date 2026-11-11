import { describe, expect, it } from "vitest";
import { detect } from "@/lib/scanner/inventory/engine";
import {
  buildInventoryInput,
  MAX_BODY_CHARS,
} from "@/lib/scanner/inventory/input";
import type { Fingerprint } from "@/lib/scanner/inventory/types";
import {
  adversarialSubjects,
  assertLinear,
  literalPrefix,
  SHAPES,
  SUBJECT_CHARS,
} from "./_assert-linear";

// The registry test in the wiring work imports this from here.
export { assertLinear } from "./_assert-linear";

/**
 * The engine reads a body of up to 1 MiB that the scanned site controls, in
 * the process that serves every other scan. The history is in
 * tests/lib/scanner/inventory-perf.test.ts: 36, 54 and 88 seconds at 32 KB
 * before the tag scanner. This file holds the new pipeline to the same bar and
 * exports the per-regex gate that every table entry has to pass.
 */

const CEILING_MS = 2_000;

// One of each rule kind, with the pattern shapes the real tables use.
const TABLE: Fingerprint[] = [
  {
    name: "Livewire",
    category: "framework",
    implies: [{ name: "Laravel", category: "framework" }],
    rules: [
      {
        in: "asset",
        match: /\/livewire(?:-[0-9a-f]{8})?\/livewire(?:\.min)?\.js/i,
        weight: 98,
        provenance: "fixture",
      },
      { in: "attr", name: /^wire:/, weight: 90, provenance: "wappalyzer" },
      {
        in: "html",
        match: /Powered by[^<]{0,40}Livewire/i,
        weight: 90,
        provenance: "vendor-docs",
      },
    ],
  },
  {
    name: "Laravel",
    category: "framework",
    implies: [{ name: "PHP", category: "language" }],
    rules: [
      {
        in: "cookie",
        name: /[-_]session$/,
        valueMatch: /^eyJpdiI6/,
        weight: 95,
        provenance: "fixture",
      },
      {
        in: "attr",
        tag: "input",
        name: "name",
        match: /^_token$/,
        weight: 30,
        provenance: "fixture",
      },
    ],
  },
  {
    name: "WordPress",
    category: "cms",
    rules: [
      {
        in: "meta",
        name: "generator",
        match: /^WordPress(?:\s+(\d+\.\d+(?:\.\d+)?))?/i,
        version: { group: 1, minComponents: 2 },
        weight: 99,
        provenance: "fixture",
      },
      {
        in: "header",
        name: "link",
        match: /rel="https:\/\/api\.w\.org\/"/i,
        weight: 97,
        provenance: "fixture",
      },
      {
        in: "title",
        match: /\| phpMyAdmin ([\d.]+)/,
        version: { group: 1 },
        weight: 98,
        provenance: "wappalyzer",
      },
      {
        in: "comment",
        match: /<!-- cPanel/i,
        weight: 90,
        provenance: "wappalyzer",
      },
    ],
  },
];

const HEADERS = new Headers({ "content-type": "text/html" });

function pipeline(body: string): void {
  detect(buildInventoryInput(HEADERS, body, "https://example.test/"), TABLE);
}

function fill(unit: string): string {
  return unit
    .repeat(Math.ceil(MAX_BODY_CHARS / unit.length))
    .slice(0, MAX_BODY_CHARS);
}

describe("the inventory pipeline stays linear on a 1 MiB body", () => {
  for (const [shape, unit] of Object.entries(SHAPES)) {
    it(`is not slowed by: ${shape}`, () => {
      const body = fill(unit);
      const started = Date.now();
      pipeline(body);
      const elapsed = Date.now() - started;
      expect(
        elapsed,
        `buildInventoryInput + detect took ${elapsed}ms on ${shape}: a page can stall every scan on the server`,
      ).toBeLessThan(CEILING_MS);
    });
  }

  it("is not slowed by a body of attribute-heavy tags", () => {
    const body = fill(
      '<div wire:click="a" data-x="1" x-data="{}" name="_token">',
    );
    const started = Date.now();
    pipeline(body);
    expect(Date.now() - started).toBeLessThan(CEILING_MS);
  });

  it("is not slowed by two hundred headers and fifty cookies", () => {
    const headers = new Headers();
    for (let i = 0; i < 250; i++) headers.append(`x-h-${i}`, "v".repeat(500));
    for (let i = 0; i < 80; i++)
      headers.append("set-cookie", `c${i}=${"v".repeat(900)}; path=/`);
    const started = Date.now();
    detect(
      buildInventoryInput(headers, "<p>x</p>", "https://example.test/"),
      TABLE,
    );
    expect(Date.now() - started).toBeLessThan(CEILING_MS);
  });
});

describe("assertLinear", () => {
  it("passes a linear pattern", () => {
    expect(() =>
      assertLinear(/\/livewire(?:-[0-9a-f]{8})?\/livewire\.js/),
    ).not.toThrow();
    expect(() =>
      assertLinear(/^WordPress(?:\s+(\d+\.\d+(?:\.\d+)?))?/i),
    ).not.toThrow();
  });

  it("is not confused by a global flag", () => {
    expect(() => assertLinear(/marker/g)).not.toThrow();
  });

  it("fails a pattern that exceeds the ceiling, naming the shape", () => {
    // Every pattern takes longer than nothing on 256 KB, so a zero ceiling
    // exercises the failure path without running a genuinely slow pattern.
    expect(() => assertLinear(/<meta/, 0)).toThrow(/ceiling 0ms/);
    expect(() => assertLinear(/<meta/, 0)).toThrow(
      /unterminated|openAngleRun|attrSoup|longWord|dottedDigits|attributeRun|slashRun|ownPrefix/,
    );
  });

  it("rejects the bounded-tag pattern the research proposed for Livewire", () => {
    // <[^>]{1,512} costs up to 512 steps for every "<" in the document, a
    // constant 512x that measured 4.6 seconds on 1 MiB of "<". An attr rule
    // reads the same signal from the tag scanner in one pass instead.
    expect(() =>
      assertLinear(/<[^>]{1,512}\bwire:(?:click|model|submit)/i),
    ).toThrow(/took \d+ms/);
  });

  it("runs the seven shapes plus the extras and the pattern's own prefix at 256 KB", () => {
    const subjects = adversarialSubjects(/<a wire:click/);
    expect(Object.keys(subjects)).toEqual(
      expect.arrayContaining([...Object.keys(SHAPES), "ownPrefix"]),
    );
    for (const subject of Object.values(subjects)) {
      expect(subject.length).toBeLessThanOrEqual(SUBJECT_CHARS);
    }
    expect(subjects.ownPrefix.startsWith("<a wire:click<a wire:click")).toBe(
      true,
    );
  });
});

describe("literalPrefix", () => {
  it("takes the leading literal text", () => {
    expect(literalPrefix("<a wire:click")).toBe("<a wire:click");
    expect(literalPrefix("<a wire(?:click|model)")).toBe("<a wire");
  });

  it("reads an escaped punctuation character as itself", () => {
    expect(literalPrefix("\\/livewire(-x)?")).toBe("/livewire");
  });

  it("falls back when the pattern opens with an anchor or a class", () => {
    expect(literalPrefix("^authenticity_token$")).toBe("<a ");
    expect(literalPrefix("\\bwire:")).toBe("<a ");
  });
});
