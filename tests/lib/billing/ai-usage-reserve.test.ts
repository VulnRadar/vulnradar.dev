import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeLedgerDb } from "./_token-ledger-fake";

/**
 * reserveAiTokens / settleAiTokens: the gate takes the run's estimate out of
 * the window and the purchased balance BEFORE the run, and the settlement
 * hands back what the run did not use.
 *
 * The gate this replaces asked only "is any balance left" and charged
 * afterwards with a floor at zero, so two verifications started together on a
 * balance of 1 were both let in, and a single large one could spend any amount
 * against it. These cases are that scenario and its edges.
 */

let fake = createFakeLedgerDb();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => fake.pool.query(sql, params),
    connect: () => fake.pool.connect(),
  },
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

const { reserveAiTokens, settleAiTokens, currentWindowStart } =
  await import("@/lib/billing/ai-usage");

const USER = 7;

function plan(aiTokensPerWindow: number) {
  mockGetUserPlanLimits.mockResolvedValue({ aiTokensPerWindow });
}

beforeEach(() => {
  fake = createFakeLedgerDb();
  mockResolveUserEndpoint.mockReset();
  mockResolveUserEndpoint.mockResolvedValue(null);
  mockGetUserPlanLimits.mockReset();
});

describe("reserveAiTokens: the gate debits before the run", () => {
  it("lets one of two parallel gates in against 1000 credits and refuses the other", async () => {
    fake = createFakeLedgerDb({ aiBalance: 1000 });
    plan(0);

    const [a, b] = await Promise.all([
      reserveAiTokens(USER, 600),
      reserveAiTokens(USER, 600),
    ]);

    const allowed = [a, b].filter((g) => g.allowed);
    expect(allowed).toHaveLength(1);
    expect(fake.state.balances.ai_credit_balance).toBe(400);

    // Then both runs report 300000 tokens. Only one of them ever ran, and
    // what it spent past its reservation is floored at the balance: the
    // account never pays for more than the 1000 it bought.
    for (const g of [a, b]) {
      if (g.allowed) await settleAiTokens(g.reservation, 300_000);
    }
    expect(fake.state.balances.ai_credit_balance).toBe(0);
  });

  it("the row lock, not only the in-process single-flight, holds two parallel debits to one", async () => {
    // Two processes behind a load balancer share no memory, so the lock that
    // has to hold is the database's. The low-level debit skips the slot.
    const { debitWindowAndBalance, AI_TOKEN_LEDGER } =
      await import("@/lib/billing/token-reservation");
    fake = createFakeLedgerDb({ aiBalance: 1000 });
    const windowStart = currentWindowStart(new Date(), 5);

    const [a, b] = await Promise.all([
      debitWindowAndBalance(AI_TOKEN_LEDGER, USER, windowStart, 0, 600, 600),
      debitWindowAndBalance(AI_TOKEN_LEDGER, USER, windowStart, 0, 600, 600),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(fake.state.balances.ai_credit_balance).toBe(400);
    expect(fake.state.usage.ai_usage.get(windowStart.toISOString())).toBe(600);
  });

  it("refuses when the window remaining plus the balance does not cover the estimate, and touches nothing", async () => {
    const windowStart = currentWindowStart(new Date(), 5);
    fake = createFakeLedgerDb({
      aiBalance: 100,
      aiUsed: { windowStart, tokens: 79_500 },
    });
    plan(80_000);

    const gate = await reserveAiTokens(USER, 1_000);

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.busy).toBe(false);
      expect(gate.message).toMatch(/AI tokens/);
    }
    expect(fake.state.balances.ai_credit_balance).toBe(100);
    expect(fake.state.usage.ai_usage.get(windowStart.toISOString())).toBe(
      79_500,
    );
  });

  it("spends the window allowance first and only the overspill from the balance", async () => {
    const windowStart = currentWindowStart(new Date(), 5);
    fake = createFakeLedgerDb({
      aiBalance: 5_000,
      aiUsed: { windowStart, tokens: 79_000 },
    });
    plan(80_000);

    const gate = await reserveAiTokens(USER, 3_000);

    expect(gate.allowed).toBe(true);
    if (!gate.allowed) return;
    expect(gate.reservation.budget).toBe(3_000);
    expect(gate.reservation.windowPortion).toBe(1_000);
    expect(gate.reservation.creditPortion).toBe(2_000);
    expect(fake.state.balances.ai_credit_balance).toBe(3_000);
    expect(fake.state.usage.ai_usage.get(windowStart.toISOString())).toBe(
      82_000,
    );
    await settleAiTokens(gate.reservation, 0);
  });

  it("with a minimum, reserves what is available rather than refusing a run that can still do part of the work", async () => {
    fake = createFakeLedgerDb({ aiBalance: 0 });
    plan(10_000);

    const gate = await reserveAiTokens(USER, 50_000, 4_000);

    expect(gate.allowed).toBe(true);
    if (!gate.allowed) return;
    expect(gate.reservation.budget).toBe(10_000);
    expect(gate.reservation.creditPortion).toBe(0);
    await settleAiTokens(gate.reservation, 0);
  });

  it("refuses below the minimum", async () => {
    fake = createFakeLedgerDb({ aiBalance: 0 });
    plan(3_000);

    const gate = await reserveAiTokens(USER, 50_000, 4_000);

    expect(gate.allowed).toBe(false);
  });

  it("refuses a plan without AI and no balance with the plan message", async () => {
    plan(0);
    const gate = await reserveAiTokens(USER, 100);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.message).toMatch(/not available on your plan/);
    }
  });

  it("a second run for the same user is refused as busy until the first one settles", async () => {
    fake = createFakeLedgerDb({ aiBalance: 1_000_000 });
    plan(80_000);

    const first = await reserveAiTokens(USER, 1_000);
    const second = await reserveAiTokens(USER, 1_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.busy).toBe(true);

    if (first.allowed) await settleAiTokens(first.reservation, 500);
    const third = await reserveAiTokens(USER, 1_000);
    expect(third.allowed).toBe(true);
    if (third.allowed) await settleAiTokens(third.reservation, 0);
  });

  it("a user with their own AI key is let in without a debit, a lock or a record", async () => {
    mockResolveUserEndpoint.mockResolvedValue({
      baseUrl: "https://own.test",
      model: "m",
      apiKey: "k",
    });

    const gate = await reserveAiTokens(USER, 1_000_000);

    expect(gate.allowed).toBe(true);
    if (!gate.allowed) return;
    expect(gate.reservation.usingOwnAi).toBe(true);
    expect(gate.reservation.budget).toBeNull();
    await settleAiTokens(gate.reservation, 1_000_000);
    expect(fake.statements).toEqual([]);
    expect(mockGetUserPlanLimits).not.toHaveBeenCalled();
  });

  it("billing disabled is uncapped, and the run is still recorded against the window for visibility", async () => {
    mockGetUserPlanLimits.mockResolvedValue(null);

    const gate = await reserveAiTokens(USER, 1_000_000);

    expect(gate.allowed).toBe(true);
    if (!gate.allowed) return;
    expect(gate.reservation.budget).toBeNull();
    await settleAiTokens(gate.reservation, 1_234);
    expect([...fake.state.usage.ai_usage.values()]).toEqual([1_234]);
    expect(fake.state.balances.ai_credit_balance).toBe(0);
  });
});

describe("settleAiTokens: the difference goes back after the run", () => {
  it("refunds the unused credit portion and lowers the window counter to the real count", async () => {
    const windowStart = currentWindowStart(new Date(), 5);
    fake = createFakeLedgerDb({
      aiBalance: 10_000,
      aiUsed: { windowStart, tokens: 79_000 },
    });
    plan(80_000);

    const gate = await reserveAiTokens(USER, 6_000);
    if (!gate.allowed) throw new Error("expected the gate to allow");
    // 1000 from the window, 5000 from the balance.
    expect(fake.state.balances.ai_credit_balance).toBe(5_000);

    await settleAiTokens(gate.reservation, 2_500);

    // The run used 2500: 1000 of window, 1500 of credit.
    expect(fake.state.balances.ai_credit_balance).toBe(8_500);
    expect(fake.state.usage.ai_usage.get(windowStart.toISOString())).toBe(
      81_500,
    );
  });

  it("charges an overrun past the reservation, floored at zero", async () => {
    fake = createFakeLedgerDb({ aiBalance: 1_000 });
    plan(0);

    const gate = await reserveAiTokens(USER, 600);
    if (!gate.allowed) throw new Error("expected the gate to allow");

    await settleAiTokens(gate.reservation, 300_000);

    expect(fake.state.balances.ai_credit_balance).toBe(0);
  });

  it("is idempotent: a second settle changes nothing", async () => {
    fake = createFakeLedgerDb({ aiBalance: 1_000 });
    plan(0);
    const gate = await reserveAiTokens(USER, 600);
    if (!gate.allowed) throw new Error("expected the gate to allow");

    await settleAiTokens(gate.reservation, 100);
    await settleAiTokens(gate.reservation, 100);

    expect(fake.state.balances.ai_credit_balance).toBe(900);
  });

  it("a reservation of nothing takes no lock and no slot", async () => {
    plan(80_000);
    const gate = await reserveAiTokens(USER, 0);
    expect(gate.allowed).toBe(true);
    if (!gate.allowed) return;
    expect(gate.reservation.budget).toBe(0);
    const again = await reserveAiTokens(USER, 0);
    expect(again.allowed).toBe(true);
    expect(fake.statements).toEqual([]);
  });
});
