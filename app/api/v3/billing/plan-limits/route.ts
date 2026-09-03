import { NextResponse } from "next/server";
import { getAllPlanLimits } from "@/lib/billing/plan-limits";

/**
 * Every plan's resolved limits, for the client components that ADVERTISE them
 * (the pricing comparison table, the upgrade modal, the checkout summary).
 *
 * Those surfaces read lib/billing/catalog.ts's hardcoded PLANS[] copy while
 * enforcement resolved the admin-editable BILLING_* settings, so one edit in
 * /admin desynchronised the advertised number from the enforced one
 * (AUDIT-011#drift-10). This route is where the resolver crosses to the
 * browser, the same job GET /api/v3/config/client does for the feature flags.
 *
 * No auth, for the same reason that route needs none: these are the published
 * prices. Every value already ships in the client bundle today as a compiled
 * default; this only makes an admin's edit reach the page that quotes it.
 */
export async function GET() {
  try {
    return NextResponse.json(await getAllPlanLimits(), {
      // Client components hold the compiled catalog values as a fallback, so
      // a short cache is fine: this is a refresh, not a security boundary.
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    console.error("[billing/plan-limits] GET error:", err);
    return NextResponse.json(
      { error: "Could not resolve plan limits." },
      { status: 500 },
    );
  }
}
