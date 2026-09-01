"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Globe,
  Radar,
  RefreshCw,
  Clock,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn, safeHref } from "@/lib/ui/utils";
import { animations } from "@/lib/ui/animations";
import { API, ROUTES } from "@/lib/config/client-constants";
import { formatAge, formatRefreshAvailability } from "@/lib/ui/relative-time";
import { useAuth } from "@/components/providers/auth-provider";
import {
  PremiumUpgradeModal,
  PREMIUM_FEATURES,
  hasFeatureAccess,
} from "@/components/modals/premium-upgrade-modal";
import type {
  DiscoveredSubdomain,
  DiscoveryResult,
} from "@/lib/scanner/subdomain-types";

// Re-exported so existing importers (e.g. app/shared/[token]/page.tsx) keep
// importing DiscoveryResult from this component unchanged.
export type { DiscoveryResult } from "@/lib/scanner/subdomain-types";

interface SubdomainDiscoveryProps {
  url: string;
  onScanSubdomain?: (url: string) => void;
  /**
   * Anonymous/shared view (app/shared/[token]/page.tsx): the viewer has no
   * session or API key to authenticate a discovery POST with, and it isn't
   * their scan to spend rate-limit budget on. Suppresses the "Discover
   * subdomains" button and the cache-refresh button entirely; the section
   * only ever renders `cachedResult`, read-only, or nothing at all.
   */
  readOnly?: boolean;
  /** Pre-fetched cache snapshot for readOnly mode. Ignored otherwise. */
  cachedResult?: DiscoveryResult | null;
  /**
   * Auto-discovered result captured during the scan (result.subdomains). Used
   * as the initial data for the OWNER view so the subdomain panel renders
   * immediately, with no "Discover subdomains" click. A manual discover or
   * refresh still overrides it. Ignored in readOnly mode, which shows
   * cachedResult instead.
   */
  initialResult?: DiscoveryResult | null;
}

// Source attribution doesn't carry security meaning, so every source gets
// the same neutral treatment instead of an arbitrary rainbow of hues.
const SOURCE_BADGE = "bg-muted text-muted-foreground border-border";

// HTTP status buckets map onto the same success/warning/destructive scale
// used everywhere else, never a raw Tailwind palette colour.
const STATUS_DOT: Record<string, string> = {
  gray: "bg-muted-foreground/30",
  green: "bg-[hsl(var(--success))]",
  blue: "bg-primary",
  amber: "bg-[hsl(var(--warning))]",
  red: "bg-destructive",
};
const STATUS_TEXT: Record<string, string> = {
  gray: "text-muted-foreground",
  green: "text-[hsl(var(--success))]",
  blue: "text-primary",
  amber: "text-[hsl(var(--warning))]",
  red: "text-destructive",
};
function statusBucket(code?: number): string {
  if (!code) return "gray";
  if (code >= 200 && code < 300) return "green";
  if (code >= 300 && code < 400) return "blue";
  if (code >= 400 && code < 500) return "amber";
  return "red";
}

// formatAge used to be redefined here, byte-identical to the exported one,
// while the same import statement above already pulled formatRefreshAvailability
// out of that very module -- and lib/ui/relative-time.ts names this component
// as the consumer its wording came from. The two sibling panels (port sweep,
// DNS records) import it, so the private copy was a silent divergence waiting
// for the next wording change.

// Mirrors the real stage names the server reports from
// lib/scanner/discovery-progress.ts -- this is a label lookup, not a
// simulation. The stage/stageIndex driving the bar comes from the server.
const DISCOVERY_STAGE_LABEL: Record<string, string> = {
  queued: "Starting discovery...",
  querying_sources: "Querying Certificate Transparency logs and passive DNS...",
  brute_force: "Running common prefix brute-force...",
  dns_resolution: "Resolving DNS records...",
  reachability: "Verifying reachability...",
  done: "Finalizing results...",
};

const PROGRESS_POLL_MS = 700;
/** The client can't know the request is truly done until the POST itself resolves. */
const MAX_LIVE_PERCENT = 96;
/**
 * A cache hit or a genuinely fast discovery can resolve before the first
 * progress poll ever lands, so showing the loading card for a few ms reads
 * as a flash of 0% rather than "it worked, fast." Loading UI stays hidden
 * until this much time has passed; if the request finishes first, the fast
 * path skips it entirely and fades straight into the result instead (see
 * `showProgressUi` below).
 */
const LOADING_UI_DELAY_MS = 800;

export function SubdomainDiscovery({
  url,
  onScanSubdomain,
  readOnly = false,
  cachedResult = null,
  initialResult = null,
}: SubdomainDiscoveryProps) {
  const router = useRouter();
  const { me, isStaff } = useAuth();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // A manual "Discover"/"Refresh" fills this in and overrides the
  // auto-discovered initialResult; null until the owner runs one by hand.
  const [manualResult, setManualResult] = useState<DiscoveryResult | null>(
    null,
  );
  // What actually renders. readOnly (shared view) never fetches and shows the
  // read-only cache snapshot directly; the owner view shows a manual result if
  // they ran one, otherwise the auto-discovered result captured during the
  // scan. Derived, not mirrored into state, so a prop that changes after mount
  // (e.g. navigating between scans without a remount) is never stale.
  const effectiveResult = readOnly
    ? (cachedResult ?? null)
    : (manualResult ?? initialResult ?? null);
  const [error, setError] = useState<string | null>(null);
  // Auto-discovered (and shared) results start expanded so the subdomains are
  // visible immediately; an owner view with nothing discovered yet stays
  // collapsed behind the "Discover subdomains" button.
  // Collapsed by default on every page, like the other result panels. A manual
  // Discover/refresh still expands it (setExpanded(true) in handleDiscover).
  const [expanded, setExpanded] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  // Gates the loading card itself (see LOADING_UI_DELAY_MS above), separate
  // from `loading`, which still tracks whether a request is in flight.
  const [showProgressUi, setShowProgressUi] = useState(false);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);
  const loadingUiTimer = useRef<NodeJS.Timeout | null>(null);

  const userPlan = me?.plan || "free";
  // Staff members have access to all premium features
  const canRefreshDNS =
    isStaff ||
    hasFeatureAccess(
      userPlan,
      PREMIUM_FEATURES.subdomain_discovery.requiredPlan,
    );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
      if (loadingUiTimer.current) {
        clearTimeout(loadingUiTimer.current);
      }
    };
  }, []);

  /**
   * Polls the real server-side stage of an in-flight discovery request
   * (see lib/scanner/discovery-progress.ts). The POST itself is unaffected
   * and stays the source of truth for the final result -- this only reads
   * a live snapshot of how far it has actually gotten.
   */
  function startProgressPolling(requestId: string) {
    setProgress(0);
    setProgressMessage(DISCOVERY_STAGE_LABEL.queued);

    progressInterval.current = setInterval(async () => {
      try {
        const res = await fetch(API.SCAN_DISCOVER_PROGRESS(requestId));
        if (!res.ok) return;
        const data = await res.json();
        const pct = Math.min(
          MAX_LIVE_PERCENT,
          Math.round((data.stageIndex / data.stagesTotal) * MAX_LIVE_PERCENT),
        );
        setProgress(pct);
        setProgressMessage(
          DISCOVERY_STAGE_LABEL[data.stage] ?? "Discovering subdomains...",
        );
      } catch {
        // A missed poll just leaves the bar briefly stale, not wrong.
      }
    }, PROGRESS_POLL_MS);
  }

  function stopProgressPolling() {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
    setProgress(100);
  }

  async function handleDiscover(forceRefresh = false) {
    // Anonymous/shared viewers have no UI path that calls this (no button
    // rendered below), but this is the actual line that would spend
    // rate-limit budget and hit a 401 -- guard it directly too.
    if (readOnly) return;

    // Check if user has premium access for refresh
    if (forceRefresh && !canRefreshDNS) {
      setShowUpgradeModal(true);
      return;
    }

    const requestId = crypto.randomUUID();
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setShowProgressUi(false);
      startProgressPolling(requestId);
      loadingUiTimer.current = setTimeout(
        () => setShowProgressUi(true),
        LOADING_UI_DELAY_MS,
      );
    }
    setError(null);
    try {
      const res = await fetch(API.SCAN_DISCOVER, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, forceRefresh, requestId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          setError(
            "You need to be logged in to use Subdomain Discovery. Create a free account to unlock this feature.",
          );
        } else {
          setError(data.error || "Discovery failed");
        }
      } else {
        setManualResult(data);
        setExpanded(true);
      }
    } catch {
      setError("Failed to discover subdomains");
    } finally {
      if (loadingUiTimer.current) {
        clearTimeout(loadingUiTimer.current);
        loadingUiTimer.current = null;
      }
      stopProgressPolling();
      setLoading(false);
      setRefreshing(false);
    }
  }

  if (!effectiveResult && !loading) {
    // No cached data for this host: the shared page renders nothing at
    // all rather than an empty state or a button anonymous viewers can't
    // use anyway.
    if (readOnly) return null;
    return (
      <>
        <PremiumUpgradeModal
          open={showUpgradeModal}
          onOpenChange={setShowUpgradeModal}
          feature={PREMIUM_FEATURES.subdomain_discovery}
          currentPlan={userPlan}
        />
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Globe
                aria-hidden
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              />
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Subdomain discovery
                </h3>
                <p className="text-xs text-muted-foreground">
                  Find related subdomains using CT logs, passive DNS, and common
                  prefix brute-force
                </p>
              </div>
            </div>
            <Button
              onClick={() => handleDiscover(false)}
              disabled={loading}
              size="sm"
              variant="outline"
              className="gap-2 bg-transparent shrink-0"
            >
              <Search aria-hidden className="h-3.5 w-3.5" />
              Discover subdomains
            </Button>
          </div>
          {error && <p className="text-sm text-destructive mt-3">{error}</p>}
        </div>
      </>
    );
  }

  if (loading) {
    // Still under LOADING_UI_DELAY_MS: hold off rendering anything so a
    // fast (or cached) discovery never flashes a near-zero progress bar.
    // If it's still running once the timer fires, showProgressUi flips
    // true and this renders the real bar below.
    if (!showProgressUi) return null;
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col items-center gap-3">
          <Loader2 aria-hidden className="h-5 w-5 animate-spin text-primary" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              Discovering subdomains
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {progressMessage}
            </p>
          </div>
          <div className="w-full max-w-xs">
            <Progress value={progress} className="h-2" />
            <p className="text-[10px] font-mono tabular-nums text-muted-foreground text-center mt-1.5">
              {progress}% complete
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!effectiveResult) return null;

  const reachable = effectiveResult.subdomains.filter((s) => s.reachable);
  const unreachable = effectiveResult.subdomains.filter((s) => !s.reachable);

  return (
    <>
      <PremiumUpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        feature={PREMIUM_FEATURES.subdomain_discovery}
        currentPlan={userPlan}
      />
      <div
        className={cn(
          "rounded-xl border border-border bg-card overflow-hidden",
          // Skipped the loading card (fast/cached path): fade the result
          // in instead of a hard cut so it still reads as deliberate.
          !showProgressUi && animations.fadeIn,
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          // a11y (SC 4.1.2): every sibling result panel (response headers,
          // threat intel, DNS records, screenshot, software inventory) reports
          // its expanded state; this one was the outlier.
          aria-expanded={expanded}
          className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        >
          <Globe
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground"
          />
          <span className="text-sm font-semibold text-foreground flex-1">
            Subdomain discovery
          </span>
          <span className="text-xs text-muted-foreground">
            {effectiveResult.reachable} reachable / {effectiveResult.total}{" "}
            found
          </span>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </button>

        {expanded && (
          <div className="border-t border-border">
            {/* Stats bar */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 bg-muted/30 border-b border-border">
              <span className="text-xs text-muted-foreground">
                Domain:{" "}
                <span className="font-medium text-foreground">
                  {effectiveResult.domain}
                </span>
              </span>
              <span className="text-xs text-[hsl(var(--success))]">
                {effectiveResult.reachable} reachable
              </span>
              <span className="text-xs text-muted-foreground">
                {effectiveResult.total - effectiveResult.reachable} unreachable
              </span>

              {/* Freshness + refresh. Always shown (even for a snapshot older
                  than the cache window) so the panel reads as "here is the
                  latest known set" rather than reverting to the button. */}
              <div className="flex items-center gap-2 ml-auto">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />
                  <span className="text-xs text-muted-foreground">
                    {formatAge(effectiveResult.cachedAt)
                      ? `Fetched ${formatAge(effectiveResult.cachedAt)}`
                      : "Latest known result"}
                    {effectiveResult.cached && effectiveResult.expiresAt && (
                      <>
                        {" · "}
                        <span className="font-medium text-foreground">
                          {formatRefreshAvailability(effectiveResult.expiresAt)}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleDiscover(true)}
                    disabled={refreshing}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50",
                      canRefreshDNS
                        ? "text-foreground hover:bg-muted"
                        : "text-primary hover:bg-primary/10",
                    )}
                    title={
                      canRefreshDNS
                        ? "Force refresh cache now"
                        : "Premium feature, upgrade to Pro"
                    }
                    aria-label={
                      canRefreshDNS
                        ? "Force refresh cache now"
                        : "Premium feature, upgrade to Pro"
                    }
                  >
                    {refreshing ? (
                      <Loader2
                        aria-hidden
                        className="h-3.5 w-3.5 animate-spin"
                      />
                    ) : canRefreshDNS ? (
                      <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                    ) : (
                      <Crown aria-hidden className="h-3.5 w-3.5" />
                    )}
                    <span className="hidden sm:inline">
                      {canRefreshDNS ? "Refresh now" : "Pro"}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Source breakdown */}
            {effectiveResult.sources && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Sources:
                </span>
                {Object.entries(effectiveResult.sources).map(
                  ([source, count]) => (
                    <span
                      key={source}
                      className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border",
                        SOURCE_BADGE,
                      )}
                    >
                      {source}
                      <span className="opacity-60">{count}</span>
                    </span>
                  ),
                )}
              </div>
            )}

            {/* Reachable subdomains */}
            {reachable.length > 0 && (
              <div className="px-4 py-3 border-b border-border">
                <p className="text-[10px] font-medium text-[hsl(var(--success))] uppercase tracking-wider mb-2">
                  Reachable
                </p>
                <div className="flex flex-col gap-1">
                  {reachable.map((sub) => (
                    <SubdomainRow
                      key={sub.subdomain}
                      sub={sub}
                      onScanSubdomain={onScanSubdomain}
                      router={router}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Unreachable subdomains (collapsed by default) */}
            {unreachable.length > 0 && (
              <UnreachableSection subdomains={unreachable} />
            )}
          </div>
        )}
      </div>
    </>
  );
}

function SubdomainRow({
  sub,
  onScanSubdomain,
  router,
}: {
  sub: DiscoveredSubdomain;
  onScanSubdomain?: (url: string) => void;
  router: ReturnType<typeof useRouter>;
}) {
  function handleScanClick() {
    if (onScanSubdomain) {
      onScanSubdomain(sub.url);
    } else {
      router.push(`${ROUTES.DASHBOARD}?scan=${encodeURIComponent(sub.url)}`);
    }
  }

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors group">
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          STATUS_DOT[statusBucket(sub.statusCode)],
        )}
      />
      <span className="text-[10px] sm:text-xs font-mono text-foreground truncate max-w-[140px] sm:max-w-none">
        {sub.subdomain}
      </span>
      {/* Source tags */}
      <div className="flex items-center gap-1 shrink-0">
        {sub.sources?.map((source) => (
          <span
            key={source}
            className={cn(
              "hidden sm:inline-flex px-1 py-px rounded text-[9px] font-medium border",
              SOURCE_BADGE,
            )}
          >
            {source}
          </span>
        ))}
      </div>
      <span className="flex-1" />
      {sub.statusCode && (
        <span
          className={cn(
            "text-[10px] font-mono",
            STATUS_TEXT[statusBucket(sub.statusCode)],
          )}
        >
          {sub.statusCode}
        </span>
      )}
      <a
        href={safeHref(sub.url)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${sub.subdomain} in a new tab`}
        className="text-muted-foreground hover:text-primary transition-opacity shrink-0"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleScanClick}
        className="h-6 px-2 text-[10px] gap-1 shrink-0"
      >
        <Radar className="h-3 w-3" />
        Scan
      </Button>
    </div>
  );
}

function UnreachableSection({
  subdomains,
}: {
  subdomains: DiscoveredSubdomain[];
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={() => setShow(!show)}
        aria-expanded={show}
        className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors flex items-center gap-1"
      >
        {show ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {subdomains.length} unreachable
      </button>
      {show && (
        <div className="flex flex-col gap-1 mt-2">
          {subdomains.map((sub) => (
            <div
              key={sub.subdomain}
              className="flex items-center gap-2 px-2 py-1 rounded-md"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
              <span className="text-[10px] sm:text-[11px] font-mono text-muted-foreground truncate max-w-[160px] sm:max-w-none">
                {sub.subdomain}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {sub.sources?.map((source) => (
                  <span
                    key={source}
                    className={cn(
                      "hidden sm:inline-flex px-1 py-px rounded text-[9px] font-medium border opacity-60",
                      SOURCE_BADGE,
                    )}
                  >
                    {source}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
