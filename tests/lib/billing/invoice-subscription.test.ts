import { describe, it, expect } from "vitest";
import { invoiceSubscriptionId } from "@/lib/billing/invoice-subscription";
import type Stripe from "stripe";

/**
 * The invoice webhooks used to write subscription state for any invoice
 * belonging to the customer, because there was nothing telling them which
 * subscription (if any) an invoice was actually for. This is that answer, and
 * the reason it has to read more than one shape is that Stripe moved the field
 * out of the top level and under `parent`, while an account still pinned to an
 * older API version keeps sending the old one.
 */

function invoice(fields: Record<string, unknown>): Stripe.Invoice {
  return fields as unknown as Stripe.Invoice;
}

describe("invoiceSubscriptionId", () => {
  it("reads the id from where Stripe puts it now", () => {
    expect(
      invoiceSubscriptionId(
        invoice({
          parent: { subscription_details: { subscription: "sub_1" } },
        }),
      ),
    ).toBe("sub_1");
  });

  it("unwraps an expanded subscription object", () => {
    expect(
      invoiceSubscriptionId(
        invoice({
          parent: { subscription_details: { subscription: { id: "sub_2" } } },
        }),
      ),
    ).toBe("sub_2");
  });

  it("still reads the top-level field an account on an older API version sends", () => {
    expect(invoiceSubscriptionId(invoice({ subscription: "sub_3" }))).toBe(
      "sub_3",
    );
  });

  it("unwraps an expanded subscription on the old top-level field too", () => {
    expect(
      invoiceSubscriptionId(invoice({ subscription: { id: "sub_3b" } })),
    ).toBe("sub_3b");
  });

  it("falls back to the line item, which carries the same id", () => {
    expect(
      invoiceSubscriptionId(
        invoice({
          parent: { subscription_details: null },
          lines: {
            data: [
              {
                parent: {
                  subscription_item_details: { subscription: "sub_4" },
                },
              },
            ],
          },
        }),
      ),
    ).toBe("sub_4");
  });

  it("returns null for an invoice that is genuinely not about a subscription", () => {
    // A real, common state, and the one the past_due bug turned into a write:
    // a one-off invoice, an invoice item billed alone, a quote.
    expect(
      invoiceSubscriptionId(invoice({ parent: null, lines: { data: [] } })),
    ).toBeNull();
    expect(invoiceSubscriptionId(invoice({}))).toBeNull();
  });

  it("does not mistake an empty string for an id", () => {
    expect(invoiceSubscriptionId(invoice({ subscription: "" }))).toBeNull();
  });
});
