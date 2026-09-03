import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ROUTES } from "@/lib/config/client-constants";

/**
 * The chrome for the subscription funnel at /checkout/[productId], and the
 * third member of the family whose other two are AppPageShell and
 * PublicPageShell.
 *
 * It is neither of those on purpose. This route is entered from the public
 * pricing page by someone about to hand over a card, so it drops the app nav
 * and the footer and keeps exactly one way out: back to plans. That decision
 * is the reason it needed a shell of its own rather than reusing one, and the
 * reason it kept drifting without one. CheckoutSkeleton wrote out the same
 * sticky bar, the same banner spacer and the same measured main a second time,
 * and the second copy had already fallen behind: it sat at max-w-4xl against
 * the page's max-w-5xl, so the whole column shifted sideways the moment the
 * auth check resolved.
 */
export function CheckoutShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 sticky top-[calc(var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] z-10 transition-[top] duration-300">
        {/* One item, so it is laid out as one item. `justify-between` plus an
            empty `w-4` spacer used to fake the balance of a header that had
            something on the right, and there has never been anything there. */}
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center">
          <Link
            href={ROUTES.PRICING}
            className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm">Back to plans</span>
          </Link>
        </div>
      </header>
      {/* position: sticky reserves flow space at the header's unshifted
          height only -- the extra top-(--vr-banner-h) offset that
          pushes it down below a banner is a paint-only shift, so without
          this the header visually overlaps the content below it. */}
      <div
        className="h-[calc(var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] transition-[height] duration-300"
        aria-hidden="true"
      />

      <main
        id="main-content"
        // tabIndex={-1} is what actually makes the layout's skip link work:
        // without it the browser scrolls to <main> but leaves focus on the
        // link, so the next Tab walks back into the nav the user just skipped.
        tabIndex={-1}
        className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16"
      >
        {children}
      </main>
    </div>
  );
}
