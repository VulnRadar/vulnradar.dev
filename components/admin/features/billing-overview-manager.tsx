"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Wallet,
  RefreshCw,
  AlertTriangle,
  Info,
  CreditCard,
} from "lucide-react";
import {
  EmptyState,
  StatBar,
  StatBarSkeleton,
  DataTableSkeleton,
  Toast,
} from "@/components/admin/shared";
import type { ToastState } from "@/components/admin/types";
import { cn } from "@/lib/ui/utils";

interface PlanMixEntry {
  planId: string;
  planName: string;
  priceInCents: number;
  totalUsers: number;
  activeUsers: number;
  mrrCents: number;
}

interface PastDueUser {
  id: number;
  email: string;
  name: string | null;
  plan: string;
  currentPeriodEnd: string | null;
}

interface FailedPaymentEvent {
  eventId: string;
  eventType: string;
  processedAt: string;
}

interface BillingOverview {
  generatedAt: string;
  billingEnabled: boolean;
  totals: {
    totalUsers: number;
    payingUsers: number;
    mrrCents: number;
    stripeCustomers: number;
    pastDueUsers: number;
  };
  planMix: PlanMixEntry[];
  failedPayments: {
    pastDueUsers: PastDueUser[];
    recentEvents: FailedPaymentEvent[];
    recentEventCount30d: number;
  };
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Admin > Billing Overview. Aggregate MRR/plan-mix/failed-payment
 * reporting (AUDIT-010 admin-feature-gap) sourced from
 * GET /api/v3/admin/billing-overview, which reads only data already
 * synced locally (users.plan/subscription_status, processed_stripe_events)
 * rather than calling out to Stripe -- see that route's doc comment for
 * exactly how each number is derived.
 */
export function BillingOverviewManager() {
  const [data, setData] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const fetchOverview = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/v3/admin/billing-overview");
      if (res.ok) {
        setData(await res.json());
      } else {
        const body = await res.json().catch(() => ({}));
        setToast({
          message: body.error || "Failed to load billing overview.",
          type: "error",
        });
      }
    } catch {
      setToast({ message: "Failed to load billing overview.", type: "error" });
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchOverview(true);
  }, [fetchOverview]);

  return (
    <div className="space-y-6">
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <CardHeader className="pb-4 pt-5 px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                <Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base font-semibold truncate">
                  Billing Overview
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  MRR estimate, plan mix, and failed payments, computed from
                  data already synced into this app. No live Stripe calls.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-10 px-3 gap-2 border-border/40 shrink-0"
              onClick={() => fetchOverview(false)}
              disabled={loading || refreshing}
              aria-label="Refresh billing overview"
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </CardHeader>
      </Card>

      {!loading && data && !data.billingEnabled && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-border/50 bg-muted/20">
          <div className="p-2 rounded-lg bg-muted shrink-0">
            <Info
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Billing is disabled on this deployment (BILLING_ENABLED is off), so
            every account is unlimited regardless of the plan value stored on
            it. The numbers below still reflect the raw plan column, but MRR
            isn&apos;t a meaningful figure here.
          </p>
        </div>
      )}

      {loading ? (
        <StatBarSkeleton segments={5} />
      ) : (
        data && (
          <StatBar
            items={[
              {
                label: "Est. MRR",
                value: formatCents(data.totals.mrrCents),
                icon: Wallet,
                tone: "primary",
              },
              {
                label: "Paying users",
                value: data.totals.payingUsers,
                icon: CreditCard,
                tone: "success",
              },
              {
                label: "Total users",
                value: data.totals.totalUsers,
              },
              {
                label: "Stripe customers",
                value: data.totals.stripeCustomers,
              },
              {
                label: "Past due",
                value: data.totals.pastDueUsers,
                icon: AlertTriangle,
                tone: data.totals.pastDueUsers > 0 ? "destructive" : "muted",
              },
            ]}
          />
        )
      )}

      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="border-b border-border/40 bg-muted/30 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-foreground">Plan mix</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Headcount per plan tier, and the subset of each tier with a
            currently-paying subscription status (active, trialing, or
            past_due). A staff-comped or gifted account counts toward the
            tier&apos;s headcount but not toward paying users or MRR.
          </p>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 sm:p-5">
              <DataTableSkeleton rows={4} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Price / mo</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="text-right">Paying</TableHead>
                  <TableHead className="text-right">MRR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.planMix.map((plan) => (
                  <TableRow key={plan.planId}>
                    <TableCell className="font-medium text-foreground">
                      {plan.planName}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {plan.priceInCents === 0
                        ? "Free"
                        : formatCents(plan.priceInCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {plan.totalUsers.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {plan.activeUsers.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatCents(plan.mrrCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="border-b border-border/40 bg-muted/30 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-foreground">
            Failed payments
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {loading
              ? "Loading..."
              : `${data?.failedPayments.recentEventCount30d ?? 0} invoice.payment_failed webhook ${
                  data?.failedPayments.recentEventCount30d === 1
                    ? "event"
                    : "events"
                } in the last 30 days. There's no local record of amount or
                invoice per failure, only the account's current status and
                the raw webhook delivery log below.`}
          </p>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 sm:p-5">
              <DataTableSkeleton rows={3} />
            </div>
          ) : data && data.failedPayments.pastDueUsers.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="No accounts past due"
              description="Nobody is currently sitting in a failed-payment retry window."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Period end</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.failedPayments.pastDueUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="text-sm text-foreground">
                        {user.name || user.email}
                      </div>
                      {user.name && (
                        <div className="text-xs text-muted-foreground">
                          {user.email}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground capitalize">
                      {user.plan.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {user.currentPeriodEnd
                        ? formatTimestamp(user.currentPeriodEnd)
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!loading && data && data.failedPayments.recentEvents.length > 0 && (
            <div className="border-t border-border/40 px-4 sm:px-5 py-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Recent webhook deliveries
              </p>
              <ul className="space-y-1.5">
                {data.failedPayments.recentEvents.slice(0, 8).map((evt) => (
                  <li
                    key={evt.eventId}
                    className="flex items-center justify-between text-xs text-muted-foreground gap-3"
                  >
                    <span className="font-mono truncate">{evt.eventId}</span>
                    <span className="shrink-0">
                      {formatTimestamp(evt.processedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
