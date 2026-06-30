import { describe, it, expect } from "vitest";
import { parseSegments } from "./think-parser";

describe("parseSegments", () => {
  it("returns a single text segment when there are no think tags", () => {
    expect(parseSegments("Hello world")).toEqual([
      { type: "text", content: "Hello world" },
    ]);
  });

  it("splits leading text, a think block, and trailing text", () => {
    expect(parseSegments("Hi<think>reasoning here</think>Answer")).toEqual([
      { type: "text", content: "Hi" },
      { type: "think", content: "reasoning here" },
      { type: "text", content: "Answer" },
    ]);
  });

  it("handles a think block at the start of content", () => {
    expect(parseSegments("<think>reasoning</think>Answer")).toEqual([
      { type: "think", content: "reasoning" },
      { type: "text", content: "Answer" },
    ]);
  });

  it("handles multiple think blocks", () => {
    const raw = "<think>thought 1</think>mid<think>thought 2</think>end";
    expect(parseSegments(raw)).toEqual([
      { type: "think", content: "thought 1" },
      { type: "text", content: "mid" },
      { type: "think", content: "thought 2" },
      { type: "text", content: "end" },
    ]);
  });

  it("matches case-insensitively (uppercase letters)", () => {
    expect(parseSegments("<THINK>reasoning</THINK>Answer")).toEqual([
      { type: "think", content: "reasoning" },
      { type: "text", content: "Answer" },
    ]);
  });

  it("preserves newlines inside think content", () => {
    expect(parseSegments("<think>line1\nline2</think>After")).toEqual([
      { type: "think", content: "line1\nline2" },
      { type: "text", content: "After" },
    ]);
  });

  it("skips empty think blocks and concatenates the surrounding text", () => {
    expect(parseSegments("Hi<think></think>There")).toEqual([
      { type: "text", content: "Hi" },
      { type: "text", content: "There" },
    ]);
  });

  it("trims whitespace inside think blocks", () => {
    expect(parseSegments("<think>  reasoning    </think>Answer")).toEqual([
      { type: "think", content: "reasoning" },
      { type: "text", content: "Answer" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseSegments("")).toEqual([]);
  });

  it("returns an empty array for whitespace-only input", () => {
    expect(parseSegments("   \n  ")).toEqual([]);
  });

  it("handles a think block with leading text and no trailing text", () => {
    expect(parseSegments("Hi<think>reasoning</think>")).toEqual([
      { type: "text", content: "Hi" },
      { type: "think", content: "reasoning" },
    ]);
  });

  it("handles only a think block (no surrounding text)", () => {
    expect(parseSegments("<think>only thinking</think>")).toEqual([
      { type: "think", content: "only thinking" },
    ]);
  });
});

describe("streaming edge cases", () => {
  it("hides partial opening tag during streaming", () => {
    expect(parseSegments("Hello world<think>partial reasoning")).toEqual([
      { type: "text", content: "Hello world" },
    ]);
  });

  it("hides everything inside an unclosed think tag", () => {
    expect(
      parseSegments("Before<think>hidden reasoning here<think>more"),
    ).toEqual([{ type: "text", content: "Before" }]);
  });

  it("hides text after an unclosed think tag", () => {
    expect(
      parseSegments("Before<think>hidden<think>more hidden text<think>extra"),
    ).toEqual([{ type: "text", content: "Before" }]);
  });

  it("preserves completed think blocks when followed by a new unclosed one", () => {
    expect(parseSegments("Done<think>done</think>Mid<think>partial")).toEqual([
      { type: "text", content: "Done" },
      { type: "think", content: "done" },
      { type: "text", content: "Mid" },
    ]);
  });

  it("emits no text when only a partial think tag is present", () => {
    expect(parseSegments("<think>partial")).toEqual([]);
  });
});
