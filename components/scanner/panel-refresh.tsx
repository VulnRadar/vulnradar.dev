"use client";

import { useState, type ReactNode } from "react";
import {
  Clock,
  Crown,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { useAuth } from "@/components/providers/auth-provider";
import {
  PremiumUpgradeModal,
  hasFeatureAccess,
  type PremiumFeature,
} from "@/components/modals/premium-upgrade-modal";
import {
  panelControlsOffered,
  panelFreshness,
  refreshOutcome,
} from "./panel-freshness";

/**
 * The React half of the re-runnable result panel, paired with the pure rules in
 * ./panel-freshness.ts. Together they replace three hand-copied implementations
 * of the same trio (age readout, cooldown-gated refresh, keep-stale-until-
 * replaced) in the DNS, port-sweep and screenshot panels.
 *
 * Same intent as components/shared/app-page-shell.tsx: the duplication was not
 * the cost, the DRIFT was. The three copies had already diverged on where the
 * freshness line renders, whether a read-only viewer sees it at all, and what
 * happens when the server answers 200 with an empty body. One hook and two rows
 * means the next panel that becomes re-runnable inherits the behaviour rather
 * than re-deriving it.
 *
 * Two invariants live here and nowhere else:
 *
 *  1. A refresh never blanks populated data. `run` only calls `onRefreshed`
 *     when replacement data actually arrived; every other path sets an error
 *     beside content that is still on screen.
 *  2. The control is owner-only. `panelControlsOffered` gates rendering on the
 *     scan id the owner-only surfaces pass, and the routes behind it re-check
 *     ownership server-side (lib/history/refresh-scan.ts).
 */

export interface PanelRefreshOptions<T> {
  /** Owner-only scan id. Absent on /shared and /host, which suppresses the control. */
  scanId?: string | number | null;
  /** Builds the POST URL, e.g. API.SCAN_REFRESH_PORTS. */
  endpoint: (id: string | number) => string;
  /** Key on the JSON response carrying the fresh capture. */
  responseKey: string;
  /** Plan gate, so a free user sees the upgrade modal instead of a silent 402. */
  feature: PremiumFeature;
  /** Shown when the request fails and the server offered no message. */
  failureMessage: string;
  /** Called only with data that actually arrived. */
  onRefreshed?: (data: T) => void;
  /**
   * Metered actions only. When set, the first press arms the control and shows
   * this sentence; only the second press spends. The page screenshot opens a
   * real browser and draws down live-browser minutes, so it must never be one
   * misclick away from costing the owner something.
   */
  confirmCost?: string;
}

export interface PanelRefresh {
  /** The viewer owns this scan, so the control is drawn at all. */
  offered: boolean;
  /** The viewer's plan (or staff) allows the re-run. */
  canRefresh: boolean;
  refreshing: boolean;
  error: string | null;
  /** The cost sentence while a metered control is armed, else null. */
  pendingCost: string | null;
  /** Arms a metered control, or runs the refresh. */
  press: () => void;
  /** Backs out of an armed metered control without spending. */
  cancel: () => void;
  /** The plan-upgrade modal to render alongside the panel. */
  modal: ReactNode;
}

export function usePanelRefresh<T>(opts: PanelRefreshOptions<T>): PanelRefresh {
  const { me, isStaff } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const userPlan = me?.plan || "free";
  const canRefresh =
    isStaff || hasFeatureAccess(userPlan, opts.feature.requiredPlan);
  const offered = panelControlsOffered(opts.scanId);

  async function run(id: string | number) {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(opts.endpoint(id), { method: "POST" });
      // A route that answers with an empty body or HTML (a proxy error page)
      // must not throw past the outcome rules below, or the panel would report
      // a network failure for what is really a server error with a status.
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const outcome = refreshOutcome<T>({
        ok: res.ok,
        body,
        responseKey: opts.responseKey,
        failureMessage: opts.failureMessage,
      });
      if (outcome.kind === "replace") {
        opts.onRefreshed?.(outcome.data);
      } else {
        setError(outcome.error);
      }
    } catch {
      setError(opts.failureMessage);
    } finally {
      setRefreshing(false);
    }
  }

  function press() {
    const id = opts.scanId;
    if (!offered || id === undefined || id === null || refreshing) return;
    if (!canRefresh) {
      setShowUpgradeModal(true);
      return;
    }
    if (opts.confirmCost && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    void run(id);
  }

  return {
    offered,
    canRefresh,
    refreshing,
    error,
    pendingCost: armed ? (opts.confirmCost ?? null) : null,
    press,
    cancel: () => setArmed(false),
    modal: (
      <PremiumUpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        feature={opts.feature}
        currentPlan={userPlan}
      />
    ),
  };
}

const CONTROL_BASE =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The run/refresh button itself. A viewer whose plan is too low still gets a
 * button (a crown, labelled "Pro") rather than a disabled control, so the press
 * opens the upgrade modal and explains itself.
 */
function PanelRefreshControl({
  state,
  label,
  proLabel = "Pro",
  title,
}: {
  state: PanelRefresh;
  label: string;
  proLabel?: string;
  title: string;
}) {
  const upgradeTitle = "Premium feature, upgrade to Pro";
  const accessible = state.canRefresh ? title : upgradeTitle;
  return (
    <button
      type="button"
      onClick={state.press}
      disabled={state.refreshing}
      // min-h-8 on every one of these: the three panels previously shipped
      // three different heights for the same control, and the smallest was a
      // 22px tap target on a phone (WCAG 2.2 SC 2.5.8 asks for 24).
      className={cn(
        CONTROL_BASE,
        "min-h-8",
        state.canRefresh
          ? "text-foreground hover:bg-muted"
          : "text-primary hover:bg-primary/10",
      )}
      title={accessible}
      aria-label={accessible}
    >
      {state.refreshing ? (
        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
      ) : state.canRefresh ? (
        <RefreshCw aria-hidden className="h-3.5 w-3.5" />
      ) : (
        <Crown aria-hidden className="h-3.5 w-3.5" />
      )}
      {state.canRefresh ? label : proLabel}
    </button>
  );
}

/**
 * The armed state of a metered control: the cost, then confirm or back out.
 * Replaces the button in place so the reader cannot press through it by
 * accident, and cancelling spends nothing.
 */
function PanelCostConfirm({
  state,
  confirmLabel,
}: {
  state: PanelRefresh;
  confirmLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-[11px] text-muted-foreground">
        {state.pendingCost}
      </span>
      <button
        type="button"
        onClick={state.press}
        disabled={state.refreshing}
        className={cn(
          CONTROL_BASE,
          "min-h-8 bg-primary/10 text-primary hover:bg-primary/20",
        )}
      >
        {state.refreshing ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
        )}
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={state.cancel}
        disabled={state.refreshing}
        className={cn(
          CONTROL_BASE,
          "min-h-8 text-muted-foreground hover:bg-muted",
        )}
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * The bar at the top of an expanded panel: what this capture is about on the
 * left, how old it is and the owner's refresh on the right.
 *
 * The freshness line renders for EVERY viewer, the control only for the owner.
 * Both were previously gated together, so a shared report showed DNS records
 * with no indication of when they were resolved -- read-only is a reason to
 * hide the button, never a reason to hide the timestamp.
 */
export function PanelActionBar({
  state,
  children,
  capturedAt,
  cooldownMs,
  agePrefix = "Fetched",
  refreshLabel = "Refresh",
  refreshTitle,
  confirmLabel = "Confirm",
  className,
}: {
  state: PanelRefresh;
  /** Left-hand identity: hostname, counts. */
  children?: ReactNode;
  capturedAt?: string | null;
  /** Server-side TTL, when the capture has one. */
  cooldownMs?: number;
  agePrefix?: string;
  refreshLabel?: string;
  refreshTitle: string;
  confirmLabel?: string;
  className?: string;
}) {
  const { age, availability } = panelFreshness(capturedAt, cooldownMs);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/40 px-4 py-1.5",
        className,
      )}
    >
      {children}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {age && (
          // Shown at every width, not `hidden sm:inline-flex` as all three
          // copies had it. "How old is this" is the whole point of the line,
          // and hiding it below sm meant a phone got no answer at all. The bar
          // wraps instead.
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <Clock aria-hidden className="h-3 w-3 text-[hsl(var(--warning))]" />
            {agePrefix} {age}
            {availability && ` · ${availability}`}
          </span>
        )}
        {state.offered &&
          (state.pendingCost ? (
            <PanelCostConfirm state={state} confirmLabel={confirmLabel} />
          ) : (
            <PanelRefreshControl
              state={state}
              label={refreshLabel}
              title={refreshTitle}
            />
          ))}
      </div>
    </div>
  );
}

/**
 * The whole panel when its capture never ran: one row naming the thing, saying
 * it did not run, and offering to run it now.
 *
 * These panels used to render nothing at all in this state, which took the run
 * control down with them in the one case it was built for: a scan whose option
 * was left off. The owner's only recourse was re-running the entire scan,
 * spending a daily quota slot and leaving a second history row for the same
 * host.
 */
export function PanelNotRunRow({
  icon: Icon,
  title,
  status,
  actionLabel,
  proLabel,
  note,
  confirmLabel = "Confirm",
  state,
}: {
  icon: LucideIcon;
  title: string;
  /** "Not scanned", "Not captured". */
  status: string;
  actionLabel: string;
  proLabel?: string;
  /** What running it costs, shown before anything is pressed. */
  note?: string;
  confirmLabel?: string;
  state: PanelRefresh;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        {/* No truncate: `title` is the panel's own name ("Open ports", "DNS
            records", "Page screenshot"), and every sibling on this row is
            shrink-0, so on a phone the clip landed on the one string that says
            what the panel is. The row already wraps. */}
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{status}</span>
        {state.pendingCost ? (
          <PanelCostConfirm state={state} confirmLabel={confirmLabel} />
        ) : (
          <PanelRefreshControl
            state={state}
            label={actionLabel}
            proLabel={proLabel ?? actionLabel}
            title={actionLabel}
          />
        )}
      </div>
      {note && !state.pendingCost && (
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          {note}
        </p>
      )}
      <PanelRefreshError
        error={state.error}
        className="border-t border-border"
      />
    </div>
  );
}

/**
 * The error line for a refresh that did not happen. Rendered UNDER the data it
 * failed to replace, never instead of it: the previous capture is still the
 * best answer available, so it stays on screen.
 */
export function PanelRefreshError({
  error,
  className = "border-b border-border",
}: {
  error: string | null;
  /** Divider side. Defaults to the bottom edge, for the usual slot between the
   *  action bar and the panel body. */
  className?: string;
}) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className={cn("px-4 py-2 text-xs text-destructive", className)}
    >
      {error}
    </p>
  );
}
