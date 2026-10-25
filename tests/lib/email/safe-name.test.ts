import { describe, it, expect } from "vitest";
import { isSafeDisplayName, safeDisplayName } from "@/lib/email/safe-name";

/**
 * Names are typed by whoever fills in a form, and some of them are printed in
 * mail to an address nobody has verified (the contact form is no longer one of
 * them, but signup verification and team invites are). A name that carries a
 * link is delivered from our domain as spam.
 */
describe("isSafeDisplayName", () => {
  it.each([
    "Ada Lovelace",
    "Priya",
    "Zoë O'Brien-Smith",
    "山田 太郎",
    "Payments Platform",
    "Team 2024",
    "J. R. R. Tolkien",
  ])("accepts %s", (name) => {
    expect(isSafeDisplayName(name)).toBe(true);
  });

  it.each([
    ["a link", "Claim your payout at example.tld/x"],
    ["a scheme", "https://evil.test"],
    ["a scheme with no slashes", "see http:evil"],
    ["a www host", "www.example.com"],
    ["a bare hostname", "bit.ly"],
    ["a hostname inside a sentence", "Visit claim-prize.top now"],
    ["an address", "ada@example.com"],
    ["an at sign alone", "me@"],
    ["a long run of digits", "Agent 5551234567"],
    ["a five-digit run", "Call 90210"],
    ["a phone number with separators", "Call 1-800-555-0199"],
    ["a control character", "Ada\nBcc: eve@example.org"],
    ["nothing", ""],
    ["only whitespace", "   "],
  ])("refuses a name carrying %s", (_label, name) => {
    expect(isSafeDisplayName(name)).toBe(false);
  });

  it("refuses anything that is not a string", () => {
    expect(isSafeDisplayName(null)).toBe(false);
    expect(isSafeDisplayName(undefined)).toBe(false);
  });

  it("refuses a name too long to be one, without scanning it", () => {
    expect(isSafeDisplayName("a".repeat(256))).toBe(false);
    expect(isSafeDisplayName("a".repeat(255))).toBe(true);
  });

  it("stays fast on a long run that almost looks like a hostname", () => {
    const started = performance.now();
    isSafeDisplayName("a-".repeat(127));
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("safeDisplayName", () => {
  it("returns the trimmed name when it is safe", () => {
    expect(safeDisplayName("  Ada  ")).toBe("Ada");
  });

  it("returns the fallback, or nothing, when it is not", () => {
    expect(safeDisplayName("evil.test")).toBe("");
    expect(safeDisplayName("evil.test", "there")).toBe("there");
    expect(safeDisplayName(null, "there")).toBe("there");
  });
});
