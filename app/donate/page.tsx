"use client";

import { useEffect } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { APP_NAME } from "@/lib/config/client-constants";

const STRIPE_DONATE_URL = "https://buy.stripe.com/eVq5kEciX75B9y3eIG2Ji04";

export default function DonatePage() {
  useEffect(() => {
    // location.replace, not location.href: href left /donate in the history
    // stack, so pressing Back from Stripe returned here and re-fired the
    // redirect 100ms later, trapping the user in a loop.
    const timeout = setTimeout(() => {
      window.location.replace(STRIPE_DONATE_URL);
    }, 100);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <PublicPageShell maxWidth="max-w-sm" padding="py-16 sm:py-24">
      <div className="text-center">
        <Heart
          className="h-9 w-9 text-primary mx-auto mb-6"
          fill="currentColor"
          aria-hidden="true"
        />

        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-5 text-balance text-foreground">
          Support {APP_NAME}
        </h1>
        <p className="text-muted-foreground leading-relaxed mb-8">
          {APP_NAME} is GPL-3.0 and free to self-host. Donations pay for the
          hosting behind the public instance and the time spent chasing false
          positives out of the detection engine.
        </p>

        <p
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-6"
          role="status"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin"
          />
          Redirecting to Stripe
        </p>

        {/* Rendered unconditionally. The old version hid this button the moment
            the redirect fired, which is exactly the moment it is needed: if the
            automatic redirect is blocked, this is the only way through, and it
            was replaced by a thank-you for a donation that had not happened. */}
        <Button asChild size="lg" className="h-11 px-6">
          <a href={STRIPE_DONATE_URL}>Continue to Stripe</a>
        </Button>
        <p className="text-xs text-muted-foreground/70 mt-4 leading-relaxed">
          Not moving? Use the button above. Payment is handled entirely by
          Stripe.
        </p>
      </div>
    </PublicPageShell>
  );
}
