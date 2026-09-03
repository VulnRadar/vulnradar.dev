"use client";

import { Crown, Zap, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  ROUTES,
  AI_USAGE_WINDOW_HOURS,
  BILLING_ENABLED,
  BILLING_HISTORY_RETENTION,
} from "@/lib/config/client-constants";
import { PLANS } from "@/lib/billing/plans";
import { usePlanLimits } from "@/lib/hooks/use-plan-limits";

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
  port_refetch: {
    id: "port_refetch",
    name: "Port Re-scan",
    description:
      "Re-run the curated port and service sweep on demand to see the latest open ports for this host.",
    requiredPlan: "pro_supporter",
  },
  screenshot_recapture: {
    id: "screenshot_recapture",
    name: "Screenshot Re-capture",
    description:
      "Capture a fresh page screenshot on demand so the report reflects how the site looks right now.",
    requiredPlan: "pro_supporter",
  },
  subdomain_discovery: {
    id: "subdomain_discovery",
    name: "Subdomain Discovery",
    description:
      "Discover subdomains for this host and scan the ones you choose, expanding coverage beyond the entry URL.",
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

// These take the resolved number rather than looking a plan id up in a map
// built from the catalog copy. This modal quotes what someone gets for paying,
// and the catalog is only what shipped: enforcement reads the admin-editable
// BILLING_* settings, so a raised quota used to be charged but not advertised
// (AUDIT-011#drift-10).
function formatApiLimit(limit: number): string {
  if (limit === -1) return "Unlimited API access";
  return `${limit.toLocaleString()} API requests/day`;
}

// aiTokensPerWindow is never -1 (see the PlanLimits doc comment in
// lib/billing/catalog.ts), so this only needs the token count plus the
// reset cadence. Covers AI finding verification only -- chat and AI scan
// summaries are free/unmetered on every plan, so they're not listed here.
function formatAiUsage(tokens: number): string {
  return `${tokens.toLocaleString()} AI verification tokens / ${AI_USAGE_WINDOW_HOURS}hr`;
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

  // Every number below is resolved from the settings the API enforces against
  // rather than the catalog copy compiled into this bundle, so an admin who
  // raises a quota is not left selling the old one (AUDIT-011#drift-10). The
  // webhook and team-member lines were plain strings ("1 webhook alert",
  // "Teams, up to 3 members", "Unlimited webhooks and scheduled scans") that
  // could not track any change at all, in config or catalog.
  const planLimits = usePlanLimits();

  const getPlanBenefits = (
    planId: PremiumFeature["requiredPlan"],
  ): string[] => {
    const limits = planLimits[planId];
    const retention = getRetentionLabel(planId);
    const countOf = (n: number, one: string, many: string) =>
      n === -1
        ? `Unlimited ${many}`
        : `${n.toLocaleString()} ${n === 1 ? one : many}`;

    if (planId === "core_supporter") {
      return [
        `${limits.dailyScans} scans per day`,
        retention,
        countOf(limits.webhooks, "webhook alert", "webhook alerts"),
        formatAiUsage(limits.aiTokensPerWindow),
        "Early access features",
      ];
    } else if (planId === "pro_supporter") {
      return [
        `${limits.dailyScans} scans per day`,
        retention,
        `Teams, up to ${limits.teamMembers} members`,
        formatApiLimit(limits.apiRequestsPerDay),
        formatAiUsage(limits.aiTokensPerWindow),
        "All Core features",
      ];
    } else if (planId === "elite_supporter") {
      return [
        `${limits.dailyScans} scans per day`,
        formatApiLimit(limits.apiRequestsPerDay),
        // Both unlimited is the shipped case and reads better said once.
        limits.webhooks === -1 && limits.scheduledScans === -1
          ? "Unlimited webhooks and scheduled scans"
          : `${countOf(limits.webhooks, "webhook", "webhooks")}, ${countOf(
              limits.scheduledScans,
              "scheduled scan",
              "scheduled scans",
            ).toLowerCase()}`,
        formatAiUsage(limits.aiTokensPerWindow),
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
      {/* The banded shell: the benefit list grows with the plan, and "Upgrade"
          is the whole point of the modal, so it stays pinned in the footer
          rather than scrolling away under a long list. */}
      <DialogContent variant="shell" size="sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
              <Crown className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <Badge variant="secondary" className="gap-1">
              <Zap className="h-3 w-3" aria-hidden="true" />
              Premium Feature
            </Badge>
          </div>
          <DialogTitle>{feature.name}</DialogTitle>
          <DialogDescription>{feature.description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
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
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
          <Button asChild>
            <Link href={ROUTES.PRICING}>
              <Crown className="h-4 w-4 mr-2" aria-hidden="true" />
              Upgrade to {requiredPlanLabel}
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Hook to check if user has access to a premium feature
export function hasFeatureAccess(
  userPlan: string,
  requiredPlan: string,
): boolean {
  const planHierarchy: string[] = PLANS.map((p) => p.id);
  const userPlanIndex = planHierarchy.indexOf(userPlan);
  const requiredPlanIndex = planHierarchy.indexOf(requiredPlan);
  return userPlanIndex >= requiredPlanIndex;
}
