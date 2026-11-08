import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { CHECKOUT_CONFIRM_BACKOFF_MS } from "@/components/billing/checkout-confirm";

/**
 * The ladder is one array because "how long do we wait before telling someone
 * their payment is pending" must have one answer across every checkout.
 */
describe("CHECKOUT_CONFIRM_BACKOFF_MS", () => {
  it("waits 8 seconds in total across six attempts", () => {
    const attempts = CHECKOUT_CONFIRM_BACKOFF_MS.length + 1;
    const waited = CHECKOUT_CONFIRM_BACKOFF_MS.reduce((a, b) => a + b, 0);
    expect(attempts).toBe(6);
    expect(waited).toBe(8_000);
  });

  it("only ever backs off", () => {
    CHECKOUT_CONFIRM_BACKOFF_MS.slice(1).forEach((delay, i) => {
      expect(delay).toBeGreaterThan(CHECKOUT_CONFIRM_BACKOFF_MS[i]);
    });
  });

  it.each(["stripe-checkout.tsx", "credit-checkout.tsx"])(
    "is the ladder %s walks, with no local copy",
    (file) => {
      const source = readFileSync(
        path.join(process.cwd(), "components/billing", file),
        "utf8",
      );
      expect(source).toContain("const delays = CHECKOUT_CONFIRM_BACKOFF_MS;");
      expect(source).not.toMatch(/\[\s*500,\s*1000/);
    },
  );
});
