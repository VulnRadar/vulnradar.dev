import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/billing/stripe";
import { getPlanFromProductId } from "@/lib/billing/products";
import { getPaidPlans, getPlanById, type PlanId } from "@/lib/billing/catalog";
import {
  sendEmail,
  paymentReceiptEmail,
  paymentFailedEmail,
  subscriptionChangedEmail,
  type SubscriptionChangeKind,
} from "@/lib/email/email";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/subscription-status";
import { grantPremiumBadge, revokePremiumBadge } from "@/lib/billing/badges";
import { getAiCreditTier } from "@/lib/billing/ai-credit-catalog";
import {
  creditAiCreditPurchase,
  reverseAiCreditPurchase,
} from "@/lib/billing/ai-usage";
import { getGithubCreditTier } from "@/lib/billing/github-credit-catalog";
import {
  creditGithubCreditPurchase,
  reverseGithubCreditPurchase,
} from "@/lib/billing/github-review-usage";
import { getBrowserbaseCreditTier } from "@/lib/billing/browserbase-credit-catalog";
import {
  creditBrowserbaseCreditPurchase,
  reverseBrowserbaseCreditPurchase,
} from "@/lib/billing/browserbase-usage";
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

// Billing email helpers. Every send built on these runs best-effort AFTER the
// event's business logic, wrapped in its own try/catch: the event is already
// processed and the row already written by the time we email, so a mail
// failure must never change the webhook's 2xx or its idempotency.
async function lookupBillingRecipient(
  customerId: string,
): Promise<{ email: string; plan: string } | null> {
  if (!customerId) return null;
  try {
    const r = await pool.query<{ email: string; plan: string }>(
      "SELECT email, plan FROM users WHERE stripe_customer_id = $1 LIMIT 1",
      [customerId],
    );
    return r.rows[0] ?? null;
  } catch (err) {
    console.error("[Stripe] billing recipient lookup failed:", err);
    return null;
  }
}

function formatBillingDate(unixSeconds: number | null | undefined): string {
  const ms = unixSeconds ? unixSeconds * 1000 : Date.now();
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function planDisplayName(planId: string | null | undefined): string {
  return getPlanById(planId ?? "")?.name ?? "your plan";
}

// Upgrade vs downgrade is decided purely on the plans' monthly price, so a
// move to a pricier tier reads "upgraded" and a cheaper one "downgraded";
// same plan (a reactivation, e.g. past_due -> active) reads "renewed".
function resolveSubscriptionChangeKind(
  oldPlanId: string | null,
  newPlanId: string,
): SubscriptionChangeKind {
  const oldPrice = getPlanById(oldPlanId ?? "")?.priceInCents ?? 0;
  const newPrice = getPlanById(newPlanId)?.priceInCents ?? 0;
  if (newPrice > oldPrice) return "upgraded";
  if (newPrice < oldPrice) return "downgraded";
  return "renewed";
}

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
        // Interval feeds the admin MRR estimate. Mirrors planToWrite: only
        // recorded once the subscription is genuinely paid, null otherwise.
        const intervalToWrite =
          planToWrite !== "free"
            ? (subscription.items?.data?.[0]?.price?.recurring?.interval ??
              null)
            : null;

        let result;

        // Primary: Update by userId if available (most reliable)
        if (userId) {
          result = await pool.query(
            `UPDATE users SET
              plan = $1,
              stripe_subscription_id = $2,
              subscription_status = $3,
              stripe_customer_id = $4,
              billing_interval = $6
            WHERE id = $5
            RETURNING id`,
            [
              planToWrite,
              subscription.id,
              subscription.status,
              customerId,
              userId,
              intervalToWrite,
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
              subscription_status = $3,
              billing_interval = $5
            WHERE stripe_customer_id = $4
            RETURNING id`,
            [
              planToWrite,
              subscription.id,
              subscription.status,
              customerId,
              intervalToWrite,
            ],
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
                stripe_customer_id = $4,
                billing_interval = $6
              WHERE LOWER(email) = LOWER($5)
              RETURNING id`,
              [
                planToWrite,
                subscription.id,
                subscription.status,
                customerId,
                customer.email,
                intervalToWrite,
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

        // Best-effort "subscription started" notice, only when the create
        // event already resolved to a real paid plan (a subscription created
        // straight into an active status). The far more common
        // default_incomplete flow writes "free" here and its real activation
        // email fires later on customer.subscription.updated, so this doesn't
        // double-send for that path.
        if (planToWrite !== "free") {
          try {
            const recipient = await lookupBillingRecipient(customerId);
            if (recipient?.email) {
              await sendEmail({
                to: recipient.email,
                ...subscriptionChangedEmail({
                  kind: "upgraded",
                  planName: planDisplayName(planToWrite),
                  previousPlanName: "Free",
                }),
              });
            }
          } catch (emailErr) {
            console.error(
              "[Stripe] subscription-created email failed:",
              emailErr,
            );
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
        // A subscription set to cancel at period end is still status "active"
        // in Stripe, so persisting the raw status would silently overwrite the
        // "canceling" the cancel route wrote and make the DB (and any UI keyed
        // on subscription_status) claim the subscription is fully active. Keep
        // access (planToWrite is unaffected) but record the pending cancel.
        const statusToWrite =
          isPaid && subscription.cancel_at_period_end
            ? "canceling"
            : subscription.status;
        // Recurring interval feeds the admin MRR estimate (yearly subs are
        // amortized, not counted at the full monthly price). null when the
        // result isn't paid -- there's no recurring charge to attribute.
        const intervalToWrite = isPaid
          ? (subscription.items?.data?.[0]?.price?.recurring?.interval ?? null)
          : null;

        // Capture the account's email and current plan BEFORE the UPDATE
        // below overwrites the plan, so the best-effort change email can tell
        // an upgrade from a downgrade and knows where to send. Read-only and
        // wrapped: it never affects the write or the response.
        let previousRow: { id: number; email: string; plan: string } | null =
          null;
        try {
          const prev = await pool.query<{
            id: number;
            email: string;
            plan: string;
          }>(
            "SELECT id, email, plan FROM users WHERE stripe_customer_id = $1 LIMIT 1",
            [customerId],
          );
          previousRow = prev.rows[0] ?? null;
        } catch (prevErr) {
          console.error(
            "[Stripe] previous-plan read failed (continuing):",
            prevErr,
          );
        }

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
            subscription_status = $2,
            billing_interval = $4
          WHERE stripe_customer_id = $3
            AND (plan IS DISTINCT FROM $1
              OR subscription_status IS DISTINCT FROM $2
              OR billing_interval IS DISTINCT FROM $4)
          RETURNING id`,
          [planToWrite, statusToWrite, customerId, intervalToWrite],
        );
        // Reconcile the premium badge on EVERY event, not only when the UPDATE
        // above changed a row: grant/revoke are idempotent, and gating them on
        // the IS DISTINCT FROM rowcount meant a retry after the row had already
        // been updated (e.g. the first attempt committed the UPDATE then threw
        // in the badge grant) would find rowCount:0 and skip the badge forever.
        const reconcileUserId = result.rows[0]?.id ?? previousRow?.id;
        if (reconcileUserId) {
          if (planToWrite !== "free") {
            await grantPremiumBadge(reconcileUserId);
          } else {
            await revokePremiumBadge(reconcileUserId);
          }
        }
        if (result.rowCount && result.rowCount > 0) {
          console.log(
            `[Stripe] Subscription updated for customer ${customerId}, plan: ${planToWrite}, status: ${subscription.status}`,
          );

          // Best-effort plan-change notice. Only for a real, active paid plan
          // (a move to free / a non-active status is handled by the cancel
          // path and isn't a user-facing "your plan changed" moment). This is
          // where the incomplete -> active first activation lands too, so a
          // brand-new subscriber gets an "upgraded from Free" email here.
          // Reuses previousRow (read before the UPDATE) for both the old plan
          // and the address, so no second lookup is needed.
          if (planToWrite !== "free" && previousRow?.email) {
            try {
              const kind = resolveSubscriptionChangeKind(
                previousRow.plan,
                planToWrite,
              );
              await sendEmail({
                to: previousRow.email,
                ...subscriptionChangedEmail({
                  kind,
                  planName: planDisplayName(planToWrite),
                  previousPlanName:
                    previousRow.plan && previousRow.plan !== planToWrite
                      ? planDisplayName(previousRow.plan)
                      : null,
                }),
              });
            } catch (emailErr) {
              console.error(
                "[Stripe] subscription-updated email failed:",
                emailErr,
              );
            }
          }
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
            stripe_subscription_id = NULL,
            billing_interval = NULL
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

        // Best-effort cancellation notice, only when a user actually matched.
        // The DB row was just reset to free/pro-floor above, so name the plan
        // that was actually canceled from the subscription object's own
        // metadata, not the post-reset row.
        if (result.rowCount && result.rowCount > 0) {
          try {
            const recipient = await lookupBillingRecipient(customerId);
            if (recipient?.email) {
              const canceledPlanId =
                subscription.metadata?.planId ||
                getPlanFromProductId(subscription.metadata?.productId || "") ||
                "";
              await sendEmail({
                to: recipient.email,
                ...subscriptionChangedEmail({
                  kind: "canceled",
                  planName:
                    getPlanById(canceledPlanId)?.name ?? "your subscription",
                }),
              });
            }
          } catch (emailErr) {
            console.error(
              "[Stripe] subscription-canceled email failed:",
              emailErr,
            );
          }
        }
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
            // 42P01 = undefined_table (self-hosted install on a schema
            // predating this table) -- expected, not worth alarming on.
            // Anything else (constraint violation, connection drop, a
            // real bug) goes through console.error so it's captured by
            // the global error-log wrapper (lib/database/error-log-
            // capture.ts only wraps console.error, not console.log) and
            // shows up in the admin Error Logs panel instead of only
            // ever being visible in raw stdout.
            const isMissingTable =
              historyErr instanceof Error &&
              "code" in historyErr &&
              historyErr.code === "42P01";
            if (isMissingTable) {
              console.log(
                `[Stripe] billing_history table does not exist -- skipping history record.`,
              );
            } else {
              console.error(
                `[Stripe] Could not record billing history:`,
                historyErr,
              );
            }
          }

          console.log(`[Stripe] Payment succeeded for customer ${customerId}`);

          // Best-effort receipt (transactional). Skip $0 invoices (trials,
          // fully-discounted cycles): there's nothing to receipt.
          try {
            const recipient = await lookupBillingRecipient(customerId);
            if (recipient?.email && invoice.amount_paid > 0) {
              await sendEmail({
                to: recipient.email,
                ...paymentReceiptEmail({
                  planName: planDisplayName(recipient.plan),
                  amountCents: invoice.amount_paid,
                  currency: invoice.currency,
                  date: formatBillingDate(
                    invoice.status_transitions?.paid_at ?? invoice.created,
                  ),
                  invoiceUrl:
                    invoice.hosted_invoice_url ?? invoice.invoice_pdf ?? null,
                }),
              });
            }
          } catch (emailErr) {
            console.error("[Stripe] payment receipt email failed:", emailErr);
          }
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

        // Best-effort dunning notice (transactional) so the customer can fix
        // the card before the retries run out and the plan drops.
        try {
          const recipient = await lookupBillingRecipient(customerId);
          if (recipient?.email) {
            await sendEmail({
              to: recipient.email,
              ...paymentFailedEmail({
                planName: planDisplayName(recipient.plan),
                amountCents: invoice.amount_due ?? invoice.amount_paid ?? 0,
                currency: invoice.currency,
                nextAttempt: invoice.next_payment_attempt
                  ? formatBillingDate(invoice.next_payment_attempt)
                  : null,
              }),
            });
          }
        } catch (emailErr) {
          console.error("[Stripe] payment failed email failed:", emailErr);
        }
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

        // Backup path for a one-time Browserbase minute credit purchase
        // (app/actions/stripe.ts's createBrowserbaseCreditPaymentIntent) --
        // mirrors the AI/GitHub credit branches above exactly. A
        // PaymentIntent only ever carries one of aiCreditTierId/
        // githubCreditTierId/browserbaseCreditTierId, never more than one,
        // so this doesn't need to be exclusive with the blocks above.
        const browserbaseTierId =
          paymentIntent.metadata?.browserbaseCreditTierId;
        if (browserbaseTierId) {
          const browserbaseTier = getBrowserbaseCreditTier(browserbaseTierId);
          const browserbasePurchaserId = paymentIntent.metadata?.userId
            ? parseInt(paymentIntent.metadata.userId, 10)
            : null;

          if (browserbaseTier && browserbasePurchaserId) {
            const result = await creditBrowserbaseCreditPurchase(
              paymentIntent.id,
              browserbasePurchaserId,
              browserbaseTier.minutes * 60,
            );
            if (result.credited) {
              console.log(
                `[Stripe] Credited ${browserbaseTier.minutes} Browserbase minutes to user ID ${browserbasePurchaserId} (tier ${browserbaseTier.id}, payment_intent.succeeded)`,
              );
            }
          } else {
            console.error(
              `[Stripe] payment_intent.succeeded has browserbaseCreditTierId but missing/invalid userId or an unknown tier (event ${event.id})`,
            );
          }
        }
        break;
      }

      case "charge.refunded": {
        // Claw back a one-time credit purchase whose charge was fully refunded.
        // Partial refunds are logged, not proportionally reversed (rare, and
        // splitting across three token/second ledgers is error-prone). A refund
        // of a subscription invoice matches no credit purchase and is a no-op
        // here -- the subscription lifecycle owns plan/badge.
        const charge = event.data.object as Stripe.Charge;
        if (!charge.refunded) {
          console.log(
            `[Stripe] Partial refund on charge ${charge.id}; not auto-reversing credits (event ${event.id})`,
          );
          break;
        }
        const refundPi =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : (charge.payment_intent?.id ?? null);
        if (!refundPi) break;
        const [aiR, ghR, bbR] = await Promise.all([
          reverseAiCreditPurchase(refundPi),
          reverseGithubCreditPurchase(refundPi),
          reverseBrowserbaseCreditPurchase(refundPi),
        ]);
        if (aiR.reversed)
          console.log(
            `[Stripe] Refund clawed back ${aiR.tokens} AI tokens from user ${aiR.userId} (payment_intent ${refundPi}, event ${event.id})`,
          );
        if (ghR.reversed)
          console.log(
            `[Stripe] Refund clawed back ${ghR.tokens} GitHub review tokens from user ${ghR.userId} (event ${event.id})`,
          );
        if (bbR.reversed)
          console.log(
            `[Stripe] Refund clawed back ${bbR.seconds}s of Browserbase credit from user ${bbR.userId} (event ${event.id})`,
          );
        if (!aiR.reversed && !ghR.reversed && !bbR.reversed)
          console.log(
            `[Stripe] charge.refunded for ${refundPi} matched no credit purchase (likely a subscription refund) (event ${event.id})`,
          );
        break;
      }

      case "charge.dispute.created": {
        // A chargeback: the customer is pulling the money back. Treat it like a
        // refund for one-time credits (the refunded_at guard makes this
        // idempotent with any later charge.refunded). Plan/badge are left to the
        // subscription lifecycle and admin review, since a dispute can be won.
        // Logged at error level so a human sees it.
        const dispute = event.data.object as Stripe.Dispute;
        const disputePi =
          typeof dispute.payment_intent === "string"
            ? dispute.payment_intent
            : (dispute.payment_intent?.id ?? null);
        console.error(
          `[Stripe] Dispute opened (reason: ${dispute.reason}, amount ${dispute.amount} ${dispute.currency}) on payment_intent ${disputePi} (event ${event.id})`,
        );
        if (disputePi) {
          const [aiR, ghR, bbR] = await Promise.all([
            reverseAiCreditPurchase(disputePi),
            reverseGithubCreditPurchase(disputePi),
            reverseBrowserbaseCreditPurchase(disputePi),
          ]);
          if (aiR.reversed)
            console.log(
              `[Stripe] Dispute clawed back ${aiR.tokens} AI tokens from user ${aiR.userId} (event ${event.id})`,
            );
          if (ghR.reversed)
            console.log(
              `[Stripe] Dispute clawed back ${ghR.tokens} GitHub review tokens from user ${ghR.userId} (event ${event.id})`,
            );
          if (bbR.reversed)
            console.log(
              `[Stripe] Dispute clawed back ${bbR.seconds}s of Browserbase credit from user ${bbR.userId} (event ${event.id})`,
            );
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    // The idempotency row was committed BEFORE this handler ran, so without
    // this the failed event is marked processed forever: we return 500, Stripe
    // retries the same event.id, and the retry is dropped as a replay -- the
    // event is applied zero times (a dropped subscription.deleted leaves a
    // cancelled user on their paid plan; a dropped renewal never refreshes).
    // Delete our marker so the retry re-processes. Safe because every handler
    // write here is idempotent (plan UPDATE, credit ON CONFLICT tables).
    try {
      await pool.query(
        `DELETE FROM processed_stripe_events WHERE event_id = $1`,
        [event.id],
      );
    } catch (delErr) {
      console.error(
        "[Stripe] failed to roll back idempotency marker after handler error:",
        delErr,
      );
    }
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 },
    );
  }
}
