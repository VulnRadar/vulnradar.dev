"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Globe,
  Loader2,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Radar,
  RefreshCw,
  Clock,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/ui/utils";
import { API } from "@/lib/config/constants";
import { useAuth } from "@/components/providers/auth-provider";
import {
  PremiumUpgradeModal,
  PREMIUM_FEATURES,
  hasFeatureAccess,
} from "@/components/modals/premium-upgrade-modal";

interface DiscoveredSubdomain {
  subdomain: string;
  url: string;
  reachable: boolean;
  statusCode?: number;
  sources: string[];
}

interface DiscoveryResult {
  domain: string;
  total: number;
  reachable: number;
  subdomains: DiscoveredSubdomain[];
  sources?: Record<string, number>;
  cached?: boolean;
  cachedAt?: string;
  expiresAt?: string;
}

interface SubdomainDiscoveryProps {
  url: string;
  onScanSubdomain?: (url: string) => void;
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

function formatTimeRemaining(expiresAt: string): string {
  const now = new Date();
  const expires = new Date(expiresAt);
  const diffMs = expires.getTime() - now.getTime();
  if (diffMs <= 0) return "expired";
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;
  return remainingMins > 0
    ? `${diffHours}h ${remainingMins}m`
    : `${diffHours}h`;
}

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

export function SubdomainDiscovery({
  url,
  onScanSubdomain,
}: SubdomainDiscoveryProps) {
  const router = useRouter();
  const { me, isStaff } = useAuth();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  const userPlan = me?.plan || "free";
  // Staff members have access to all premium features
  const canRefreshDNS =
    isStaff ||
    hasFeatureAccess(userPlan, PREMIUM_FEATURES.dns_refetch.requiredPlan);

  // Cleanup progress interval on unmount
  useEffect(() => {
    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
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
      startProgressPolling(requestId);
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
        setResult(data);
        setExpanded(true);
      }
    } catch {
      setError("Failed to discover subdomains");
    } finally {
      stopProgressPolling();
      setLoading(false);
      setRefreshing(false);
    }
  }

  if (!result && !loading) {
    return (
      <>
        <PremiumUpgradeModal
          open={showUpgradeModal}
          onOpenChange={setShowUpgradeModal}
          feature={PREMIUM_FEATURES.dns_refetch}
          currentPlan={userPlan}
        />
        <div className="rounded-md border border-border bg-card p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Globe
                aria-hidden
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
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
    return (
      <div className="rounded-md border border-border bg-card p-6">
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

  if (!result) return null;

  const reachable = result.subdomains.filter((s) => s.reachable);
  const unreachable = result.subdomains.filter((s) => !s.reachable);

  return (
    <>
      <PremiumUpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        feature={PREMIUM_FEATURES.dns_refetch}
        currentPlan={userPlan}
      />
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        >
          <Globe className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground flex-1">
            Subdomain discovery
          </span>
          <span className="text-xs text-muted-foreground">
            {result.reachable} reachable / {result.total} found
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
                  {result.domain}
                </span>
              </span>
              <span className="text-xs text-[hsl(var(--success))]">
                {result.reachable} reachable
              </span>
              <span className="text-xs text-muted-foreground">
                {result.total - result.reachable} unreachable
              </span>

              {/* Cache status */}
              {result.cached && result.expiresAt && (
                <div className="flex items-center gap-2 ml-auto">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />
                    <span className="text-xs text-muted-foreground">
                      Cached • Refreshes in{" "}
                      <span className="font-medium text-foreground">
                        {formatTimeRemaining(result.expiresAt)}
                      </span>
                    </span>
                  </div>
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
                </div>
              )}
            </div>

            {/* Source breakdown */}
            {result.sources && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Sources:
                </span>
                {Object.entries(result.sources).map(([source, count]) => (
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
                ))}
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
      router.push(`/dashboard?scan=${encodeURIComponent(sub.url)}`);
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
      <div className="flex items-center gap-1 flex-shrink-0">
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
        href={sub.url}
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
              <div className="flex items-center gap-1 flex-shrink-0">
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
