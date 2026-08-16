import pool from "@/lib/database/db";
import { getUserPlanLimits } from "@/lib/billing/plan-limits";

/**
 * Calendar-month usage tracking for the browserbaseMinutesPerMonth plan
 * limit -- how many live-browser (Browserbase) session minutes a user has
 * used this month, and the purchased top-up balance spent as a fallback
 * once that free monthly allowance runs out.
 *
 * Mirrors lib/billing/ai-usage.ts's shape closely (fixed-window counter +
 * purchased balance + idempotent crediting), with two real differences:
 *
 * 1. Bucketed by calendar month, not a fixed AI_USAGE_WINDOW_HOURS slice --
 *    a live-browser minute allowance reads naturally as "this month," and
 *    there's no shared window this needs to line up with the way
 *    github-review-usage.ts's window has to match ai-usage.ts's.
 * 2. Usage is recorded in SECONDS, not minutes -- a session's actual
 *    duration is measured in seconds (see app/api/v3/browser/sessions/
 *    route.ts's DELETE handler), and truncating to whole minutes per
 *    session before accumulating would silently lose a fraction of a
 *    minute on every single session, adding up over many short sessions.
 *    Limits are still expressed and displayed in minutes; conversion
 *    happens at the edges (checkBrowserbaseQuota, the billing API route).
 */

/** UTC start of the calendar month `date` falls into. */
export function currentPeriodStart(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Real (not estimated) seconds used so far in the given period. */
export async function getBrowserbaseSecondsUsed(
  userId: number,
  periodStart: Date,
): Promise<number> {
  const result = await pool.query<{ seconds_used: number }>(
    "SELECT seconds_used FROM browserbase_usage WHERE user_id = $1 AND period_start = $2",
    [userId, periodStart],
  );
  return result.rows[0]?.seconds_used ?? 0;
}

/**
 * Purchased live-browser minute balance (users.browserbase_credit_seconds_balance,
 * stored in seconds -- see this file's own header comment for why), bought
 * via app/actions/stripe.ts's createBrowserbaseCreditPaymentIntent and
 * credited by creditBrowserbaseCreditPurchase below. Unlike the monthly
 * counter above, this is NEVER reset by the period: it only goes up (a
 * purchase) or down (a recordBrowserbaseSeconds spend past the free
 * allowance).
 */
export async function getBrowserbaseCreditBalanceSeconds(
  userId: number,
): Promise<number> {
  const result = await pool.query<{
    browserbase_credit_seconds_balance: number;
  }>("SELECT browserbase_credit_seconds_balance FROM users WHERE id = $1", [
    userId,
  ]);
  return result.rows[0]?.browserbase_credit_seconds_balance ?? 0;
}

/**
 * Adds to the user's Browserbase credit balance. A plain, non-idempotent
 * `+` -- calling this twice for the same purchase double-credits the user.
 * Callers crediting a Stripe purchase must go through
 * creditBrowserbaseCreditPurchase below instead of calling this directly.
 */
export async function addBrowserbaseCreditBalanceSeconds(
  userId: number,
  seconds: number,
): Promise<void> {
  if (seconds <= 0) return;
  await pool.query(
    `UPDATE users SET browserbase_credit_seconds_balance = browserbase_credit_seconds_balance + $2 WHERE id = $1`,
    [userId, seconds],
  );
}

/**
 * Idempotently applies ONE successful Browserbase credit PaymentIntent to a
 * user's balance -- same "two independent code paths can each try to credit
 * the same purchase" concern and same real guard as
 * lib/billing/ai-usage.ts's creditAiCreditPurchase (confirmBrowserbaseCreditPurchase,
 * the fast path, vs. the Stripe webhook's payment_intent.succeeded handler,
 * the backup path). The INSERT ... ON CONFLICT DO NOTHING against
 * browserbase_credit_purchases (payment_intent_id PRIMARY KEY) succeeds for
 * only the first caller to reach it for a given PaymentIntent id.
 */
export async function creditBrowserbaseCreditPurchase(
  paymentIntentId: string,
  userId: number,
  seconds: number,
): Promise<{ credited: boolean }> {
  if (seconds <= 0) return { credited: false };
  const result = await pool.query(
    `INSERT INTO browserbase_credit_purchases (payment_intent_id, user_id, seconds)
     VALUES ($1, $2, $3)
     ON CONFLICT (payment_intent_id) DO NOTHING
     RETURNING payment_intent_id`,
    [paymentIntentId, userId, seconds],
  );
  if ((result.rowCount ?? 0) === 0) return { credited: false };
  await addBrowserbaseCreditBalanceSeconds(userId, seconds);
  return { credited: true };
}

/**
 * Adds `seconds` (the actual elapsed duration of one ended session -- see
 * app/api/v3/browser/sessions/route.ts's DELETE handler) to the user's
 * counter for the given period. Called after a session ends, not before
 * (its real duration isn't known until then).
 *
 * Spend order: the plan's free browserbaseMinutesPerMonth allowance (in
 * seconds) is always consumed first, and only the portion of THIS session's
 * seconds that lands above that ceiling is charged against the purchased
 * credit balance -- same reasoning and same atomic-UPSERT-then-split
 * mechanics as recordAiTokens in lib/billing/ai-usage.ts (see that
 * function's own comment for the full race-safety argument). A plan with no
 * ceiling or billing disabled entirely (getUserPlanLimits returns null)
 * never touches credits.
 */
export async function recordBrowserbaseSeconds(
  userId: number,
  seconds: number,
  periodStart?: Date,
): Promise<void> {
  if (seconds <= 0) return;
  const start = periodStart ?? currentPeriodStart();

  const result = await pool.query<{ seconds_used: number }>(
    `INSERT INTO browserbase_usage (user_id, period_start, seconds_used, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, period_start)
     DO UPDATE SET seconds_used = browserbase_usage.seconds_used + $3, updated_at = NOW()
     RETURNING seconds_used`,
    [userId, start, seconds],
  );
  const newTotal = result.rows[0]?.seconds_used ?? seconds;

  const limits = await getUserPlanLimits(userId);
  const limitMinutes = limits?.browserbaseMinutesPerMonth ?? -1;
  if (limitMinutes === -1) return;
  const limitSeconds = limitMinutes * 60;

  const previousTotal = newTotal - seconds;
  const periodPortion = Math.max(
    0,
    Math.min(seconds, limitSeconds - previousTotal),
  );
  const creditPortion = seconds - periodPortion;
  if (creditPortion > 0) {
    await pool.query(
      `UPDATE users SET browserbase_credit_seconds_balance = GREATEST(browserbase_credit_seconds_balance - $2, 0) WHERE id = $1`,
      [userId, creditPortion],
    );
  }
}

export interface BrowserbaseQuotaCheck {
  allowed: boolean;
  usedSeconds: number;
  /** -1 means unlimited (billing disabled); otherwise the plan's per-month cap in minutes (a staff caller resolves to the Pro Supporter cap, see getUserPlanLimits). */
  limitMinutes: number;
  /** Start (UTC) of the calendar month this check evaluated against. */
  periodStart: Date;
  /** Present only when allowed is false. */
  message?: string;
  /** Purchased balance, in seconds (see getBrowserbaseCreditBalanceSeconds)
   *  -- resolved on every branch so callers like Profile > Billing can
   *  always show it accurately. */
  creditBalanceSeconds: number;
}

/**
 * Pre-create quota check: called before a new Browserbase session is
 * allowed to start (see app/api/v3/browser/sessions/route.ts's POST
 * handler). Same per-call, not per-second, granularity as
 * checkAiUsageQuota: a session is allowed to start as long as ANY budget
 * remains (free allowance or purchased balance), and the exact split of
 * that session's real duration between the two pools is resolved after it
 * ends, in recordBrowserbaseSeconds -- there's no way to know a session's
 * real duration before it starts, so reserving the full max TTL up front
 * would refuse sessions unnecessarily early.
 */
export async function checkBrowserbaseQuota(
  userId: number,
): Promise<BrowserbaseQuotaCheck> {
  const periodStart = currentPeriodStart();
  const creditBalanceSeconds = await getBrowserbaseCreditBalanceSeconds(userId);

  const limits = await getUserPlanLimits(userId);
  // null means billing is disabled: unlimited.
  if (limits === null) {
    return {
      allowed: true,
      usedSeconds: 0,
      limitMinutes: -1,
      periodStart,
      creditBalanceSeconds,
    };
  }

  const limitMinutes = limits.browserbaseMinutesPerMonth;
  const usedSeconds = await getBrowserbaseSecondsUsed(userId, periodStart);

  if (limitMinutes === 0 && creditBalanceSeconds <= 0) {
    return {
      allowed: false,
      usedSeconds,
      limitMinutes,
      periodStart,
      creditBalanceSeconds,
      message:
        "Live-browser sessions are not available on your plan. Upgrade to use this, or buy Browserbase minutes in Profile > Billing.",
    };
  }

  if (
    limitMinutes !== -1 &&
    usedSeconds >= limitMinutes * 60 &&
    creditBalanceSeconds <= 0
  ) {
    return {
      allowed: false,
      usedSeconds,
      limitMinutes,
      periodStart,
      creditBalanceSeconds,
      message: `You've used your ${limitMinutes} live-browser minute(s) for this month. Upgrade your plan, wait for next month, or buy more minutes in Profile > Billing.`,
    };
  }

  return {
    allowed: true,
    usedSeconds,
    limitMinutes,
    periodStart,
    creditBalanceSeconds,
  };
}
