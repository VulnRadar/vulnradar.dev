"use client";

import { useState } from "react";
import {
  Camera,
  Loader2,
  Maximize2,
  ChevronDown,
  ChevronRight,
  Crown,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { API } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { useAuth } from "@/components/providers/auth-provider";
import {
  PremiumUpgradeModal,
  PREMIUM_FEATURES,
  hasFeatureAccess,
} from "@/components/modals/premium-upgrade-modal";

interface ScreenshotPanelProps {
  /** Image URL served by the screenshot route (owner/public or token-scoped). */
  src: string;
  /** The scanned URL, for the caption and image alt text. */
  url: string;
  /** Capture viewport dimensions, for the intrinsic image box (avoids layout shift). */
  width?: number;
  height?: number;
  capturedAt?: string;
  /**
   * Owner-only: the scan id whose screenshot this panel can re-capture. When
   * set (and not the shared/read-only view), a small refresh control re-runs
   * the metered capture for this scan and reloads the image in place. Omitted
   * on the shared page.
   */
  scanId?: string | number | null;
  /** Called with the fresh reference after a successful re-capture so the
   *  parent can update its copy of the result in place. */
  onRefreshed?: (ref: {
    width: number;
    height: number;
    capturedAt: string;
  }) => void;
}

function formatCapturedAt(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The opt-in page screenshot, rendered as a thumbnail card that opens a
 * full-size view on click. Bows out entirely (renders nothing) if the image
 * fails to load -- a screenshot is best-effort, so a scan whose reference is
 * present but whose bytes can't be served (revoked visibility, missing row)
 * degrades to no panel rather than a broken image, matching how the other
 * "More about this host" panels render nothing when they have nothing.
 */
export function ScreenshotPanel({
  src,
  url,
  width,
  height,
  capturedAt,
  scanId,
  onRefreshed,
}: ScreenshotPanelProps) {
  const [broken, setBroken] = useState(false);
  // Collapsed by default: a screenshot is a large visual, so it starts folded
  // like the other "More about this host" panels and expands on click.
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  // Bumped after a successful re-capture to bust the served image's private
  // cache (the screenshot route sets Cache-Control: max-age=3600), so the
  // fresh frame actually loads instead of the stale cached one.
  const [cacheBust, setCacheBust] = useState<string | null>(null);
  const { me, isStaff } = useAuth();
  const userPlan = me?.plan || "free";
  // Same premium gate as the subdomain refresh: staff always pass, everyone
  // else needs the dns_refetch plan (Pro). A free user gets the upgrade modal
  // instead of a silent 402 from the route.
  const canRefresh =
    isStaff ||
    hasFeatureAccess(userPlan, PREMIUM_FEATURES.dns_refetch.requiredPlan);

  async function handleRefresh() {
    if (!scanId || refreshing) return;
    if (!canRefresh) {
      setShowUpgradeModal(true);
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(API.SCAN_REFRESH_SCREENSHOT(scanId), {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not refresh the screenshot.");
      } else if (data.screenshot) {
        setBroken(false);
        setCacheBust(data.screenshot.capturedAt || String(Date.now()));
        onRefreshed?.(data.screenshot);
      }
    } catch {
      setError("Could not refresh the screenshot.");
    } finally {
      setRefreshing(false);
    }
  }

  if (broken) return null;

  const captured = formatCapturedAt(capturedAt);
  const alt = `Screenshot of ${url}`;
  const imgSrc = cacheBust
    ? `${src}${src.includes("?") ? "&" : "?"}v=${encodeURIComponent(cacheBust)}`
    : src;

  return (
    <>
      <PremiumUpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        feature={PREMIUM_FEATURES.dns_refetch}
        currentPlan={userPlan}
      />
      <div className="overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <Camera aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          Page screenshot
        </span>
        {captured && (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {captured}
          </span>
        )}
        {expanded ? (
          <ChevronDown
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground"
          />
        ) : (
          <ChevronRight
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground"
          />
        )}
      </button>
      {expanded && (
        <div className="border-t border-border">
          {scanId && (
            <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {captured ? `Captured ${captured}` : "Page screenshot"}
              </span>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className={cn(
                  "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                  canRefresh
                    ? "text-foreground hover:bg-muted"
                    : "text-primary hover:bg-primary/10",
                )}
                title={
                  canRefresh
                    ? "Re-capture the page screenshot now"
                    : "Premium feature, upgrade to Pro"
                }
                aria-label={
                  canRefresh
                    ? "Re-capture the page screenshot now"
                    : "Premium feature, upgrade to Pro"
                }
              >
                {refreshing ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
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
          {error && (
            <p className="border-b border-border px-4 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="group relative block w-full bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label="Enlarge page screenshot"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- served from
                    a dynamic same-origin API route; next/image would need a loader
                    and remotePatterns config for what is a simple <img>. */}
                <img
                  src={imgSrc}
                  alt={alt}
                  width={width}
                  height={height}
                  loading="lazy"
                  onError={() => setBroken(true)}
                  className="block aspect-4/3 max-h-[280px] w-full object-cover object-top sm:aspect-auto sm:max-h-[420px]"
                />
                <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-background/85 px-1.5 py-0.5 text-[11px] font-medium text-foreground opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <Maximize2 aria-hidden className="h-3 w-3" />
                  Enlarge
                </span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl p-2 sm:p-3">
              <DialogTitle className="sr-only">{alt}</DialogTitle>
              {/* eslint-disable-next-line @next/next/no-img-element -- see above. */}
              <img
                src={imgSrc}
                alt={alt}
                className="h-auto max-h-[80vh] w-full rounded object-contain"
              />
            </DialogContent>
          </Dialog>
        </div>
      )}
      </div>
    </>
  );
}
