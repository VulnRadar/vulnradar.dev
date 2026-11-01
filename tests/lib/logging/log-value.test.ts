import { describe, it, expect } from "vitest";
import {
  logSafeError,
  logValue,
  LOG_VALUE_MAX_CHARS,
} from "@/lib/logging/log-value";

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

describe("logSafeError", () => {
  const forged =
    "Unexpected token '<', \"<html>\n[AI] Admin password reset approved\" is not valid JSON";

  it("escapes the message an outside party wrote and keeps the server's frames", () => {
    const err = new SyntaxError(forged);
    const safe = logSafeError(err, 300) as Error;
    expect(safe).toBeInstanceOf(Error);
    expect(safe.name).toBe("SyntaxError");
    expect(safe.message).not.toMatch(/[\r\n]/);
    expect(safe.message).toContain("\\n[AI] Admin password reset approved");
    const lines = (safe.stack as string).split("\n");
    expect(lines[0]).toBe(`SyntaxError: ${safe.message}`);
    expect(lines.slice(1).length).toBeGreaterThan(0);
    for (const line of lines.slice(1)) expect(line).toMatch(/^\s+at /);
    expect(lines.some((l) => l.startsWith("[AI]"))).toBe(false);
  });

  it("bounds the message like logValue does", () => {
    const safe = logSafeError(new Error("y".repeat(1000)), 50) as Error;
    expect(safe.message).toBe(`${"y".repeat(50)}... [1000 chars]`);
  });

  it("escapes a name the thrower set", () => {
    const err = new Error("boom");
    err.name = "Bad\nName";
    const safe = logSafeError(err) as Error;
    expect(safe.name).toBe("Bad\\nName");
    expect(safe.stack).not.toMatch(/Bad\nName/);
  });

  it("keeps an error with an empty message", () => {
    const safe = logSafeError(new Error("")) as Error;
    expect(safe.message).toBe("");
    expect((safe.stack as string).split("\n")[0]).toBe("Error: ");
    expect((safe.stack as string).split("\n").length).toBeGreaterThan(1);
  });

  it("leaves out frames it cannot separate from the message", () => {
    const err = new Error("boom");
    err.stack = "something else\n[AI] forged";
    const safe = logSafeError(err) as Error;
    expect(safe.stack).toBe("Error: boom");
  });

  it("returns a value that is not an Error as its logValue string", () => {
    expect(logSafeError("a\nb")).toBe("a\\nb");
    expect(logSafeError(429)).toBe("429");
  });
});
