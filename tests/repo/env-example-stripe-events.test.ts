import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { REQUIRED_EVENTS } from "@/lib/billing/stripe-webhook-events";

/**
 * .env.example tells an operator which Stripe events to subscribe the webhook
 * to when they create the endpoint by hand. It listed five of the nine the
 * handler acts on, so anyone who followed the template got an endpoint that
 * never delivered `payment_intent.succeeded`, `charge.refunded` or
 * `charge.dispute.created`: one-time credits were not backfilled and a refund
 * did not claw anything back. /docs/self-hosting renders the real list, which
 * is how the docs page stayed right while the template did not.
 *
 * The template is plain text a person copies, so it cannot render anything.
 * What it can do is be checked against REQUIRED_EVENTS here, both ways: every
 * required event is named, and no Stripe event the app does not ask for is
 * left in the list to be subscribed to for nothing.
 */

const ROOT = path.resolve(__dirname, "../..");
const envExample = readFileSync(path.join(ROOT, ".env.example"), "utf8");

/** The block between the webhook endpoint line and the secret itself. */
function stripeEventBlock(): string {
  const start = envExample.indexOf("Endpoint URL:");
  const end = envExample.indexOf("STRIPE_WEBHOOK_SECRET=", start);
  return start === -1 || end === -1 ? "" : envExample.slice(start, end);
}

describe(".env.example lists the Stripe events the webhook handler needs", () => {
  it("finds the event block at all", () => {
    expect(stripeEventBlock()).toContain("/api/v3/webhooks/stripe");
  });

  it.each([...REQUIRED_EVENTS])("names %s", (event) => {
    expect(
      stripeEventBlock(),
      `${event} is in REQUIRED_EVENTS but not in the .env.example list an ` +
        `operator follows when creating the endpoint by hand, so a webhook ` +
        `built from the template never receives it`,
    ).toContain(event);
  });

  it("names no Stripe event the app does not ask for", () => {
    // Stripe event types are lower-case dotted identifiers with a known
    // namespace; the endpoint URL and prose in the block do not match.
    const named = [
      ...stripeEventBlock().matchAll(
        /\b((?:checkout|customer|invoice|payment_intent|charge)(?:\.[a-z_]+)+)\b/g,
      ),
    ].map((m) => m[1]);
    const required = new Set<string>(REQUIRED_EVENTS);
    expect(named.filter((e) => !required.has(e))).toEqual([]);
  });
});

/**
 * The docs and comments once said ensureStripeWebhook re-checks the event list
 * on every boot. Nothing calls it at boot: the one caller is the admin GET to
 * the setup-webhook route, which short-circuits once STRIPE_WEBHOOK_SECRET is
 * set. An operator who believed the claim would add an event, restart, and
 * wait for a subscription that was never going to change.
 */
describe("nothing re-checks the Stripe event subscription at boot", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }

  it("keeps ensureStripeWebhook out of instrumentation and the boot phases", () => {
    const bootFiles = [
      path.join(ROOT, "instrumentation.ts"),
      ...walk(path.join(ROOT, "lib", "database", "boot")),
    ];
    const callers = bootFiles.filter((file) =>
      /ensureStripeWebhook/.test(readFileSync(file, "utf8")),
    );
    expect(
      callers.map((f) => path.relative(ROOT, f)),
      "something at boot now calls ensureStripeWebhook: the claim in " +
        "stripe-webhook-events.ts, the self-hosting page and .env.example " +
        "that no boot-time re-check exists is now false",
    ).toEqual([]);
  });

  it("does not repeat the claim in the places that once made it", () => {
    const sources = [
      "lib/billing/stripe-webhook-events.ts",
      "tests/lib/billing/stripe-webhook-events.test.ts",
      "app/docs/self-hosting/page.tsx",
      ".env.example",
    ];
    for (const rel of sources) {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      expect(text, rel).not.toMatch(/re-?check[a-z]*[^.]{0,80}every boot/i);
      expect(text, rel).not.toMatch(/re-?appl[a-z]*[^.]{0,80}every boot/i);
    }
  });
});
