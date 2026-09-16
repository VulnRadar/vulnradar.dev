import pool from "@/lib/database/db";

/**
 * Admin "Grant Credits" action (app/api/v3/admin/route.ts's "grant_credits"
 * PATCH case). Separate from lib/billing/ai-usage.ts's addAiCreditBalance /
 * github-review-usage.ts's addGithubCreditBalance / browserbase-usage.ts's
 * addBrowserbaseCreditBalanceSeconds -- those return void and have no
 * shared place to keep the three parallel facts this action needs (which
 * column, what unit the operator types the amount in, what the per-grant
 * ceiling is), and none of them hand back the balance the UPDATE actually
 * committed. This module is that one place, plus the validation the route
 * needs before it touches the database at all.
 */

export type AdminCreditType = "ai" | "github" | "browser";

export interface AdminCreditTypeConfig {
  label: string;
  /** Unit the admin form and the audit-log entry express the amount in. */
  unit: "tokens" | "minutes";
  /**
   * Per-grant ceiling, in `unit`. Set to the largest purchasable tier for
   * that credit type (lib/billing/ai-credit-catalog.ts and
   * github-credit-catalog.ts both top out at 20,000,000 tokens;
   * lib/billing/browserbase-credit-catalog.ts tops out at 500 minutes) --
   * a single admin grant should never be able to hand out more value than
   * a customer could buy in one real purchase.
   */
  maxPerGrant: number;
}

export const ADMIN_CREDIT_TYPES: Record<
  AdminCreditType,
  AdminCreditTypeConfig
> = {
  ai: {
    label: "AI verification tokens",
    unit: "tokens",
    maxPerGrant: 20_000_000,
  },
  github: {
    label: "GitHub review tokens",
    unit: "tokens",
    maxPerGrant: 20_000_000,
  },
  browser: {
    label: "browser session minutes",
    unit: "minutes",
    maxPerGrant: 500,
  },
};

const MAX_REASON_LENGTH = 200;

export interface GrantCreditsValidated {
  creditType: AdminCreditType;
  amount: number;
  reason: string;
}

// A literal `ok` discriminant, not a truthy-`error` check: TypeScript only
// narrows a union cleanly on a property with disjoint literal types across
// its members, and `error: string` doesn't qualify -- an earlier version of
// this type left `validated.value` typed as possibly-undefined at every call
// site even after an `if (validated.error) return` guard.
export type GrantCreditsValidationResult =
  { ok: true; value: GrantCreditsValidated } | { ok: false; error: string };

/**
 * Validates a grant_credits request body. Takes `unknown` fields straight
 * from the parsed JSON body rather than pre-typed values -- the route has
 * no guarantee a caller sent the right shape, and every failure here must
 * become a 400 with a plain message, not a thrown TypeError.
 */
export function validateGrantCreditsInput(input: {
  creditType: unknown;
  amount: unknown;
  reason: unknown;
}): GrantCreditsValidationResult {
  const { creditType, amount, reason } = input;

  if (
    creditType !== "ai" &&
    creditType !== "github" &&
    creditType !== "browser"
  ) {
    return {
      ok: false,
      error: "creditType must be one of: ai, github, browser",
    };
  }

  // Accept a numeric string as well as a number -- the amount input comes
  // through an HTML number field, and some callers send its value
  // unconverted. Number.isSafeInteger on the coerced value still rejects
  // "1.5", "", "abc" and anything past MAX_SAFE_INTEGER.
  const numericAmount = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0) {
    return { ok: false, error: "amount must be a positive whole number" };
  }
  const config = ADMIN_CREDIT_TYPES[creditType];
  if (numericAmount > config.maxPerGrant) {
    return {
      ok: false,
      error: `amount cannot exceed ${config.maxPerGrant.toLocaleString()} ${config.unit} per grant`,
    };
  }

  if (typeof reason !== "string") {
    return { ok: false, error: "reason is required" };
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { ok: false, error: "reason is required" };
  }
  if (trimmedReason.length > MAX_REASON_LENGTH) {
    return {
      ok: false,
      error: `reason cannot exceed ${MAX_REASON_LENGTH} characters`,
    };
  }

  return {
    ok: true,
    value: { creditType, amount: numericAmount, reason: trimmedReason },
  };
}

export interface GrantCreditsResult {
  /** The column's new value after the grant. Browser is stored in seconds. */
  balance: number;
  /** Only set for creditType "browser" -- the same balance expressed in
   *  minutes, the unit the admin form and the user's own account page use. */
  balanceMinutes?: number;
}

/**
 * Applies a validated grant in one statement (UPDATE ... RETURNING), so the
 * response and the audit log both reflect the balance Postgres actually
 * committed rather than a value computed in application code that could
 * race a concurrent spend (e.g. the user burning tokens on an AI
 * verification call between a SELECT and a later UPDATE). The column is
 * chosen from a switch over the three known credit types -- never built
 * from the input string -- so there is no path from `creditType` to SQL
 * text, even though validateGrantCreditsInput above already narrows it to
 * one of three literals before this is ever called.
 */
export async function applyCreditGrant(
  userId: number,
  creditType: AdminCreditType,
  amount: number,
): Promise<GrantCreditsResult> {
  switch (creditType) {
    case "ai": {
      const result = await pool.query<{
        ai_credit_balance: string | number;
      }>(
        "UPDATE users SET ai_credit_balance = ai_credit_balance + $2 WHERE id = $1 RETURNING ai_credit_balance",
        [userId, amount],
      );
      // BIGINT column: node-pg returns it as a string to protect values
      // past 2^53. Balances are bounded far below that, so Number is exact.
      return { balance: Number(result.rows[0]?.ai_credit_balance ?? 0) };
    }
    case "github": {
      const result = await pool.query<{
        github_credit_balance: string | number;
      }>(
        "UPDATE users SET github_credit_balance = github_credit_balance + $2 WHERE id = $1 RETURNING github_credit_balance",
        [userId, amount],
      );
      return { balance: Number(result.rows[0]?.github_credit_balance ?? 0) };
    }
    case "browser": {
      // Column stores seconds (lib/billing/browserbase-usage.ts); the admin
      // form and the catalog both deal in minutes.
      const seconds = amount * 60;
      const result = await pool.query<{
        browserbase_credit_seconds_balance: string | number;
      }>(
        "UPDATE users SET browserbase_credit_seconds_balance = browserbase_credit_seconds_balance + $2 WHERE id = $1 RETURNING browserbase_credit_seconds_balance",
        [userId, seconds],
      );
      const balance = Number(
        result.rows[0]?.browserbase_credit_seconds_balance ?? 0,
      );
      return { balance, balanceMinutes: Math.floor(balance / 60) };
    }
  }
}

/** Human-readable "amount unit" for the audit-log details string, e.g.
 *  "1,000,000 tokens" or "60 minutes". */
export function formatGrantAmount(
  creditType: AdminCreditType,
  amount: number,
): string {
  return `${amount.toLocaleString()} ${ADMIN_CREDIT_TYPES[creditType].unit}`;
}
