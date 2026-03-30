"use client"

import { useState, useEffect } from "react"
import { CreditCard, Loader2, Download, ExternalLink, AlertTriangle, Check, Zap, Crown, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { API, ROUTES } from "@/lib/config/constants"
import { useProfile } from "../profile-context"
import { formatDate } from "../profile-types"
import type { BillingInfo } from "../profile-types"
import Link from "next/link"

const PLAN_FEATURES: Record<string, { name: string; icon: typeof Zap; color: string; features: string[] }> = {
  free: {
    name: "Free",
    icon: Zap,
    color: "text-muted-foreground",
    features: ["5 scans per day", "Basic vulnerability detection", "7-day history"],
  },
  pro: {
    name: "Pro",
    icon: Crown,
    color: "text-primary",
    features: ["100 scans per day", "Advanced detection", "30-day history", "API access", "Webhooks"],
  },
  enterprise: {
    name: "Enterprise",
    icon: Sparkles,
    color: "text-amber-500",
    features: ["Unlimited scans", "Priority support", "Custom integrations", "Team management", "SLA"],
  },
}

export function ProfileBillingTab() {
  const { profile, billingInfo, setBillingInfo } = useProfile()

  const [isLoading, setIsLoading] = useState(true)
  const [isManaging, setIsManaging] = useState(false)

  useEffect(() => {
    fetchBillingInfo()
  }, [])

  const fetchBillingInfo = async () => {
    try {
      setIsLoading(true)
      const res = await fetch(`${API.ME}/billing`, { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        setBillingInfo(data)
      }
    } catch (error) {
      console.error("Failed to fetch billing:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleManageSubscription = async () => {
    setIsManaging(true)
    try {
      const res = await fetch(`${API.ME}/billing/portal`, {
        method: "POST",
        credentials: "include",
      })

      if (res.ok) {
        const data = await res.json()
        window.location.href = data.url
      } else {
        toast.error("Failed to open billing portal")
      }
    } catch (error) {
      toast.error("Failed to open billing portal")
    } finally {
      setIsManaging(false)
    }
  }

  const currentPlan = profile?.plan || "free"
  const planInfo = PLAN_FEATURES[currentPlan] || PLAN_FEATURES.free
  const PlanIcon = planInfo.icon

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <PlanIcon className={`h-4 w-4 ${planInfo.color}`} />
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">Current Plan</h3>
              <p className="text-xs text-muted-foreground">Your subscription details</p>
            </div>
          </div>
          <Badge variant="outline" className={`${planInfo.color} border-current/30 bg-current/10`}>
            {planInfo.name}
          </Badge>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                {billingInfo?.status === "active" ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Active
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                    {billingInfo?.status || "Free"}
                  </>
                )}
              </p>
            </div>
            {billingInfo?.currentPeriodEnd && (
              <div>
                <p className="text-xs text-muted-foreground">
                  {billingInfo.cancelAtPeriodEnd ? "Cancels on" : "Renews on"}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {formatDate(billingInfo.currentPeriodEnd)}
                </p>
              </div>
            )}
            {billingInfo?.paymentMethod && (
              <div>
                <p className="text-xs text-muted-foreground">Payment Method</p>
                <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5" />
                  {billingInfo.paymentMethod.brand} •••• {billingInfo.paymentMethod.last4}
                </p>
              </div>
            )}
          </div>

          {billingInfo?.cancelAtPeriodEnd && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" />
                Your subscription will cancel at the end of the current billing period
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {currentPlan !== "free" && (
              <Button variant="outline" size="sm" onClick={handleManageSubscription} disabled={isManaging}>
                {isManaging ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                )}
                Manage Subscription
              </Button>
            )}
            <Button asChild size="sm">
              <Link href={ROUTES.PRICING}>
                <Zap className="h-3.5 w-3.5 mr-1.5" />
                {currentPlan === "free" ? "Upgrade Plan" : "View Plans"}
              </Link>
            </Button>
          </div>
        </div>
      </Card>

      {/* Plan Features */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <h3 className="text-sm font-medium text-foreground mb-4">Plan Features</h3>
        <ul className="space-y-2">
          {planInfo.features.map((feature, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
              {feature}
            </li>
          ))}
        </ul>
      </Card>

      {/* Invoices */}
      {billingInfo?.invoices && billingInfo.invoices.length > 0 && (
        <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
          <h3 className="text-sm font-medium text-foreground mb-4">Billing History</h3>
          <div className="space-y-2">
            {billingInfo.invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-background">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      ${(invoice.amount / 100).toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDate(invoice.date)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      invoice.status === "paid"
                        ? "text-green-500 border-green-500/30 bg-green-500/10"
                        : "text-amber-500 border-amber-500/30 bg-amber-500/10"
                    }
                  >
                    {invoice.status}
                  </Badge>
                  <Button asChild variant="ghost" size="sm">
                    <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer">
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
