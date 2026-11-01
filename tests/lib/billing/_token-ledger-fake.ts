/**
 * An in-memory stand-in for the four rows a token reservation touches: the
 * user's purchased balance, the window counter, the free-trial stamp, and the
 * row lock that serialises one user's reservations.
 *
 * It answers by statement shape, so it proves the JavaScript around the SQL
 * (which statements run, in what order, with which numbers, and that a second
 * gate waits for the first one's lock) and nothing about the SQL itself.
 * tests/integration/ai-credits.test.ts is where Postgres answers for real.
 */

type BalanceColumn = "ai_credit_balance" | "github_credit_balance";
type UsageTable = "ai_usage" | "github_review_usage";

export interface FakeLedgerState {
  userExists: boolean;
  balances: Record<BalanceColumn, number>;
  usage: Record<UsageTable, Map<string, number>>;
  trialUsed: boolean;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

function result(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length };
}

function key(windowStart: unknown): string {
  return windowStart instanceof Date
    ? windowStart.toISOString()
    : String(windowStart);
}

export function createFakeLedgerDb(
  initial: {
    aiBalance?: number;
    githubBalance?: number;
    aiUsed?: { windowStart: Date; tokens: number };
    githubUsed?: { windowStart: Date; tokens: number };
    trialUsed?: boolean;
    userExists?: boolean;
  } = {},
) {
  const state: FakeLedgerState = {
    userExists: initial.userExists ?? true,
    balances: {
      ai_credit_balance: initial.aiBalance ?? 0,
      github_credit_balance: initial.githubBalance ?? 0,
    },
    usage: { ai_usage: new Map(), github_review_usage: new Map() },
    trialUsed: initial.trialUsed ?? false,
  };
  if (initial.aiUsed) {
    state.usage.ai_usage.set(
      key(initial.aiUsed.windowStart),
      initial.aiUsed.tokens,
    );
  }
  if (initial.githubUsed) {
    state.usage.github_review_usage.set(
      key(initial.githubUsed.windowStart),
      initial.githubUsed.tokens,
    );
  }

  const statements: string[] = [];
  let lockTail: Promise<void> = Promise.resolve();

  const balanceColumnIn = (sql: string): BalanceColumn =>
    sql.includes("github_credit_balance")
      ? "github_credit_balance"
      : "ai_credit_balance";
  const usageTableIn = (sql: string): UsageTable =>
    sql.includes("github_review_usage") ? "github_review_usage" : "ai_usage";

  async function run(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult> {
    const text = sql.replace(/\s+/g, " ").trim();
    statements.push(text);

    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return result([]);

    if (/^SELECT \w+ FROM users WHERE id = \$1 FOR UPDATE$/.test(text)) {
      if (!state.userExists) return result([]);
      const col = balanceColumnIn(text);
      // BIGINT: node-pg hands it back as a string.
      return result([{ [col]: String(state.balances[col]) }]);
    }

    if (
      /^SELECT tokens_used FROM \w+ WHERE user_id = \$1 AND window_start = \$2$/.test(
        text,
      )
    ) {
      const used = state.usage[usageTableIn(text)].get(key(params[1]));
      return result(used === undefined ? [] : [{ tokens_used: used }]);
    }

    // Conditional debit: the reservation's own statement.
    if (
      /^UPDATE users SET (\w+) = \1 - \$2 WHERE id = \$1 AND \1 >= \$2 RETURNING/.test(
        text,
      )
    ) {
      const col = balanceColumnIn(text);
      const amount = Number(params[1]);
      if (!state.userExists || state.balances[col] < amount) return result([]);
      state.balances[col] -= amount;
      return result([{ [col]: String(state.balances[col]) }]);
    }

    // Floored debit: recordAiTokens / recordGithubReviewTokens.
    if (
      /^UPDATE users SET (\w+) = GREATEST\(\1 - \$2, 0\) WHERE id = \$1$/.test(
        text,
      )
    ) {
      const col = balanceColumnIn(text);
      state.balances[col] = Math.max(
        state.balances[col] - Number(params[1]),
        0,
      );
      return result([]);
    }

    // Window counter upsert (reservation and recorders share the shape).
    if (/^INSERT INTO (ai_usage|github_review_usage) /.test(text)) {
      const table = usageTableIn(text);
      const k = key(params[1]);
      const next = (state.usage[table].get(k) ?? 0) + Number(params[2]);
      state.usage[table].set(k, next);
      return result([{ tokens_used: next }]);
    }

    // Settlement refund: window counter down, balance up, one statement.
    if (
      /^WITH win AS \( UPDATE (ai_usage|github_review_usage) SET tokens_used = GREATEST\(tokens_used - \$3, 0\)/.test(
        text,
      )
    ) {
      const table = usageTableIn(text);
      const col = balanceColumnIn(text);
      const k = key(params[1]);
      if (state.usage[table].has(k)) {
        state.usage[table].set(
          k,
          Math.max(state.usage[table].get(k)! - Number(params[2]), 0),
        );
      }
      state.balances[col] += Number(params[3]);
      return result([]);
    }

    if (
      text.startsWith(
        "UPDATE users SET free_github_review_used_at = NOW() WHERE id = $1 AND",
      )
    ) {
      if (state.trialUsed) return result([]);
      state.trialUsed = true;
      return result([{ id: params[0] }]);
    }

    throw new Error(`fake ledger: unrecognised statement: ${text}`);
  }

  const pool = {
    query: (sql: string, params?: unknown[]) => run(sql, params),
    connect: async () => {
      let unlock: (() => void) | null = null;
      return {
        query: async (sql: string, params?: unknown[]) => {
          const text = sql.replace(/\s+/g, " ").trim();
          if (text.endsWith("FOR UPDATE")) {
            // Row lock: a second transaction waits here until the first one
            // commits or rolls back, which is what makes the second gate see
            // the first one's debit.
            const previous = lockTail;
            let release!: () => void;
            lockTail = new Promise<void>((r) => {
              release = r;
            });
            await previous;
            unlock = release;
          }
          const out = await run(sql, params);
          if (/^(COMMIT|ROLLBACK)$/.test(text) && unlock) {
            unlock();
            unlock = null;
          }
          return out;
        },
        release: () => {
          if (unlock) {
            unlock();
            unlock = null;
          }
        },
      };
    },
  };

  return { pool, state, statements };
}
