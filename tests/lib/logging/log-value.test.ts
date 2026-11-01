import { describe, it, expect } from "vitest";
import { logValue, LOG_VALUE_MAX_CHARS } from "@/lib/logging/log-value";

describe("logValue", () => {
  it("writes line breaks out as escapes, so a value cannot start a new log entry", () => {
    const out = logValue("a\r\nb\nc\rd\u2028e\u2029f\u0085g");
    expect(out).not.toMatch(/[\r\n\u2028\u2029\u0085]/);
    expect(out).toBe("a\\r\\nb\\nc\\rd\\u2028e\\u2029f\\u0085g");
  });

  it("escapes every other control and format character, terminal escapes and bidi overrides included", () => {
    const out = logValue("\u001b[31mred\u0000\u007f\u202eevil\u200b");
    expect(out).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(out).toBe("\\u001b[31mred\\u0000\\u007f\\u202eevil\\u200b");
  });

  it("leaves ordinary text, including non-Latin scripts and emoji, as it is", () => {
    expect(logValue("https://example.com/漢字?q=\u{1F600}")).toBe(
      "https://example.com/漢字?q=\u{1F600}",
    );
  });

  it("bounds the length and says the value was cut", () => {
    const out = logValue("x".repeat(10_000));
    expect(out.startsWith("x".repeat(LOG_VALUE_MAX_CHARS))).toBe(true);
    expect(out).toContain("[10000 chars]");
    expect(out.length).toBeLessThan(LOG_VALUE_MAX_CHARS + 40);
  });

  it("takes a smaller bound per call", () => {
    expect(logValue("abcdef", 3)).toBe("abc... [6 chars]");
  });

  it("stringifies a non-string value", () => {
    expect(logValue(429)).toBe("429");
    expect(logValue(undefined)).toBe("undefined");
    expect(logValue(new Error("boom\nforged"))).toBe("Error: boom\\nforged");
  });
});
