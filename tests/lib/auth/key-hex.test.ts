import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isKeyHex, parseKeyHex } from "@/lib/auth/key-hex";

const MESSAGE = "the key is wrong";

describe("parseKeyHex", () => {
  it("decodes 64 hex characters to exactly 32 bytes", () => {
    const key = randomBytes(32);
    const parsed = parseKeyHex(key.toString("hex"), MESSAGE);
    expect(parsed).toHaveLength(32);
    expect(parsed.equals(key)).toBe(true);
  });

  it("reads upper and mixed case the same as lowercase", () => {
    const lower = parseKeyHex("ab".repeat(32), MESSAGE);
    expect(parseKeyHex("AB".repeat(32), MESSAGE).equals(lower)).toBe(true);
    expect(parseKeyHex("aB".repeat(32), MESSAGE).equals(lower)).toBe(true);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["63 characters", "a".repeat(63)],
    ["65 characters", "a".repeat(65)],
    ["base64 of 48 random bytes", randomBytes(48).toString("base64")],
    ["63 hex characters and a g", `${"a".repeat(63)}g`],
    ["a non-hex first character", `g${"a".repeat(63)}`],
    ["64 hex characters and trailing junk", `${"a".repeat(64)}zz`],
    ["a trailing newline", `${"a".repeat(64)}\n`],
    ["a leading space", ` ${"a".repeat(63)}`],
    ["a 0x prefix", `0x${"a".repeat(62)}`],
  ])("throws the caller's message for %s", (_label, value) => {
    expect(() => parseKeyHex(value, MESSAGE)).toThrow(MESSAGE);
    expect(isKeyHex(value)).toBe(false);
  });
});

describe("isKeyHex", () => {
  it("accepts what parseKeyHex accepts", () => {
    expect(isKeyHex("ab".repeat(32))).toBe(true);
    expect(isKeyHex("AB".repeat(32))).toBe(true);
  });
});
