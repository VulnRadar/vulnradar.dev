"use client";

import { Crown, Zap, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  ROUTES,
  BILLING_ENABLED,
  BILLING_PLAN_LIMITS,
  BILLING_HISTORY_RETENTION,
} from "@/lib/config/constants";
import { PLANS } from "@/lib/billing/plans";

export interface PremiumFeature {
  id: string;
  name: string;
  description: string;
  requiredPlan: "core_supporter" | "pro_supporter" | "elite_supporter";
}

// Define all premium features in one place
export const PREMIUM_FEATURES: Record<string, PremiumFeature> = {
  scan_limit: {
    id: "scan_limit",
    name: "Daily Scan Limit Reached",
    description:
      "You've used all your free scans for today. Upgrade to get more daily scans and keep your security monitoring running.",
    requiredPlan: "core_supporter",
  },
  dns_refetch: {
    id: "dns_refetch",
    name: "DNS Re-fetch",
    description:
      "Re-fetch DNS records during scans to get the most up-to-date information about your domain's DNS configuration.",
    requiredPlan: "pro_supporter",
  },
};

// Derive plan labels, prices, and limits from centralized plans config
const PLAN_LABELS: Record<string, string> = Object.fromEntries(
  PLANS.map((p) => [p.id, p.name.replace(" Supporter", "")]),
);

const PLAN_PRICES: Record<string, number> = Object.fromEntries(
  PLANS.map((p) => [p.id, p.priceInCents / 100]),
);

const PLAN_API_LIMITS: Record<string, number> = Object.fromEntries(
  PLANS.map((p) => [p.id, p.limits.apiRequestsPerDay]),
);

function formatApiLimit(planId: string): string {
  const limit = PLAN_API_LIMITS[planId];
  if (limit === -1) return "Unlimited API access";
  return `${limit.toLocaleString()} API requests/day`;
}

// Helper to get retention label
function getRetentionLabel(planId: string): string {
  const retention =
    BILLING_HISTORY_RETENTION[planId as keyof typeof BILLING_HISTORY_RETENTION];
  if (retention === -1) return "Unlimited scan history";
  return `${retention}-day scan history`;
}

interface PremiumUpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: PremiumFeature;
  currentPlan?: string;
}

export function PremiumUpgradeModal({
  open,
  onOpenChange,
  feature,
  currentPlan: _currentPlan = "free",
}: PremiumUpgradeModalProps) {
  const requiredPlanLabel = PLAN_LABELS[feature.requiredPlan];
  const requiredPlanPrice = PLAN_PRICES[feature.requiredPlan];

  // Get benefits dynamically from config
  const getPlanBenefits = (planId: string): string[] => {
    const scanLimit =
      BILLING_PLAN_LIMITS[planId as keyof typeof BILLING_PLAN_LIMITS];
    const retention = getRetentionLabel(planId);

    if (planId === "core_supporter") {
      return [
        `${scanLimit} scans per day`,
        retention,
        "1 webhook alert",
        "Early access features",
      ];
    } else if (planId === "pro_supporter") {
      return [
        `${scanLimit} scans per day`,
        retention,
        "Teams, up to 3 members",
        formatApiLimit(planId),
        "All Core features",
      ];
    } else if (planId === "elite_supporter") {
      return [
        `${scanLimit} scans per day`,
        formatApiLimit(planId),
        "Unlimited webhooks and scheduled scans",
        "All Pro features",
      ];
    }
    return [];
  };

  const benefits = getPlanBenefits(feature.requiredPlan);

  // This modal only exists to sell an upgrade, so on a self-hosted deployment
  // with billing switched off there is nothing for it to say.
  if (!BILLING_ENABLED) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
              <Crown className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <Badge variant="secondary" className="gap-1">
              <Zap className="h-3 w-3" aria-hidden="true" />
              Premium Feature
            </Badge>
          </div>
          <DialogTitle className="text-xl">{feature.name}</DialogTitle>
          <DialogDescription className="text-base">
            {feature.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium">{requiredPlanLabel} Plan</span>
              <div className="text-right">
                <span className="text-2xl font-bold">${requiredPlanPrice}</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
            </div>
            <ul className="space-y-2">
              {benefits.map((benefit, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <Check
                    className="h-4 w-4 text-primary shrink-0"
                    aria-hidden="true"
                  />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Upgrade to {requiredPlanLabel} or higher to unlock this feature
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href={ROUTES.PRICING}>
              <Crown className="h-4 w-4 mr-2" aria-hidden="true" />
              Upgrade to {requiredPlanLabel}
            </Link>
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Hook to check if user has access to a premium feature
export function hasFeatureAccess(
  userPlan: string,
  requiredPlan: string,
): boolean {
  const planHierarchy = [
    "free",
    "core_supporter",
    "pro_supporter",
    "elite_supporter",
  ];
  const userPlanIndex = planHierarchy.indexOf(userPlan);
  const requiredPlanIndex = planHierarchy.indexOf(requiredPlan);
  return userPlanIndex >= requiredPlanIndex;
}
