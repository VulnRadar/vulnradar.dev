import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { invoicePaymentIntentId } from "@/lib/billing/invoice-payment-intent";
import type Stripe from "stripe";

/**
 * Stripe removed `payment_intent` from Invoice and `current_period_end` from
 * Subscription. Both were read through an `as unknown as {...}` cast, which is
 * the one assertion form that survives a vendored type losing a field: a plain
 * `as` errors on non-overlapping types, a double cast compiles against
 * anything. So `tsc` stayed green, the `?? null` beside one of them swallowed
 * the undefined, and every billing_history row written since the upgrade
 * recorded a NULL payment intent. The other would have thrown a RangeError on
 * the cancel path, after the cancellation had already committed.
 *
 * Nothing crashed on the first one, which is exactly why it went unnoticed.
 *
 * These tests cover the replacement helper AND assert that the dangerous
 * idiom has not come back to the billing code, because the next SDK bump will
 * remove another field and the cast is what decides whether that is a compile
 * error or a silent data loss.
 */

function invoice(payments: unknown): Stripe.Invoice {
  return { payments } as unknown as Stripe.Invoice;
}

describe("invoicePaymentIntentId", () => {
  it("reads the id from where Stripe actually puts it now", () => {
    expect(
      invoicePaymentIntentId(
        invoice({
          data: [
            { payment: { type: "payment_intent", payment_intent: "pi_1" } },
          ],
        }),
      ),
    ).toBe("pi_1");
  });

  it("unwraps an expanded PaymentIntent object", () => {
    // A webhook payload sends the bare id, but an expanded read is legal and
    // returning "[object Object]" into a database column would be worse than
    // returning null.
    expect(
      invoicePaymentIntentId(
        invoice({
          data: [
            {
              payment: {
                type: "payment_intent",
                payment_intent: { id: "pi_2" },
              },
            },
          ],
        }),
      ),
    ).toBe("pi_2");
  });

  it("skips payments that are not payment intents", () => {
    // An invoice settled by a charge surfaces `charge`, not `payment_intent`,
    // and only for invoices finalized before March 2019. Returning the charge
    // id from a column named stripe_payment_intent_id would be a lie.
    expect(
      invoicePaymentIntentId(
        invoice({ data: [{ payment: { type: "charge", charge: "ch_1" } }] }),
      ),
    ).toBeNull();
  });

  it("finds the payment intent when it is not the first entry", () => {
    expect(
      invoicePaymentIntentId(
        invoice({
          data: [
            { payment: { type: "charge", charge: "ch_1" } },
            { payment: { type: "payment_intent", payment_intent: "pi_3" } },
          ],
        }),
      ),
    ).toBe("pi_3");
  });

  it("returns null rather than throwing on every shape of absence", () => {
    for (const payments of [
      undefined,
      null,
      {},
      { data: null },
      { data: [] },
    ]) {
      expect(invoicePaymentIntentId(invoice(payments))).toBeNull();
    }
    expect(invoicePaymentIntentId(invoice({ data: [{}] }))).toBeNull();
    expect(
      invoicePaymentIntentId(invoice({ data: [{ payment: null }] })),
    ).toBeNull();
  });
});

describe("the billing code does not assert shapes over Stripe's types", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const FILES = [
    "app/api/v3/billing/route.ts",
    "app/api/v3/billing/verify/route.ts",
    "app/api/v3/webhooks/stripe/route.ts",
  ];

  it("no `as unknown as` reaches into a Stripe object", () => {
    const offenders: string[] = [];
    for (const rel of FILES) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      for (const [i, line] of src.split("\n").entries()) {
        // Comments explaining the history of this bug are not the bug.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (line.includes("as unknown as")) offenders.push(`${rel}:${i + 1}`);
      }
    }

    expect(
      offenders,
      "`as unknown as` over a Stripe type is how two field removals shipped " +
        "silently: it defeats the non-overlap check that would otherwise make " +
        "an SDK upgrade a compile error. Read the field from where the SDK " +
        "declares it, or narrow with a real check:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });
});
