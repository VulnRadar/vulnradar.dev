import type Stripe from "stripe";
import pool from "@/lib/database/db";
import { getAiCreditTier } from "@/lib/billing/ai-credit-catalog";
import { getGithubCreditTier } from "@/lib/billing/github-credit-catalog";
import { getBrowserbaseCreditTier } from "@/lib/billing/browserbase-credit-catalog";

/**
 * The parts of a one-time credit purchase's life the Stripe webhook cannot
 * leave to the per-ledger credit and reverse functions: a refund or dispute
 * that arrives before the credit does, and a dispute the merchant wins.
 *
 * Reversal only went one way. A refund processed before the purchase was
 * credited found no ledger row to reverse, did nothing, and the credit that
 * followed went through, so the customer had the money back and kept the
 * tokens. A dispute the merchant won never gave anything back, so a customer
 * whose bank sided with us still lost what they paid for.
 *
 * Three ledgers, one shape. The table, amount and balance names below are
 * module constants and the only identifiers ever interpolated into SQL.
 */
export type CreditKind = "ai" | "github" | "browserbase";

const LEDGERS: Record<
  CreditKind,
  { table: string; amount: string; balance: string }
> = {
  ai: {
    table: "ai_credit_purchases",
    amount: "tokens",
    balance: "ai_credit_balance",
  },
  github: {
    table: "github_credit_purchases",
    amount: "tokens",
    balance: "github_credit_balance",
  },
  browserbase: {
    table: "browserbase_credit_purchases",
    amount: "seconds",
    balance: "browserbase_credit_seconds_balance",
  },
};

const KINDS: readonly CreditKind[] = ["ai", "github", "browserbase"];

/** What a PaymentIntent bought, in the units its ledger stores. */
export interface CreditPurchase {
  kind: CreditKind;
  userId: number;
  amount: number;
}

/**
 * Read from the metadata the create*PaymentIntent actions stamp: exactly one
 * tier key and the buyer's id. Null for anything else, a subscription
 * invoice's own PaymentIntent included.
 */
export function creditPurchaseFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): CreditPurchase | null {
  const userId = metadata?.userId ? parseInt(metadata.userId, 10) : NaN;
  if (!Number.isInteger(userId) || userId <= 0) return null;

  const ai = metadata?.aiCreditTierId
    ? getAiCreditTier(metadata.aiCreditTierId)
    : undefined;
  if (ai) return { kind: "ai", userId, amount: ai.tokens };

  const github = metadata?.githubCreditTierId
    ? getGithubCreditTier(metadata.githubCreditTierId)
    : undefined;
  if (github) return { kind: "github", userId, amount: github.tokens };

  const browserbase = metadata?.browserbaseCreditTierId
    ? getBrowserbaseCreditTier(metadata.browserbaseCreditTierId)
    : undefined;
  if (browserbase) {
    return { kind: "browserbase", userId, amount: browserbase.minutes * 60 };
  }
  return null;
}

/**
 * Writes the purchase into its ledger as already reversed, without crediting
 * anything, for a refund that arrived before the credit did.
 *
 * Both crediting paths (the checkout confirmation and the webhook's backup)
 * insert into the same ledger with ON CONFLICT DO NOTHING and only credit when
 * their insert won, so a row that is already there refuses them. A purchase
 * that was already credited (or already recorded) conflicts here instead and
 * nothing changes. The INSERT ... SELECT skips an account that has since been
 * deleted rather than failing on the foreign key.
 */
export async function recordReversedCreditPurchase(
  paymentIntentId: string,
  purchase: CreditPurchase,
): Promise<boolean> {
  const l = LEDGERS[purchase.kind];
  const result = await pool.query(
    `INSERT INTO ${l.table} (payment_intent_id, user_id, ${l.amount}, refunded_at)
     SELECT $1, id, $3, NOW() FROM users WHERE id = $2
     ON CONFLICT (payment_intent_id) DO NOTHING
     RETURNING payment_intent_id`,
    [paymentIntentId, purchase.userId, purchase.amount],
  );
  return (result.rowCount ?? 0) > 0;
}

/** One ledger a dispute reversed, and what a win would give back. */
export interface DisputeReversal {
  kind: CreditKind;
  userId: number;
  /** The purchase, in the ledger's units. */
  amount: number;
  /**
   * What came off the balance, or for a purchase that was never credited the
   * whole purchase. Spent credit cannot be taken back, so this can be less
   * than `amount`, and it is all a won dispute may restore.
   */
  restorable: number;
  /** True when the purchase had not been credited yet: nothing was removed. */
  neverCredited: boolean;
}

/**
 * Reverses every credit purchase on a disputed PaymentIntent and hands the
 * result to `record` before committing.
 *
 * The balance is floored at zero, so a customer who spent part of the
 * purchase loses only what is left, and a win must give back that and no
 * more: restoring the whole purchase would let somebody buy, spend, dispute,
 * lose the dispute and keep both. How much was taken is known only here, and
 * there is no column for it, so `record` stores it on the Stripe dispute
 * itself. It runs inside the transaction: if it fails the reversal rolls back,
 * the webhook answers 500, and the redelivery starts from the same balance
 * instead of finding the purchase already reversed and the amount lost.
 *
 * With nothing to reverse and a credit purchase to name, the purchase is
 * recorded as reversed, as for a refund, so the credit cannot land after the
 * dispute, and a win grants the whole of it. When even that finds the row
 * already there, a refund reversed the purchase before the dispute opened:
 * `record` still runs, with nothing in it, so a later win knows there is
 * nothing to give back rather than asking a person to restore credit the
 * customer already has the money back for.
 */
export async function reverseCreditsForDispute(
  paymentIntentId: string,
  purchase: CreditPurchase | null,
  record: (reversals: DisputeReversal[]) => Promise<void>,
): Promise<DisputeReversal[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reversals: DisputeReversal[] = [];
    for (const kind of KINDS) {
      const l = LEDGERS[kind];
      const claimed = await client.query<{ user_id: number; amount: string }>(
        `UPDATE ${l.table} SET refunded_at = NOW()
          WHERE payment_intent_id = $1 AND refunded_at IS NULL
          RETURNING user_id, ${l.amount} AS amount`,
        [paymentIntentId],
      );
      const row = claimed.rows[0];
      if (!row) continue;
      const amount = Number(row.amount);
      const held = await client.query<{ balance: string }>(
        `SELECT ${l.balance} AS balance FROM users WHERE id = $1 FOR UPDATE`,
        [row.user_id],
      );
      const balance = Number(held.rows[0]?.balance ?? 0);
      const taken = Math.max(0, Math.min(amount, balance));
      if (taken > 0) {
        await client.query(
          `UPDATE users SET ${l.balance} = ${l.balance} - $1 WHERE id = $2`,
          [taken, row.user_id],
        );
      }
      reversals.push({
        kind,
        userId: row.user_id,
        amount,
        restorable: taken,
        neverCredited: false,
      });
    }

    if (reversals.length === 0 && purchase) {
      const l = LEDGERS[purchase.kind];
      const recorded = await client.query(
        `INSERT INTO ${l.table} (payment_intent_id, user_id, ${l.amount}, refunded_at)
         SELECT $1, id, $3, NOW() FROM users WHERE id = $2
         ON CONFLICT (payment_intent_id) DO NOTHING
         RETURNING payment_intent_id`,
        [paymentIntentId, purchase.userId, purchase.amount],
      );
      if ((recorded.rowCount ?? 0) > 0) {
        reversals.push({
          kind: purchase.kind,
          userId: purchase.userId,
          amount: purchase.amount,
          restorable: purchase.amount,
          neverCredited: true,
        });
      }
    }

    // Zero is recorded too, and so is nothing at all for a purchase a refund
    // already reversed: it is what tells a later win that this dispute was
    // handled and there is simply nothing left to give back.
    if (reversals.length > 0 || purchase) await record(reversals);
    await client.query("COMMIT");
    return reversals;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("[Stripe] dispute reversal rollback failed:", rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Metadata keys the dispute carries its restorable amounts under. */
const RESTORABLE_KEYS: Record<CreditKind, string> = {
  ai: "vulnradar_restorable_ai",
  github: "vulnradar_restorable_github",
  browserbase: "vulnradar_restorable_browserbase",
};

/**
 * Present on every dispute the reversal recorded, including one with no
 * amounts in it, so "recorded, nothing to restore" reads differently from
 * "opened before anything was recorded".
 */
const RECORDED_KEY = "vulnradar_reversal_recorded";

export type RestorableCredits = Partial<Record<CreditKind, number>>;

export function restorableToMetadata(
  reversals: DisputeReversal[],
): Record<string, string> {
  const metadata: Record<string, string> = { [RECORDED_KEY]: "1" };
  for (const r of reversals) {
    metadata[RESTORABLE_KEYS[r.kind]] = String(r.restorable);
  }
  return metadata;
}

/** Null when the dispute carries no record, e.g. one opened before it existed. */
export function restorableFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): RestorableCredits | null {
  const restorable: RestorableCredits = {};
  let found = metadata?.[RECORDED_KEY] !== undefined;
  for (const kind of KINDS) {
    const raw = metadata?.[RESTORABLE_KEYS[kind]];
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 0) continue;
    restorable[kind] = n;
    found = true;
  }
  return found ? restorable : null;
}

/**
 * Gives back what a lost-then-won dispute took, ledger by ledger.
 *
 * Clearing refunded_at is the claim, so a redelivered close restores nothing a
 * second time, and the row is a normal credited purchase again: a later refund
 * reverses it like any other.
 */
export async function restoreCreditsAfterDispute(
  paymentIntentId: string,
  restorable: RestorableCredits,
): Promise<Array<{ kind: CreditKind; userId: number; amount: number }>> {
  const restored: Array<{ kind: CreditKind; userId: number; amount: number }> =
    [];
  for (const kind of KINDS) {
    const amount = restorable[kind];
    if (amount === undefined) continue;
    const l = LEDGERS[kind];
    const result = await pool.query<{ user_id: number }>(
      `WITH restored AS (
         UPDATE ${l.table} SET refunded_at = NULL
          WHERE payment_intent_id = $1 AND refunded_at IS NOT NULL
          RETURNING user_id
       ), upd AS (
         UPDATE users SET ${l.balance} = ${l.balance} + $2
          WHERE id = (SELECT user_id FROM restored)
          RETURNING id
       )
       SELECT user_id FROM restored`,
      [paymentIntentId, amount],
    );
    const row = result.rows[0];
    if (row) restored.push({ kind, userId: row.user_id, amount });
  }
  return restored;
}

/** The ledgers that hold a reversed purchase for this PaymentIntent. */
export async function reversedCreditKinds(
  paymentIntentId: string,
): Promise<CreditKind[]> {
  const result = await pool.query<{ kind: CreditKind }>(
    `SELECT 'ai' AS kind FROM ${LEDGERS.ai.table}
      WHERE payment_intent_id = $1 AND refunded_at IS NOT NULL
     UNION ALL
     SELECT 'github' FROM ${LEDGERS.github.table}
      WHERE payment_intent_id = $1 AND refunded_at IS NOT NULL
     UNION ALL
     SELECT 'browserbase' FROM ${LEDGERS.browserbase.table}
      WHERE payment_intent_id = $1 AND refunded_at IS NOT NULL`,
    [paymentIntentId],
  );
  return result.rows.map((r) => r.kind);
}
