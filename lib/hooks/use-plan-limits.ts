"use client";

import { useEffect, useState } from "react";
import { PLANS, type PlanId, type PlanLimits } from "@/lib/billing/catalog";
import { API } from "@/lib/config/client-constants";

export type AllPlanLimits = Record<PlanId, PlanLimits>;

/**
 * The shipped catalog copy, used until the live values arrive and whenever
 * they cannot be fetched. It is only a fallback: the numbers a route actually
 * enforces come from the admin-editable BILLING_* settings, which is what
 * GET /api/v3/billing/plan-limits resolves.
 *
 * tests/lib/billing/plan-limits-drift.test.ts asserts this copy equals the
 * registry defaults for every plan and every field, so falling back to it can
 * never quote a number the deployment never shipped.
 */
export const CATALOG_PLAN_LIMITS: AllPlanLimits = PLANS.reduce((acc, plan) => {
  acc[plan.id] = plan.limits;
  return acc;
}, {} as AllPlanLimits);

/**
 * Map one GET /api/v3/billing/plan-limits response body onto AllPlanLimits.
 *
 * Split out of the hook so it can be tested without a DOM. Any field that
 * does not resolve to a finite number keeps the catalog value rather than
 * propagating NaN into a price comparison.
 */
export function parsePlanLimits(data: unknown): AllPlanLimits {
  const body = (data ?? {}) as Record<string, unknown>;
  const out = {} as AllPlanLimits;

  for (const plan of PLANS) {
    const raw = (body[plan.id] ?? {}) as Record<string, unknown>;
    const merged = { ...plan.limits };
    for (const field of Object.keys(plan.limits) as (keyof PlanLimits)[]) {
      // typeof, not Number(): Number(null), Number("") and Number([]) are all
      // 0, and 0 is the "this tier does not get the feature at all" sentinel.
      // Coercing would have turned a malformed field into a cross in the
      // comparison table rather than into the fallback.
      const value = raw[field];
      if (typeof value === "number" && Number.isFinite(value)) {
        merged[field] = value;
      }
    }
    out[plan.id] = merged;
  }

  return out;
}

/**
 * Every plan's limits, resolved live from the admin-editable billing settings
 * rather than read out of the shipped catalog.
 *
 * The pricing table, the upgrade modal and the checkout summary all quote
 * these numbers to a user who is about to pay for them, while enforcement
 * reads the settings registry. Any one of the 48 admin edits used to leave
 * the two disagreeing with no signal (AUDIT-011#drift-10). Falls back to the
 * catalog until the fetch resolves, so first paint and a failed fetch both
 * render today's values instead of nothing.
 */
export function usePlanLimits(): AllPlanLimits {
  const [limits, setLimits] = useState<AllPlanLimits>(CATALOG_PLAN_LIMITS);

  useEffect(() => {
    let cancelled = false;
    // Derived from API.BILLING rather than written out, so the api version
    // segment keeps exactly one definition. Worth a real API map entry once
    // lib/config/client-constants.ts is free to edit.
    fetch(`${API.BILLING}/plan-limits`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setLimits(parsePlanLimits(data));
      })
      .catch(() => {
        /* keep the shipped catalog values */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return limits;
}
