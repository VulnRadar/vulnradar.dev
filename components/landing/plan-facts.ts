import { PLANS, getFreePlan } from "@/lib/billing/plans";

/**
 * Plan numbers the landing page quotes, read from the billing catalog the API
 * enforces against.
 *
 * Two sections used to state "up to 100 URLs per request" as a flat fact. 100
 * is real, but it is the top plan's `bulkScanUrls`, and
 * app/api/v3/scan/bulk/route.ts checks the caller's own plan cap on top of the
 * deployment-wide MAX_URLS_BULK: a free account that follows that sentence
 * gets a 403 at six URLs. Naming both ends is both honest and more useful than
 * naming the ceiling alone, and neither number is typed in.
 */
export const BULK_URLS_FREE = getFreePlan().limits.bulkScanUrls;

export const BULK_URLS_TOP = Math.max(
  ...PLANS.map((plan) => plan.limits.bulkScanUrls),
);
