"use server";

import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { getOrCreateStripePriceId } from "@/lib/billing/stripe-catalog";
import { PRODUCTS, getPlanFromProductId } from "@/lib/billing/products";
import { getAiCreditTier } from "@/lib/billing/ai-credit-catalog";
import {
  creditAiCreditPurchase,
  getAiCreditBalance,
} from "@/lib/billing/ai-usage";
import { getGithubCreditTier } from "@/lib/billing/github-credit-catalog";
import {
  creditGithubCreditPurchase,
  getGithubCreditBalance,
} from "@/lib/billing/github-review-usage";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/subscription-status";
import { grantPremiumBadge, revokePremiumBadge } from "@/lib/billing/badges";
import { getSession } from "@/lib/auth/auth";
import { isStaffRole } from "@/lib/auth/permissions-client";
import { planMeetsMinimum } from "@/lib/billing/plan-limits";
import pool from "@/lib/database/db";

export type CreateSubscriptionResult =
  | { kind: "new"; clientSecret: string; subscriptionId: string }
  | { kind: "switched"; subscriptionId: string };

export async function createSubscription(
  productId: string,
): Promise<CreateSubscriptionResult> {
  // auth: userId is derived from the session — client-supplied userId
  // is never trusted (any session could otherwise upgrade a victim).
  const sessionUser = await getSession();
  if (!sessionUser) {
    throw new Error("User must be logged in to subscribe");
  }
  const userId = sessionUser.userId;

  const product = PRODUCTS.find((p) => p.id === productId);
  if (!product) {
    throw new Error(`Product with id "${productId}" not found`);
  }

  const planId = getPlanFromProductId(productId);

  // billing: staff (lib/billing/staff-plan.ts) already hold a real,
  // non-Stripe pro_supporter floor granted on promotion -- see that file
  // and scripts/migrate/versions/2.0.0-to-3.0.0.mjs's header comment on
  // users.pre_staff_plan. They are NOT allowed to self-downgrade below
  // that floor by buying a cheaper plan (that would undercut the plan
  // their staff role guarantees them), but they ARE allowed to pay for
  // real if they want Elite Supporter on top of it -- a genuine purchase,
  // let it through normally. Checked server-side, not just hidden in the
  // UI, since a staff member could otherwise call this action directly.
  if (
    isStaffRole(sessionUser.role) &&
    !planMeetsMinimum(planId, "pro_supporter")
  ) {
    throw new Error(
      "Staff accounts already have Pro Supporter access and cannot downgrade below it. You can still upgrade to Elite Supporter if you want to pay for it.",
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured on this server.");
  }

  // Get or create Stripe customer
  const userResult = await pool.query(
    `SELECT email, name, stripe_customer_id, stripe_subscription_id, subscription_status
     FROM users WHERE id = $1`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) throw new Error("User not found");

  async function createStripeCustomer(): Promise<string> {
    const customer = await stripe!.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { userId: String(userId) },
    });
    await pool.query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [
      customer.id,
      userId,
    ]);
    return customer.id;
  }

  // A stored stripe_customer_id can go stale: the Stripe account was reset,
  // the API key moved from live to test mode (or vice versa), or the
  // customer was deleted directly in the dashboard. Any of those leaves a
  // row pointing at a customer id Stripe no longer recognizes, and every
  // downstream call (subscriptions.create, subscriptions.retrieve) fails
  // with a generic "No such customer" 404 that has nothing to do with this
  // checkout attempt itself. Verify it actually resolves before trusting
  // it, and silently re-create rather than surfacing that as a checkout
  // failure -- the customer is a Stripe-side implementation detail, not
  // something the subscriber should ever have to know went missing.
  let customerId: string;
  if (!user.stripe_customer_id) {
    customerId = await createStripeCustomer();
  } else {
    try {
      const existing = await stripe.customers.retrieve(user.stripe_customer_id);
      if (existing.deleted) throw new Error("customer deleted");
      customerId = user.stripe_customer_id;
    } catch {
      customerId = await createStripeCustomer();
    }
  }

  const metadata = {
    planId,
    productId: product.id,
    userId: String(userId),
    scansPerDay: product.scansPerDay.toString(),
  };

  // billing: a user who already has an active paid subscription and picks a
  // different plan (upgrade or downgrade) must have their EXISTING Stripe
  // subscription switched to the new price, not a second one created
  // alongside it. Without this check, every plan change created a parallel
  // subscription and the customer was billed for both.
  const existingSubscriptionId = user.stripe_subscription_id as string | null;
  if (
    existingSubscriptionId &&
    ACTIVE_SUBSCRIPTION_STATUSES.includes(user.subscription_status)
  ) {
    const existingSubscription = await stripe.subscriptions
      .retrieve(existingSubscriptionId)
      .catch(() => null);
    if (
      existingSubscription &&
      ACTIVE_SUBSCRIPTION_STATUSES.includes(existingSubscription.status)
    ) {
      const priceId = await getOrCreateStripePriceId(stripe, product);

      const updated = await stripe.subscriptions.update(
        existingSubscriptionId,
        {
          items: [
            { id: existingSubscription.items.data[0].id, price: priceId },
          ],
          proration_behavior: "create_prorations",
          metadata,
        },
      );

      return { kind: "switched", subscriptionId: updated.id };
    }
  }

  const priceId = await getOrCreateStripePriceId(stripe, product);

  // Create subscription with default_incomplete so client collects payment via Elements
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: {
      save_default_payment_method: "on_subscription",
    },
    // `expand: ["latest_invoice"]` alone turns latest_invoice into a full
    // Invoice object, but confirmation_secret is itself only populated when
    // separately expanded (Stripe's own default_incomplete guide expands
    // "latest_invoice.confirmation_secret" explicitly) -- without the
    // nested path it comes back undefined even though Stripe finalized the
    // invoice and created the PaymentIntent server-side, which is exactly
    // what threw "Failed to create payment intent" here despite the
    // subscription (and its webhook events) existing correctly in Stripe.
    expand: ["latest_invoice.confirmation_secret"],
    metadata,
  });

  // Stripe's Invoice object no longer exposes `payment_intent` directly (the
  // prior code force-cast around this with `as Invoice & { payment_intent }`,
  // which compiled but was always undefined at runtime). The client secret
  // now lives on `confirmation_secret`, populated on invoice finalization,
  // but only comes back on the response when explicitly expanded (see
  // above).
  const invoice = subscription.latest_invoice as Stripe.Invoice | null;
  const clientSecret = invoice?.confirmation_secret?.client_secret;
  if (!clientSecret) {
    // No confirmation_secret doesn't necessarily mean creation failed: a
    // customer with a working default payment method on file (from an
    // earlier subscription, e.g.) can have this first invoice settle
    // synchronously with nothing left to confirm client-side, which
    // Stripe represents as the subscription already being active/trialing
    // with no payment intent to hand back. That's success, not an error --
    // report it the same way an in-place plan switch already is (no
    // Elements form needed, just verify the plan changed).
    if (ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
      return { kind: "switched", subscriptionId: subscription.id };
    }
    throw new Error("Failed to create payment intent for subscription");
  }

  return {
    kind: "new",
    clientSecret,
    subscriptionId: subscription.id,
  };
}

export interface ConfirmSubscriptionResult {
  plan: string;
  active: boolean;
}

/**
 * Writes a subscription's current Stripe status straight to the users row,
 * called right after the client confirms payment (or right after an
 * in-place plan switch) instead of waiting on the Stripe webhook. A
 * self-hosted deployment with no public URL for Stripe to call back to (no
 * `stripe listen` forwarding, no tunnel) would otherwise never receive
 * customer.subscription.updated at all -- the payment goes through on
 * Stripe's side but the account stays on "free" forever. The webhook stays
 * the source of truth for everything that happens *after* this moment
 * (renewals, cancellations, past_due), this only covers the one instant
 * the user is actually sitting on the checkout page waiting for an answer.
 */
export async function confirmSubscription(
  subscriptionId: string,
): Promise<ConfirmSubscriptionResult> {
  const sessionUser = await getSession();
  if (!sessionUser) {
    throw new Error("User must be logged in to confirm a subscription");
  }

  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured on this server.");
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Authorization: createSubscription() always stamps the creating user's
  // id into metadata. Without this check, anyone logged in could pass an
  // arbitrary subscription id belonging to a stranger and have their own
  // account upgraded off someone else's payment.
  if (subscription.metadata?.userId !== String(sessionUser.userId)) {
    throw new Error("This subscription does not belong to your account");
  }

  const isPaid = ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status);
  const resolvedPlan = getPlanFromProductId(
    subscription.metadata?.productId || "",
  );
  const planToWrite = isPaid && resolvedPlan !== "free" ? resolvedPlan : "free";

  await pool.query(
    `UPDATE users SET
      plan = $1,
      stripe_subscription_id = $2,
      subscription_status = $3,
      stripe_customer_id = $4
    WHERE id = $5`,
    [
      planToWrite,
      subscription.id,
      subscription.status,
      subscription.customer as string,
      sessionUser.userId,
    ],
  );

  if (planToWrite !== "free") {
    await grantPremiumBadge(sessionUser.userId);
  } else {
    await revokePremiumBadge(sessionUser.userId);
  }

  return { plan: planToWrite, active: isPaid };
}

// Alias kept so any remaining import of startCheckoutSession doesn't hard-break
export const startCheckoutSession = createSubscription;

export interface CreateAiCreditPaymentIntentResult {
  clientSecret: string;
  paymentIntentId: string;
}

/**
 * Starts a real, one-time Stripe PaymentIntent (mode: "payment", never a
 * Checkout Session) for a purchased AI verification token top-up -- see
 * lib/billing/ai-credit-catalog.ts for the tier catalog and
 * lib/billing/ai-usage.ts for how the resulting balance is later spent.
 *
 * Mirrors createSubscription's Stripe Elements shape exactly: a client
 * secret handed to <Elements>, confirmed client-side via
 * stripe.confirmPayment, then verified server-side by
 * confirmAiCreditPurchase below -- the same "deferred payment intent"
 * pattern components/billing/stripe-checkout.tsx uses for a subscription,
 * mirrored in components/billing/ai-credit-checkout.tsx for this one-time
 * purchase, rendered on the dedicated app/checkout/credits/page.tsx tier
 * picker instead of redirecting to Stripe's own hosted Checkout page.
 *
 * The customer-resolution block below (get-or-create, repair a stale
 * stored stripe_customer_id) is deliberately mirrored from createSubscription
 * rather than extracted into a shared helper, matching that function's own
 * established pattern instead of inventing a new one.
 */
export async function createAiCreditPaymentIntent(
  tierId: string,
): Promise<CreateAiCreditPaymentIntentResult> {
  const sessionUser = await getSession();
  if (!sessionUser) {
    throw new Error("User must be logged in to buy AI credits");
  }
  const userId = sessionUser.userId;

  const tier = getAiCreditTier(tierId);
  if (!tier) {
    throw new Error(`AI credit tier "${tierId}" not found`);
  }

  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured on this server.");
  }

  const userResult = await pool.query(
    `SELECT email, name, stripe_customer_id FROM users WHERE id = $1`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) throw new Error("User not found");

  async function createStripeCustomer(): Promise<string> {
    const customer = await stripe!.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { userId: String(userId) },
    });
    await pool.query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [
      customer.id,
      userId,
    ]);
    return customer.id;
  }

  // Same stale-customer-id repair as createSubscription above -- see its
  // own comment for the full rationale (a stored stripe_customer_id can go
  // stale across a Stripe account reset, a test/live key switch, or a
  // dashboard deletion).
  let customerId: string;
  if (!user.stripe_customer_id) {
    customerId = await createStripeCustomer();
  } else {
    try {
      const existing = await stripe.customers.retrieve(user.stripe_customer_id);
      if (existing.deleted) throw new Error("customer deleted");
      customerId = user.stripe_customer_id;
    } catch {
      customerId = await createStripeCustomer();
    }
  }

  // automatic_payment_methods (rather than an explicit payment_method_types
  // list) is what lets the PaymentElement below offer more than card without
  // this app having to enumerate methods itself -- a plain
  // paymentIntents.create() with neither set defaults to card-only.
  const paymentIntent = await stripe.paymentIntents.create({
    amount: tier.priceInCents,
    currency: "usd",
    customer: customerId,
    metadata: {
      userId: String(userId),
      aiCreditTierId: tier.id,
    },
    automatic_payment_methods: { enabled: true },
  });

  if (!paymentIntent.client_secret) {
    throw new Error("Failed to create payment intent for AI credit purchase");
  }

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  };
}

export interface ConfirmAiCreditPurchaseResult {
  /** True once Stripe confirms the PaymentIntent actually succeeded --
   *  independent of which of the two code paths (this action vs. the
   *  payment_intent.succeeded webhook) ends up being the one that actually
   *  applies the credit; see creditAiCreditPurchase's own comment. */
  succeeded: boolean;
  /** The tier's token amount when succeeded is true, otherwise 0. */
  tokens: number;
  /** The account's current purchased AI token balance, valid whenever
   *  succeeded is true (fetched fresh, not just this purchase's delta, so
   *  the checkout page can show a real running total). */
  balance: number;
}

/**
 * Confirms an AI credit purchase directly against Stripe via its
 * PaymentIntent id, right after the client confirms payment -- the same
 * "verify by id, never trust the client, never wait on the webhook"
 * pattern confirmSubscription above uses. The webhook's
 * payment_intent.succeeded handler stays the backup path for a closed tab /
 * lost connection, exactly like customer.subscription.created backs up
 * confirmSubscription.
 */
export async function confirmAiCreditPurchase(
  paymentIntentId: string,
): Promise<ConfirmAiCreditPurchaseResult> {
  const sessionUser = await getSession();
  if (!sessionUser) {
    throw new Error("User must be logged in to confirm an AI credit purchase");
  }

  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured on this server.");
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

  // Authorization: createAiCreditPaymentIntent always stamps the creating
  // user's id into metadata. Without this check, anyone logged in could
  // pass an arbitrary PaymentIntent id belonging to a stranger and have
  // their own account credited off someone else's payment -- same
  // reasoning as confirmSubscription's identical check above.
  if (paymentIntent.metadata?.userId !== String(sessionUser.userId)) {
    throw new Error("This purchase does not belong to your account");
  }

  const tier = getAiCreditTier(paymentIntent.metadata?.aiCreditTierId || "");
  // "succeeded" means the purchase is fully verified end-to-end -- the
  // payment cleared AND the tier it was for still resolves. A cleared
  // payment with an unresolvable tier id should never happen for a
  // PaymentIntent this app created (createAiCreditPaymentIntent always
  // stamps a real tier id), so it's treated the same as "not confirmed
  // yet" rather than a false success with 0 tokens.
  const succeeded = paymentIntent.status === "succeeded" && !!tier;

  if (succeeded) {
    // Idempotent -- see creditAiCreditPurchase's own comment for why this
    // needs to be more than a plain addAiCreditBalance call here.
    await creditAiCreditPurchase(
      paymentIntent.id,
      sessionUser.userId,
      tier!.tokens,
    );
  }

  const balance = await getAiCreditBalance(sessionUser.userId);

  return {
    succeeded,
    tokens: succeeded ? tier!.tokens : 0,
    balance,
  };
}

export interface CreateGithubCreditPaymentIntentResult {
  clientSecret: string;
  paymentIntentId: string;
}

/**
 * Starts a real, one-time Stripe PaymentIntent for a purchased GitHub repo
 * AI review token top-up. Mirrors createAiCreditPaymentIntent above exactly
 * -- same customer-resolution block, same Stripe Elements shape -- for a
 * completely separate catalog/tier/metadata key (githubCreditTierId, not
 * aiCreditTierId) and balance (users.github_credit_balance, not
 * ai_credit_balance).
 */
export async function createGithubCreditPaymentIntent(
  tierId: string,
): Promise<CreateGithubCreditPaymentIntentResult> {
  const sessionUser = await getSession();
  if (!sessionUser) {
    throw new Error("User must be logged in to buy GitHub review credits");
  }
  const userId = sessionUser.userId;

  const tier = getGithubCreditTier(tierId);
  if (!tier) {
    throw new Error(`GitHub credit tier "${tierId}" not found`);
  }

  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured on this server.");
  }

  const userResult = await pool.query(
    `SELECT email, name, stripe_customer_id FROM users WHERE id = $1`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) throw new Error("User not found");

  async function createStripeCustomer(): Promise<string> {
    const customer = await stripe!.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { userId: String(userId) },
    });
    await pool.query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [
      customer.id,
      userId,
    ]);
    return customer.id;
  }

  let customerId: string;
  if (!user.stripe_customer_id) {
    customerId = await createStripeCustomer();
  } else {
    try {
      const existing = await stripe.customers.retrieve(user.stripe_customer_id);
      if (existing.deleted) throw new Error("customer deleted");
      customerId = user.stripe_customer_id;
    } catch {
      customerId = await createStripeCustomer();
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: tier.priceInCents,
    currency: "usd",
    customer: customerId,
    metadata: {
      userId: String(userId),
      githubCreditTierId: tier.id,
    },
    automatic_payment_methods: { enabled: true },
  });

  if (!paymentIntent.client_secret) {
    throw new Error(
      "Failed to create payment intent for GitHub credit purchase",
    );
  }

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  };
}

export interface ConfirmGithubCreditPurchaseResult {
  succeeded: boolean;
  tokens: number;
  balance: number;
}

/**
 * Confirms a GitHub credit purchase directly against Stripe via its
 * PaymentIntent id -- mirrors confirmAiCreditPurchase above exactly. The
 * webhook's payment_intent.succeeded handler stays the backup path for a
 * closed tab / lost connection.
 */
export async function confirmGithubCreditPurchase(
  paymentIntentId: string,
): Promise<ConfirmGithubCreditPurchaseResult> {
  const sessionUser = await getSession();
  if (!sessionUser) {
    throw new Error(
      "User must be logged in to confirm a GitHub credit purchase",
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured on this server.");
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (paymentIntent.metadata?.userId !== String(sessionUser.userId)) {
    throw new Error("This purchase does not belong to your account");
  }

  const tier = getGithubCreditTier(
    paymentIntent.metadata?.githubCreditTierId || "",
  );
  const succeeded = paymentIntent.status === "succeeded" && !!tier;

  if (succeeded) {
    await creditGithubCreditPurchase(
      paymentIntent.id,
      sessionUser.userId,
      tier!.tokens,
    );
  }

  const balance = await getGithubCreditBalance(sessionUser.userId);

  return {
    succeeded,
    tokens: succeeded ? tier!.tokens : 0,
    balance,
  };
}
