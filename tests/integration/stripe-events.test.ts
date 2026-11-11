import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import {
  claimStripeEvent,
  releaseStripeEvent,
} from "@/lib/billing/stripe-event-marker";
import {
  recordReversedCreditPurchase,
  restoreCreditsAfterDispute,
  reverseCreditsForDispute,
  reversedCreditKinds,
} from "@/lib/billing/credit-reversal-ledger";
import {
  creditAiCreditPurchase,
  reverseAiCreditPurchase,
} from "@/lib/billing/ai-usage";
import { readDunningExemption } from "@/lib/billing/subscription-writes";
import { syncPlanForRoleChange } from "@/lib/billing/staff-plan";
import { getUserPlan } from "@/lib/rate-limiting/daily-limits";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The Stripe webhook's decisions that live in SQL, against a real PostgreSQL.
 *
 * The unit suite for the route fakes pool.query, so it proves which statement
 * runs and nothing about what it does. Each case here is a claim that only
 * Postgres can settle: that an ON CONFLICT really refuses a second claim, that
 * a row recorded as reversed really refuses a later credit, that a dispute's
 * reversal takes no more than the balance holds and a win gives back exactly
 * that, and that a gift counts only while it is live.
 */

async function balance(userId: number): Promise<number> {
  const { rows } = await pool.query<{ ai_credit_balance: string }>(
    "SELECT ai_credit_balance FROM users WHERE id = $1",
    [userId],
  );
  return Number(rows[0].ai_credit_balance);
}

async function gift(
  userId: number,
  plan: string,
  state: { expiresIn: string; revoked?: boolean },
): Promise<void> {
  const giver = await createUser({ role: "admin" });
  await pool.query(
    `INSERT INTO gifted_subscriptions (user_id, gifted_by, plan, expires_at, revoked_at)
     VALUES ($1, $2, $3, NOW() + $4::interval, $5)`,
    [
      userId,
      giver.id,
      plan,
      state.expiresIn,
      state.revoked ? new Date() : null,
    ],
  );
}

describeIntegration("Stripe webhook idempotency marker", () => {
  it("claims an event once, and lets a failed delivery be claimed again after release", async () => {
    const eventId = unique("evt");

    expect(await claimStripeEvent(eventId, "invoice.payment_failed")).toBe(
      true,
    );
    expect(await claimStripeEvent(eventId, "invoice.payment_failed")).toBe(
      false,
    );

    await releaseStripeEvent(eventId);
    expect(await claimStripeEvent(eventId, "invoice.payment_failed")).toBe(
      true,
    );
  });

  it("gives exactly one of two concurrent deliveries the claim", async () => {
    const eventId = unique("evt");
    const claims = await Promise.all([
      claimStripeEvent(eventId, "customer.subscription.updated"),
      claimStripeEvent(eventId, "customer.subscription.updated"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});

describeIntegration(
  "credit purchases refunded or disputed out of order",
  () => {
    it("a refund recorded before the credit refuses the credit when it arrives", async () => {
      const user = await createUser();
      const pi = unique("pi");

      expect(
        await recordReversedCreditPurchase(pi, {
          kind: "ai",
          userId: user.id,
          amount: 1_000_000,
        }),
      ).toBe(true);
      const credited = await creditAiCreditPurchase(pi, user.id, 1_000_000);

      expect(credited.credited).toBe(false);
      expect(await balance(user.id)).toBe(0);
      expect(await reversedCreditKinds(pi)).toEqual(["ai"]);
    });

    it("does not record over a purchase that was already credited", async () => {
      const user = await createUser();
      const pi = unique("pi");
      await creditAiCreditPurchase(pi, user.id, 500);

      expect(
        await recordReversedCreditPurchase(pi, {
          kind: "ai",
          userId: user.id,
          amount: 500,
        }),
      ).toBe(false);
      expect(await reversedCreditKinds(pi)).toEqual([]);
    });

    it("skips an account that no longer exists instead of failing the webhook", async () => {
      expect(
        await recordReversedCreditPurchase(unique("pi"), {
          kind: "github",
          userId: 2_000_000_000,
          amount: 1,
        }),
      ).toBe(false);
    });

    it("a dispute takes only what is left of a part-spent purchase, and a win gives back exactly that", async () => {
      const user = await createUser();
      const pi = unique("pi");
      await creditAiCreditPurchase(pi, user.id, 1_000_000);
      // Spend 800,000 of it.
      await pool.query(
        "UPDATE users SET ai_credit_balance = ai_credit_balance - 800000 WHERE id = $1",
        [user.id],
      );

      let recorded: Array<{ restorable: number }> = [];
      const reversals = await reverseCreditsForDispute(pi, null, async (r) => {
        recorded = r;
      });

      expect(reversals).toHaveLength(1);
      expect(reversals[0]).toMatchObject({
        kind: "ai",
        amount: 1_000_000,
        restorable: 200_000,
        neverCredited: false,
      });
      expect(recorded[0].restorable).toBe(200_000);
      expect(await balance(user.id)).toBe(0);

      const restored = await restoreCreditsAfterDispute(pi, { ai: 200_000 });
      expect(restored).toEqual([
        { kind: "ai", userId: user.id, amount: 200_000 },
      ]);
      expect(await balance(user.id)).toBe(200_000);

      // A redelivered close finds nothing still reversed.
      expect(await restoreCreditsAfterDispute(pi, { ai: 200_000 })).toEqual([]);
      expect(await balance(user.id)).toBe(200_000);
    });

    it("a failed record rolls the dispute's reversal back", async () => {
      const user = await createUser();
      const pi = unique("pi");
      await creditAiCreditPurchase(pi, user.id, 300);

      await expect(
        reverseCreditsForDispute(pi, null, async () => {
          throw new Error("stripe down");
        }),
      ).rejects.toThrow("stripe down");

      expect(await balance(user.id)).toBe(300);
      expect(await reversedCreditKinds(pi)).toEqual([]);
    });

    it("a dispute on a purchase a refund already reversed records that it took nothing, and a win restores nothing", async () => {
      const user = await createUser();
      const pi = unique("pi");
      await creditAiCreditPurchase(pi, user.id, 400);
      await reverseAiCreditPurchase(pi);

      let recorded: unknown = null;
      const reversals = await reverseCreditsForDispute(
        pi,
        { kind: "ai", userId: user.id, amount: 400 },
        async (r) => {
          recorded = r;
        },
      );

      expect(reversals).toEqual([]);
      expect(recorded).toEqual([]);
      expect(await balance(user.id)).toBe(0);
      expect(await restoreCreditsAfterDispute(pi, {})).toEqual([]);
      expect(await reversedCreditKinds(pi)).toEqual(["ai"]);
    });

    it("a dispute on a purchase never credited records it, and a win grants the whole purchase", async () => {
      const user = await createUser();
      const pi = unique("pi");

      const reversals = await reverseCreditsForDispute(
        pi,
        { kind: "ai", userId: user.id, amount: 1_000_000 },
        async () => {},
      );
      expect(reversals[0]).toMatchObject({
        restorable: 1_000_000,
        neverCredited: true,
      });
      expect(
        (await creditAiCreditPurchase(pi, user.id, 1_000_000)).credited,
      ).toBe(false);

      await restoreCreditsAfterDispute(pi, { ai: 1_000_000 });
      expect(await balance(user.id)).toBe(1_000_000);
    });
  },
);

describeIntegration("two-strike exemptions", () => {
  it("counts a staff role and a live gift, and not an expired or revoked one", async () => {
    const plain = await createUser();
    const staff = await createUser({ role: "support" });
    const gifted = await createUser();
    const expired = await createUser();
    const revoked = await createUser();
    await gift(gifted.id, "pro_supporter", { expiresIn: "7 days" });
    await gift(expired.id, "pro_supporter", { expiresIn: "-1 day" });
    await gift(revoked.id, "pro_supporter", {
      expiresIn: "7 days",
      revoked: true,
    });

    expect(await readDunningExemption(plain.id)).toEqual({
      staffFloor: false,
      gifted: false,
    });
    expect(await readDunningExemption(staff.id)).toEqual({
      staffFloor: true,
      gifted: false,
    });
    expect(await readDunningExemption(gifted.id)).toEqual({
      staffFloor: false,
      gifted: true,
    });
    expect((await readDunningExemption(expired.id)).gifted).toBe(false);
    expect((await readDunningExemption(revoked.id)).gifted).toBe(false);
  });
});

describeIntegration(
  "staff demotion restores only a plan something still pays for",
  () => {
    async function demote(state: {
      subscriptionId: string | null;
      status: string | null;
    }): Promise<{ id: number; plan: () => Promise<string> }> {
      const user = await createUser({ plan: "pro_supporter", role: "admin" });
      await pool.query(
        `UPDATE users SET pre_staff_plan = 'core_supporter', stripe_subscription_id = $1,
              subscription_status = $2
        WHERE id = $3`,
        [state.subscriptionId, state.status, user.id],
      );
      return {
        id: user.id,
        plan: async () => {
          const { rows } = await pool.query<{ plan: string }>(
            "SELECT plan FROM users WHERE id = $1",
            [user.id],
          );
          return rows[0].plan;
        },
      };
    }

    it("writes free when the subscription was cancelled while they were staff", async () => {
      const user = await demote({ subscriptionId: null, status: "canceled" });
      await syncPlanForRoleChange(user.id, "admin", "user");
      expect(await user.plan()).toBe("free");
    });

    it("restores the saved plan while its subscription is live", async () => {
      const user = await demote({
        subscriptionId: unique("sub"),
        status: "active",
      });
      await syncPlanForRoleChange(user.id, "admin", "user");
      expect(await user.plan()).toBe("core_supporter");
    });

    it("leaves a live gift to plan resolution instead of writing the saved plan, which would outlast it", async () => {
      // The admin route writes the new role before it syncs the plan.
      const demoteToUser = async (id: number) => {
        await pool.query("UPDATE users SET role = 'user' WHERE id = $1", [id]);
        await syncPlanForRoleChange(id, "admin", "user");
      };

      const covered = await demote({ subscriptionId: null, status: null });
      await gift(covered.id, "pro_supporter", { expiresIn: "7 days" });
      await demoteToUser(covered.id);
      expect(await covered.plan()).toBe("free");
      expect(await getUserPlan(covered.id)).toBe("pro_supporter");

      const lapsed = await demote({ subscriptionId: null, status: null });
      await gift(lapsed.id, "pro_supporter", { expiresIn: "-1 day" });
      await demoteToUser(lapsed.id);
      expect(await lapsed.plan()).toBe("free");
      expect(await getUserPlan(lapsed.id)).toBe("free");
    });
  },
);
