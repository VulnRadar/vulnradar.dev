/**
 * Tests for parsePlanLimits, the pure half of lib/hooks/use-plan-limits.ts.
 *
 * The hook is what makes the pricing surfaces quote the limits the API
 * actually enforces (AUDIT-011#drift-10). This is the boundary where an
 * untrusted response body becomes numbers rendered next to a price, so a
 * missing, malformed or hostile field must fall back to the shipped catalog
 * value rather than reaching the page as NaN or as a string.
 */
import { describe, it, expect } from "vitest";
import { PLANS, type PlanLimits } from "@/lib/billing/catalog";
import {
  parsePlanLimits,
  CATALOG_PLAN_LIMITS,
} from "@/lib/hooks/use-plan-limits";

const FIELDS = Object.keys(PLANS[0].limits) as (keyof PlanLimits)[];

describe("CATALOG_PLAN_LIMITS", () => {
  it("carries every plan's shipped limits", () => {
    expect(Object.keys(CATALOG_PLAN_LIMITS).sort()).toEqual(
      [...PLANS].map((p) => p.id).sort(),
    );
    for (const plan of PLANS) {
      expect(CATALOG_PLAN_LIMITS[plan.id]).toEqual(plan.limits);
    }
  });
});

describe("parsePlanLimits", () => {
  it("takes the resolved value for every field when the body is complete", () => {
    const body = Object.fromEntries(
      PLANS.map((p) => [p.id, Object.fromEntries(FIELDS.map((f) => [f, 42]))]),
    );

    const parsed = parsePlanLimits(body);

    for (const plan of PLANS) {
      for (const field of FIELDS) {
        expect(parsed[plan.id][field]).toBe(42);
      }
    }
  });

  it("keeps the unlimited sentinel and the zero sentinel intact", () => {
    // -1 means unlimited and 0 means "not on this tier". Both are real
    // answers, and a truthiness check would turn 0 into the catalog value.
    const parsed = parsePlanLimits({
      free: { dailyScans: -1, webhooks: 0 },
    });

    expect(parsed.free.dailyScans).toBe(-1);
    expect(parsed.free.webhooks).toBe(0);
  });

  it("falls back to the catalog for a field the response omits", () => {
    const parsed = parsePlanLimits({ free: { dailyScans: 500 } });
    const shipped = PLANS.find((p) => p.id === "free")!.limits;

    expect(parsed.free.dailyScans).toBe(500);
    expect(parsed.free.apiKeys).toBe(shipped.apiKeys);
    expect(parsed.free.teamMembers).toBe(shipped.teamMembers);
  });

  it("falls back to the catalog for a plan the response omits entirely", () => {
    const parsed = parsePlanLimits({ free: { dailyScans: 500 } });

    expect(parsed.elite_supporter).toEqual(
      PLANS.find((p) => p.id === "elite_supporter")!.limits,
    );
  });

  it("never produces NaN from a malformed value", () => {
    const parsed = parsePlanLimits({
      free: {
        dailyScans: "lots",
        apiKeys: null,
        webhooks: {},
        teams: undefined,
      },
    });
    const shipped = PLANS.find((p) => p.id === "free")!.limits;

    expect(parsed.free.dailyScans).toBe(shipped.dailyScans);
    expect(parsed.free.apiKeys).toBe(shipped.apiKeys);
    expect(parsed.free.webhooks).toBe(shipped.webhooks);
    expect(parsed.free.teams).toBe(shipped.teams);
    for (const plan of PLANS) {
      for (const field of FIELDS) {
        expect(Number.isFinite(parsed[plan.id][field])).toBe(true);
      }
    }
  });

  it("degrades to the full catalog for null, undefined and a non-object body", () => {
    for (const body of [null, undefined, 7, "nope", []]) {
      expect(parsePlanLimits(body)).toEqual(CATALOG_PLAN_LIMITS);
    }
  });

  it("does not mutate the catalog it falls back to", () => {
    const before = structuredClone(CATALOG_PLAN_LIMITS);

    parsePlanLimits({ free: { dailyScans: 9999 } });

    expect(CATALOG_PLAN_LIMITS).toEqual(before);
    expect(PLANS.find((p) => p.id === "free")!.limits.dailyScans).toBe(
      before.free.dailyScans,
    );
  });
});
