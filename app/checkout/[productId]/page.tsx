"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import {
  Shield,
  Check,
  Loader2,
  ArrowLeft,
  Sparkles,
  Zap,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PRODUCTS, getPlanFromProductId } from "@/lib/billing/products";
import { PLANS } from "@/lib/billing/plans";
import Link from "next/link";
import { ROUTES, BILLING_ENABLED, APP_NAME } from "@/lib/config/constants";
import { StripeCheckout } from "@/components/billing/stripe-checkout";
import { cn } from "@/lib/ui/utils";

export default function CheckoutPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [checkoutComplete, setCheckoutComplete] = useState(false);

  const product = PRODUCTS.find((p) => p.id === productId);
  const planId = product ? getPlanFromProductId(product.id) : null;
  const plan = planId ? PLANS.find((p) => p.id === planId) : null;

  const monthlyPrice = product ? product.priceInCents / 100 : 0;
  const isYearly = product?.interval === "year";
  const effectiveMonthly = isYearly ? monthlyPrice / 12 : monthlyPrice;

  useEffect(() => {
    async function checkAuth() {
      try {
        const meRes = await fetch("/api/v3/auth/me");
        if (!meRes.ok) {
          router.push(`/auth?redirect=/checkout/${productId}`);
          return;
        }
        const meData = await meRes.json();
        setUserId(meData.data?.id);
      } catch {
        router.push(`/auth?redirect=/checkout/${productId}`);
      } finally {
        setLoading(false);
      }
    }

    if (product) {
      checkAuth();
    } else {
      setError("Invalid product");
      setLoading(false);
    }
  }, [productId, product, router]);

  if (!BILLING_ENABLED) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-4">
          <h1 className="text-2xl font-bold mb-2">
            There is nothing to pay for
          </h1>
          <p className="text-muted-foreground mb-4">
            Billing is switched off on this {APP_NAME} deployment, so every
            account already has full access.
          </p>
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.DASHBOARD}>Go to Scanner</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!product || !plan) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center px-4">
          <h1 className="text-2xl font-bold mb-2">That plan does not exist</h1>
          <p className="text-muted-foreground mb-4">
            The link you followed does not match a current plan. Nothing has
            been charged.
          </p>
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.PRICING}>View plans</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div
          className="flex flex-col items-center gap-4"
          role="status"
          aria-live="polite"
        >
          <Loader2
            className="h-8 w-8 animate-spin text-primary"
            aria-hidden="true"
          />
          <p className="text-muted-foreground">Preparing checkout...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-4" role="alert">
          <h1 className="text-2xl font-bold mb-2">
            We could not start checkout
          </h1>
          <p className="text-muted-foreground mb-4">{error}</p>
          <p className="text-sm text-muted-foreground mb-4">
            Nothing has been charged.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Button variant="outline" asChild>
              <Link href={ROUTES.PRICING}>Back to plans</Link>
            </Button>
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }

  if (checkoutComplete) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        role="status"
      >
        <div className="text-center px-4">
          <div className="w-16 h-16 rounded-full bg-[hsl(var(--success)/0.12)] flex items-center justify-center mx-auto mb-6">
            <Check
              className="h-8 w-8 text-[hsl(var(--success))]"
              aria-hidden="true"
            />
          </div>
          <h1 className="text-2xl font-bold mb-2">You are subscribed</h1>
          <p className="text-muted-foreground mb-6">
            Your account is on{" "}
            <span className="font-medium text-foreground">{plan.name}</span>{" "}
            now. The new scan limit applies immediately.
          </p>
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.DASHBOARD}>Start scanning</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            href={ROUTES.PRICING}
            className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm">Back to plans</span>
          </Link>
          <div className="w-4" />
        </div>
      </header>

      {/* Main content */}
      <main className="container max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="grid md:grid-cols-2 gap-8 md:gap-12 md:items-start">
          {/* Left column - order summary */}
          <div>
            <div className="text-center md:text-left mb-6">
              {/* Badge color is per-plan branding from the plan catalog, not a
                  UI state, so a data-provided hex is intentional here. Plans
                  without one keep the Badge component's own token-driven
                  default instead of a synthesized fallback color. */}
              <Badge
                className="mb-4"
                style={
                  plan.badge?.color
                    ? {
                        backgroundColor: `${plan.badge.color}18`,
                        color: plan.badge.color,
                        borderColor: `${plan.badge.color}50`,
                      }
                    : undefined
                }
              >
                {plan.badge?.text || plan.name}
              </Badge>
              <h1 className="text-2xl md:text-3xl font-bold mb-2">
                Complete your subscription
              </h1>
              <p className="text-muted-foreground">
                You&apos;re subscribing to {product.name}
              </p>
            </div>

            <div className="sticky top-24">
              {/* Order Summary */}
              <div className="rounded-xl border border-border bg-card p-5 mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-4">
                  Order Summary
                </h3>
                <div className="flex items-start gap-4 mb-4">
                  <div
                    className={cn(
                      "h-12 w-12 rounded-lg flex items-center justify-center shrink-0",
                      !plan.badge?.color && "bg-primary/10",
                    )}
                    style={
                      plan.badge?.color
                        ? { backgroundColor: `${plan.badge.color}18` }
                        : undefined
                    }
                  >
                    {plan.id.includes("elite") ? (
                      <Crown
                        className={cn(
                          "h-6 w-6",
                          !plan.badge?.color && "text-primary",
                        )}
                        style={
                          plan.badge?.color
                            ? { color: plan.badge.color }
                            : undefined
                        }
                        aria-hidden="true"
                      />
                    ) : plan.id.includes("pro") ? (
                      <Zap
                        className={cn(
                          "h-6 w-6",
                          !plan.badge?.color && "text-primary",
                        )}
                        style={
                          plan.badge?.color
                            ? { color: plan.badge.color }
                            : undefined
                        }
                        aria-hidden="true"
                      />
                    ) : (
                      <Sparkles
                        className={cn(
                          "h-6 w-6",
                          !plan.badge?.color && "text-primary",
                        )}
                        style={
                          plan.badge?.color
                            ? { color: plan.badge.color }
                            : undefined
                        }
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-lg">{product.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {product.description}
                    </p>
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {isYearly
                        ? "Yearly subscription"
                        : "Monthly subscription"}
                    </span>
                    <span className="font-medium">
                      ${monthlyPrice.toFixed(2)}/{isYearly ? "yr" : "mo"}
                    </span>
                  </div>
                  {isYearly && (
                    <div className="flex justify-between text-[hsl(var(--success))]">
                      <span>Annual discount (20% off)</span>
                      <span>Included</span>
                    </div>
                  )}
                </div>

                <Separator className="my-4" />

                <div className="flex justify-between items-center">
                  <span className="font-semibold">Total today</span>
                  <div className="text-right">
                    <span className="text-2xl font-bold">
                      ${monthlyPrice.toFixed(2)}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {isYearly
                        ? `$${effectiveMonthly.toFixed(2)}/mo effective`
                        : "Billed monthly"}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Renews {isYearly ? "every year" : "every month"} at{" "}
                  {`$${monthlyPrice.toFixed(2)}`} until you cancel. No trial, no
                  separate setup fee.
                </p>
              </div>

              {/* Features */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">
                  What&apos;s included
                </h3>
                <ul className="space-y-2">
                  {plan.features.slice(0, 5).map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Check
                        className="h-4 w-4 text-[hsl(var(--success))] shrink-0"
                        aria-hidden="true"
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                  <li className="flex items-center gap-2 text-sm">
                    <Check
                      className="h-4 w-4 text-[hsl(var(--success))] shrink-0"
                      aria-hidden="true"
                    />
                    <span>{plan.limits.dailyScans} scans per day</span>
                  </li>
                </ul>
              </div>

              <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground mt-4">
                <div className="flex items-center gap-1">
                  <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Payment handled by Stripe</span>
                </div>
                <span aria-hidden="true">·</span>
                <span>Cancel anytime, no lock-in</span>
              </div>
            </div>
          </div>

          {/* Right column - payment form */}
          <div className="md:pt-[120px]">
            <div className="sticky top-24">
              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="text-base font-semibold mb-5">
                  Payment details
                </h2>
                <StripeCheckout
                  productId={productId}
                  userId={userId ?? 0}
                  onSuccess={() => setCheckoutComplete(true)}
                />
              </div>

              <p className="text-center text-xs text-muted-foreground mt-4">
                By subscribing, you agree to our{" "}
                <Link
                  href="/legal/terms"
                  className="underline hover:text-foreground"
                >
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link
                  href="/legal/privacy"
                  className="underline hover:text-foreground"
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
