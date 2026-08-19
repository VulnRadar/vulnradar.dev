"use client";

import { useState, useEffect } from "react";
import { ArrowRight, Check, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { useModalA11y } from "@/lib/hooks/use-modal-a11y";
import { useAuth } from "@/components/providers/auth-provider";
import { getCrawlPageSelectionLimit } from "@/lib/billing/crawl-page-limits";
import { BILLING_ENABLED } from "@/lib/config/constants";

interface CrawlUrlSelectorProps {
  urls: string[];
  isLoading: boolean;
  onConfirm: (selectedUrls: string[]) => void;
  onCancel: () => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function getPath(url: string) {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function CrawlUrlSelector({
  urls,
  isLoading,
  onConfirm,
  onCancel,
}: CrawlUrlSelectorProps) {
  const { me } = useAuth();
  // Per-plan cap on how many pages the user may SELECT to scan. Same source the
  // server route enforces (lib/billing/crawl-page-limits.ts), so the two never
  // disagree. Billing off (self-hosted) means no cap.
  const selectionLimit = BILLING_ENABLED
    ? getCrawlPageSelectionLimit(me?.plan)
    : Number.POSITIVE_INFINITY;
  const isCapped = Number.isFinite(selectionLimit);
  const maxSelectable = Math.min(urls.length, selectionLimit);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(urls.slice(0, maxSelectable)),
  );
  const [filter, setFilter] = useState("");

  // Select up to the plan cap by default as URLs arrive from discovery.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local selection state from a changed prop
    setSelected(new Set(urls.slice(0, maxSelectable)));
  }, [urls, maxSelectable]);

  const allSelectableSelected =
    selected.size >= maxSelectable && maxSelectable > 0;
  const atCap = selected.size >= selectionLimit;
  const noneSelected = selected.size === 0;

  function toggleUrl(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        // At the plan cap: refuse to add more (the row is also disabled below).
        if (next.size >= selectionLimit) return prev;
        next.add(url);
      }
      return next;
    });
  }

  const filtered = filter
    ? urls.filter((u) => u.toLowerCase().includes(filter.toLowerCase()))
    : urls;

  const hostname = urls.length > 0 ? getHostname(urls[0]) : "";

  const { dialogProps: crawlDialogProps, titleProps: crawlTitleProps } =
    useModalA11y({
      open: urls.length > 0 || isLoading,
      onClose: onCancel,
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel crawl"
        className="absolute inset-0 cursor-default bg-background/80 backdrop-blur-sm"
        onClick={onCancel}
      />

      <div
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-border bg-card shadow-lg"
        {...crawlDialogProps}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2
              className="text-sm font-semibold text-foreground"
              {...crawlTitleProps}
            >
              Pick the pages to scan
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {isLoading
                ? `Crawling ${hostname || "the entry page"} for links`
                : `${urls.length} ${urls.length === 1 ? "page" : "pages"} found on ${hostname}. Each one costs a scan.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              "-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              FOCUS_RING,
            )}
            aria-label="Close"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center gap-2 py-12">
            <Loader2
              aria-hidden
              className="h-5 w-5 animate-spin text-primary"
            />
            <p className="text-sm text-muted-foreground">
              Following links from the entry page
            </p>
            <p className="font-mono text-xs tabular-nums text-muted-foreground/60">
              {urls.length} found so far
            </p>
          </div>
        )}

        {!isLoading && urls.length > 0 && (
          <>
            <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
              <div className="relative flex-1">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="search"
                  placeholder="Filter paths"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Filter pages by URL"
                  className="h-7 w-full rounded border border-border bg-background pl-7 pr-2 text-base sm:text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    allSelectableSelected
                      ? new Set()
                      : new Set(urls.slice(0, maxSelectable)),
                  )
                }
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10",
                  FOCUS_RING,
                )}
              >
                {allSelectableSelected ? "Clear all" : "Select all"}
              </button>
            </div>

            {isCapped && urls.length > selectionLimit && (
              <div className="border-b border-border bg-primary/5 px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Your plan scans up to {selectionLimit} pages per crawl. Upgrade
                to select more.
              </div>
            )}

            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {filtered.map((url, i) => {
                const isChecked = selected.has(url);
                return (
                  <li key={url}>
                    <button
                      type="button"
                      onClick={() => toggleUrl(url)}
                      aria-pressed={isChecked}
                      disabled={!isChecked && atCap}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60",
                        !isChecked &&
                          atCap &&
                          "cursor-not-allowed opacity-40 hover:bg-transparent",
                        FOCUS_RING,
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                          isChecked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {isChecked && (
                          <Check className="h-2.5 w-2.5" strokeWidth={3} />
                        )}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate font-mono text-xs",
                          isChecked
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {getPath(url)}
                      </span>
                      {i === 0 && !filter && (
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Entry
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="py-6 text-center text-xs text-muted-foreground">
                  No paths contain &ldquo;{filter}&rdquo;.
                </li>
              )}
            </ul>
          </>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {selected.size} of {urls.length} selected
            {isCapped && urls.length > selectionLimit
              ? ` (max ${selectionLimit})`
              : ""}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="h-8 bg-transparent"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => onConfirm(Array.from(selected))}
              disabled={noneSelected || isLoading}
              className="h-8 gap-1.5"
            >
              Scan {selected.size} {selected.size === 1 ? "page" : "pages"}
              <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
