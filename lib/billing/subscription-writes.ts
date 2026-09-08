import pool from "@/lib/database/db";
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  LIVE_SUBSCRIPTION_STATUSES,
} from "@/lib/billing/subscription-status";
import {
  staffPlanFloorCase,
  STAFF_PLAN_FLOOR_ROLES,
} from "@/lib/billing/staff-plan";

/**
 * Every write the Stripe webhook makes to a users row's subscription state,
 * and the one rule they all share.
 *
 * Stripe delivers subscription events keyed on the customer, and a customer
 * can hold more than one subscription: a checkout that ran twice, an
 * abandoned incomplete alongside the one that was actually paid for, an old
 * one Stripe has not finished expiring. Every handler here used to write on
 * `WHERE stripe_customer_id = $1` alone, so whichever event arrived last won
 * regardless of which subscription it described. A stale `created` for the
 * abandoned subscription downgraded a paying account to free and revoked its
 * badge; a `deleted` for the abandoned one cancelled the live one outright.
 *
 * Stripe also makes no ordering promise, so "arrived last" is not even
 * "happened last". `created` is the one event whose position in the sequence
 * is known for certain: it is always first. Anything already recorded against
 * that subscription id is therefore newer than it, which is what
 * subscriptionCreateGuardSql below encodes.
 *
 * The rule: a users row already bound to a live subscription is only ever
 * moved by that subscription's own events. A row bound to nothing, or bound
 * to a subscription that has already ended, is free to be claimed.
 */

/**
 * `roleParam`-style placeholders, matching staffPlanFloorCase: the caller
 * binds LIVE_SUBSCRIPTION_STATUSES to `liveStatusesParam`, and no literal here
 * is ever caller input.
 */
function subscriptionOwnershipSql(
  subscriptionIdParam: string,
  liveStatusesParam: string,
): string {
  return `(
      stripe_subscription_id IS NULL
      OR stripe_subscription_id = ${subscriptionIdParam}
      OR subscription_status IS NULL
      OR NOT (subscription_status = ANY(${liveStatusesParam}::text[]))
    )`;
}

/**
 * Ownership, plus the extra condition only `created` gets: it must not touch a
 * row that already knows this subscription. Something newer put the id there,
 * whether a later webhook or the checkout confirmation the buyer sat through,
 * and this event's snapshot predates all of it.
 */
function subscriptionCreateGuardSql(
  subscriptionIdParam: string,
  liveStatusesParam: string,
): string {
  return `(
      stripe_subscription_id IS DISTINCT FROM ${subscriptionIdParam}
      AND ${subscriptionOwnershipSql(subscriptionIdParam, liveStatusesParam)}
    )`;
}

export interface SubscriptionStateWrite {
  subscriptionId: string;
  customerId: string;
  plan: string;
  status: string;
  billingInterval: string | null;
}

/**
 * How the `created` handler found its user. It tries the id from subscription
 * metadata first, then the stored customer id, then the customer's email,
 * and the SET list is the same for all three.
 */
export type SubscriptionMatch =
  | { by: "id"; userId: number }
  | { by: "customer" }
  | { by: "email"; email: string };

/** The users row a write landed on, or null when the guard refused it. */
export interface SubscriptionWriteResult {
  userId: number | null;
}

export async function applySubscriptionCreated(
  write: SubscriptionStateWrite,
  match: SubscriptionMatch,
): Promise<SubscriptionWriteResult> {
  const params: unknown[] = [
    write.plan,
    write.subscriptionId,
    write.status,
    write.customerId,
    write.billingInterval,
    LIVE_SUBSCRIPTION_STATUSES,
  ];
  let matchClause: string;
  if (match.by === "id") {
    params.push(match.userId);
    matchClause = "id = $7";
  } else if (match.by === "email") {
    params.push(match.email);
    matchClause = "LOWER(email) = LOWER($7)";
  } else {
    matchClause = "stripe_customer_id = $4";
  }

  const result = await pool.query<{ id: number }>(
    `UPDATE users SET
        plan = $1,
        stripe_subscription_id = $2,
        subscription_status = $3,
        stripe_customer_id = $4,
        billing_interval = $5
      WHERE ${matchClause}
        AND ${subscriptionCreateGuardSql("$2", "$6")}
      RETURNING id`,
    params,
  );
  return { userId: result.rows[0]?.id ?? null };
}

/**
 * The `updated` handler's write. It claims stripe_subscription_id as well as
 * the plan, which is what makes the create guard above able to tell a first
 * event from a replayed one, and what stops a row going active with no
 * subscription id recorded when the create event never matched a user.
 *
 * The IS DISTINCT FROM tail is not the ownership rule, it is a no-op filter:
 * Stripe fires this event on ANY change to the subscription object, including
 * ones that touch nothing we store, and without it every one of those re-ran
 * the same UPDATE and re-emitted the same log line.
 */
export async function applySubscriptionUpdated(
  write: SubscriptionStateWrite,
): Promise<SubscriptionWriteResult> {
  const result = await pool.query<{ id: number }>(
    `UPDATE users SET
        plan = $1,
        subscription_status = $2,
        billing_interval = $4,
        stripe_subscription_id = $5
      WHERE stripe_customer_id = $3
        AND ${subscriptionOwnershipSql("$5", "$6")}
        AND (plan IS DISTINCT FROM $1
          OR subscription_status IS DISTINCT FROM $2
          OR billing_interval IS DISTINCT FROM $4
          OR stripe_subscription_id IS DISTINCT FROM $5)
      RETURNING id`,
    [
      write.plan,
      write.status,
      write.customerId,
      write.billingInterval,
      write.subscriptionId,
      LIVE_SUBSCRIPTION_STATUSES,
    ],
  );
  return { userId: result.rows[0]?.id ?? null };
}

/**
 * A staff account (lib/billing/staff-plan.ts) already holds a real, granted
 * plan floor, so a paid subscription ending lands back on that floor rather
 * than all the way on free. Matches the two synchronous cancel routes this
 * webhook otherwise races.
 */
export async function applySubscriptionDeleted(params: {
  subscriptionId: string;
  customerId: string;
}): Promise<SubscriptionWriteResult> {
  const result = await pool.query<{ id: number }>(
    `UPDATE users SET
        plan = ${staffPlanFloorCase("$3")},
        subscription_status = 'canceled',
        stripe_subscription_id = NULL,
        billing_interval = NULL
      WHERE stripe_customer_id = $1
        AND ${subscriptionOwnershipSql("$2", "$4")}
      RETURNING id`,
    [
      params.customerId,
      params.subscriptionId,
      STAFF_PLAN_FLOOR_ROLES,
      LIVE_SUBSCRIPTION_STATUSES,
    ],
  );
  return { userId: result.rows[0]?.id ?? null };
}

/**
 * A paid subscription invoice clears whatever dunning state the row was in.
 *
 * "canceling" is left alone: the customer asked for the subscription to stop
 * at the end of the period, and overwriting that with "active" made the
 * profile page claim the cancellation had not happened. Nothing writes
 * "canceling" back afterwards, so it was lost for good.
 */
export async function markSubscriptionPaid(params: {
  subscriptionId: string;
  customerId: string;
}): Promise<SubscriptionWriteResult> {
  const result = await pool.query<{ id: number }>(
    `UPDATE users SET subscription_status = 'active'
      WHERE stripe_customer_id = $1
        AND ${subscriptionOwnershipSql("$2", "$3")}
        AND subscription_status IS DISTINCT FROM 'canceling'
      RETURNING id`,
    [params.customerId, params.subscriptionId, LIVE_SUBSCRIPTION_STATUSES],
  );
  return { userId: result.rows[0]?.id ?? null };
}

/**
 * Dunning, and only dunning: past_due is a statement about a subscription that
 * WAS paying and whose renewal just failed. It used to be written for any
 * failed invoice belonging to the customer, so a one-off invoice, a first
 * invoice on a subscription that never completed, or a retry against an
 * account that had already cancelled all stamped past_due onto the row. None
 * of those has a later success to clear it and no subscription left to send
 * one, which is how accounts ended up reading "past due" permanently.
 *
 * ACTIVE_SUBSCRIPTION_STATUSES rather than the live list: a cancel-at-period-
 * end subscription keeps its "canceling" state, since the pending cancellation
 * is the thing the customer chose and the plan is unaffected either way.
 */
export async function markSubscriptionPastDue(params: {
  subscriptionId: string;
  customerId: string;
}): Promise<SubscriptionWriteResult> {
  const result = await pool.query<{ id: number }>(
    `UPDATE users SET subscription_status = 'past_due'
      WHERE stripe_customer_id = $1
        AND (stripe_subscription_id IS NULL OR stripe_subscription_id = $2)
        AND subscription_status = ANY($3::text[])
      RETURNING id`,
    [params.customerId, params.subscriptionId, ACTIVE_SUBSCRIPTION_STATUSES],
  );
  return { userId: result.rows[0]?.id ?? null };
}
