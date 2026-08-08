"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitCompareArrows, Loader2, Search, ArrowLeft } from "lucide-react";
import { API } from "@/lib/config/constants";
import {
  clearQueryParams,
  getQueryParamInt,
  removeQueryParam,
  setQueryParam,
} from "@/lib/ui/url-state";
import {
  CompareHostPicker,
  CompareHostScanPicker,
  CompareHeader,
  CompareSummaryStats,
  CompareFindingsList,
  CompareActionsMenu,
  type ScanOption,
  type HostGroup,
  type DiffResult,
  getDomain,
} from "@/components/compare";

export default function ComparePage() {
  const [scans, setScans] = useState<ScanOption[]>([]);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const [selectedA, setSelectedA] = useState<number | null>(null);
  const [selectedB, setSelectedB] = useState<number | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingScans, setLoadingScans] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetch(API.HISTORY)
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d)
          ? d
          : Array.isArray(d?.scans)
            ? d.scans
            : [];
        setScans(list);
        setLoadingScans(false);
      })
      .catch(() => setLoadingScans(false));
  }, []);

  const runCompare = useCallback(async (a: number, b: number) => {
    setLoading(true);
    setDiffResult(null);
    try {
      const res = await fetch(`${API.COMPARE}?a=${a}&b=${b}`);
      const data = await res.json();
      if (res.ok) setDiffResult(data);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  const handleCompare = useCallback(() => {
    if (!selectedA || !selectedB) return;
    runCompare(selectedA, selectedB);
  }, [selectedA, selectedB, runCompare]);

  useEffect(() => {
    const syncFromUrl = () => {
      const a = getQueryParamInt("a");
      const b = getQueryParamInt("b");
      setSelectedA(a);
      setSelectedB(b);
      if (a !== null && b !== null) {
        runCompare(a, b);
      } else {
        setDiffResult(null);
      }
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [runCompare]);

  // A deep link (?a=&b=) resolves selectedA/selectedB before the scan list
  // has loaded, so there is nothing yet to derive a host from. Once `scans`
  // arrives, backfill selectedHost so a still-loading comparison lands on
  // the host's own scan list (with its visible loading state) instead of
  // sitting on the generic host picker with no feedback.
  useEffect(() => {
    if (selectedHost !== null) return;
    if (selectedA === null || selectedB === null) return;
    const match = scans.find((s) => s.id === selectedA || s.id === selectedB);
    if (match) setSelectedHost(getDomain(match.url));
  }, [scans, selectedA, selectedB, selectedHost]);

  // Only hosts with 2+ scans can ever be diffed, so anything else is left
  // out entirely rather than shown as a dead end. `scans` already comes
  // back newest-first from the API, and grouping preserves that order.
  const hostGroups = useMemo<HostGroup[]>(() => {
    const byHost = new Map<string, ScanOption[]>();
    for (const scan of scans) {
      const host = getDomain(scan.url);
      const list = byHost.get(host);
      if (list) list.push(scan);
      else byHost.set(host, [scan]);
    }
    return Array.from(byHost.entries())
      .map(([host, hostScans]) => ({ host, scans: hostScans }))
      .filter((g) => g.scans.length >= 2)
      .sort(
        (a, b) =>
          new Date(b.scans[0].scanned_at).getTime() -
          new Date(a.scans[0].scanned_at).getTime(),
      );
  }, [scans]);

  const filteredHostGroups = hostGroups.filter((g) =>
    g.host.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const selectedGroup = selectedHost
    ? (hostGroups.find((g) => g.host === selectedHost) ?? null)
    : null;

  function handleSelectHost(host: string) {
    setSelectedHost(host);
    setDiffResult(null);
    const group = hostGroups.find((g) => g.host === host);
    if (group && group.scans.length === 2) {
      // No real choice to make with exactly two scans, so run the diff
      // immediately instead of making the user pick both manually.
      const [older, newer] = [...group.scans].sort(
        (x, y) =>
          new Date(x.scanned_at).getTime() - new Date(y.scanned_at).getTime(),
      );
      setSelectedA(older.id);
      setSelectedB(newer.id);
      setQueryParam("a", String(older.id));
      setQueryParam("b", String(newer.id));
      runCompare(older.id, newer.id);
    } else {
      setSelectedA(null);
      setSelectedB(null);
      removeQueryParam("a");
      removeQueryParam("b");
    }
  }

  function handleChangeHost() {
    setSelectedHost(null);
    setSelectedA(null);
    setSelectedB(null);
    removeQueryParam("a");
    removeQueryParam("b");
  }

  function toggleHostScan(id: number) {
    if (selectedA === id) {
      setSelectedA(null);
      removeQueryParam("a");
      return;
    }
    if (selectedB === id) {
      setSelectedB(null);
      removeQueryParam("b");
      return;
    }
    if (selectedA === null) {
      setSelectedA(id);
      setQueryParam("a", String(id));
      return;
    }
    if (selectedB === null) {
      setSelectedB(id);
      setQueryParam("b", String(id));
      return;
    }
    // Both slots already taken: swap out the first pick and keep the second,
    // so picking a third scan replaces rather than requiring a deselect first.
    setSelectedA(selectedB);
    setSelectedB(id);
    setQueryParam("a", String(selectedB));
    setQueryParam("b", String(id));
  }

  function handleReset() {
    setDiffResult(null);
    setSelectedHost(null);
    setSelectedA(null);
    setSelectedB(null);
    clearQueryParams();
  }

  return (
    <PublicPageShell maxWidth="max-w-6xl" padding="py-8 sm:py-10">
      <div className="flex flex-col gap-8">
        <header className="max-w-2xl">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Compare
          </h1>
          <p className="text-muted-foreground mt-2 leading-relaxed">
            Diff two scans of the same host. Because finding IDs do not change
            between runs, the difference is real: what appeared, what you
            closed, and what has been sitting there the whole time.
          </p>
        </header>

        {!diffResult && !selectedHost && (
          <div className="flex flex-col gap-6">
            <div className="relative max-w-sm">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                placeholder="Filter by host"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Filter hosts by name"
                className="pl-9 bg-card/50 border-border/50"
              />
            </div>

            <CompareHostPicker
              hosts={filteredHostGroups}
              loading={loadingScans}
              searchActive={searchQuery.trim().length > 0}
              onSelect={handleSelectHost}
            />
          </div>
        )}

        {!diffResult && selectedHost && selectedGroup && (
          <div className="flex flex-col gap-6">
            <Button
              variant="outline"
              size="sm"
              onClick={handleChangeHost}
              className="self-start gap-1.5 border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Change host
            </Button>

            <div>
              <h2 className="font-mono text-sm font-medium">{selectedHost}</h2>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedGroup.scans.length === 2
                  ? "Only two scans of this host exist, comparing them now."
                  : `${selectedGroup.scans.length} scans on record. Pick two to diff, the older one becomes the base automatically.`}
              </p>
            </div>

            <CompareHostScanPicker
              scans={selectedGroup.scans}
              selectedA={selectedA}
              selectedB={selectedB}
              onToggle={toggleHostScan}
            />

            <div>
              <Button
                onClick={handleCompare}
                disabled={!selectedA || !selectedB || loading}
                size="lg"
                className="h-11 px-6 gap-2"
              >
                {loading ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
                )}
                Compare
              </Button>
            </div>
          </div>
        )}

        {diffResult && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="gap-1.5 border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Pick different scans
              </Button>
              <CompareActionsMenu result={diffResult} />
            </div>

            <CompareHeader result={diffResult} />
            <CompareSummaryStats
              added={diffResult.diff.summary.added}
              removed={diffResult.diff.summary.removed}
              unchanged={diffResult.diff.summary.unchanged}
            />
            <CompareFindingsList diff={diffResult.diff} />
          </div>
        )}
      </div>
    </PublicPageShell>
  );
}
