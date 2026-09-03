"use client";

import { useState } from "react";
import { Camera, Maximize2, ChevronDown, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { API } from "@/lib/config/client-constants";
import { PREMIUM_FEATURES } from "@/components/modals/premium-upgrade-modal";
import {
  PanelActionBar,
  PanelNotRunRow,
  PanelRefreshError,
  usePanelRefresh,
} from "./panel-refresh";

/** The small reference result_meta.screenshot carries (lib/scanner/page-screenshot.ts). */
interface ScreenshotRef {
  width: number;
  height: number;
  capturedAt: string;
}

/**
 * Stated before the control is ever pressed, and again on the confirm step.
 *
 * This is the only re-runnable panel whose action costs real money: a capture
 * opens a genuine headless browser and draws down the account's live-browser
 * minutes (lib/billing/browserbase-usage.ts), the same meter the interactive
 * session viewer spends. The DNS lookup and the port sweep cost a lookup and a
 * few sockets, so they run on one press; this one arms first and spends second.
 */
const CAPTURE_COST =
  "Opens a real browser once and uses your live-browser minutes.";

interface ScreenshotPanelProps {
  /**
   * Image URL served by the screenshot route (owner/public or token-scoped).
   * Absent when this scan has no screenshot yet, which is the state the
   * owner's "Capture screenshot" control exists for.
   */
  src?: string;
  /** The scanned URL, for the caption and image alt text. */
  url: string;
  /** Capture viewport dimensions, for the intrinsic image box (avoids layout shift). */
  width?: number;
  height?: number;
  capturedAt?: string;
  /**
   * Owner-only: the scan id whose screenshot this panel can capture or
   * re-capture. When set (and not the shared/read-only view), a metered
   * capture control appears and reloads the image in place. Omitted on the
   * shared and host pages, so a viewer can never spend the owner's minutes.
   */
  scanId?: string | number | null;
  /** Called with the fresh reference after a successful capture so the parent
   *  can update its copy of the result in place. */
  onRefreshed?: (ref: ScreenshotRef) => void;
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
 * full-size view on click.
 *
 * Three states, and the middle one is new: a scan that has a screenshot shows
 * it; a scan that does NOT (the option was left off, or the stored bytes can no
 * longer be served) offers the owner a capture instead of rendering nothing;
 * and any read-only viewer of a scan without a screenshot still gets nothing at
 * all, since there is no image to show and no control they may press.
 *
 * A re-capture never blanks the picture that is already there. The old frame
 * stays on screen for the whole capture, and is swapped only once the fresh
 * reference comes back; a failed capture leaves it untouched and puts the
 * reason underneath.
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
  // Bumped after a successful re-capture to bust the served image's private
  // cache (the screenshot route sets Cache-Control: max-age=3600), so the
  // fresh frame actually loads instead of the stale cached one.
  const [cacheBust, setCacheBust] = useState<string | null>(null);

  const refresh = usePanelRefresh<ScreenshotRef>({
    scanId,
    endpoint: API.SCAN_REFRESH_SCREENSHOT,
    responseKey: "screenshot",
    feature: PREMIUM_FEATURES.screenshot_recapture,
    failureMessage: "Could not capture the screenshot.",
    confirmCost: CAPTURE_COST,
    onRefreshed: (shot) => {
      setBroken(false);
      setCacheBust(shot.capturedAt || String(Date.now()));
      onRefreshed?.(shot);
    },
  });

  const hasImage = Boolean(src) && !broken;

  // Nothing to show. The owner gets the capture control (the route captures
  // and stores from cold just as happily as it re-captures); anyone else gets
  // no panel, exactly as before.
  if (!hasImage) {
    if (!refresh.offered) return null;
    return (
      <>
        {refresh.modal}
        <PanelNotRunRow
          icon={Camera}
          title="Page screenshot"
          // "Unavailable" rather than "Not captured" when a reference existed
          // but its bytes would not load: the difference matters to whoever is
          // deciding whether to spend minutes on a re-capture.
          status={broken ? "Unavailable" : "Not captured"}
          actionLabel={broken ? "Capture again" : "Capture screenshot"}
          proLabel="Pro"
          note={CAPTURE_COST}
          confirmLabel="Capture now"
          state={refresh}
        />
      </>
    );
  }

  const captured = formatCapturedAt(capturedAt);
  const alt = `Screenshot of ${url}`;
  const imgSrc = cacheBust
    ? `${src}${src!.includes("?") ? "&" : "?"}v=${encodeURIComponent(cacheBust)}`
    : src;

  return (
    <>
      {refresh.modal}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
        >
          <Camera
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground"
          />
          {/* A literal we wrote, so it wraps rather than clips. */}
          <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
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
            {/* No cooldownMs, deliberately. DNS and ports both cache per host
                for five minutes, so "Available to refresh in Xm" is a true
                statement about the server. A capture has no such cache: every
                press opens a browser and spends minutes, so a countdown here
                would invent a window that does not exist. Age only. */}
            <PanelActionBar
              state={refresh}
              capturedAt={capturedAt}
              agePrefix="Captured"
              refreshLabel="Re-capture"
              refreshTitle="Re-capture the page screenshot now"
              confirmLabel="Capture now"
              className="bg-muted/30"
            >
              {/* The absolute timestamp, bare: the relative "Captured 3 hours
                  ago" beside it supplies the verb. Dropped on a phone, where
                  the relative form is the more useful of the two and the bar
                  has no room for both. */}
              <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground sm:inline">
                {captured ?? "Page screenshot"}
              </span>
            </PanelActionBar>
            <PanelRefreshError error={refresh.error} />
            {/* Cost restated where the spend happens, not only on the confirm
                step, so an owner who lands here mid-scroll still sees it. */}
            {refresh.offered && !refresh.pendingCost && (
              <p className="border-b border-border px-4 py-1.5 text-[11px] text-muted-foreground">
                {CAPTURE_COST}
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
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-background/85 px-1.5 py-0.5 text-[11px] font-medium text-foreground opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Maximize2 aria-hidden className="h-3 w-3" />
                    Enlarge
                  </span>
                </button>
              </DialogTrigger>
              {/* The one modal that stays compact on purpose: it is a bare
                  lightbox, so a header band would put a titled strip above a
                  picture that names itself. The padding is trimmed to a mat
                  around the image, and the title is sr-only so the dialog is
                  still announced. */}
              <DialogContent size="xl" className="p-2 sm:p-3">
                <DialogTitle className="sr-only">{alt}</DialogTitle>
                {/* eslint-disable-next-line @next/next/no-img-element -- see above. */}
                <img
                  src={imgSrc}
                  alt={alt}
                  className="h-auto max-h-[80vh] w-full rounded-lg object-contain"
                />
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>
    </>
  );
}
