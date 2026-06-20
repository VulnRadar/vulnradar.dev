// Backward-compatible re-export of plans.ts. New code should import
// from @/lib/billing/catalog directly.
export {
  PLANS,
  getPlanById,
  getFreePlan,
  isPaidPlan,
  getPaidPlans,
  getApiLimitForPlan,
  type Plan,
  type PlanId,
  type PlanLimits,
  type PlanBadge,
} from "./catalog";
