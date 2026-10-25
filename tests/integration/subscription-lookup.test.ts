import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { applySubscriptionCreated } from "@/lib/billing/subscription-writes";
import { findAccountForSubscriptionEvent } from "@/lib/billing/subscription-lookup";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The read the Stripe webhook runs when a subscription write changed no row,
 * against a real PostgreSQL.
 *
 * It exists to separate "no account exists for this event" (a paying customer
 * with nobody to receive the plan, which alerts) from "an account exists and
 * the ownership guard refused it" (routine, and must not alert). Both look
 * like zero rows updated. The behaviour that matters is therefore the pairing:
 * a write the guard refuses is reported by applySubscriptionCreated as no row,
 * and this lookup must still find the account that refusal protected. A faked
 * pool cannot show that, because the guard and the lookup are both SQL.
 *
 * Fixture ids come from unique(): stripe_customer_id and email are UNIQUE.
 */

async function bind(
  userId: number,
  state: {
    customerId?: string | null;
    subscriptionId?: string | null;
    status?: string | null;
  },
): Promise<void> {
  await pool.query(
    `UPDATE users SET stripe_customer_id = $1, stripe_subscription_id = $2, subscription_status = $3 WHERE id = $4`,
    [
      state.customerId ?? null,
      state.subscriptionId ?? null,
      state.status ?? null,
      userId,
    ],
  );
}

describeIntegration("findAccountForSubscriptionEvent", () => {
  it("finds an account by user id, by Stripe customer id, and by email ignoring case", async () => {
    const customerId = unique("cus");
    const user = await createUser();
    await bind(user.id, { customerId });

    expect(await findAccountForSubscriptionEvent({ userId: user.id })).toBe(
      user.id,
    );
    expect(await findAccountForSubscriptionEvent({ customerId })).toBe(user.id);
    expect(
      await findAccountForSubscriptionEvent({
        email: user.email.toUpperCase(),
      }),
    ).toBe(user.id);
  });

  it("finds nothing when no key matches an account", async () => {
    expect(
      await findAccountForSubscriptionEvent({
        userId: 2_000_000_000,
        customerId: unique("cus_nobody"),
        email: `${unique("nobody")}@example.test`,
      }),
    ).toBeNull();
  });

  it("asks nothing, and finds nothing, when it has no key to look up", async () => {
    expect(await findAccountForSubscriptionEvent({})).toBeNull();
    expect(
      await findAccountForSubscriptionEvent({
        userId: null,
        customerId: "",
        email: null,
      }),
    ).toBeNull();
  });

  it("treats a malformed user id as no key rather than failing the whole lookup", async () => {
    const customerId = unique("cus");
    const user = await createUser();
    await bind(user.id, { customerId });

    // parseInt of a bad metadata value is NaN. It must not poison the other keys.
    expect(
      await findAccountForSubscriptionEvent({ userId: Number.NaN, customerId }),
    ).toBe(user.id);
  });

  it("finds the account a refused create protected, so a guard refusal is not mistaken for 'no account'", async () => {
    const customerId = unique("cus");
    const liveSub = unique("sub");
    const lateCreatedSub = unique("sub");
    const user = await createUser({ plan: "elite_supporter" });
    await bind(user.id, {
      customerId,
      subscriptionId: liveSub,
      status: "active",
    });

    // A `created` for a second subscription on a customer already on a live
    // one: the ownership guard refuses it in every lookup mode.
    const write = {
      subscriptionId: lateCreatedSub,
      customerId,
      plan: "free",
      status: "incomplete",
      billingInterval: null,
    };
    expect(
      (await applySubscriptionCreated(write, { by: "id", userId: user.id }))
        .userId,
    ).toBeNull();
    expect(
      (await applySubscriptionCreated(write, { by: "customer" })).userId,
    ).toBeNull();

    // Refused, and the account is right there.
    expect(
      await findAccountForSubscriptionEvent({
        userId: user.id,
        customerId,
        email: user.email,
      }),
    ).toBe(user.id);
  });

  it("still finds nothing for the same refused-looking write when the account really does not exist", async () => {
    const write = {
      subscriptionId: unique("sub"),
      customerId: unique("cus_ghost"),
      plan: "pro_supporter",
      status: "active",
      billingInterval: "month",
    };
    expect(
      (await applySubscriptionCreated(write, { by: "customer" })).userId,
    ).toBeNull();
    expect(
      await findAccountForSubscriptionEvent({ customerId: write.customerId }),
    ).toBeNull();
  });
});
