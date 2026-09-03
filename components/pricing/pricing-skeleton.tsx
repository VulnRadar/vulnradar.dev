import { Skeleton } from "@/components/ui/skeleton";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { PricingFeatures } from "@/components/pricing/pricing-features";
import { PricingFaq } from "@/components/pricing/pricing-faq";
import { PricingCta } from "@/components/pricing/pricing-cta";
import {
  PRICING_HERO_SECTION,
  PRICING_RAIL_SECTION,
} from "@/components/pricing/pricing-sections";
import { PLANS } from "@/lib/billing/plans";

/** One column per plan, read from the catalog the loaded page reads, so a
 *  fifth tier cannot leave the placeholder a column short. */
const CARD_COUNT = PLANS.length;
/** Every column carries the same five labelled rows. The list is assembled in
 *  app/pricing/page.tsx, which is a client module, so this tracks it by count
 *  rather than importing it. */
const SPEC_ROW_COUNT = 5;

/**
 * Mirrors PricingPage's real layout for the route-level loading.tsx.
 *
 * Only the two sections that actually depend on state are drawn as
 * placeholders: the hero (whose monthly/yearly toggle is controlled) and the
 * plan rail (whose prices, current-plan marking and CTA labels come from the
 * billing interval and the signed-in account). Everything below them is static
 * content with no fetch behind it, so the skeleton renders the REAL
 * PricingFeatures, PricingFaq and PricingCta rather than a guess at their
 * shape.
 *
 * That is not a shortcut, it is the fix. The hand-drawn versions were six
 * 16px bars where the comparison table has 20 rows, five 48px boxes where the
 * FAQ has ten multi-line entries, and nothing at all where the closing CTA is:
 * roughly 2,000px short in total, so the footer painted mid-viewport and the
 * whole document jumped on hydration. The nav and footer come from
 * PublicPageShell for the same reason, replacing a hand-rolled copy of
 * LandingNav that had three links where the real nav has five and no theme
 * toggle or mobile menu button at all.
 *
 * The two sections that ARE drawn take their container from
 * pricing-sections.ts, which is the same constant PricingHero and PricingCards
 * lay themselves out with. /pricing is fullBleed, so the measure lives on the
 * section rather than on the shell, and a placeholder that restates it is a
 * second copy of the page's width.
 */
export function PricingSkeleton() {
  return (
    <PublicPageShell fullBleed>
      <div role="status" aria-live="polite" aria-label="Loading pricing">
        {/* PricingHero */}
        <section className="border-b border-border/50">
          <div className={PRICING_HERO_SECTION}>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-8 lg:gap-12 lg:items-end">
              <div className="max-w-2xl space-y-4">
                <Skeleton className="h-10 w-full max-w-md" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
              <Skeleton className="h-11 w-48 rounded-lg" />
            </div>
          </div>
        </section>

        {/* PricingCards: one panel of columns, not four separate boxes. */}
        <section className={PRICING_RAIL_SECTION}>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
            <div className="grid grid-cols-1 lg:grid-cols-4">
              {Array.from({ length: CARD_COUNT }).map((_, i) => (
                <div
                  key={i}
                  className={
                    "flex flex-col gap-5 p-5 lg:gap-0 lg:p-6" +
                    (i > 0
                      ? " border-t border-border/60 lg:border-t-0 lg:border-l"
                      : "")
                  }
                >
                  <div className="lg:pb-4">
                    <Skeleton className="h-5 w-20" />
                  </div>
                  {/* text-4xl price plus the "Free forever" / "billed
                      annually" note under it, which the single h-9 bar left
                      no room for. */}
                  <div className="space-y-1 lg:pb-4">
                    <Skeleton className="h-10 w-24" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <div className="space-y-1.5 lg:pb-5">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                  <div className="lg:pb-5">
                    <Skeleton className="h-10 w-full rounded-md" />
                  </div>
                  {/* Each spec row is py-2 over a hairline, so roughly 37px,
                      not the 12px bar this used to draw. */}
                  <div className="border-t border-border/50">
                    {Array.from({ length: SPEC_ROW_COUNT }).map((_, j) => (
                      <div
                        key={j}
                        className="flex items-baseline justify-between gap-3 border-b border-border/40 py-2 last:border-b-0"
                      >
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-14" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-2 border-t border-border/60 bg-muted/30 px-5 py-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-6 sm:px-6">
              <Skeleton className="h-4 w-40" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-full max-w-3xl" />
                <Skeleton className="h-4 w-full max-w-2xl" />
              </div>
            </div>
          </div>

          {/* The row under the panel, which the placeholder omitted entirely. */}
          <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <Skeleton className="h-4 w-full max-w-lg" />
            <Skeleton className="h-4 w-40" />
          </div>
        </section>
      </div>

      <PricingFeatures />
      <PricingFaq />
      {/* isLoggedIn only swaps the button label, never the block's geometry. */}
      <PricingCta isLoggedIn={false} />
    </PublicPageShell>
  );
}
