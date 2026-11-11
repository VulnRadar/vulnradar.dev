import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ai_usage holds one row per (user, window, kind). Only kind 'verify' is
 * metered: it is what the plan's aiTokensPerWindow allowance counts and what
 * may spill over into purchased credit. Chat, scan summaries and auto-tags are
 * free features that record their tokens for admin cost visibility under
 * their own kind.
 *
 * Before the kind existed they all wrote into the verification row, so a long
 * chat used up the allowance a user had for verifying findings, and the
 * billing page showed chat tokens as verification spend.
 *
 * The fake below keys rows the way the boot schema does. A statement that does
 * not name the kind lands on the column default, 'verify', and a read that
 * does not filter by kind sees every row of the window, which is what an
 * unkeyed write and read did against the single shared row.
 */

type Row = { tokens: number };
const rows = new Map<string, Row>();
let balance = 0;
const statements: string[] = [];

function rowKey(windowStart: unknown, kind: string): string {
  const w =
    windowStart instanceof Date
      ? windowStart.toISOString()
      : String(windowStart);
  return `${w}|${kind}`;
}

function kindFilter(sql: string, params: unknown[], at: number): string | null {
  if (/kind = 'verify'/.test(sql)) return "verify";
  if (new RegExp(`kind = \\$${at + 1}\\b`).test(sql)) return String(params[at]);
  return null;
}

async function query(sql: string, params: unknown[] = []) {
  const text = sql.replace(/\s+/g, " ").trim();
  statements.push(text);

  if (text.startsWith("INSERT INTO ai_usage")) {
    const cols = /INSERT INTO ai_usage \(([^)]*)\)/.exec(text)![1];
    const named = cols.split(",").map((c) => c.trim());
    const kindAt = named.indexOf("kind");
    const kind = kindAt === -1 ? "verify" : String(params[kindAt]);
    const tokensAt = named.indexOf("tokens_used");
    const k = rowKey(params[1], kind);
    const next = (rows.get(k)?.tokens ?? 0) + Number(params[tokensAt]);
    rows.set(k, { tokens: next });
    return { rows: [{ tokens_used: next }], rowCount: 1 };
  }

  if (text.startsWith("SELECT tokens_used FROM ai_usage")) {
    const kind = kindFilter(text, params, 2);
    const w =
      params[1] instanceof Date ? params[1].toISOString() : String(params[1]);
    let total = 0;
    let found = false;
    for (const [k, r] of rows) {
      const [rw, rk] = k.split("|");
      if (rw !== w) continue;
      if (kind !== null && rk !== kind) continue;
      total += r.tokens;
      found = true;
    }
    return found
      ? { rows: [{ tokens_used: total }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }

  if (text.startsWith("SELECT ai_credit_balance FROM users")) {
    return { rows: [{ ai_credit_balance: String(balance) }], rowCount: 1 };
  }

  if (
    text.startsWith(
      "UPDATE users SET ai_credit_balance = GREATEST(ai_credit_balance - $2, 0)",
    )
  ) {
    balance = Math.max(balance - Number(params[1]), 0);
    return { rows: [], rowCount: 1 };
  }

  throw new Error(`ai-usage-kind fake: unrecognised statement: ${text}`);
}

vi.mock("@/lib/database/db", () => ({
  default: { query: (sql: string, params?: unknown[]) => query(sql, params) },
}));

const mockResolveUserEndpoint = vi.fn();
vi.mock("@/lib/ai/verify-findings", () => ({
  resolveUserEndpoint: (...args: unknown[]) => mockResolveUserEndpoint(...args),
}));

const mockGetUserPlanLimits = vi.fn();
vi.mock("@/lib/billing/plan-limits", () => ({
  getUserPlanLimits: (...args: unknown[]) => mockGetUserPlanLimits(...args),
}));

vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: async () => 5,
}));

const {
  recordAiTokens,
  getAiTokensUsed,
  checkAiUsageQuota,
  currentWindowStart,
} = await import("@/lib/billing/ai-usage");

const USER = 11;

function plan(aiTokensPerWindow: number) {
  mockGetUserPlanLimits.mockResolvedValue({ aiTokensPerWindow });
}

beforeEach(() => {
  rows.clear();
  balance = 0;
  statements.length = 0;
  mockResolveUserEndpoint.mockReset();
  mockResolveUserEndpoint.mockResolvedValue(null);
  mockGetUserPlanLimits.mockReset();
});

describe("ai_usage kinds: only verification is metered", () => {
  it("80000 chat tokens leave the verification allowance untouched", async () => {
    plan(50_000);
    const window = currentWindowStart(new Date(), 5);

    await recordAiTokens(USER, 80_000, window, false, "chat");

    expect(await getAiTokensUsed(USER, window)).toBe(0);
    const quota = await checkAiUsageQuota(USER);
    expect(quota.allowed).toBe(true);
    expect(quota.usedTokens).toBe(0);
  });

  it("400k chat tokens against a 1000 credit balance spend nothing, even when the caller asks to charge", async () => {
    plan(0);
    balance = 1000;
    const window = currentWindowStart(new Date(), 5);

    await recordAiTokens(USER, 400_000, window, true, "chat");

    expect(balance).toBe(1000);
    expect(statements.some((s) => s.includes("ai_credit_balance -"))).toBe(
      false,
    );
  });

  it("summary and tag tokens are recorded but do not count against verification either", async () => {
    plan(20_000);
    const window = currentWindowStart(new Date(), 5);

    await recordAiTokens(USER, 15_000, window, false, "summary");
    await recordAiTokens(USER, 15_000, window, false, "tag");

    expect(await getAiTokensUsed(USER, window)).toBe(0);
    expect(rows.size).toBe(2);
  });

  it("splits a verification against the allowance as if the chat had never happened", async () => {
    // 20000 allowance, 15000 already spent on chat. A 10000-token verification
    // fits the allowance whole, so not one credit moves. Counted against the
    // shared row it would have found 5000 left and taken 5000 from credit.
    plan(20_000);
    balance = 1000;
    const window = currentWindowStart(new Date(), 5);

    await recordAiTokens(USER, 15_000, window, false, "chat");
    await recordAiTokens(USER, 10_000, window, true, "verify");

    expect(balance).toBe(1000);
    expect(await getAiTokensUsed(USER, window)).toBe(10_000);
  });

  it("an unnamed kind is verification, so a paid caller that omits it is still metered", async () => {
    plan(0);
    balance = 1000;
    const window = currentWindowStart(new Date(), 5);

    await recordAiTokens(USER, 300, window, true);

    expect(balance).toBe(700);
    expect(await getAiTokensUsed(USER, window)).toBe(300);
  });
});
