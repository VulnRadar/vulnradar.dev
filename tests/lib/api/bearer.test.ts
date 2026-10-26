import { describe, it, expect } from "vitest";
import { parseBearer } from "@/lib/api/bearer";

const KEY = "vr_live_0123456789abcdef";

describe("parseBearer: accepted", () => {
  it.each([
    ["the canonical spelling", `Bearer ${KEY}`],
    ["a lowercase scheme", `bearer ${KEY}`],
    ["an uppercase scheme", `BEARER ${KEY}`],
    ["a mixed-case scheme", `bEaReR ${KEY}`],
    ["two spaces after the scheme", `Bearer  ${KEY}`],
    ["many spaces after the scheme", `Bearer      ${KEY}`],
  ])("returns the credentials for %s", (_label, header) => {
    expect(parseBearer(header)).toBe(KEY);
  });

  it("returns the credentials untouched, including characters a key can carry", () => {
    expect(parseBearer("Bearer a.b-c_d~e+f/g==")).toBe("a.b-c_d~e+f/g==");
  });
});

describe("parseBearer: rejected", () => {
  it.each([
    ["a missing header", null],
    ["an undefined header", undefined],
    ["an empty header", ""],
    ["another scheme", "Basic dXNlcjpwYXNz"],
    ["another scheme that starts with Bearer", `Bearerx ${KEY}`],
    ["no space between scheme and credentials", `Bearer${KEY}`],
    ["the scheme alone", "Bearer"],
    ["the scheme and one space", "Bearer "],
    ["the scheme and many spaces", "Bearer     "],
    ["a tab instead of a space", `Bearer\t${KEY}`],
    ["whitespace inside the credentials", "Bearer one two"],
    ["trailing whitespace", `Bearer ${KEY} `],
    ["leading whitespace", ` Bearer ${KEY}`],
    ["a newline smuggled after the key", `Bearer ${KEY}\nX-Evil: 1`],
    ["the key with no scheme", KEY],
  ])("returns null for %s", (_label, header) => {
    expect(parseBearer(header)).toBeNull();
  });
});
