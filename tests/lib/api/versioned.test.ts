import { describe, expect, it } from "vitest";
import { versioned } from "@/lib/api/versioned";
import { versioned as wrapped } from "@/lib/api/v4/wrap";

describe("lib/api/versioned", () => {
  it("is the wrapper itself, not a copy of it", () => {
    expect(versioned).toBe(wrapped);
  });
});
