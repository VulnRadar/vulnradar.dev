import { describe, it, expect } from "vitest";
import { cn, getStaggerDelay } from "@/lib/ui/animations";

/**
 * Most of lib/ui/animations.ts (durations, easings, transitions, hovers,
 * focus, animations, interactive, backdrops, effects, stagger) is static
 * Tailwind class-string configuration with no branching or computation -
 * testing those would just assert string literals back at themselves, so
 * they're skipped as hollow. cn() and getStaggerDelay() are the only two
 * exports with actual logic, and are covered below.
 *
 * Note: this file also exports a `cn` helper, distinct from the
 * clsx + tailwind-merge `cn` in lib/ui/utils.ts referenced by
 * CLAUDE.md's import conventions. This one is a plain
 * `.filter(Boolean).join(" ")`, with no class-conflict resolution.
 */

describe("cn", () => {
  it("joins truthy class strings with a space", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("filters out false and undefined", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });

  it("returns an empty string when given nothing truthy", () => {
    expect(cn(false, undefined)).toBe("");
    expect(cn()).toBe("");
  });

  it("filters out an empty-string class the same as other falsy input", () => {
    expect(cn("a", "", "b")).toBe("a b");
  });
});

describe("getStaggerDelay", () => {
  it("multiplies index by the default 50ms base delay", () => {
    expect(getStaggerDelay(0)).toBe("[animation-delay:0ms]");
    expect(getStaggerDelay(1)).toBe("[animation-delay:50ms]");
    expect(getStaggerDelay(3)).toBe("[animation-delay:150ms]");
  });

  it("honors a custom base delay", () => {
    expect(getStaggerDelay(2, 100)).toBe("[animation-delay:200ms]");
    expect(getStaggerDelay(0, 100)).toBe("[animation-delay:0ms]");
  });
});
