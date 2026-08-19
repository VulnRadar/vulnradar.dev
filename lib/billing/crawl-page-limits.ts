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
 * client-safe: only a type is imported from the billing catalog, so no
 * server-only code is pulled into the client bundle. Billing-disabled
 * (self-hosted) callers treat selection as unlimited and never consult this
 * table -- see each call site.
 */
import type { PlanId } from "./catalog";

export const CRAWL_PAGE_SELECTION_LIMITS: Record<PlanId, number> = {
  free: 25,
  core_supporter: 50,
  pro_supporter: 100,
  elite_supporter: 250,
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
