/**
 * Per-plan cap on how many pages a user may SELECT to scan in a single crawl.
 *
 * Distinct from the crawl DISCOVERY cap (how many pages the picker may find and
 * list, CRAWL_DISCOVER_MAX_PAGES): a crawl can surface hundreds of pages, but
 * a user may only queue up to their plan's share of them for actual scanning.
 *
 * This is the single source of truth both the client picker
 * (components/scanner/crawl-url-selector.tsx) and the server route
 * (app/api/v3/scan/crawl/route.ts) reference, so the two never disagree. It is
 * client-safe: only a type is imported from the billing catalog and the values
 * come from lib/config/config-values.ts (plain constants, no server-only
 * code), so nothing server-side is pulled into the client bundle.
 * Billing-disabled (self-hosted) callers treat selection as unlimited and
 * never consult this table -- see each call site.
 *
 * These are the SHIPPED defaults. The same four numbers now also have
 * BILLING_*_CRAWL_PAGES registry keys, so an admin can retune them, and
 * getUserPlanLimits().crawlPages resolves the live value. A server caller that
 * can await should prefer that; this synchronous table exists for the client
 * picker, which has no access to the settings resolver (AUDIT-011#drift-23).
 */
import {
  CONFIG_BILLING_FREE_CRAWL_PAGES,
  CONFIG_BILLING_CORE_SUPPORTER_CRAWL_PAGES,
  CONFIG_BILLING_PRO_SUPPORTER_CRAWL_PAGES,
  CONFIG_BILLING_ELITE_SUPPORTER_CRAWL_PAGES,
} from "@/lib/config/config-values";
import type { PlanId } from "./catalog";

export const CRAWL_PAGE_SELECTION_LIMITS: Record<PlanId, number> = {
  free: CONFIG_BILLING_FREE_CRAWL_PAGES,
  core_supporter: CONFIG_BILLING_CORE_SUPPORTER_CRAWL_PAGES,
  pro_supporter: CONFIG_BILLING_PRO_SUPPORTER_CRAWL_PAGES,
  elite_supporter: CONFIG_BILLING_ELITE_SUPPORTER_CRAWL_PAGES,
};

/**
 * The crawl page-selection cap for a plan id. Staff resolve to the Pro
 * Supporter cap (the same substitution getUserPlanLimits makes), and any
 * unknown or missing plan falls back to the Free cap.
 */
export function getCrawlPageSelectionLimit(
  plan: string | null | undefined,
): number {
  const effective = plan === "staff" ? "pro_supporter" : plan;
  if (effective && effective in CRAWL_PAGE_SELECTION_LIMITS) {
    return CRAWL_PAGE_SELECTION_LIMITS[effective as PlanId];
  }
  return CRAWL_PAGE_SELECTION_LIMITS.free;
}
