import { describe, it, expect } from "vitest";
import { parseRowId } from "@/lib/teams/parse-id";

describe("parseRowId", () => {
  it.each([
    [1, 1],
    ["1", 1],
    ["007", 7],
    [2147483647, 2147483647],
    ["2147483647", 2147483647],
  ])("takes %j as %d", (input, expected) => {
    expect(parseRowId(input)).toBe(expected);
  });

  it.each([
    ["zero", 0],
    ["a negative number", -1],
    ["a fraction", 1.5],
    ["just past INTEGER", 2147483648],
    ["a string past INTEGER", "2147483648"],
    ["eleven digits", "12345678901"],
    ["a word", "abc"],
    ["scientific notation", "1e3"],
    ["a signed string", "+1"],
    ["a padded string", " 1"],
    ["the empty string", ""],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a boolean", true],
    ["null", null],
    ["undefined", undefined],
    ["an array", [1]],
    ["an object", { id: 1 }],
  ])("refuses %s", (_label, input) => {
    expect(parseRowId(input)).toBeNull();
  });
});
