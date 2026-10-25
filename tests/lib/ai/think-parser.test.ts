import { describe, it, expect } from "vitest";
import { visibleText } from "@/lib/ai/think-parser";

describe("visibleText", () => {
  it("returns plain text unchanged", () => {
    expect(visibleText("Hello world")).toBe("Hello world");
  });

  it("removes a leading think block", () => {
    expect(visibleText("<think>reasoning</think>Answer")).toBe("Answer");
  });

  it("removes blocks between and around text", () => {
    expect(
      visibleText("Hi <think>one</think>there<think>two</think> again"),
    ).toBe("Hi there again");
  });

  it("matches the tags case-insensitively", () => {
    expect(visibleText("<THINK>reasoning</THINK>Answer")).toBe("Answer");
  });

  it("removes multi-line reasoning", () => {
    expect(visibleText("<think>line1\nline2</think>\nAfter")).toBe("After");
  });

  it("drops everything after an unclosed block, which was never the answer", () => {
    expect(visibleText("Answer so far<think>still thinking")).toBe(
      "Answer so far",
    );
    expect(visibleText("<think>only thinking")).toBe("");
  });

  it("drops an unclosed block that follows a closed one", () => {
    expect(visibleText("<think>a</think>Answer<think>b")).toBe("Answer");
  });
});
