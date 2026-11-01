import { describe, it, expect } from "vitest";
import { parsedFormOf } from "@/lib/scanner/canonical-url";

const BACKSLASH = "\\";

describe("parsedFormOf", () => {
  it.each([
    [
      `https://evil.com${BACKSLASH}@victim.com/`,
      "https://evil.com/@victim.com/",
    ],
    [`https://example.com${BACKSLASH}path`, "https://example.com/path"],
    ["https://vic\ttim.com/", "https://victim.com/"],
    ["https://example.com/a\r\nb", "https://example.com/ab"],
    // A non-special scheme keeps the backslash in the userinfo, encoded.
    [`ssh://victim.com${BACKSLASH}@evil.com/`, "ssh://victim.com%5C@evil.com/"],
  ])("rewrites %s to the address the parser fetches", (input, parsed) => {
    expect(parsedFormOf(input)).toBe(parsed);
    expect(parsedFormOf(input)).toBe(new URL(input).href);
  });

  it("returns a URL with nothing to rewrite exactly as given", () => {
    // Not even the trailing slash the parser would add: stored URLs keep the
    // spelling they were scanned with unless it was ambiguous.
    expect(parsedFormOf("https://Example.com")).toBe("https://Example.com");
    expect(parsedFormOf("https://example.com/a?b=c#d")).toBe(
      "https://example.com/a?b=c#d",
    );
  });

  it("returns a string the parser refuses unchanged, for validation to reject", () => {
    const refused = `https://exa\u0001mple.com${BACKSLASH}x`;
    expect(parsedFormOf(refused)).toBe(refused);
  });
});
