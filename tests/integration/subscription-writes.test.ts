import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import {
  applySubscriptionCreated,
  applySubscriptionDeleted,
  applySubscriptionUpdated,
  markSubscriptionPaid,
  markSubscriptionPastDue,
} from "@/lib/billing/subscription-writes";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The Stripe webhook's subscription writes, against a real PostgreSQL.
 *
 * Every claim these functions make lives in a WHERE clause: an ownership
 * predicate over three columns with NULLs in two of them, an `= ANY` against a
 * bound text array, an IS DISTINCT FROM evaluated on the pre-update row. A
 * faked pool answers all of that with whatever the test scripted, so the unit
 * suite can prove the route calls the right function with the right parameters
 * and nothing at all about whether the guard holds. This is where it is
 * actually evaluated.
 *
 * What is being defended: a Stripe customer can hold more than one
 * subscription, and Stripe does not deliver events in order. Before these
 * guards, an event for an abandoned subscription downgraded the account paying
 * for a live one, and a `created` redelivered after the customer confirmed
 * payment wrote "free" back over their plan.
 *
 * Fixture ids come from unique(): users.stripe_subscription_id and
 * stripe_customer_id are both UNIQUE, so a shared literal would fail as a
 * duplicate key in whichever test happened to run second.
 */

interface BillingRow {
  plan: string;
  subscription_status: string | null;
  stripe_subscription_id: string | null;
  billing_interval: string | null;
}

async function createBillingUser(state: {
  plan?: string;
  role?: string;
  customerId: string;
  subscriptionId?: string | null;
  status?: string | null;
}): Promise<number> {
  const user = await createUser({
    plan: state.plan ?? "free",
    role: state.role ?? "user",
  });
  await pool.query(
    `UPDATE users SET stripe_customer_id = $1, stripe_subscription_id = $2, subscription_status = $3 WHERE id = $4`,
    [
      state.customerId,
      state.subscriptionId ?? null,
      state.status ?? null,
      user.id,
    ],
  );
  return user.id;
}

async function readBilling(userId: number): Promise<BillingRow> {
  const { rows } = await pool.query<BillingRow>(
    `SELECT plan, subscription_status, stripe_subscription_id, billing_interval
     FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0];
}

describeIntegration("Stripe subscription writes", () => {
  it("will not let one subscription's update overwrite the plan another live subscription is paying for", async () => {
    const customerId = unique("cus");
    const liveSub = unique("sub");
    const abandonedSub = unique("sub");
    const userId = await createBillingUser({
      plan: "elite_supporter",
      customerId,
      subscriptionId: liveSub,
      status: "active",
    });

    const result = await applySubscriptionUpdated({
      subscriptionId: abandonedSub,
      customerId,
      plan: "free",
      status: "incomplete_expired",
      billingInterval: null,
    });

    expect(result.userId).toBeNull();
    const row = await readBilling(userId);
    expect(row.plan).toBe("elite_supporter");
    expect(row.subscription_status).toBe("active");
    expect(row.stripe_subscription_id).toBe(liveSub);
  });

  it("claims a row that is not bound to any subscription yet, recording the id as well as the plan", async () => {
    const customerId = unique("cus");
    const sub = unique("sub");
    const userId = await createBillingUser({ customerId });

    const result = await applySubscriptionUpdated({
      subscriptionId: sub,
      customerId,
      plan: "pro_supporter",
      status: "active",
      billingInterval: "year",
    });

    expect(result.userId).toBe(userId);
    expect(await readBilling(userId)).toMatchObject({
      plan: "pro_supporter",
      subscription_status: "active",
      stripe_subscription_id: sub,
      billing_interval: "year",
    });
  });

  it("takes over a row whose recorded subscription has already ended, so a returning customer is never locked out", async () => {
    // The guard has to be releasable. A row left pointing at an
    // incomplete_expired subscription that ignored every other subscription's
    // events would mean a customer who lapsed and came back could pay and
    // never get their plan.
    const customerId = unique("cus");
    const deadSub = unique("sub");
    const freshSub = unique("sub");
    const userId = await createBillingUser({
      customerId,
      subscriptionId: deadSub,
      status: "incomplete_expired",
    });

    const result = await applySubscriptionUpdated({
      subscriptionId: freshSub,
      customerId,
      plan: "core_supporter",
      status: "active",
      billingInterval: "month",
    });

    expect(result.userId).toBe(userId);
    const row = await readBilling(userId);
    expect(row.stripe_subscription_id).toBe(freshSub);
    expect(row.plan).toBe("core_supporter");
  });

  it("does not rewrite a row when nothing about it actually changed", async () => {
    const customerId = unique("cus");
    const sub = unique("sub");
    const userId = await createBillingUser({
      plan: "core_supporter",
      customerId,
      subscriptionId: sub,
      status: "active",
    });

    const result = await applySubscriptionUpdated({
      subscriptionId: sub,
      customerId,
      plan: "core_supporter",
      status: "active",
      billingInterval: null,
    });

    expect(result.userId).toBeNull();
    expect((await readBilling(userId)).plan).toBe("core_supporter");
  });

  it("refuses a create event for a subscription the row already records", async () => {
    // `created` is always the oldest event about a subscription, so a row that
    // already knows the id was written by something newer. Redelivered after
    // the customer confirmed payment, this used to write "free"/"incomplete"
    // over an active plan.
    const customerId = unique("cus");
    const sub = unique("sub");
    const userId = await createBillingUser({
      plan: "elite_supporter",
      customerId,
      subscriptionId: sub,
      status: "active",
    });

    for (const match of [
      { by: "id" as const, userId },
      { by: "customer" as const },
    ]) {
      const result = await applySubscriptionCreated(
        {
          subscriptionId: sub,
          customerId,
          plan: "free",
          status: "incomplete",
          billingInterval: null,
        },
        match,
      );
      expect(result.userId).toBeNull();
    }

    const row = await readBilling(userId);
    expect(row.plan).toBe("elite_supporter");
    expect(row.subscription_status).toBe("active");
  });

  it("still applies a create event to a row that has never seen a subscription", async () => {
    const customerId = unique("cus");
    const sub = unique("sub");
    const userId = await createBillingUser({ customerId });

    const result = await applySubscriptionCreated(
      {
        subscriptionId: sub,
        customerId,
        plan: "free",
        status: "incomplete",
        billingInterval: null,
      },
      { by: "id", userId },
    );

    expect(result.userId).toBe(userId);
    expect((await readBilling(userId)).stripe_subscription_id).toBe(sub);
  });

  it("cancels only the subscription the row is on, and falls back to the staff floor rather than free", async () => {
    const customerId = unique("cus");
    const liveSub = unique("sub");
    const abandonedSub = unique("sub");
    const userId = await createBillingUser({
      plan: "elite_supporter",
      role: "moderator",
      customerId,
      subscriptionId: liveSub,
      status: "active",
    });

    const other = await applySubscriptionDeleted({
      subscriptionId: abandonedSub,
      customerId,
    });
    expect(other.userId).toBeNull();
    expect((await readBilling(userId)).plan).toBe("elite_supporter");

    const own = await applySubscriptionDeleted({
      subscriptionId: liveSub,
      customerId,
    });
    expect(own.userId).toBe(userId);
    const row = await readBilling(userId);
    // A staff account holds a granted floor that a paid subscription sits on
    // top of, so the end of the subscription lands there, not on free.
    expect(row.plan).toBe("pro_supporter");
    expect(row.subscription_status).toBe("canceled");
    expect(row.stripe_subscription_id).toBeNull();
  });

  it("writes past_due only for a failed renewal of the subscription the account is actually paying for", async () => {
    const customerId = unique("cus");
    const sub = unique("sub");
    const userId = await createBillingUser({
      plan: "pro_supporter",
      customerId,
      subscriptionId: sub,
      status: "active",
    });

    const result = await markSubscriptionPastDue({
      subscriptionId: sub,
      customerId,
    });

    expect(result.userId).toBe(userId);
    expect((await readBilling(userId)).subscription_status).toBe("past_due");
  });

  it("never leaves past_due on an account with no live subscription to clear it", async () => {
    // The permanent past_due. None of these rows has a later invoice coming on
    // any subscription, so anything written here would have stayed forever.
    const cases = [
      { status: "canceled", bound: false },
      { status: "incomplete", bound: true },
      { status: null, bound: false },
    ];

    for (const c of cases) {
      const customerId = unique("cus");
      const sub = unique("sub");
      const userId = await createBillingUser({
        customerId,
        subscriptionId: c.bound ? sub : null,
        status: c.status,
      });

      const result = await markSubscriptionPastDue({
        subscriptionId: sub,
        customerId,
      });

      expect(result.userId).toBeNull();
      expect((await readBilling(userId)).subscription_status).toBe(c.status);
    }
  });

  it("leaves a pending cancel-at-period-end alone on both the failure and the success path", async () => {
    // "canceling" is the state the customer chose. A renewal event writing over
    // it made the profile page claim the cancellation had not happened, and
    // nothing writes it back.
    const customerId = unique("cus");
    const sub = unique("sub");
    const userId = await createBillingUser({
      plan: "pro_supporter",
      customerId,
      subscriptionId: sub,
      status: "canceling",
    });

    await markSubscriptionPastDue({ subscriptionId: sub, customerId });
    expect((await readBilling(userId)).subscription_status).toBe("canceling");

    await markSubscriptionPaid({ subscriptionId: sub, customerId });
    expect((await readBilling(userId)).subscription_status).toBe("canceling");
  });

  it("clears past_due when the renewal for that same subscription finally goes through", async () => {
    const customerId = unique("cus");
    const sub = unique("sub");
    const userId = await createBillingUser({
      plan: "pro_supporter",
      customerId,
      subscriptionId: sub,
      status: "past_due",
    });

    const result = await markSubscriptionPaid({
      subscriptionId: sub,
      customerId,
    });

    expect(result.userId).toBe(userId);
    expect((await readBilling(userId)).subscription_status).toBe("active");
  });
});
