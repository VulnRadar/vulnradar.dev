"use client";

import { useState, useEffect, useCallback } from "react";
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
// The tone-aware empty state, not the admin one. The admin EmptyState has no
// tone, so "Couldn't load billing overview" (a failed request) and "No
// accounts past due" (the best news this panel can carry) rendered as the
// same grey box with a different sentence in it.
import { EmptyState } from "@/components/shared/empty-state";
import {
  StatBar,
  StatBarSkeleton,
  StatusPill,
  DataTableSkeleton,
  TableScrollArea,
  Toast,
} from "@/components/admin/shared";
import { formatTimestamp } from "@/components/admin/utils";
import type { ToastState } from "@/components/admin/types";
import { cn } from "@/lib/ui/utils";
import { getPlanById } from "@/lib/billing/catalog";

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

/** One geometry for both of this panel's tables. They were the only admin
 *  tables passing no className at all, so they inherited ui/table.tsx's
 *  h-12 / 14px sentence-case default while every sibling table renders a
 *  h-10 uppercase micro-label head over px-4 py-3 cells. Billing read as a
 *  different product bolted onto the panel purely because of this. */
const TH = "px-4 h-10 text-[11px] font-semibold uppercase tracking-wider";
const TH_RIGHT = `${TH} text-right`;
const TD = "px-4 py-3";

/**
 * How overdue an account is, from the one date the endpoint gives us.
 * Every row in the failed-payments table is past due, so a "past due" chip on
 * all of them would be noise; what an operator needs is which of them Stripe
 * has already stopped retrying. A period end in the past means the billing
 * period it belongs to has closed with the invoice still unpaid.
 */
function pastDueState(periodEnd: string | null): {
  tone: "crit" | "warn";
  label: string;
} {
  if (!periodEnd) return { tone: "warn", label: "No period end" };
  return new Date(periodEnd).getTime() < Date.now()
    ? { tone: "crit", label: "Period ended" }
    : { tone: "warn", label: "In retry" };
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

  const pastDue = data?.totals.pastDueUsers ?? 0;

  return (
    <div className="space-y-4">
      {/* A heading and a live sentence, not a card. This was a whole <Card>
          whose only content was an icon tile, a title, a subtitle and the
          Refresh button: a 100px-tall header pretending to be a panel, sitting
          above the panels it introduced. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Billing overview
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {loading
              ? "Reading plan mix and failed payments from locally synced data."
              : pastDue > 0
                ? `${pastDue} ${pastDue === 1 ? "account is" : "accounts are"} past due.`
                : "No account is past due."}{" "}
            Every number here comes from data already synced into this app, so
            there are no live Stripe calls behind this page.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-2 px-3 border-border/40"
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

      {!loading && data && !data.billingEnabled && (
        // rounded-lg, matching the sibling callout in mass-email-manager. A
        // callout is a small card, not a panel.
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border/50 bg-muted/20">
          <div className="p-2 rounded-md bg-muted shrink-0">
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

      <div className="overflow-hidden rounded-xl border border-border/50 bg-card/50">
        <div className="border-b border-border/40 bg-muted/30 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-foreground">Plan mix</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Headcount per plan tier, and the subset of each tier with a
            currently-paying subscription status (active, trialing, or
            past_due). A staff-comped or gifted account counts toward the
            tier&apos;s headcount but not toward paying users or MRR.
          </p>
        </div>
        <div>
          {loading ? (
            <div className="p-4 sm:p-5">
              <DataTableSkeleton rows={4} />
            </div>
          ) : !data ? (
            // Without this the failed fetch rendered a header-only table,
            // which reads as "no plans" rather than "nothing loaded". The
            // warning tone is what separates it from a genuinely empty list.
            <EmptyState
              variant="inline"
              size="sm"
              tone="warning"
              icon={AlertTriangle}
              title="Couldn't load billing overview"
              description="The request failed. Use Refresh above to try again."
            />
          ) : (
            <>
              {/* Desktop table plus an md:hidden card list: five numeric
                  columns do not fit a phone. */}
              <div className="hidden md:block">
                {/* TableScrollArea + min-w: this was the last bare <Table> in
                    the admin panel. Without them a narrow desktop window
                    compressed the five numeric columns instead of scrolling
                    them, which is what the min-w exists to prevent. */}
                <TableScrollArea maxHeight="28rem">
                  <Table className="min-w-[560px]">
                    <TableHeader className="bg-muted/40">
                      <TableRow className="border-y border-border/50 hover:bg-transparent">
                        <TableHead className={TH}>Plan</TableHead>
                        <TableHead className={TH_RIGHT}>Price / mo</TableHead>
                        <TableHead className={TH_RIGHT}>Users</TableHead>
                        <TableHead className={TH_RIGHT}>Paying</TableHead>
                        <TableHead className={TH_RIGHT}>MRR</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data?.planMix.map((plan) => (
                        <TableRow
                          key={plan.planId}
                          className="border-border/40"
                        >
                          <TableCell
                            className={cn(TD, "font-medium text-foreground")}
                          >
                            {plan.planName}
                          </TableCell>
                          {/* tabular-nums: this was the one currency column
                              without it, sitting between three that had it,
                              so the prices were the only figures in the table
                              that did not line up on the decimal. */}
                          <TableCell
                            className={cn(
                              TD,
                              "text-right tabular-nums text-muted-foreground",
                            )}
                          >
                            {plan.priceInCents === 0
                              ? "Free"
                              : formatCents(plan.priceInCents)}
                          </TableCell>
                          <TableCell
                            className={cn(TD, "text-right tabular-nums")}
                          >
                            {plan.totalUsers.toLocaleString()}
                          </TableCell>
                          <TableCell
                            className={cn(TD, "text-right tabular-nums")}
                          >
                            {plan.activeUsers.toLocaleString()}
                          </TableCell>
                          <TableCell
                            className={cn(
                              TD,
                              "text-right tabular-nums font-medium",
                            )}
                          >
                            {formatCents(plan.mrrCents)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScrollArea>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-border/40">
                {data.planMix.map((plan) => (
                  <div key={plan.planId} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">
                        {plan.planName}
                      </p>
                      <p className="text-sm font-medium tabular-nums">
                        {formatCents(plan.mrrCents)}
                      </p>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {plan.priceInCents === 0
                          ? "Free"
                          : `${formatCents(plan.priceInCents)} / mo`}
                      </span>
                      <span>{plan.totalUsers.toLocaleString()} users</span>
                      <span>{plan.activeUsers.toLocaleString()} paying</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/50 bg-card/50">
        <div className="border-b border-border/40 bg-muted/30 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-foreground">
            Failed payments
          </h3>
          {/* The second half of this sentence used to be a template literal
              written across three source lines, so its own indentation (a
              newline plus sixteen spaces, twice) was baked into the rendered
              string. */}
          <p className="text-xs text-muted-foreground mt-1">
            {loading
              ? "Loading..."
              : `${data?.failedPayments.recentEventCount30d ?? 0} invoice.payment_failed webhook ${
                  data?.failedPayments.recentEventCount30d === 1
                    ? "event"
                    : "events"
                } in the last 30 days. There's no local record of amount or invoice per failure, only the account's current status and the raw webhook delivery log below.`}
          </p>
        </div>
        <div>
          {loading ? (
            <div className="p-4 sm:p-5">
              <DataTableSkeleton rows={3} />
            </div>
          ) : !data ? (
            <EmptyState
              variant="inline"
              size="sm"
              tone="warning"
              icon={AlertTriangle}
              title="Couldn't load failed payments"
              description="The request failed. Use Refresh above to try again."
            />
          ) : data.failedPayments.pastDueUsers.length === 0 ? (
            // Good news, and drawn as such. This and the failure above used
            // to be the same grey box.
            <EmptyState
              variant="inline"
              size="sm"
              tone="success"
              icon={CreditCard}
              title="No accounts past due"
              description="Nobody is currently sitting in a failed-payment retry window."
            />
          ) : (
            /* This was a bare <Table> with no scroll container, so on a phone
               the three columns compressed into each other instead of
               scrolling. min-w on the table is what makes the wrapper scroll
               rather than shrink. */
            <TableScrollArea maxHeight="28rem">
              <Table className="min-w-[620px]">
                <TableHeader className="bg-muted/40">
                  <TableRow className="border-y border-border/50 hover:bg-transparent">
                    <TableHead className={TH}>Account</TableHead>
                    <TableHead className={TH}>Plan</TableHead>
                    <TableHead className={TH}>State</TableHead>
                    <TableHead className={TH_RIGHT}>Period end</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.failedPayments.pastDueUsers.map((user) => {
                    const state = pastDueState(user.currentPeriodEnd);
                    const plan = getPlanById(user.plan);
                    return (
                      <TableRow
                        key={user.id}
                        // The red "Past due" number in the strip above had
                        // nothing connecting it to the rows that produced it:
                        // this was the failure list of the whole panel drawn
                        // in default grey. A row whose period has already
                        // closed carries the tint; one still inside its retry
                        // window does not, so the two are told apart.
                        className={cn(
                          "border-border/40",
                          state.tone === "crit" && "bg-destructive/5",
                        )}
                      >
                        <TableCell className={TD}>
                          {/* A real link to the account, the same move the
                              support inbox makes with a requester's name, so
                              chasing a failed payment does not mean copying an
                              email into the Users tab by hand. */}
                          <a
                            href={`/admin?tab=users&user=${user.id}`}
                            className="text-sm text-primary hover:underline"
                          >
                            {user.name || user.email}
                          </a>
                          {user.name && (
                            <div className="text-xs text-muted-foreground font-mono">
                              {user.email}
                            </div>
                          )}
                        </TableCell>
                        {/* A past-due Pro and a past-due Free rendered
                            identically though only one of them is revenue.
                            The tier's price is what says which is which. */}
                        <TableCell className={TD}>
                          <span className="text-sm font-medium text-foreground">
                            {plan?.name || user.plan}
                          </span>
                          {plan && plan.priceInCents > 0 && (
                            <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                              {formatCents(plan.priceInCents)}/mo
                            </span>
                          )}
                        </TableCell>
                        <TableCell className={TD}>
                          <StatusPill tone={state.tone}>
                            {state.label}
                          </StatusPill>
                        </TableCell>
                        <TableCell
                          className={cn(
                            TD,
                            "text-right tabular-nums text-muted-foreground",
                          )}
                        >
                          {/* Was "-", a bare ASCII hyphen, for a null. Every
                              other absence in this panel is spelled out. */}
                          {user.currentPeriodEnd
                            ? formatTimestamp(user.currentPeriodEnd)
                            : "Not recorded"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableScrollArea>
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
                    // Stacked below sm: a Stripe event id is about 30 mono
                    // characters and the timestamp opposite it is shrink-0.
                    className="flex flex-col text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                  >
                    <span title={evt.eventId} className="font-mono truncate">
                      {evt.eventId}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatTimestamp(evt.processedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
