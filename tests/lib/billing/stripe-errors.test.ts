import { describe, it, expect } from "vitest";
import { isMissingStripeResource } from "@/lib/billing/stripe-errors";

/**
 * The predicate that decides whether billing code is allowed to create a
 * replacement for something it could not retrieve. Answering yes to a timeout
 * is how a customer ends up with two live subscriptions, so the interesting
 * cases here are all the errors that must answer no.
 */
describe("isMissingStripeResource", () => {
  it("recognizes Stripe's own shape for an object that does not exist", () => {
    expect(
      isMissingStripeResource(
        Object.assign(new Error("No such subscription"), {
          code: "resource_missing",
          statusCode: 404,
        }),
      ),
    ).toBe(true);
  });

  it("accepts a 404 that carries no code", () => {
    expect(isMissingStripeResource({ statusCode: 404 })).toBe(true);
  });

  it("refuses a timeout, a 5xx and a rate limit", () => {
    expect(
      isMissingStripeResource(
        Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT" }),
      ),
    ).toBe(false);
    expect(isMissingStripeResource({ statusCode: 500 })).toBe(false);
    expect(
      isMissingStripeResource({ statusCode: 429, code: "rate_limit" }),
    ).toBe(false);
  });

  it("refuses a plain error, and anything that is not an object", () => {
    expect(isMissingStripeResource(new Error("boom"))).toBe(false);
    expect(isMissingStripeResource(null)).toBe(false);
    expect(isMissingStripeResource(undefined)).toBe(false);
    expect(isMissingStripeResource("resource_missing")).toBe(false);
  });
});
