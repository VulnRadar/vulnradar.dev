"use client"

import { Crown, Zap, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ROUTES } from "@/lib/constants"

export interface PremiumFeature {
  id: string
  name: string
  description: string
  requiredPlan: "core_supporter" | "pro_supporter" | "elite_supporter"
}

// Define all premium features in one place
export const PREMIUM_FEATURES: Record<string, PremiumFeature> = {
  scan_limit: {
    id: "scan_limit",
    name: "Daily Scan Limit Reached",
    description: "You've used all your free scans for today. Upgrade to get more daily scans and keep your security monitoring running.",
    requiredPlan: "core_supporter",
  },
  dns_refetch: {
    id: "dns_refetch",
    name: "DNS Re-fetch",
    description: "Re-fetch DNS records during scans to get the most up-to-date information about your domain's DNS configuration.",
    requiredPlan: "pro_supporter",
  },
  advanced_reporting: {
    id: "advanced_reporting",
    name: "Advanced Reporting",
    description: "Generate detailed PDF/CSV reports with executive summaries and compliance mapping.",
    requiredPlan: "pro_supporter",
  },
  custom_scan_profiles: {
    id: "custom_scan_profiles",
    name: "Custom Scan Profiles",
    description: "Create and save custom scan configurations for different use cases.",
    requiredPlan: "pro_supporter",
  },
  security_trends: {
    id: "security_trends",
    name: "Security Trends",
    description: "Track your security score over time with historical trend analysis.",
    requiredPlan: "core_supporter",
  },
  bulk_export: {
    id: "bulk_export",
    name: "Bulk Export",
    description: "Export all scan history data in bulk for external analysis.",
    requiredPlan: "pro_supporter",
  },
  priority_scanning: {
    id: "priority_scanning",
    name: "Priority Scanning",
    description: "Skip the queue and get faster scan results with priority processing.",
    requiredPlan: "elite_supporter",
  },
}

const PLAN_LABELS: Record<string, string> = {
  core_supporter: "Core",
  pro_supporter: "Pro",
  elite_supporter: "Elite",
}

const PLAN_PRICES: Record<string, number> = {
  core_supporter: 5,
  pro_supporter: 10,
  elite_supporter: 20,
}

interface PremiumUpgradeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  feature: PremiumFeature
  currentPlan?: string
}

export function PremiumUpgradeModal({
  open,
  onOpenChange,
  feature,
  currentPlan = "free",
}: PremiumUpgradeModalProps) {
  const requiredPlanLabel = PLAN_LABELS[feature.requiredPlan]
  const requiredPlanPrice = PLAN_PRICES[feature.requiredPlan]

  // Get benefits based on required plan
  const planBenefits = {
    core_supporter: [
      "100 scans per day",
      "90-day scan history",
      "Email support",
      "Early access features",
    ],
    pro_supporter: [
      "150 scans per day",
      "Unlimited scan history",
      "Priority support",
      "5,000 API requests/day",
      "All Core features",
    ],
    elite_supporter: [
      "500 scans per day",
      "Unlimited API access",
      "Dedicated support",
      "Beta features access",
      "All Pro features",
    ],
  }

  const benefits = planBenefits[feature.requiredPlan] || []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
              <Crown className="h-5 w-5 text-primary" />
            </div>
            <Badge variant="secondary" className="gap-1">
              <Zap className="h-3 w-3" />
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
                  <Check className="h-4 w-4 text-primary shrink-0" />
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
              <Crown className="h-4 w-4 mr-2" />
              Upgrade to {requiredPlanLabel}
            </Link>
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Maybe Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Hook to check if user has access to a premium feature
export function hasFeatureAccess(userPlan: string, requiredPlan: string): boolean {
  const planHierarchy = ["free", "core_supporter", "pro_supporter", "elite_supporter"]
  const userPlanIndex = planHierarchy.indexOf(userPlan)
  const requiredPlanIndex = planHierarchy.indexOf(requiredPlan)
  return userPlanIndex >= requiredPlanIndex
}
