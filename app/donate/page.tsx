"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";

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
    <div className="min-h-screen bg-gradient-to-b from-background to-background/50 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="mb-6 flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full" />
            <Heart
              className="h-12 w-12 text-primary relative"
              fill="currentColor"
            />
          </div>
        </div>

        <h1 className="text-3xl font-bold text-foreground mb-2">
          Support VulnRadar
        </h1>
        <p className="text-muted-foreground mb-6">
          Help us continue building the best free vulnerability scanner
        </p>

        <div className="inline-block mb-6">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          Redirecting to Stripe...
        </p>

        <div className="text-xs text-muted-foreground/60 space-y-2">
          {!redirected && (
            <>
              <p>If you're not redirected, click the button below:</p>
              <Link
                href={STRIPE_DONATE_URL}
                className="inline-block mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
              >
                Donate Now
              </Link>
            </>
          )}
          {redirected && (
            <p>Thank you for supporting open-source security! 🙏</p>
          )}
        </div>
      </div>
    </div>
  );
}
