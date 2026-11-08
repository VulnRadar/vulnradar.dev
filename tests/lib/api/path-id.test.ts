import { describe, expect, it } from "vitest";

import { isPublicScanId, parseIdParam } from "@/lib/api/path-id";

describe("parseIdParam", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["2147483647", 2147483647],
  ])("reads %s", (raw, id) => {
    expect(parseIdParam(raw)).toBe(id);
  });

  it.each([
    ["the one past INT4", "2147483648"],
    ["ten digits past INT4", "9999999999"],
    ["eleven digits", "12345678901"],
    ["zero", "0"],
    ["a leading zero", "012"],
    ["a file suffix", "12.png"],
    ["trailing letters", "12abc"],
    ["an exponent", "1e3"],
    ["hex", "0x10"],
    ["a decimal", "1.5"],
    ["a negative", "-1"],
    ["a plus sign", "+1"],
    ["surrounding space", " 1"],
    ["a trailing newline", "1\n"],
    ["empty", ""],
    ["Arabic-Indic digits", "١٢"],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s", (_label, raw) => {
    expect(parseIdParam(raw)).toBeNull();
  });
});

describe("isPublicScanId", () => {
  const id = "0123456789abcdef0123456789abcdef";

  it("accepts 32 lowercase hex characters", () => {
    expect(isPublicScanId(id)).toBe(true);
  });

  it.each([
    ["uppercase hex", id.toUpperCase()],
    ["31 characters", id.slice(1)],
    ["33 characters", `${id}0`],
    ["a non-hex character", `g${id.slice(1)}`],
    ["a numeric id", "42"],
    ["a trailing newline", `${id}\n`],
    ["a UUID with dashes", "01234567-89ab-cdef-0123-456789abcdef"],
    ["empty", ""],
    ["a number", 42],
    ["null", null],
  ])("refuses %s", (_label, raw) => {
    expect(isPublicScanId(raw)).toBe(false);
  });
});
