import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REQUIRED_EVENTS } from "@/lib/billing/stripe-webhook-events";

/**
 * The guard `stripe-webhook-events.ts` asks for in its own docblock: "Keep it
 * in sync with the switch in app/api/v3/webhooks/stripe/route.ts: an event the
 * handler reads but that is not registered here never arrives."
 *
 * Nothing enforced that, and both directions of the mismatch are silent and
 * expensive:
 *
 *   Handled but not registered - the endpoint is never subscribed to the
 *   event, so Stripe never sends it and the branch is dead code that looks
 *   alive. That already happened: `payment_intent.succeeded` was handled and
 *   unregistered, so the backup crediting path for one-time purchases only ran
 *   when the fast confirm path had already run, which is exactly when it was
 *   not needed.
 *
 *   Registered but not handled - the endpoint receives traffic it drops on the
 *   floor. Harmless to the customer, but it makes the list a claim about
 *   behaviour that is not true, and `ensureStripeWebhook` re-applies it to the
 *   live endpoint on every boot.
 *
 * Reading the route as text rather than importing it is deliberate: that
 * module is `server-only` and pulls in Stripe and the database, none of which
 * this assertion needs. The switch is a literal list of string cases, which is
 * exactly the shape a regex can read honestly.
 */

const ROUTE = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "app",
  "api",
  "v3",
  "webhooks",
  "stripe",
  "route.ts",
);

/** Every `case "some.stripe.event":` in the handler. */
function handledEvents(): string[] {
  const src = readFileSync(ROUTE, "utf8");
  // Stripe event names always carry a dot, which is what separates them from
  // any other string case that might appear in this file.
  const found = [...src.matchAll(/case\s+"([a-z_]+(?:\.[a-z_]+)+)":/g)].map(
    (m) => m[1],
  );
  return [...new Set(found)];
}

describe("REQUIRED_EVENTS matches the webhook handler", () => {
  it("finds the handler's switch at all", () => {
    // If the route is ever restructured away from a literal switch this fails
    // loudly, rather than silently asserting two empty lists are equal.
    expect(handledEvents().length).toBeGreaterThan(5);
  });

  it("registers every event the handler acts on", () => {
    const unregistered = handledEvents().filter(
      (e) => !(REQUIRED_EVENTS as readonly string[]).includes(e),
    );
    expect(
      unregistered,
      "these events are handled in app/api/v3/webhooks/stripe/route.ts but " +
        "are not in REQUIRED_EVENTS, so Stripe is never subscribed to them " +
        "and the branch never runs",
    ).toEqual([]);
  });

  it("handles every event it registers", () => {
    const handled = handledEvents();
    const unhandled = (REQUIRED_EVENTS as readonly string[]).filter(
      (e) => !handled.includes(e),
    );
    expect(
      unhandled,
      "these events are registered in REQUIRED_EVENTS but no case in the " +
        "webhook route handles them, so the endpoint is subscribed to " +
        "traffic it drops",
    ).toEqual([]);
  });

  it("lists no duplicates", () => {
    expect(REQUIRED_EVENTS.length).toBe(new Set(REQUIRED_EVENTS).size);
  });
});
