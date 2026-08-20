"use client";

import { useId, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Crown,
  Loader2,
  RefreshCw,
  Server,
} from "lucide-react";
import type { ClosedPort, PortScanResult } from "@/lib/scanner/port-scan";
import { API } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { useAuth } from "@/components/providers/auth-provider";
import {
  PremiumUpgradeModal,
  PREMIUM_FEATURES,
  hasFeatureAccess,
} from "@/components/modals/premium-upgrade-modal";
import { formatAge, formatRefreshAvailability } from "@/lib/ui/relative-time";

/**
 * Matches lib/scanner/port-scan.ts PORT_SCAN_TTL_MS: a refresh within this
 * window returns the cached sweep, so "Available to refresh in Xm" tells the
 * user when a genuinely fresh sweep is next available.
 */
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

interface PortScanPanelProps {
  portScan?: PortScanResult | null;
  /**
   * Owner-only: the scan id whose sweep this panel can re-run. When set (and
   * not the shared/read-only view), a small refresh control re-runs the
   * ownership-gated port sweep for this scan and updates the panel in place.
   * Omitted on the shared page, so anonymous viewers get no control.
   */
  scanId?: string | number | null;
  /** Called with the fresh sweep after a successful refresh so the parent can
   *  update its copy of the result in place. */
  onRefreshed?: (portScan: PortScanResult) => void;
}

/**
 * "Open ports" panel: the result of the opt-in, ownership-gated curated port
 * sweep (lib/scanner/port-scan.ts). Collapsible, monospace, with each open
 * port's number, service, and any banner. Mirrors DnsRecordsPanel's styling
 * and the response-headers panel's "render nothing when absent" behavior --
 * but when the sweep DID run and found nothing open, it still renders a short
 * definitive "no open ports" line, since that is itself a useful result.
 *
 * The checked-but-closed ports are shown in a collapsed section beneath the
 * open ones, the same way SubdomainDiscovery lists unreachable hosts, so a
 * closed port reads as "checked, nothing there" without flooding the findings
 * list with an info entry per closed port.
 */
export function PortScanPanel({
  portScan,
  scanId,
  onRefreshed,
}: PortScanPanelProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { me, isStaff } = useAuth();
  const userPlan = me?.plan || "free";
  // Premium gate (Pro): staff always pass. A free user gets the upgrade modal
  // instead of a silent 402 from the route.
  const canRefresh =
    isStaff ||
    hasFeatureAccess(userPlan, PREMIUM_FEATURES.port_refetch.requiredPlan);

  async function handleRefresh() {
    if (!scanId || refreshing) return;
    if (!canRefresh) {
      setShowUpgradeModal(true);
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(API.SCAN_REFRESH_PORTS(scanId), {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not refresh the port sweep.");
      } else if (data.portScan) {
        onRefreshed?.(data.portScan);
      }
    } catch {
      setError("Could not refresh the port sweep.");
    } finally {
      setRefreshing(false);
    }
  }

  // Absent field: the caller did not opt in, or the target was unsafe /
  // unresolvable. Nothing to say -- render nothing, like the DNS panel does
  // for a raw IP.
  if (!portScan) return null;

  const openCount = portScan.open.length;
  const closed = portScan.closed ?? [];
  const showRefresh = Boolean(scanId);
  const fetchedAge = formatAge(portScan.scannedAt);
  const refreshAvail = portScan.scannedAt
    ? formatRefreshAvailability(
        new Date(
          new Date(portScan.scannedAt).getTime() + REFRESH_COOLDOWN_MS,
        ).toISOString(),
      )
    : null;

  return (
    <>
      <PremiumUpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        feature={PREMIUM_FEATURES.port_refetch}
        currentPlan={userPlan}
      />
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Server
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground"
          />
          <span className="flex-1 text-sm font-medium text-foreground">
            Open ports
          </span>
          <span className="hidden flex-wrap items-center gap-1 sm:flex">
            {portScan.open.slice(0, 8).map((p) => (
              <span
                key={p.port}
                className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary"
              >
                {p.port}
              </span>
            ))}
            {openCount > 8 && (
              <span className="font-mono text-[11px] text-muted-foreground">
                +{openCount - 8}
              </span>
            )}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {openCount} open / {portScan.portsScanned} checked
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>

        {expanded && (
          <div id={panelId} className="border-t border-border">
            {/* Sticky action bar: host + open count, plus the owner refresh. */}
            <div className="sticky top-0 flex items-center gap-2 bg-muted/40 px-4 py-1.5 backdrop-blur-sm">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-primary">
                {portScan.host}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {openCount} open
              </span>
              {showRefresh && (
                <div className="ml-auto flex items-center gap-2">
                  {fetchedAge && (
                    <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
                      <Clock
                        aria-hidden
                        className="h-3 w-3 text-[hsl(var(--warning))]"
                      />
                      Fetched {fetchedAge}
                      {refreshAvail && ` · ${refreshAvail}`}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                      canRefresh
                        ? "text-foreground hover:bg-muted"
                        : "text-primary hover:bg-primary/10",
                    )}
                    title={
                      canRefresh
                        ? "Re-run the port sweep now"
                        : "Premium feature, upgrade to Pro"
                    }
                    aria-label={
                      canRefresh
                        ? "Re-run the port sweep now"
                        : "Premium feature, upgrade to Pro"
                    }
                  >
                    {refreshing ? (
                      <Loader2
                        aria-hidden
                        className="h-3.5 w-3.5 animate-spin"
                      />
                    ) : canRefresh ? (
                      <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                    ) : (
                      <Crown aria-hidden className="h-3.5 w-3.5" />
                    )}
                    <span className="hidden sm:inline">
                      {canRefresh ? "Refresh" : "Pro"}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {error && (
              <p className="border-b border-border px-4 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            {openCount === 0 && closed.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">
                No open ports among the {portScan.portsScanned} common service
                ports checked on {portScan.host}.
              </p>
            ) : (
              <>
                {openCount > 0 && (
                  // Long banners scroll horizontally inside this container so
                  // the page body never does.
                  <div className="max-h-96 overflow-auto">
                    <div className="divide-y divide-border/50">
                      {portScan.open.map((p) => (
                        <div key={p.port} className="px-4 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-foreground">
                              {p.port}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                              {p.service}
                            </span>
                            <span className="shrink-0 font-mono text-[11px] text-[hsl(var(--severity-medium))]">
                              open
                            </span>
                          </div>
                          {p.banner && (
                            <div className="mt-1 overflow-x-auto">
                              <code className="whitespace-pre font-mono text-[11px] text-muted-foreground">
                                {p.banner}
                              </code>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {closed.length > 0 && <ClosedSection ports={closed} />}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Collapsed "N closed" section, mirroring SubdomainDiscovery's
 * UnreachableSection: a chevron toggle over a monospace list of the ports the
 * sweep probed and found closed/filtered.
 */
function ClosedSection({ ports }: { ports: ClosedPort[] }) {
  const [show, setShow] = useState(false);

  return (
    <div className="border-t border-border px-4 py-3">
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {show ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {ports.length} closed
      </button>
      {show && (
        <div className="mt-2 flex flex-col gap-1">
          {ports.map((p) => (
            <div
              key={p.port}
              className="flex items-center gap-2 rounded-md px-2 py-1"
            >
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                {p.port}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                {p.service}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                closed
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
