"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Gauge,
  Zap,
  RefreshCw,
  AlertTriangle,
  CreditCard,
  Users,
  Gift,
  Calendar,
  TrendingUp,
  Loader2,
  XCircle,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react"
import { cn } from "@/lib/ui/utils"
import { API, ROUTES } from "@/lib/config/constants"
import type { ProfileTabProps, BillingInfo } from "../types"
import { BillingVerificationModal } from "../modals/billing-verification-modal"

export function ProfileBillingTab({
  setError,
  setSuccess,
  preloadedBillingInfo,
}: ProfileTabProps) {
  // Use preloaded data if available
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(preloadedBillingInfo ?? null)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [cancelType, setCancelType] = useState<"period_end" | "immediate">("period_end")
  const [cancelingSubscription, setCancelingSubscription] = useState(false)
  const [reactivatingSubscription, setReactivatingSubscription] = useState(false)
  const [showVerificationModal, setShowVerificationModal] = useState(false)
  const [sensitiveInfoVisible, setSensitiveInfoVisible] = useState(false)

  // Update state when preloaded data changes
  useEffect(() => {
    if (preloadedBillingInfo) {
      setBillingInfo(preloadedBillingInfo)
    }
  }, [preloadedBillingInfo])

  async function handleCancelSubscription(immediate: boolean) {
    setCancelingSubscription(true)
    try {
      const res = await fetch(API.SUBSCRIPTION_CANCEL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ immediate }),
      })
      const data = await res.json()
      if (res.ok) {
        if (immediate) {
          setBillingInfo((prev) => prev ? { ...prev, plan: "free", subscription: null } : prev)
          setSuccess("Subscription canceled. You are now on the free plan.")
        } else {
          setBillingInfo((prev) => prev?.subscription ? {
            ...prev,
            subscription: { ...prev.subscription, cancelAtPeriodEnd: true }
          } : prev)
          setSuccess("Subscription will be canceled at the end of the billing period.")
        }
        setShowCancelDialog(false)
      } else {
        setError(data.error || "Failed to cancel subscription.")
      }
    } catch {
      setError("Failed to cancel subscription.")
    } finally {
      setCancelingSubscription(false)
    }
  }

  async function handleReactivateSubscription() {
    setReactivatingSubscription(true)
    try {
      const res = await fetch(API.SUBSCRIPTION_REACTIVATE, {
        method: "POST",
      })
      const data = await res.json()
      if (res.ok) {
        setBillingInfo((prev) => prev?.subscription ? {
          ...prev,
          subscription: { ...prev.subscription, cancelAtPeriodEnd: false }
        } : prev)
        setSuccess("Subscription reactivated successfully.")
      } else {
        setError(data.error || "Failed to reactivate subscription.")
      }
    } catch {
      setError("Failed to reactivate subscription.")
    } finally {
      setReactivatingSubscription(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Usage Card */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Gauge className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Daily Usage</h2>
            <p className="text-sm text-muted-foreground">Track scan requests, resets at midnight UTC</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 flex flex-col gap-4">
            {billingInfo ? (
              <>
                {billingInfo.usage.unlimited ? (
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <Zap className="h-5 w-5 text-emerald-500" />
                    <div>
                      <p className="font-medium text-foreground">Unlimited Access</p>
                      <p className="text-sm text-muted-foreground">
                        You have unlimited scans{billingInfo.plan !== "free" && " with your " + billingInfo.plan.replace("_supporter", " Supporter").replace(/(^\w|\s\w)/g, (m: string) => m.toUpperCase()) + " plan"}.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-2xl font-bold text-foreground">
                          {billingInfo.usage.used} <span className="text-muted-foreground text-base font-normal">/ {billingInfo.usage.limit}</span>
                        </p>
                        <p className="text-sm text-muted-foreground">scans used today</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-foreground">{billingInfo.usage.remaining}</p>
                        <p className="text-sm text-muted-foreground">remaining</p>
                      </div>
                    </div>
                    <Progress
                      value={(billingInfo.usage.used / billingInfo.usage.limit) * 100}
                      className="h-2"
                    />
                    {billingInfo.usage.remaining === 0 && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <p className="text-sm text-destructive">
                          Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.
                        </p>
                      </div>
                    )}
                    {billingInfo.usage.remaining > 0 && billingInfo.usage.remaining <= 10 && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <p className="text-sm text-amber-600 dark:text-amber-400">
                          Running low on scans. Consider upgrading for more capacity.
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Resets at {new Date(billingInfo.usage.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Plan Info Card */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <CreditCard className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Subscription Plan</h2>
            <p className="text-sm text-muted-foreground">Manage your subscription and billing</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 flex flex-col gap-4">
            {billingInfo ? (
              <>
                <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex items-center justify-center h-10 w-10 rounded-lg",
                      billingInfo.plan === "free"
                        ? "bg-muted"
                        : "bg-primary/10 border border-primary/20"
                    )}>
                      {billingInfo.plan === "free" ? (
                        <Users className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <Zap className="h-5 w-5 text-primary" />
                    )}
                  </div>
                )}

                {/* Reveal Sensitive Billing Information */}
                {billingInfo.subscription && !billingInfo.giftedSubscription && (
                  <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-background/50 mt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">Payment Details</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowVerificationModal(true)}
                        className="text-xs"
                      >
                        {sensitiveInfoVisible ? (
                          <>
                            <EyeOff className="h-4 w-4 mr-1" />
                            Hide
                          </>
                        ) : (
                          <>
                            <Eye className="h-4 w-4 mr-1" />
                            Reveal
                          </>
                        )}
                      </Button>
                    </div>

                    {sensitiveInfoVisible && billingInfo.subscription.cardLast4 ? (
                      <div className="space-y-2 pt-2 border-t border-border">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Card Number</span>
                          <span className="font-mono text-foreground">•••• •••• •••• {billingInfo.subscription.cardLast4}</span>
                        </div>
                        {billingInfo.subscription.cardBrand && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Card Brand</span>
                            <span className="font-medium text-foreground capitalize">{billingInfo.subscription.cardBrand}</span>
                          </div>
                        )}
                        {billingInfo.subscription.cardExpMonth && billingInfo.subscription.cardExpYear && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Expires</span>
                            <span className="font-mono text-foreground">{billingInfo.subscription.cardExpMonth.toString().padStart(2, '0')}/{billingInfo.subscription.cardExpYear.toString().slice(-2)}</span>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground pt-2 italic">
                          This information is encrypted and secure. You&apos;ll need to verify your identity each time you view it.
                        </p>
                      </div>
                    ) : sensitiveInfoVisible ? (
                      <p className="text-sm text-muted-foreground pt-2">No card information available</p>
                    ) : (
                      <p className="text-xs text-muted-foreground pt-2">
                        Click &quot;Reveal&quot; and verify your email to view your payment details
                      </p>
                    )}
                  </div>
                )}
                </div>

                {/* Gifted subscription details */}
                {billingInfo.giftedSubscription && (
                  <div className="flex flex-col gap-3 p-4 rounded-lg border border-primary/30 bg-primary/5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <Badge className="bg-primary/10 text-primary border-primary/20">
                        Gifted
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Gift Period</span>
                      <span className="text-sm font-medium text-foreground">
                        {new Date(billingInfo.giftedSubscription.startedAt).toLocaleDateString()} - {new Date(billingInfo.giftedSubscription.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20 mt-2">
                      <Gift className="h-4 w-4 text-primary shrink-0" />
                      <p className="text-sm text-primary">
                        You have a gifted {billingInfo.giftedSubscription.plan.replace("_supporter", "").replace("_", " ")} subscription until {new Date(billingInfo.giftedSubscription.expiresAt).toLocaleDateString()}.
                      </p>
                    </div>
                  </div>
                )}

                {/* Subscription details for paid Stripe plans */}
                {billingInfo.subscription && !billingInfo.giftedSubscription && (
                  <div className="flex flex-col gap-3 p-4 rounded-lg border border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <Badge className={cn(
                        billingInfo.subscription.cancelAtPeriodEnd
                          ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                          : billingInfo.subscription.status === "active"
                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                            : "bg-muted text-muted-foreground"
                      )}>
                        {billingInfo.subscription.cancelAtPeriodEnd
                          ? "Canceling"
                          : billingInfo.subscription.status.charAt(0).toUpperCase() + billingInfo.subscription.status.slice(1)
                        }
                      </Badge>
                    </div>
                    
                    {/* Price and billing interval */}
                    {billingInfo.subscription.priceAmount && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Billing Amount</span>
                        <span className="text-sm font-medium text-foreground">
                          {new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: billingInfo.subscription.priceCurrency || "usd",
                          }).format(billingInfo.subscription.priceAmount)}
                          /{billingInfo.subscription.priceIntervalCount === 1 
                            ? billingInfo.subscription.priceInterval 
                            : `${billingInfo.subscription.priceIntervalCount} ${billingInfo.subscription.priceInterval}s`}
                        </span>
                      </div>
                    )}
                    
                    {/* Current billing period */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Current Period</span>
                      <span className="text-sm font-medium text-foreground">
                        {billingInfo.subscription.currentPeriodStart && billingInfo.subscription.currentPeriodEnd
                          ? `${new Date(billingInfo.subscription.currentPeriodStart).toLocaleDateString()} - ${new Date(billingInfo.subscription.currentPeriodEnd).toLocaleDateString()}`
                          : "Not available"}
                      </span>
                    </div>
                    
                    {/* Next billing date */}
                    {billingInfo.subscription.nextBillingDate && !billingInfo.subscription.cancelAtPeriodEnd && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Next Billing Date</span>
                        <span className="text-sm font-medium text-foreground">
                          {new Date(billingInfo.subscription.nextBillingDate).toLocaleDateString(undefined, {
                            weekday: "short",
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    )}
                    
                    {/* Payment method */}
                    {billingInfo.subscription.cardLast4 && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Payment Method</span>
                        <span className="text-sm font-medium text-foreground flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-muted-foreground" />
                          {billingInfo.subscription.cardBrand?.charAt(0).toUpperCase()}{billingInfo.subscription.cardBrand?.slice(1)} •••• {billingInfo.subscription.cardLast4}
                          {billingInfo.subscription.cardExpMonth && billingInfo.subscription.cardExpYear && (
                            <span className="text-muted-foreground text-xs">
                              (exp {billingInfo.subscription.cardExpMonth}/{billingInfo.subscription.cardExpYear.toString().slice(-2)})
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    
                    {/* Last payment info */}
                    {billingInfo.subscription.lastPaymentDate && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Last Payment</span>
                        <span className="text-sm font-medium text-foreground">
                          {billingInfo.subscription.lastPaymentAmount && new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: billingInfo.subscription.priceCurrency || "usd",
                          }).format(billingInfo.subscription.lastPaymentAmount)}
                          {" "}on {new Date(billingInfo.subscription.lastPaymentDate).toLocaleDateString()}
                          {billingInfo.subscription.lastPaymentStatus === "paid" && (
                            <Badge className="ml-2 bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-xs">Paid</Badge>
                          )}
                        </span>
                      </div>
                    )}
                    
                    {billingInfo.subscription.cancelAtPeriodEnd && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mt-2">
                        <Calendar className="h-4 w-4 text-amber-500 shrink-0" />
                        <p className="text-sm text-amber-600 dark:text-amber-400">
                          Your subscription will end on {billingInfo.subscription.currentPeriodEnd ? new Date(billingInfo.subscription.currentPeriodEnd).toLocaleDateString() : "the end of your billing period"}. You&apos;ll keep access until then.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions for paid plans */}
                {billingInfo.plan !== "free" && !billingInfo.giftedSubscription && (
                  <div className="flex flex-col gap-2 pt-2">
                    {billingInfo.subscription?.cancelAtPeriodEnd ? (
                      <Button
                        variant="outline"
                        onClick={handleReactivateSubscription}
                        disabled={reactivatingSubscription}
                        className="w-full"
                      >
                        {reactivatingSubscription ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Reactivating...</>
                        ) : (
                          <><RefreshCw className="mr-2 h-4 w-4" />Reactivate Subscription</>
                        )}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => setShowCancelDialog(true)}
                        className="w-full text-destructive dark:text-red-400 hover:text-destructive dark:hover:text-red-400 hover:bg-destructive/10"
                      >
                        Cancel Subscription
                      </Button>
                    )}
                  </div>
                )}

                {/* Plan Comparison */}
                {billingInfo.plan === "free" && (
                  <div className="flex flex-col gap-3 pt-4 border-t border-border">
                    <p className="text-sm font-medium text-muted-foreground">Available Plans</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3 rounded-lg border border-border bg-card hover:bg-secondary/30 transition-colors">
                        <p className="font-medium text-foreground text-sm">Core Supporter</p>
                        <p className="text-xs text-muted-foreground">{billingInfo.limits.core_supporter} scans/day</p>
                        <p className="text-sm font-semibold text-primary mt-1">$5/mo</p>
                      </div>
                      <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 relative">
                        <Badge className="absolute -top-2 right-2 text-[10px] bg-primary text-primary-foreground">Popular</Badge>
                        <p className="font-medium text-foreground text-sm">Pro Supporter</p>
                        <p className="text-xs text-muted-foreground">{billingInfo.limits.pro_supporter} scans/day</p>
                        <p className="text-sm font-semibold text-primary mt-1">$10/mo</p>
                      </div>
                      <div className="p-3 rounded-lg border border-border bg-card hover:bg-secondary/30 transition-colors">
                        <p className="font-medium text-foreground text-sm">Elite Supporter</p>
                        <p className="text-xs text-muted-foreground">{billingInfo.limits.elite_supporter} scans/day</p>
                        <p className="text-sm font-semibold text-primary mt-1">$20/mo</p>
                      </div>
                    </div>
                    <Button asChild className="w-full mt-2">
                      <a href={ROUTES.PRICING}>
                        <TrendingUp className="mr-2 h-4 w-4" />
                        View All Plans
                      </a>
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Cancel Subscription Dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCancelDialog(false)}>
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6 mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Cancel Subscription</h3>
                <p className="text-sm text-muted-foreground">Choose how you&apos;d like to cancel</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 mb-6">
              <label
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  cancelType === "period_end"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/50"
                )}
                onClick={() => setCancelType("period_end")}
              >
                <input
                  type="radio"
                  name="cancelType"
                  checked={cancelType === "period_end"}
                  onChange={() => setCancelType("period_end")}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium text-foreground">Cancel at period end</p>
                  <p className="text-sm text-muted-foreground">
                    Keep access until {billingInfo?.subscription?.currentPeriodEnd
                      ? new Date(billingInfo.subscription.currentPeriodEnd).toLocaleDateString()
                      : "your billing period ends"}
                  </p>
                </div>
              </label>

              <label
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  cancelType === "immediate"
                    ? "border-destructive bg-destructive/5"
                    : "border-border hover:border-muted-foreground/50"
                )}
                onClick={() => setCancelType("immediate")}
              >
                <input
                  type="radio"
                  name="cancelType"
                  checked={cancelType === "immediate"}
                  onChange={() => setCancelType("immediate")}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium text-foreground">Cancel immediately</p>
                  <p className="text-sm text-muted-foreground">
                    Lose access now and move to the free plan. No refund will be issued.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowCancelDialog(false)}
                className="flex-1"
                disabled={cancelingSubscription}
              >
                Keep Subscription
              </Button>
              <Button
                variant={cancelType === "immediate" ? "destructive" : "default"}
                onClick={() => handleCancelSubscription(cancelType === "immediate")}
                disabled={cancelingSubscription}
                className="flex-1"
              >
                {cancelingSubscription ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Canceling...</>
                ) : (
                  cancelType === "immediate" ? "Cancel Now" : "Cancel at Period End"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Billing Verification Modal */}
      <BillingVerificationModal
        open={showVerificationModal}
        onOpenChange={setShowVerificationModal}
        email={billingInfo?.email || ""}
        onVerified={() => setSensitiveInfoVisible(true)}
      />
    </div>
  )
}
