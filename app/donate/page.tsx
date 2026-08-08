"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/config/constants";

const STRIPE_DONATE_URL = "https://buy.stripe.com/eVq5kEciX75B9y3eIG2Ji04";

export default function DonatePage() {
  const [redirected, setRedirected] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      window.location.href = STRIPE_DONATE_URL;
      setRedirected(true);
    }, 100);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <Heart
          className="h-9 w-9 text-primary mx-auto mb-6"
          fill="currentColor"
          aria-hidden="true"
        />

        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-2">
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

        {!redirected && (
          <Button asChild size="lg" className="h-11 px-6">
            <Link href={STRIPE_DONATE_URL}>Continue to Stripe</Link>
          </Button>
        )}
        {redirected && (
          <p className="text-sm text-muted-foreground">
            Thank you for supporting open-source security.
          </p>
        )}
      </div>
    </div>
  );
}
