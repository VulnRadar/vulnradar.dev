"use client";

import { Sparkles, Shield, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StripeCheckout } from "@/components/billing/stripe-checkout";
import { PLANS } from "@/lib/billing/plans";
import Link from "next/link";

interface CheckoutModalProps {
  planId: string;
  userId: number;
  billing: "monthly" | "yearly";
  onClose: () => void;
  onSuccess: () => void;
}

export function CheckoutModal({
  planId,
  userId,
  billing,
  onClose,
  onSuccess,
}: CheckoutModalProps) {
  const selectedPlan = PLANS.find((p) => p.id === planId);
  const planName = planId.includes("elite")
    ? "Elite"
    : planId.includes("pro")
      ? "Pro"
      : "Core";
  const planPrice = selectedPlan ? selectedPlan.priceInCents / 100 : 0;
  const planBadgeColor = selectedPlan?.badge?.color || "#10b981";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-scale-in">
        {/* Header - plan identity strip */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${planBadgeColor}18` }}
            >
              <Sparkles className="h-4 w-4" style={{ color: planBadgeColor }} />
            </div>
            <div className="flex items-center gap-2.5">
              <span className="font-semibold text-base">
                {planName} Supporter
              </span>
              <span className="text-muted-foreground text-sm">·</span>
              <span className="font-bold text-base">
                $
                {billing === "yearly" ? Math.round(planPrice * 0.8) : planPrice}
                <span className="text-sm font-normal text-muted-foreground">
                  /mo
                </span>
              </span>
              {billing === "yearly" && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0"
                  style={{
                    borderColor: `${planBadgeColor}50`,
                    color: planBadgeColor,
                  }}
                >
                  20% off
                </Badge>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full hover:bg-muted flex-shrink-0"
            onClick={onClose}
            aria-label="Close checkout"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Stripe Checkout Form - scrollable */}
        <div className="flex-1 overflow-y-auto bg-white">
          <div className="p-5">
            <StripeCheckout
              productId={planId}
              userId={userId}
              onSuccess={onSuccess}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-between gap-4 px-5 py-3 border-t border-border bg-muted/20">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Shield className="h-3.5 w-3.5" />
            <span>256-bit SSL encryption</span>
          </div>
          <p className="text-xs text-muted-foreground">
            All purchases are final.{" "}
            <Link
              href="/legal/terms"
              className="underline hover:text-foreground transition-colors"
            >
              Terms
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
