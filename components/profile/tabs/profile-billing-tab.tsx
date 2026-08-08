"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
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
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { API, ROUTES, BILLING_ENABLED, APP_NAME } from "@/lib/config/constants";
import { getPaidPlans } from "@/lib/billing/plans";
import type { ProfileTabProps, BillingInfo } from "../types";
import {
  BillingVerificationModal,
  type SensitiveBillingData,
} from "../modals/billing-verification-modal";
import { useModalA11y } from "@/lib/hooks/use-modal-a11y";

export function ProfileBillingTab({
  user,
  setError,
  setSuccess,
  preloadedBillingInfo,
}: ProfileTabProps) {
  // Use preloaded data if available
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(
    preloadedBillingInfo ?? null,
  );
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelType, setCancelType] = useState<"period_end" | "immediate">(
    "period_end",
  );

  const {
    dialogProps: cancelDialogProps,
    titleProps: cancelTitleProps,
    descriptionProps: cancelDescriptionProps,
  } = useModalA11y({
    open: showCancelDialog,
    onClose: () => setShowCancelDialog(false),
    hasDescription: true,
  });
  const [cancelingSubscription, setCancelingSubscription] = useState(false);
  const [reactivatingSubscription, setReactivatingSubscription] =
    useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [sensitiveInfoVisible, setSensitiveInfoVisible] = useState(false);
  const [sensitiveData, setSensitiveData] =
    useState<SensitiveBillingData | null>(null);

  // Update state when preloaded data changes
  useEffect(() => {
    if (preloadedBillingInfo) {
      setBillingInfo(preloadedBillingInfo);
    }
  }, [preloadedBillingInfo]);

  async function handleCancelSubscription(immediate: boolean) {
    setCancelingSubscription(true);
    try {
      const res = await fetch(API.SUBSCRIPTION_CANCEL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ immediate }),
      });
      const data = await res.json();
      if (res.ok) {
        if (immediate) {
          setBillingInfo((prev) =>
            prev ? { ...prev, plan: "free", subscription: null } : prev,
          );
          setSuccess("Subscription canceled. You are now on the free plan.");
        } else {
          setBillingInfo((prev) =>
            prev?.subscription
              ? {
                  ...prev,
                  subscription: {
                    ...prev.subscription,
                    cancelAtPeriodEnd: true,
                  },
                }
              : prev,
          );
          setSuccess(
            "Subscription will be canceled at the end of the billing period.",
          );
        }
        setShowCancelDialog(false);
      } else {
        setError(data.error || "Failed to cancel subscription.");
      }
    } catch {
      setError("Failed to cancel subscription.");
    } finally {
      setCancelingSubscription(false);
    }
  }

  async function handleReactivateSubscription() {
    setReactivatingSubscription(true);
    try {
      const res = await fetch(API.SUBSCRIPTION_REACTIVATE, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setBillingInfo((prev) =>
          prev?.subscription
            ? {
                ...prev,
                subscription: {
                  ...prev.subscription,
                  cancelAtPeriodEnd: false,
                },
              }
            : prev,
        );
        setSuccess("Subscription reactivated successfully.");
      } else {
        setError(data.error || "Failed to reactivate subscription.");
      }
    } catch {
      setError("Failed to reactivate subscription.");
    } finally {
      setReactivatingSubscription(false);
    }
  }

  if (!BILLING_ENABLED) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          There is nothing to pay for here
        </h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-prose leading-relaxed">
          Billing is switched off on this {APP_NAME} deployment. Every account
          gets the full check set, the full API, and no daily scan ceiling.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Usage Card */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Daily usage
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track scan requests, resets at midnight UTC
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 flex flex-col gap-4">
            {billingInfo ? (
              <>
                {billingInfo.usage.unlimited ? (
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-[hsl(var(--success)/0.1)] border border-[hsl(var(--success)/0.25)]">
                    <Zap
                      className="h-5 w-5 text-[hsl(var(--success))]"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-medium text-foreground">
                        Unlimited Access
                      </p>
                      <p className="text-sm text-muted-foreground">
                        You have unlimited scans
                        {billingInfo.plan !== "free" &&
                          " with your " +
                            billingInfo.plan
                              .replace("_supporter", " Supporter")
                              .replace(/(^\w|\s\w)/g, (m: string) =>
                                m.toUpperCase(),
                              ) +
                            " plan"}
                        .
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-2xl font-bold text-foreground">
                          {billingInfo.usage.used}{" "}
                          <span className="text-muted-foreground text-base font-normal">
                            / {billingInfo.usage.limit}
                          </span>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          scans used today
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-foreground">
                          {billingInfo.usage.remaining}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          remaining
                        </p>
                      </div>
                    </div>
                    <Progress
                      value={
                        (billingInfo.usage.used / billingInfo.usage.limit) * 100
                      }
                      className="h-2"
                    />
                    {billingInfo.usage.remaining === 0 && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <p className="text-sm text-destructive">
                          Daily scan limit reached. Upgrade your plan or wait
                          until midnight UTC for the limit to reset.
                        </p>
                      </div>
                    )}
                    {billingInfo.usage.remaining > 0 &&
                      billingInfo.usage.remaining <= 10 && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-[hsl(var(--warning)/0.1)] border border-[hsl(var(--warning)/0.25)]">
                          <AlertTriangle
                            className="h-4 w-4 text-[hsl(var(--warning))]"
                            aria-hidden="true"
                          />
                          <p className="text-sm text-[hsl(var(--warning))]">
                            Running low on scans. Consider upgrading for more
                            capacity.
                          </p>
                        </div>
                      )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>
                        Resets at{" "}
                        {new Date(
                          billingInfo.usage.resetsAt,
                        ).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZoneName: "short",
                        })}
                      </span>
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
        <div className="mb-4">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Subscription plan
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your subscription and billing
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 flex flex-col gap-4">
            {billingInfo ? (
              <>
                <div className="flex items-center justify-between gap-3 p-4 rounded-lg bg-secondary/50 border border-border">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        "flex items-center justify-center h-10 w-10 rounded-lg shrink-0",
                        billingInfo.plan === "free"
                          ? "bg-muted"
                          : "bg-primary/10 border border-primary/20",
                      )}
                    >
                      {billingInfo.plan === "free" ? (
                        <Users className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <Zap className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">
                        {billingInfo.planName}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {billingInfo.limits[
                          billingInfo.plan as keyof typeof billingInfo.limits
                        ] || billingInfo.limits.free}{" "}
                        scans/day
                      </p>
                    </div>
                  </div>
                  {billingInfo.subscription?.status && (
                    <Badge
                      className={cn(
                        "shrink-0",
                        billingInfo.subscription.cancelAtPeriodEnd
                          ? "bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.25)]"
                          : billingInfo.subscription.status === "active"
                            ? "bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.25)]"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {billingInfo.subscription.cancelAtPeriodEnd
                        ? "Canceling"
                        : billingInfo.subscription.status
                            .charAt(0)
                            .toUpperCase() +
                          billingInfo.subscription.status.slice(1)}
                    </Badge>
                  )}
                </div>

                {/* Subscription details for paid Stripe plans */}
                {billingInfo.subscription &&
                  !billingInfo.giftedSubscription && (
                    <div className="flex flex-col gap-3 p-4 rounded-lg border border-border">
                      {/* Price and billing interval */}
                      {billingInfo.subscription.priceAmount && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            Billing Amount
                          </span>
                          <span className="text-sm font-medium text-foreground">
                            {new Intl.NumberFormat("en-US", {
                              style: "currency",
                              currency:
                                billingInfo.subscription.priceCurrency || "usd",
                            }).format(billingInfo.subscription.priceAmount)}
                            /
                            {billingInfo.subscription.priceIntervalCount === 1
                              ? billingInfo.subscription.priceInterval
                              : `${billingInfo.subscription.priceIntervalCount} ${billingInfo.subscription.priceInterval}s`}
                          </span>
                        </div>
                      )}

                      {/* Next billing date */}
                      {billingInfo.subscription.nextBillingDate &&
                        !billingInfo.subscription.cancelAtPeriodEnd && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">
                              Next Billing Date
                            </span>
                            <span className="text-sm font-medium text-foreground">
                              {new Date(
                                billingInfo.subscription.nextBillingDate,
                              ).toLocaleDateString(undefined, {
                                weekday: "short",
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          </div>
                        )}

                      {/* Last payment info */}
                      {billingInfo.subscription.lastPaymentDate && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            Last Payment
                          </span>
                          <span className="text-sm font-medium text-foreground">
                            {billingInfo.subscription.lastPaymentAmount &&
                              new Intl.NumberFormat("en-US", {
                                style: "currency",
                                currency:
                                  billingInfo.subscription.priceCurrency ||
                                  "usd",
                              }).format(
                                billingInfo.subscription.lastPaymentAmount,
                              )}{" "}
                            on{" "}
                            {new Date(
                              billingInfo.subscription.lastPaymentDate,
                            ).toLocaleDateString()}
                            {billingInfo.subscription.lastPaymentStatus ===
                              "paid" && (
                              <Badge className="ml-2 bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.25)] text-xs">
                                Paid
                              </Badge>
                            )}
                          </span>
                        </div>
                      )}

                      {billingInfo.subscription.cancelAtPeriodEnd && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-[hsl(var(--warning)/0.1)] border border-[hsl(var(--warning)/0.25)] mt-2">
                          <Calendar
                            className="h-4 w-4 text-[hsl(var(--warning))] shrink-0"
                            aria-hidden="true"
                          />
                          <p className="text-sm text-[hsl(var(--warning))]">
                            Your subscription will end on{" "}
                            {billingInfo.subscription.currentPeriodEnd
                              ? new Date(
                                  billingInfo.subscription.currentPeriodEnd,
                                ).toLocaleDateString()
                              : "the end of your billing period"}
                            . You&apos;ll keep access until then.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                {/* Reveal Sensitive Billing Information */}
                {billingInfo.subscription &&
                  !billingInfo.giftedSubscription && (
                    <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-background/50 mt-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Lock className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium text-foreground">
                            Sensitive Billing Details
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (sensitiveInfoVisible) {
                              setSensitiveInfoVisible(false);
                              setSensitiveData(null);
                            } else {
                              setShowVerificationModal(true);
                            }
                          }}
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

                      {sensitiveInfoVisible && sensitiveData ? (
                        <div className="space-y-4 pt-3 border-t border-border">
                          {/* Payment Method Section */}
                          {sensitiveData.paymentMethod && (
                            <div className="space-y-2">
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Payment Method
                              </h4>
                              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">
                                    Card
                                  </span>
                                  <span className="font-mono text-foreground flex items-center gap-2">
                                    <CreditCard className="h-4 w-4" />
                                    <span className="capitalize">
                                      {sensitiveData.paymentMethod.cardBrand}
                                    </span>{" "}
                                    •••• {sensitiveData.paymentMethod.cardLast4}
                                  </span>
                                </div>
                                {sensitiveData.paymentMethod.cardExpMonth &&
                                  sensitiveData.paymentMethod.cardExpYear && (
                                    <div className="flex items-center justify-between text-sm">
                                      <span className="text-muted-foreground">
                                        Expires
                                      </span>
                                      <span className="font-mono text-foreground">
                                        {sensitiveData.paymentMethod.cardExpMonth
                                          .toString()
                                          .padStart(2, "0")}
                                        /
                                        {sensitiveData.paymentMethod.cardExpYear
                                          .toString()
                                          .slice(-2)}
                                      </span>
                                    </div>
                                  )}
                                {sensitiveData.paymentMethod.billingEmail && (
                                  <div className="flex items-center justify-between gap-2 text-sm">
                                    <span className="text-muted-foreground shrink-0">
                                      Billing Email
                                    </span>
                                    <span className="text-foreground text-xs font-mono truncate min-w-0">
                                      {sensitiveData.paymentMethod.billingEmail}
                                    </span>
                                  </div>
                                )}
                                {sensitiveData.paymentMethod
                                  .cardSupports3dSecure && (
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">
                                      Security
                                    </span>
                                    <span className="text-foreground">
                                      ✓ 3D Secure
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Subscription Details Section */}
                          <div className="space-y-2">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Subscription Info
                            </h4>
                            <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                              {sensitiveData.created && (
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">
                                    Created
                                  </span>
                                  <span className="text-foreground">
                                    {new Date(
                                      sensitiveData.created,
                                    ).toLocaleDateString()}
                                  </span>
                                </div>
                              )}
                              {sensitiveData.currentPeriodEnd && (
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">
                                    Billing Period Ends
                                  </span>
                                  <span className="text-foreground">
                                    {new Date(
                                      sensitiveData.currentPeriodEnd,
                                    ).toLocaleDateString()}
                                  </span>
                                </div>
                              )}
                              {sensitiveData.hasTrialPeriod && (
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">
                                    Trial
                                  </span>
                                  <span className="text-foreground">
                                    {sensitiveData.isOnTrial
                                      ? "✓ Active"
                                      : "Ended"}
                                  </span>
                                </div>
                              )}
                              {sensitiveData.billingInterval && (
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">
                                    Renews
                                  </span>
                                  <span className="text-foreground capitalize">
                                    {sensitiveData.billingIntervalCount &&
                                    sensitiveData.billingIntervalCount > 1
                                      ? `Every ${sensitiveData.billingIntervalCount} ${sensitiveData.billingInterval}s`
                                      : sensitiveData.billingInterval}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Latest Invoice Section */}
                          {sensitiveData.invoice && (
                            <div className="space-y-2">
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Latest Invoice
                              </h4>
                              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                                {sensitiveData.invoice.number && (
                                  <div className="flex items-center justify-between gap-2 text-sm">
                                    <span className="text-muted-foreground shrink-0">
                                      Invoice #
                                    </span>
                                    <span className="font-mono text-foreground truncate min-w-0">
                                      {sensitiveData.invoice.number}
                                    </span>
                                  </div>
                                )}
                                {sensitiveData.invoice.created && (
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">
                                      Date
                                    </span>
                                    <span className="text-foreground">
                                      {new Date(
                                        sensitiveData.invoice.created,
                                      ).toLocaleDateString()}
                                    </span>
                                  </div>
                                )}
                                {sensitiveData.invoice.total !== null && (
                                  <div className="flex items-center justify-between text-sm font-medium">
                                    <span className="text-muted-foreground">
                                      Total
                                    </span>
                                    <span className="text-foreground">
                                      ${sensitiveData.invoice.total.toFixed(2)}
                                    </span>
                                  </div>
                                )}
                                {sensitiveData.invoice.status && (
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">
                                      Status
                                    </span>
                                    <Badge
                                      className={cn(
                                        sensitiveData.invoice.status === "paid"
                                          ? "bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.25)]"
                                          : "bg-muted text-muted-foreground",
                                      )}
                                    >
                                      {sensitiveData.invoice.status
                                        .charAt(0)
                                        .toUpperCase() +
                                        sensitiveData.invoice.status.slice(1)}
                                    </Badge>
                                  </div>
                                )}
                                <div className="flex gap-2 pt-2">
                                  {sensitiveData.invoice.hostedUrl && (
                                    <a
                                      href={sensitiveData.invoice.hostedUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-primary hover:underline"
                                    >
                                      View Invoice
                                    </a>
                                  )}
                                  {sensitiveData.invoice.pdfUrl && (
                                    <a
                                      href={sensitiveData.invoice.pdfUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-primary hover:underline"
                                    >
                                      Download PDF
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Subscription IDs Section */}
                          <div className="space-y-2">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Reference IDs & Metadata
                            </h4>
                            <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2 text-sm">
                                <span className="text-muted-foreground shrink-0">
                                  Customer ID
                                </span>
                                <span className="font-mono text-xs text-foreground truncate min-w-0">
                                  {sensitiveData.stripeCustomerId}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-sm">
                                <span className="text-muted-foreground shrink-0">
                                  Subscription ID
                                </span>
                                <span className="font-mono text-xs text-foreground truncate min-w-0">
                                  {sensitiveData.stripeSubscriptionId}
                                </span>
                              </div>
                              {sensitiveData.stripePaymentMethodId && (
                                <div className="flex items-center justify-between gap-2 text-sm">
                                  <span className="text-muted-foreground shrink-0">
                                    Payment Method ID
                                  </span>
                                  <span className="font-mono text-xs text-foreground truncate min-w-0">
                                    {sensitiveData.stripePaymentMethodId}
                                  </span>
                                </div>
                              )}
                              {sensitiveData.productId && (
                                <div className="flex items-center justify-between gap-2 text-sm">
                                  <span className="text-muted-foreground shrink-0">
                                    Product ID
                                  </span>
                                  <span className="font-mono text-xs text-foreground truncate min-w-0">
                                    {sensitiveData.productId}
                                  </span>
                                </div>
                              )}
                              {sensitiveData.liveMode !== undefined && (
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">
                                    Mode
                                  </span>
                                  <Badge
                                    className={
                                      sensitiveData.liveMode
                                        ? "bg-destructive/10 text-destructive border-destructive/20"
                                        : "bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.25)]"
                                    }
                                  >
                                    {sensitiveData.liveMode ? "Live" : "Test"}
                                  </Badge>
                                </div>
                              )}
                              {sensitiveData.created && (
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">
                                    Created
                                  </span>
                                  <span className="text-foreground">
                                    {new Date(
                                      sensitiveData.created,
                                    ).toLocaleDateString()}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          <p className="text-xs text-muted-foreground pt-2 italic">
                            This information is securely fetched each time you
                            verify. Click &quot;Hide&quot; to clear it.
                          </p>
                        </div>
                      ) : sensitiveInfoVisible ? (
                        <p className="text-sm text-muted-foreground pt-2">
                          No billing information available
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground pt-2">
                          Click &quot;Reveal&quot; and verify your email to view
                          payment details, invoices, and billing address
                        </p>
                      )}
                    </div>
                  )}

                {/* Gifted subscription details */}
                {billingInfo.giftedSubscription && (
                  <div className="flex flex-col gap-3 p-4 rounded-lg border border-primary/30 bg-primary/5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Status
                      </span>
                      <Badge className="bg-primary/10 text-primary border-primary/20">
                        Gifted
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Gift Period
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {new Date(
                          billingInfo.giftedSubscription.startedAt,
                        ).toLocaleDateString()}{" "}
                        -{" "}
                        {new Date(
                          billingInfo.giftedSubscription.expiresAt,
                        ).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20 mt-2">
                      <Gift className="h-4 w-4 text-primary shrink-0" />
                      <p className="text-sm text-primary">
                        You have a gifted{" "}
                        {billingInfo.giftedSubscription.plan
                          .replace("_supporter", "")
                          .replace("_", " ")}{" "}
                        subscription until{" "}
                        {new Date(
                          billingInfo.giftedSubscription.expiresAt,
                        ).toLocaleDateString()}
                        .
                      </p>
                    </div>
                  </div>
                )}

                {/* Actions for paid plans */}
                {billingInfo.plan !== "free" &&
                  !billingInfo.giftedSubscription && (
                    <div className="flex flex-col gap-2 pt-2">
                      {billingInfo.subscription?.cancelAtPeriodEnd ? (
                        <Button
                          variant="outline"
                          onClick={handleReactivateSubscription}
                          disabled={reactivatingSubscription}
                          className="w-full"
                        >
                          {reactivatingSubscription ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Reactivating...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Reactivate Subscription
                            </>
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => setShowCancelDialog(true)}
                          className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          Cancel subscription
                        </Button>
                      )}
                    </div>
                  )}

                {/* Plan Comparison, priced straight from the plan catalog so
                    this can never drift from what checkout actually charges. */}
                {billingInfo.plan === "free" && (
                  <div className="flex flex-col gap-3 pt-4 border-t border-border">
                    <p className="text-sm font-medium text-muted-foreground">
                      Available plans
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {getPaidPlans().map((paidPlan, i) => (
                        <div
                          key={paidPlan.id}
                          className={cn(
                            "relative p-3 rounded-lg border transition-colors",
                            i === 1
                              ? "border-primary/30 bg-primary/5"
                              : "border-border bg-card hover:bg-secondary/30",
                          )}
                        >
                          {i === 1 && (
                            <Badge className="absolute -top-2 right-2 text-[10px] bg-primary text-primary-foreground">
                              Popular
                            </Badge>
                          )}
                          <p className="font-medium text-foreground text-sm">
                            {paidPlan.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {paidPlan.limits.dailyScans} scans/day
                          </p>
                          <p className="text-sm font-semibold text-primary mt-1">
                            ${(paidPlan.priceInCents / 100).toFixed(0)}/mo
                          </p>
                        </div>
                      ))}
                    </div>
                    <Button asChild className="w-full mt-2 gap-2">
                      <a href={ROUTES.PRICING}>
                        <TrendingUp className="h-4 w-4" aria-hidden="true" />
                        View all plans
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowCancelDialog(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
            {...cancelDialogProps}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3
                  className="text-lg font-semibold text-foreground"
                  {...cancelTitleProps}
                >
                  Cancel Subscription
                </h3>
                <p
                  className="text-sm text-muted-foreground"
                  {...cancelDescriptionProps}
                >
                  Choose how you&apos;d like to cancel
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 mb-6">
              <label
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  cancelType === "period_end"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/50",
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
                  <p className="font-medium text-foreground">
                    Cancel at period end
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Keep access until{" "}
                    {billingInfo?.subscription?.currentPeriodEnd
                      ? new Date(
                          billingInfo.subscription.currentPeriodEnd,
                        ).toLocaleDateString()
                      : "your billing period ends"}
                  </p>
                </div>
              </label>

              <label
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  cancelType === "immediate"
                    ? "border-destructive bg-destructive/5"
                    : "border-border hover:border-muted-foreground/50",
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
                  <p className="font-medium text-foreground">
                    Cancel immediately
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Lose access now and move to the free plan. No refund will be
                    issued.
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
                onClick={() =>
                  handleCancelSubscription(cancelType === "immediate")
                }
                disabled={cancelingSubscription}
                className="flex-1"
              >
                {cancelingSubscription ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Canceling...
                  </>
                ) : cancelType === "immediate" ? (
                  "Cancel Now"
                ) : (
                  "Cancel at Period End"
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
        email={user?.email || ""}
        onVerified={(data) => {
          setSensitiveData(data);
          setSensitiveInfoVisible(true);
        }}
      />
    </div>
  );
}
