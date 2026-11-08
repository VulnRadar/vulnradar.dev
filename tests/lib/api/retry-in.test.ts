import { describe, expect, it } from "vitest";

import { TOO_MANY_ATTEMPTS, retryIn } from "@/lib/api/retry-in";

describe("retryIn", () => {
  it.each([
    [5, "under a minute"],
    [59, "under a minute"],
    [60, "a minute"],
    [61, "2 minutes"],
    [120, "2 minutes"],
    [3600, "60 minutes"],
  ])("%i seconds reads as %s", (seconds, words) => {
    expect(retryIn(seconds)).toBe(words);
  });

  it.each([0, -30, NaN, Infinity])("%s reads as under a minute", (seconds) => {
    expect(retryIn(seconds)).toBe("under a minute");
  });

  it("never prints a parenthesised plural", () => {
    for (const seconds of [1, 60, 61, 90, 3600, 86400]) {
      expect(retryIn(seconds)).not.toContain("(s)");
    }
  });
});

describe("TOO_MANY_ATTEMPTS", () => {
  it("is one sentence with the thing and the wait filled in", () => {
    expect(TOO_MANY_ATTEMPTS("login attempts", 120)).toBe(
      "Too many login attempts. Try again in 2 minutes.",
    );
    expect(TOO_MANY_ATTEMPTS("AI requests", 60)).toBe(
      "Too many AI requests. Try again in a minute.",
    );
    expect(TOO_MANY_ATTEMPTS("2FA attempts", 5)).toBe(
      "Too many 2FA attempts. Try again in under a minute.",
    );
  });
});
