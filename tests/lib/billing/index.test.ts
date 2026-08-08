import { describe, it, expect, vi } from "vitest";

// "server-only" is a Next.js bundler marker package that unconditionally
// throws when loaded outside webpack's react-server condition. Under plain
// Node (vitest) it must be neutralized so the barrel's re-exports (which
// transitively load lib/billing/stripe.ts) can load.
vi.mock("server-only", () => ({}));

// The index barrel re-exports lib/billing/billing.ts, which imports the
// real pg pool at module load time (and throws if DATABASE_URL isn't set).
// Mocked here purely so the barrel can load; no query behavior is exercised
// in this file.
vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn() },
}));

import * as catalog from "@/lib/billing/catalog";
import * as plansBarrel from "@/lib/billing/plans";
import * as productsBarrel from "@/lib/billing/products";
import * as billingBarrel from "@/lib/billing";

/**
 * lib/billing/plans.ts, products.ts, and index.ts are thin re-export
 * barrels with no logic of their own. Nothing else in the app imports
 * through them (routes import lib/billing/catalog and lib/billing/stripe
 * directly), so without a test touching them they never get loaded and
 * show as 0% coverage. Deep behavior for the re-exported functions is
 * already covered in catalog.test.ts and stripe.test.ts; this file's job
 * is just to exercise the re-export lines themselves.
 */

describe("lib/billing/plans.ts re-exports", () => {
  it("re-exports the same PLANS array as catalog", () => {
    expect(plansBarrel.PLANS).toBe(catalog.PLANS);
  });

  it("re-exports working lookup helpers", () => {
    expect(plansBarrel.getPlanById("free")).toBe(catalog.getPlanById("free"));
    expect(plansBarrel.getFreePlan()).toBe(catalog.getFreePlan());
    expect(plansBarrel.isPaidPlan("core_supporter")).toBe(true);
    expect(plansBarrel.getPaidPlans()).toEqual(catalog.getPaidPlans());
    expect(plansBarrel.getApiLimitForPlan("pro_supporter")).toBe(5000);
  });
});

describe("lib/billing/products.ts re-exports", () => {
  it("re-exports the same PRODUCTS array as catalog", () => {
    expect(productsBarrel.PRODUCTS).toBe(catalog.PRODUCTS);
  });

  it("re-exports getPlanFromProductId", () => {
    expect(productsBarrel.getPlanFromProductId("elite_supporter_yearly")).toBe(
      "elite_supporter",
    );
  });
});

describe("lib/billing/index.ts barrel", () => {
  it("re-exports catalog, stripe, and webhook-setup functions", () => {
    expect(billingBarrel.PLANS).toBe(catalog.PLANS);
    expect(billingBarrel.PRODUCTS).toBe(catalog.PRODUCTS);
    expect(typeof billingBarrel.getPlanFromProductId).toBe("function");
    expect(typeof billingBarrel.getStripe).toBe("function");
    expect(typeof billingBarrel.isStripeEnabled).toBe("function");
    expect(typeof billingBarrel.ensureStripeWebhookOnce).toBe("function");
  });

  it("re-exports the billing/subscription functions", () => {
    expect(typeof billingBarrel.getUserSubscription).toBe("function");
    expect(typeof billingBarrel.getUserPlan).toBe("function");
    expect(typeof billingBarrel.cancelSubscription).toBe("function");
    expect(typeof billingBarrel.upsertSubscription).toBe("function");
  });
});
