import pool from "@/lib/database/db";

/**
 * Reserve-then-settle for the two operator-paid AI token pools: finding
 * verification (ai_usage + users.ai_credit_balance) and GitHub repo review
 * (github_review_usage + users.github_credit_balance).
 *
 * The gates this replaces asked one question before a run, "is any balance
 * left", and charged after it with a floor at zero. Two runs started together
 * both saw the same positive balance, and one large run spent any amount
 * against a balance of 1: the floor stopped the number going negative, not
 * the spend. Here the run's estimate leaves the window and the balance before
 * the run starts, under the user's row lock, and the settlement afterwards
 * hands back whatever the run did not use (or charges an overrun, floored, if
 * the estimate was short).
 *
 * The two pools differ only in table and column names, so they share this
 * code through a ledger descriptor. The names are fixed strings below and
 * never come from input.
 */

export interface TokenLedger {
  usageTable: "ai_usage" | "github_review_usage";
  balanceColumn: "ai_credit_balance" | "github_credit_balance";
  /** Prefix of the in-process single-flight key. */
  slotPrefix: string;
}

export const AI_TOKEN_LEDGER: TokenLedger = {
  usageTable: "ai_usage",
  balanceColumn: "ai_credit_balance",
  slotPrefix: "ai-verify",
};

export const GITHUB_REVIEW_TOKEN_LEDGER: TokenLedger = {
  usageTable: "github_review_usage",
  balanceColumn: "github_credit_balance",
  slotPrefix: "github-review",
};

/**
 * What a gate took for one run. The run is handed `budget`; the settlement is
 * handed this whole object back with the real count.
 */
export interface TokenReservation {
  userId: number;
  /** The user's own AI key pays: nothing is debited, recorded or charged. */
  usingOwnAi: boolean;
  /** The window the reservation was counted into. Settlement adjusts this
   *  window even when the clock has moved into the next one. */
  windowStart: Date;
  /** Most the run may spend, or null when nothing caps it (own key, billing
   *  off, an unlimited plan, the free GitHub review trial). */
  budget: number | null;
  /** Of `budget`, the part taken from the plan's window allowance. */
  windowPortion: number;
  /** Of `budget`, the part debited from the purchased balance. */
  creditPortion: number;
  /** The single-flight slot this reservation holds until it is settled. */
  slotKey: string | null;
  settled: boolean;
}

export function uncappedReservation(
  userId: number,
  windowStart: Date,
  usingOwnAi: boolean,
): TokenReservation {
  return {
    userId,
    usingOwnAi,
    windowStart,
    budget: null,
    windowPortion: 0,
    creditPortion: 0,
    slotKey: null,
    settled: false,
  };
}

/**
 * Per-user single-flight, in-process. The row lock below is what holds across
 * processes; this stops one account running several metered passes side by
 * side on the same instance, each holding a slice of the balance for up to
 * the route's maxDuration. A slot older than RUN_SLOT_MAX_AGE_MS is treated
 * as abandoned (a run that died without settling) so a lost settle cannot lock
 * an account out until the next restart.
 */
const RUN_SLOT_MAX_AGE_MS = 30 * 60 * 1000;
const runSlots = new Map<string, number>();

export function claimRunSlot(key: string, now = Date.now()): boolean {
  const startedAt = runSlots.get(key);
  if (startedAt !== undefined && now - startedAt < RUN_SLOT_MAX_AGE_MS) {
    return false;
  }
  runSlots.set(key, now);
  return true;
}

export function releaseRunSlot(key: string): void {
  runSlots.delete(key);
}

export type DebitResult =
  | { ok: true; budget: number; windowPortion: number; creditPortion: number }
  | { ok: false; windowRemaining: number; balance: number; needed: number };

/**
 * The atomic part of a reservation: under the user's row lock, read what the
 * window has left and what the balance holds, and take up to `want` tokens
 * (window first, then balance) provided at least `minimum` is available.
 *
 * READ COMMITTED gives each statement a fresh snapshot, so once the second of
 * two concurrent callers gets the lock its window read and its debit see the
 * first caller's committed debit. A single-statement CTE could not do this:
 * its snapshot is taken before the lock is waited for. The debit itself keeps
 * the `WHERE balance >= amount` guard so the statement on its own can never
 * take the balance below zero, lock or no lock.
 */
export async function debitWindowAndBalance(
  ledger: TokenLedger,
  userId: number,
  windowStart: Date,
  limitTokens: number,
  want: number,
  minimum: number,
): Promise<DebitResult> {
  const { usageTable, balanceColumn } = ledger;
  const needed = Math.max(1, Math.min(want, minimum));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userRow = await client.query<Record<string, string | number | null>>(
      `SELECT ${balanceColumn} FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (userRow.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, windowRemaining: 0, balance: 0, needed };
    }
    // BIGINT: node-pg returns it as a string.
    const balance = Number(userRow.rows[0][balanceColumn] ?? 0);
    const usageRow = await client.query<{ tokens_used: number }>(
      `SELECT tokens_used FROM ${usageTable} WHERE user_id = $1 AND window_start = $2`,
      [userId, windowStart],
    );
    const used = Number(usageRow.rows[0]?.tokens_used ?? 0);
    const windowRemaining = Math.max(0, limitTokens - used);

    if (windowRemaining + balance < needed) {
      await client.query("ROLLBACK");
      return { ok: false, windowRemaining, balance, needed };
    }

    const budget = Math.min(want, windowRemaining + balance);
    const windowPortion = Math.min(budget, windowRemaining);
    const creditPortion = budget - windowPortion;

    if (creditPortion > 0) {
      const debit = await client.query(
        `UPDATE users SET ${balanceColumn} = ${balanceColumn} - $2
          WHERE id = $1 AND ${balanceColumn} >= $2
          RETURNING ${balanceColumn}`,
        [userId, creditPortion],
      );
      if ((debit.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return { ok: false, windowRemaining, balance, needed };
      }
    }

    await client.query(
      `INSERT INTO ${usageTable} (user_id, window_start, tokens_used, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, window_start)
       DO UPDATE SET tokens_used = ${usageTable}.tokens_used + $3, updated_at = NOW()
       RETURNING tokens_used`,
      [userId, windowStart, budget],
    );
    await client.query("COMMIT");
    return { ok: true, budget, windowPortion, creditPortion };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type MeteredReserveResult =
  | { ok: true; reservation: TokenReservation }
  | { ok: false; busy: true }
  | {
      ok: false;
      busy: false;
      windowRemaining: number;
      balance: number;
      needed: number;
    };

/**
 * Single-flight plus the debit, for a run that is charged. The slot is held
 * from here until settleReservation, and given back at once on a refusal or
 * an error so neither can lock the account.
 */
export async function reserveMetered(
  ledger: TokenLedger,
  userId: number,
  windowStart: Date,
  limitTokens: number,
  estimate: number,
  minimum: number,
): Promise<MeteredReserveResult> {
  const want = Math.max(0, Math.ceil(estimate));
  if (want === 0) {
    // Nothing will be sent to a provider, so there is nothing to hold.
    return {
      ok: true,
      reservation: {
        ...uncappedReservation(userId, windowStart, false),
        budget: 0,
      },
    };
  }

  const slotKey = `${ledger.slotPrefix}:${userId}`;
  if (!claimRunSlot(slotKey)) return { ok: false, busy: true };

  let debit: DebitResult;
  try {
    debit = await debitWindowAndBalance(
      ledger,
      userId,
      windowStart,
      limitTokens,
      want,
      Math.max(0, Math.ceil(minimum)),
    );
  } catch (err) {
    releaseRunSlot(slotKey);
    throw err;
  }
  if (!debit.ok) {
    releaseRunSlot(slotKey);
    return { ...debit, busy: false };
  }
  return {
    ok: true,
    reservation: {
      userId,
      usingOwnAi: false,
      windowStart,
      budget: debit.budget,
      windowPortion: debit.windowPortion,
      creditPortion: debit.creditPortion,
      slotKey,
      settled: false,
    },
  };
}

export interface SettleHooks {
  /** Record a run no reservation capped (billing off, unlimited, trial). */
  recordUncapped: (tokens: number) => Promise<void>;
  /** Charge what the run spent past its reservation. */
  chargeOverrun: (tokens: number) => Promise<void>;
}

/**
 * Close a reservation with the run's real token count. Runs once: a second
 * call is a no-op, so a route and a library can both settle on their own
 * error paths without double-refunding.
 *
 * Spend order inside the reservation matches the old recorders: the window
 * allowance is used first, so the credit refund is whatever of creditPortion
 * the run did not reach.
 */
export async function settleReservation(
  ledger: TokenLedger,
  reservation: TokenReservation,
  actualTokens: number,
  hooks: SettleHooks,
): Promise<void> {
  if (reservation.settled) return;
  reservation.settled = true;
  try {
    const actual = Math.max(0, Math.round(Number(actualTokens) || 0));
    if (reservation.usingOwnAi) return;

    if (reservation.budget === null) {
      if (actual > 0) await hooks.recordUncapped(actual);
      return;
    }

    if (actual > reservation.budget) {
      await hooks.chargeOverrun(actual - reservation.budget);
      return;
    }

    const counterRefund = reservation.budget - actual;
    const usedWindow = Math.min(actual, reservation.windowPortion);
    const creditRefund = reservation.creditPortion - (actual - usedWindow);
    if (counterRefund === 0 && creditRefund === 0) return;

    const { usageTable, balanceColumn } = ledger;
    // One statement, so a crash cannot return the credit without lowering
    // the counter or the other way round.
    await pool.query(
      `WITH win AS (
         UPDATE ${usageTable} SET tokens_used = GREATEST(tokens_used - $3, 0), updated_at = NOW()
          WHERE user_id = $1 AND window_start = $2
          RETURNING user_id
       )
       UPDATE users SET ${balanceColumn} = ${balanceColumn} + $4 WHERE id = $1`,
      [
        reservation.userId,
        reservation.windowStart,
        counterRefund,
        creditRefund,
      ],
    );
  } finally {
    if (reservation.slotKey) releaseRunSlot(reservation.slotKey);
  }
}
