import { describe, it, expect, afterEach } from "vitest";
import { stripeKeyMode } from "@/lib/billing/stripe-mode";

/**
 * The mode goes into a log line and an admin alert next to a "subscription not
 * found" id, to tell a deleted subscription from a key aimed at the wrong
 * environment. Only the answer may leave the function, never the key.
 */
describe("stripeKeyMode", () => {
  const saved = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (saved === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = saved;
  });

  it("reads live and test off a standard secret key", () => {
    expect(stripeKeyMode("sk_live_abc123")).toBe("live");
    expect(stripeKeyMode("sk_test_abc123")).toBe("test");
  });

  it("reads them off a restricted key too", () => {
    expect(stripeKeyMode("rk_live_abc123")).toBe("live");
    expect(stripeKeyMode("rk_test_abc123")).toBe("test");
  });

  it("says unknown, rather than guessing, for anything else", () => {
    expect(stripeKeyMode(undefined)).toBe("unknown");
    expect(stripeKeyMode("")).toBe("unknown");
    expect(stripeKeyMode("pk_live_abc123")).toBe("unknown");
    expect(stripeKeyMode("whsec_abc123")).toBe("unknown");
    // A prefix has to start the key, not merely appear in it.
    expect(stripeKeyMode("x_sk_live_abc")).toBe("unknown");
  });

  it("defaults to the configured key", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_from_env";
    expect(stripeKeyMode()).toBe("live");
    delete process.env.STRIPE_SECRET_KEY;
    expect(stripeKeyMode()).toBe("unknown");
  });
});
