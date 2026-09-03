import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { privatePageMetadata } from "@/lib/seo/metadata";
import { Button } from "@/components/ui/button";
import { AppPageShell } from "@/components/shared/app-page-shell";
import {
  ROUTES,
  APP_NAME,
  BILLING_ENABLED,
} from "@/lib/config/client-constants";
import { CheckoutMessage } from "@/components/billing/checkout-message";
import { CreditsOverview } from "@/components/billing/credits-overview";
import { loadCreditSnapshots } from "@/components/billing/credit-usage";

export const metadata: Metadata = privatePageMetadata("Credits", "/credits");

/**
 * Every credit balance on one page.
 *
 * There was no such page. There were three sibling checkout URLs, each of
 * which sold one balance and mentioned neither of the other two, and the only
 * thing that knew all three existed was the billing tab of the profile page.
 * So "what do I hold, and what would more of it buy me" had no answer short of
 * visiting three URLs you had to already know about.
 */
export default async function CreditsPage() {
  const session = await getSession();
  if (!session) {
    redirect(`${ROUTES.LOGIN}?redirect=/credits`);
  }

  if (!BILLING_ENABLED) {
    return (
      <CheckoutMessage
        title="There is nothing to buy"
        description={`Billing is switched off on this ${APP_NAME} deployment, so no feature has a cap that credits could top up.`}
        action={
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.DASHBOARD}>Go to Scanner</Link>
          </Button>
        }
      />
    );
  }

  const snapshots = await loadCreditSnapshots(session.userId);

  return (
    // max-w-5xl, narrower than the app default: this page is a single column
    // of three rows, and CreditsHubSkeleton reserves the same measure by
    // passing the same argument rather than restating the number.
    <AppPageShell maxWidth="max-w-5xl">
      <CreditsOverview snapshots={snapshots} />
    </AppPageShell>
  );
}
