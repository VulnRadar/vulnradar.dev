import { describe, it, expect } from "vitest";
import { compareSemver, parseSemver } from "@/lib/updater/semver";

describe("parseSemver", () => {
  it("splits a release into its numeric core", () => {
    expect(parseSemver("4.0.1")).toEqual({ core: [4, 0, 1], pre: null });
  });

  it("splits a prerelease into dot-separated identifiers", () => {
    expect(parseSemver("4.0.0-rc.1")).toEqual({
      core: [4, 0, 0],
      pre: ["rc", "1"],
    });
  });

  it("ignores a leading v, surrounding space and build metadata", () => {
    expect(parseSemver(" v1.2.3+build.5 ")).toEqual({
      core: [1, 2, 3],
      pre: null,
    });
    expect(parseSemver("V1.2.3-beta+exp.sha.5114f85")).toEqual({
      core: [1, 2, 3],
      pre: ["beta"],
    });
  });

  it("reads a part that is not a number as 0 instead of throwing", () => {
    expect(parseSemver("1.x.3").core).toEqual([1, 0, 3]);
    expect(parseSemver("abc").core).toEqual([0]);
    expect(parseSemver("").core).toEqual([0]);
  });

  it("treats a dangling hyphen as no prerelease", () => {
    expect(parseSemver("1.0.0-")).toEqual({ core: [1, 0, 0], pre: null });
  });

  it("keeps a core of any length", () => {
    expect(parseSemver("1.2.3.4").core).toEqual([1, 2, 3, 4]);
    expect(parseSemver("3").core).toEqual([3]);
  });
});

describe("compareSemver", () => {
  // [a, b, expected compareSemver(a, b)]
  const cases: [string, string, -1 | 0 | 1][] = [
    // Equal, however it is written.
    ["1.2.3", "1.2.3", 0],
    ["1.2", "1.2.0", 0],
    ["3", "3.0.0", 0],
    ["v1.2.3", "1.2.3", 0],
    [" 1.2.3 ", "1.2.3", 0],
    ["1.2.3+a", "1.2.3+b", 0],
    ["1.2.3+build.5", "1.2.3", 0],
    ["4.0.0-rc.1", "4.0.0-rc.1", 0],
    ["1.0.0-", "1.0.0", 0],

    // The numeric core is compared as numbers, left to right.
    ["1.9.0", "1.12.0", -1],
    ["1.10.0", "1.9.0", 1],
    ["2.0.0", "1.99.99", 1],
    ["4.17", "4.17.21", -1],
    ["1.2.3.4", "1.2.3", 1],
    ["1.2.3", "1.2.3.1", -1],

    // A prerelease sorts below the release it leads up to.
    ["4.0.0-rc.1", "4.0.0", -1],
    ["4.0.0", "4.0.0-rc.1", 1],
    ["1.2.3-beta.1", "1.2.3", -1],
    // ...but the core still decides first.
    ["4.0.1-rc.1", "4.0.0", 1],
    ["3.9.9", "4.0.0-rc.1", -1],

    // Prerelease identifiers: numbers numerically, below words, words as text.
    ["4.0.0-rc.1", "4.0.0-rc.2", -1],
    ["2.0.0-rc.10", "2.0.0-rc.9", 1],
    ["1.0.0-1", "1.0.0-alpha", -1],
    ["1.0.0-alpha", "1.0.0-beta", -1],
    ["1.0.0-alpha.1", "1.0.0-alpha.beta", -1],
    // A list sorts below a longer list that starts the same.
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-alpha.1", "1.0.0-alpha", 1],

    // Malformed input reads as 0 rather than throwing.
    ["abc", "0.0.0", 0],
    ["", "0", 0],
    ["1.x.3", "1.1.3", -1],
  ];

  it.each(cases)("compareSemver(%j, %j) is %i", (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected);
  });

  it.each(cases)("is antisymmetric for (%j, %j)", (a, b, expected) => {
    expect(compareSemver(b, a)).toBe(expected === 0 ? 0 : -expected);
  });

  it("orders the precedence example from semver.org section 11", () => {
    const ascending = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 0; i < ascending.length; i++) {
      for (let j = 0; j < ascending.length; j++) {
        const expected = i === j ? 0 : i < j ? -1 : 1;
        expect(compareSemver(ascending[i], ascending[j])).toBe(expected);
      }
    }
  });

  it("is the order the 4.0.0 release train needs", () => {
    expect(compareSemver("3.9.1", "4.0.0-rc.1")).toBe(-1);
    expect(compareSemver("4.0.0-rc.1", "4.0.0-rc.2")).toBe(-1);
    expect(compareSemver("4.0.0-rc.2", "4.0.0")).toBe(-1);
    expect(compareSemver("4.0.0", "4.0.1")).toBe(-1);
  });
});
