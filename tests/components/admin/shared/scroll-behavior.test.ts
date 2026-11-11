import { describe, it, expect, afterEach, vi } from "vitest";
import { scrollBehavior } from "@/components/admin/shared/scroll-behavior";

/**
 * A literal `behavior: "smooth"` ignores prefers-reduced-motion, so a long
 * jump from the admin jump list animated for someone who turned animation off.
 */
describe("scrollBehavior", () => {
  afterEach(() => vi.unstubAllGlobals());

  const withReducedMotion = (reduce: boolean) =>
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        matches: reduce && query === "(prefers-reduced-motion: reduce)",
      }),
    });

  it("is instant under reduced motion", () => {
    withReducedMotion(true);
    expect(scrollBehavior()).toBe("auto");
  });

  it("is smooth otherwise", () => {
    withReducedMotion(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("is instant where there is no window to ask", () => {
    expect(scrollBehavior()).toBe("auto");
  });
});
