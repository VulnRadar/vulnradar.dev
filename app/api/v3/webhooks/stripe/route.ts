import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/billing/stripe";
import { getPlanFromProductId } from "@/lib/billing/products";
import { getPaidPlans, type PlanId } from "@/lib/billing/catalog";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/subscription-status";
import { grantPremiumBadge, revokePremiumBadge } from "@/lib/billing/badges";
import { getAiCreditTier } from "@/lib/billing/ai-credit-catalog";
import { creditAiCreditPurchase } from "@/lib/billing/ai-usage";
import { getGithubCreditTier } from "@/lib/billing/github-credit-catalog";
import { creditGithubCreditPurchase } from "@/lib/billing/github-review-usage";
import pool from "@/lib/database/db";
import Stripe from "stripe";

// getPlanFromProductId() only recognizes our own catalog ids (e.g.
// "core_supporter_monthly"), never a raw Stripe product id like
// "prod_abc123". createSubscription() stamps our id into the Stripe
// product's own metadata at creation time (product_data.metadata.productId
// in app/actions/stripe.ts), so when all we have is the raw Stripe product
// id (e.g. after a Billing Portal-initiated plan change didn't carry our
// subscription metadata forward), look it up there instead of silently
// falling back to "free".
async function resolvePlanFromStripeProductId(
  stripe: Stripe,
  rawStripeProductId: string,
): Promise<PlanId | ""> {
  if (!rawStripeProductId) return "";
  try {
    const product = await stripe.products.retrieve(rawStripeProductId);
    const ourProductId = product.metadata?.productId || "";
    return ourProductId ? getPlanFromProductId(ourProductId) : "";
  } catch (err) {
    console.error("[Stripe] Failed to resolve plan from product id:", err);
    return "";
  }
}

const PAID_PLAN_IDS: readonly PlanId[] = getPaidPlans().map((p) => p.id);

// Get webhook secret lazily to avoid issues during build time
function getWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET environment variable is not set");
  }
  return secret;
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 503 },
    );
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, getWebhookSecret());
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency: Stripe retries events on any 5xx, and operators can also
  // replay from the dashboard. Without this guard a single
  // customer.subscription.created event would plan-upgrade the user
  // twice (and re-grant the premium badge, etc.).
  try {
    const seen = await pool.query<{ event_id: string }>(
      `INSERT INTO processed_stripe_events (event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.id, event.type],
    );
    if (seen.rowCount === 0) {
      return NextResponse.json({ received: true, replay: true });
    }
  } catch (err) {
    // If the table doesn't exist yet (fresh deploy) we still want to
    // process the event; fall through and log.
    console.error("[Stripe] idempotency check failed (continuing):", err);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // "unpaid" means the session completed (e.g. the form was
        // submitted) but the payment itself didn't go through -- granting
        // access on that is the same class of bug as gating below on
        // subscription.status.
        const sessionIsPaid = session.payment_status !== "unpaid";

        // AI credit purchases no longer go through a Checkout Session at
        // all (see app/actions/stripe.ts's createAiCreditPaymentIntent,
        // which creates a real PaymentIntent directly and confirms it
        // through Stripe Elements on app/checkout/credits/page.tsx) -- the
        // payment_intent.succeeded case below is where those get credited
        // now. Every session this route still sees here is a real
        // subscription checkout.
        const customerEmail = session.customer_email;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        // Get userId and planId directly from session metadata (set in startCheckoutSession)
        const userId = session.metadata?.userId
          ? parseInt(session.metadata.userId, 10)
          : null;
        let plan = session.metadata?.planId || "";

        // Validate the plan is a valid supporter plan
        if (!plan || !PAID_PLAN_IDS.includes(plan as PlanId)) {
          // Try to get from subscription metadata
          if (subscriptionId) {
            const subscription =
              await stripe.subscriptions.retrieve(subscriptionId);
            plan =
              subscription.metadata?.planId ||
              subscription.metadata?.productId ||
              "";

            // Last resort: check product name
            if (!plan && subscription.items?.data?.[0]) {
              const productName =
                subscription.items.data[0].price?.nickname || "";
              if (productName.toLowerCase().includes("elite"))
                plan = "elite_supporter";
              else if (productName.toLowerCase().includes("pro"))
                plan = "pro_supporter";
              else if (productName.toLowerCase().includes("core"))
                plan = "core_supporter";
            }
          }
        }

        if (subscriptionId) {
          let result;
          const planToWrite = plan && sessionIsPaid ? plan : "free";
          const statusToWrite = sessionIsPaid ? "active" : "incomplete";

          // Primary: Update by userId if available (most reliable - ID never changes)
          if (userId) {
            result = await pool.query(
              `UPDATE users SET
                plan = $1,
                stripe_customer_id = $2,
                stripe_subscription_id = $3,
                subscription_status = $4
              WHERE id = $5
              RETURNING id, email`,
              [planToWrite, customerId, subscriptionId, statusToWrite, userId],
            );
            if (result.rowCount && result.rowCount > 0) {
              console.log(
                `[Stripe] User ID ${userId} upgraded to ${planToWrite}`,
              );
              if (sessionIsPaid) await grantPremiumBadge(userId);
            }
          }

          // Fallback: Update by email if userId lookup failed
          if ((!result || result.rowCount === 0) && customerEmail) {
            result = await pool.query(
              `UPDATE users SET
                plan = $1,
                stripe_customer_id = $2,
                stripe_subscription_id = $3,
                subscription_status = $4
              WHERE LOWER(email) = LOWER($5)
              RETURNING id, email`,
              [
                planToWrite,
                customerId,
                subscriptionId,
                statusToWrite,
                customerEmail,
              ],
            );
            if (result.rowCount && result.rowCount > 0) {
              // log userId (already known from
              // RETURNING) instead of customerEmail. PII stays out of
              // log aggregators.
              console.log(
                `[Stripe] User ID ${result.rows[0].id} upgraded to ${planToWrite} (by-email fallback)`,
              );
              if (sessionIsPaid) await grantPremiumBadge(result.rows[0].id);
            } else {
              // No PII in this branch either — we don't have a userId to
              // log, but we can log the Stripe event id for correlation.
              console.log(
                `[Stripe] checkout.session.completed but no user found (event ${event.id})`,
              );
            }
          }
        }
        break;
      }

      case "customer.subscription.created": {
        // New subscription created - update user's plan
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Get userId and planId from subscription metadata (set in startCheckoutSession)
        const userId = subscription.metadata?.userId
          ? parseInt(subscription.metadata.userId, 10)
          : null;
        let plan = subscription.metadata?.planId || "";

        // Fallback: try to get plan from productId
        if (!plan || !PAID_PLAN_IDS.includes(plan as PlanId)) {
          const productId = subscription.metadata?.productId || "";
          plan = getPlanFromProductId(productId);
        }

        // Fallback: try to extract from price/product
        if (!plan || plan === "free") {
          const rawStripeProductId =
            (subscription.items?.data?.[0]?.price?.product as string) || "";
          plan =
            (await resolvePlanFromStripeProductId(
              stripe,
              rawStripeProductId,
            )) || plan;
        }

        // This event fires the instant Stripe creates the subscription
        // object, while it's still "incomplete" and nothing has been
        // charged -- writing the resolved plan straight to the users row
        // here (as this used to) granted paid-plan feature limits (scan
        // count, etc.) to anyone who merely clicked a plan, before they
        // ever completed payment. Only write the real plan once the
        // subscription is genuinely paid; otherwise leave the account on
        // "free" (customer.subscription.updated picks up the later
        // incomplete -> active transition and writes the real plan then).
        const planToWrite =
          plan && ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)
            ? plan
            : "free";

        let result;

        // Primary: Update by userId if available (most reliable)
        if (userId) {
          result = await pool.query(
            `UPDATE users SET
              plan = $1,
              stripe_subscription_id = $2,
              subscription_status = $3,
              stripe_customer_id = $4
            WHERE id = $5
            RETURNING id`,
            [
              planToWrite,
              subscription.id,
              subscription.status,
              customerId,
              userId,
            ],
          );
          if (result.rowCount && result.rowCount > 0) {
            console.log(
              `[Stripe] Subscription created for user ID ${userId}, plan: ${planToWrite}, status: ${subscription.status}`,
            );
            if (planToWrite !== "free") {
              await grantPremiumBadge(userId);
            }
          }
        }

        // Fallback: Try stripe_customer_id
        if (!result || result.rowCount === 0) {
          result = await pool.query(
            `UPDATE users SET
              plan = $1,
              stripe_subscription_id = $2,
              subscription_status = $3
            WHERE stripe_customer_id = $4
            RETURNING id`,
            [planToWrite, subscription.id, subscription.status, customerId],
          );
          if (result.rowCount && result.rowCount > 0) {
            console.log(
              `[Stripe] Subscription created for customer ${customerId}, plan: ${planToWrite}, status: ${subscription.status}`,
            );
            if (planToWrite !== "free") {
              await grantPremiumBadge(result.rows[0].id);
            }
          }
        }

        // Last fallback: Try email from Stripe customer
        if (!result || result.rowCount === 0) {
          const customer = (await stripe.customers.retrieve(
            customerId,
          )) as Stripe.Customer;
          if (customer.email) {
            result = await pool.query(
              `UPDATE users SET
                plan = $1,
                stripe_subscription_id = $2,
                subscription_status = $3,
                stripe_customer_id = $4
              WHERE LOWER(email) = LOWER($5)
              RETURNING id`,
              [
                planToWrite,
                subscription.id,
                subscription.status,
                customerId,
                customer.email,
              ],
            );
            if (result.rowCount && result.rowCount > 0) {
              // log userId from RETURNING
              // instead of customer.email. PII stays out of logs.
              console.log(
                `[Stripe] Subscription created for user ID ${result.rows[0].id}, plan: ${planToWrite}, status: ${subscription.status}`,
              );
              if (planToWrite !== "free") {
                await grantPremiumBadge(result.rows[0].id);
              }
            } else {
              console.log(
                `[Stripe] Subscription created but no user found (event ${event.id})`,
              );
            }
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Get productId from subscription metadata first
        let productId = subscription.metadata?.productId || "";
        let plan = getPlanFromProductId(productId);

        // Fallback: try to extract from price/product
        if (!plan || plan === "free") {
          const rawStripeProductId =
            (subscription.items?.data?.[0]?.price?.product as string) || "";
          plan =
            (await resolvePlanFromStripeProductId(
              stripe,
              rawStripeProductId,
            )) || plan;
        }

        // A subscription created with payment_behavior: "default_incomplete"
        // (app/actions/stripe.ts) starts life "incomplete" --
        // customer.subscription.created fires for that object before
        // payment is confirmed, and both the plan and the badge are
        // correctly withheld there. The transition to "active" once the
        // client confirms the PaymentElement lands here instead, so this is
        // where a completed checkout actually gets its plan and badge.
        // Symmetrically, if the 23-hour confirmation window lapses the
        // subscription goes straight to "incomplete_expired" (or "unpaid"
        // after repeated invoice failures) WITHOUT a
        // customer.subscription.deleted event ever firing, so a plan/badge
        // granted earlier would otherwise never get revoked -- gating both
        // on the same isPaid check here handles every non-terminal status
        // (plain "incomplete" included) the same way, not just those two.
        const isPaid = ACTIVE_SUBSCRIPTION_STATUSES.includes(
          subscription.status,
        );
        const planToWrite = isPaid ? plan || "free" : "free";

        // Stripe fires customer.subscription.updated on ANY field change to
        // the subscription object (e.g. a retried payment attempt on an
        // already-incomplete_expired subscription touches latest_invoice),
        // not just the plan/status fields we care about -- a subscription
        // stuck in a bad state can generate a steady stream of genuinely
        // distinct events (so the idempotency guard above correctly lets
        // each one through) that are still no-ops from our side. The
        // "IS DISTINCT FROM" guard only writes and logs when plan or status
        // actually changed, instead of re-running the same UPDATE and
        // re-emitting the same log line for every no-op event.
        const result = await pool.query(
          `UPDATE users SET
            plan = $1,
            subscription_status = $2
          WHERE stripe_customer_id = $3
            AND (plan IS DISTINCT FROM $1 OR subscription_status IS DISTINCT FROM $2)
          RETURNING id`,
          [planToWrite, subscription.status, customerId],
        );
        if (result.rowCount && result.rowCount > 0) {
          const userId = result.rows[0].id;
          if (planToWrite !== "free") {
            await grantPremiumBadge(userId);
          } else {
            await revokePremiumBadge(userId);
          }
          console.log(
            `[Stripe] Subscription updated for customer ${customerId}, plan: ${planToWrite}, status: ${subscription.status}`,
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Downgrade to free plan and revoke premium badge. billing: a
        // staff account (lib/billing/staff-plan.ts) already holds a real,
        // granted pro_supporter floor -- a real paid subscription (e.g.
        // Elite) ending, however it ended, lands back on that floor, not
        // all the way to free. Matches the synchronous immediate-cancel
        // routes (app/api/v3/billing/subscription/cancel,
        // app/api/v3/billing POST cancel_immediately), which this webhook
        // otherwise duplicates/races with for the immediate-cancel path.
        const result = await pool.query(
          `UPDATE users SET
            plan = CASE WHEN role IN ('admin', 'moderator', 'support') THEN 'pro_supporter' ELSE 'free' END,
            subscription_status = 'canceled',
            stripe_subscription_id = NULL
          WHERE stripe_customer_id = $1
          RETURNING id`,
          [customerId],
        );
        if (result.rowCount && result.rowCount > 0) {
          await revokePremiumBadge(result.rows[0].id);
        }
        console.log(
          `[Stripe] Subscription canceled for customer ${customerId}`,
        );
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        if (customerId) {
          // Update subscription status to active (this is the important part)
          await pool.query(
            `UPDATE users SET subscription_status = 'active' WHERE stripe_customer_id = $1`,
            [customerId],
          );

          // Try to record in billing history (optional - don't fail if table doesn't exist)
          try {
            await pool.query(
              `INSERT INTO billing_history 
                (user_id, stripe_invoice_id, stripe_payment_intent_id, amount_cents, currency, status, description, invoice_pdf_url)
              SELECT id, $1, $2, $3, $4, $5, $6, $7
              FROM users WHERE stripe_customer_id = $8`,
              [
                invoice.id,
                (invoice as unknown as { payment_intent?: string })
                  .payment_intent ?? null,
                invoice.amount_paid,
                invoice.currency,
                "succeeded",
                invoice.description ||
                  `Payment for ${invoice.lines?.data?.[0]?.description || "subscription"}`,
                invoice.invoice_pdf,
                customerId,
              ],
            );
          } catch (historyErr) {
            // billing_history table might not exist - log but don't fail
            console.log(
              `[Stripe] Could not record billing history (table may not exist):`,
              historyErr,
            );
          }

          console.log(`[Stripe] Payment succeeded for customer ${customerId}`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        await pool.query(
          `UPDATE users SET subscription_status = 'past_due' WHERE stripe_customer_id = $1`,
          [customerId],
        );
        console.log(`[Stripe] Payment failed for customer ${customerId}`);
        break;
      }

      case "payment_intent.succeeded": {
        // Backup path for a one-time AI credit purchase
        // (app/actions/stripe.ts's createAiCreditPaymentIntent) -- the
        // fast/primary path is confirmAiCreditPurchase, called the instant
        // the client confirms payment on app/checkout/credits/page.tsx.
        // This covers the closed-tab / lost-connection case, same
        // redundancy reasoning customer.subscription.created gives the
        // subscription flow.
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const tierId = paymentIntent.metadata?.aiCreditTierId;

        // Every PaymentIntent Stripe has ever created fires this event,
        // including a subscription's own invoice PaymentIntent (see
        // createSubscription above) -- those never carry aiCreditTierId, so
        // this is the normal, silent no-op path for anything that isn't an
        // AI credit purchase, not an error.
        if (!tierId) break;

        const tier = getAiCreditTier(tierId);
        const purchaserId = paymentIntent.metadata?.userId
          ? parseInt(paymentIntent.metadata.userId, 10)
          : null;

        if (tier && purchaserId) {
          const result = await creditAiCreditPurchase(
            paymentIntent.id,
            purchaserId,
            tier.tokens,
          );
          if (result.credited) {
            console.log(
              `[Stripe] Credited ${tier.tokens.toLocaleString()} AI tokens to user ID ${purchaserId} (tier ${tier.id}, payment_intent.succeeded)`,
            );
          }
        } else {
          // Stamped with an aiCreditTierId but we can't resolve the tier or
          // the purchaser -- should never happen for a PaymentIntent this
          // app created (both are always stamped into metadata by
          // createAiCreditPaymentIntent), but don't silently drop a real
          // payment without a trace.
          console.error(
            `[Stripe] payment_intent.succeeded has aiCreditTierId but missing/invalid userId or an unknown tier (event ${event.id})`,
          );
        }

        // Backup path for a one-time GitHub review credit purchase
        // (app/actions/stripe.ts's createGithubCreditPaymentIntent) --
        // mirrors the AI credit branch above exactly, for a completely
        // separate metadata key and catalog. A PaymentIntent only ever
        // carries one of aiCreditTierId/githubCreditTierId, never both, so
        // this doesn't need to be exclusive with the block above.
        const githubTierId = paymentIntent.metadata?.githubCreditTierId;
        if (githubTierId) {
          const githubTier = getGithubCreditTier(githubTierId);
          const githubPurchaserId = paymentIntent.metadata?.userId
            ? parseInt(paymentIntent.metadata.userId, 10)
            : null;

          if (githubTier && githubPurchaserId) {
            const result = await creditGithubCreditPurchase(
              paymentIntent.id,
              githubPurchaserId,
              githubTier.tokens,
            );
            if (result.credited) {
              console.log(
                `[Stripe] Credited ${githubTier.tokens.toLocaleString()} GitHub review tokens to user ID ${githubPurchaserId} (tier ${githubTier.id}, payment_intent.succeeded)`,
              );
            }
          } else {
            console.error(
              `[Stripe] payment_intent.succeeded has githubCreditTierId but missing/invalid userId or an unknown tier (event ${event.id})`,
            );
          }
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 },
    );
  }
}
