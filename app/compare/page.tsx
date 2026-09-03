"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
// AppPageShell, not PublicPageShell. /compare diffs two scans out of the
// caller's own history, so it has no meaning signed out and is not in
// PUBLIC_PATHS: the middleware sends an anonymous visitor to
// /login?redirect=/compare. Rendering the public marketing nav on a page only
// a signed-in account can reach put the wrong top bar on it, and disagreed
// with CompareSkeleton, which already rendered the app Header for the same
// route.
import { AppPageShell } from "@/components/shared/app-page-shell";
import { tourAnchor } from "@/lib/tour/anchors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitCompareArrows, Loader2, Search, ArrowLeft } from "lucide-react";
import { API } from "@/lib/config/client-constants";
import {
  clearQueryParams,
  getQueryParam,
  removeQueryParam,
  setQueryParams,
  LOCATION_CHANGE_EVENT,
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
import { InlineAlert } from "@/components/shared/inline-alert";

export default function ComparePage() {
  const [scans, setScans] = useState<ScanOption[]>([]);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  // Strings, not numbers: these hold scan_history.public_id. See
  // components/compare/compare-types.ts.
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingScans, setLoadingScans] = useState(true);
  const [scansFailed, setScansFailed] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    // A failed history load used to fall through to an empty list, which the
    // picker renders as "Nothing to compare yet". On a security product that
    // reads as "you have no scans", so a fetch failure has to look different
    // from genuinely having nothing.
    fetch(API.HISTORY)
      .then(async (r) => {
        if (!r.ok) {
          setScansFailed(true);
          return;
        }
        const d = await r.json();
        const list = Array.isArray(d)
          ? d
          : Array.isArray(d?.scans)
            ? d.scans
            : [];
        setScans(list);
      })
      .catch(() => setScansFailed(true))
      .finally(() => setLoadingScans(false));
  }, []);

  const runCompare = useCallback(async (a: string, b: string) => {
    setLoading(true);
    setDiffResult(null);
    setCompareError(null);
    try {
      const res = await fetch(
        `${API.COMPARE}?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
      );
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (res.ok) {
        setDiffResult(data as DiffResult);
      } else {
        // Every failure used to land in exactly the same place: the spinner
        // stopped, no diff appeared, and the picker came back with Compare
        // live again. A 403 on someone else's scans, a 404 on a deleted one
        // and a 500 were indistinguishable from nothing having happened.
        setCompareError(
          data?.error ||
            (res.status === 403
              ? "You do not have access to one of those scans."
              : res.status === 404
                ? "One of those scans no longer exists."
                : "That comparison could not be run. Try again in a moment."),
        );
      }
    } catch {
      setCompareError(
        "Could not reach the server, so the comparison did not run. Check your connection and try again.",
      );
    }
    setLoading(false);
  }, []);

  const handleCompare = useCallback(() => {
    if (!selectedA || !selectedB) return;
    runCompare(selectedA, selectedB);
  }, [selectedA, selectedB, runCompare]);

  useEffect(() => {
    const syncFromUrl = () => {
      // getQueryParam, not getQueryParamInt: these are opaque hex ids and
      // parseInt turned them into a different scan or into null.
      const a = getQueryParam("a");
      const b = getQueryParam("b");
      setSelectedA(a);
      setSelectedB(b);
      if (a !== null && b !== null) {
        runCompare(a, b);
      } else {
        setDiffResult(null);
      }
    };
    syncFromUrl();
    // Also catch Next.js soft navigations (clicking the Compare nav link while
    // a diff is open clears ?a/?b without firing popstate or remounting).
    window.addEventListener(LOCATION_CHANGE_EVENT, syncFromUrl);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener(LOCATION_CHANGE_EVENT, syncFromUrl);
      window.removeEventListener("popstate", syncFromUrl);
    };
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
    if (match) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time backfill, gated by the `selectedHost !== null` early-return above so it can't cascade once set
      setSelectedHost(getDomain(match.url));
    }
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

  // Arriving from a scan's actions menu as /compare?host=example.com.
  // Reaching a diff of the host you were just looking at used to be six
  // interactions (back to the findings list, back to History, Compare in the
  // nav, find the host in the picker, pick two scans, press Compare) with
  // nothing preselected. Writing ?a and ?b here is enough to run it: the
  // syncFromUrl effect above is subscribed to LOCATION_CHANGE_EVENT, which
  // setQueryParams' pushState fires, so the diff starts from that one write
  // rather than from a second runCompare call racing it.
  const hostParamHandledRef = useRef(false);
  useEffect(() => {
    if (hostParamHandledRef.current) return;
    if (loadingScans) return;
    const host = getQueryParam("host");
    if (!host) return;
    hostParamHandledRef.current = true;
    const group = hostGroups.find((g) => g.host === host);
    if (group && group.scans.length >= 2) {
      // Sorted rather than trusting the API's order, the same way
      // handleSelectHost below does: a diff reads left to right as older then
      // newer, so the older of the two most recent goes in slot A.
      const recent = [...group.scans]
        .sort(
          (x, y) =>
            new Date(y.scanned_at).getTime() - new Date(x.scanned_at).getTime(),
        )
        .slice(0, 2);
      const [newer, older] = recent;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot deep-link resolution, gated by hostParamHandledRef so it cannot cascade
      setSelectedHost(host);
      setQueryParams({ a: String(older.id), b: String(newer.id), host: null });
    } else {
      // Fewer than two scans of this host on the account, so there is nothing
      // to diff. Filter the picker to it rather than dropping the user on the
      // full list with no explanation for why they are there.
      setSearchQuery(host);
      removeQueryParam("host", { replace: true });
    }
  }, [loadingScans, hostGroups]);

  const filteredHostGroups = hostGroups.filter((g) =>
    g.host.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const selectedGroup = selectedHost
    ? (hostGroups.find((g) => g.host === selectedHost) ?? null)
    : null;

  function handleSelectHost(host: string) {
    setSelectedHost(host);
    setDiffResult(null);
    setCompareError(null);
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
      // One atomic write, same reason as toggleHostScan.
      setQueryParams({ a: older.id, b: newer.id });
      runCompare(older.id, newer.id);
    } else {
      setSelectedA(null);
      setSelectedB(null);
      setQueryParams({ a: null, b: null });
    }
  }

  function handleChangeHost() {
    setSelectedHost(null);
    setSelectedA(null);
    setSelectedB(null);
    setCompareError(null);
    setQueryParams({ a: null, b: null });
  }

  /**
   * Every branch writes BOTH slots in one setQueryParams call, deliberately.
   * url-state patches history.pushState/replaceState to emit
   * LOCATION_CHANGE_EVENT, and the effect below subscribes to it and rebuilds
   * both selections from the URL. Writing one param at a time re-entered that
   * handler while the URL still held the old value for the other slot, so
   * picking a second scan set ?a and the handler immediately cleared b: the
   * second slot could never be filled and a comparison was impossible to
   * assemble. One atomic write means the handler only ever sees a consistent
   * pair.
   */
  function toggleHostScan(id: string) {
    if (selectedA === id) {
      setSelectedA(null);
      setQueryParams({ a: null, b: selectedB });
      return;
    }
    if (selectedB === id) {
      setSelectedB(null);
      setQueryParams({ a: selectedA, b: null });
      return;
    }
    if (selectedA === null) {
      setSelectedA(id);
      setQueryParams({ a: id, b: selectedB });
      return;
    }
    if (selectedB === null) {
      setSelectedB(id);
      setQueryParams({ a: selectedA, b: id });
      return;
    }
    // Both slots already taken: swap out the first pick and keep the second,
    // so picking a third scan replaces rather than requiring a deselect first.
    setSelectedA(selectedB);
    setSelectedB(id);
    setQueryParams({ a: selectedB, b: id });
  }

  function handleReset() {
    setDiffResult(null);
    setCompareError(null);
    setSelectedHost(null);
    setSelectedA(null);
    setSelectedB(null);
    clearQueryParams();
  }

  return (
    <AppPageShell padding="py-8 sm:py-10" className="flex flex-col gap-8">
      <header className="max-w-2xl">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
          Compare
        </h1>
        <p className="text-muted-foreground mt-2 leading-relaxed">
          Diff two scans of the same host. Because finding IDs do not change
          between runs, the difference is real: what appeared, what you closed,
          and what has been sitting there the whole time.
        </p>
      </header>

      {compareError && <InlineAlert tone="error">{compareError}</InlineAlert>}

      {!diffResult && !selectedHost && (
        <div {...tourAnchor("compareHosts")} className="flex flex-col gap-6">
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
            loadFailed={scansFailed}
            searchActive={searchQuery.trim().length > 0}
            onSelect={handleSelectHost}
          />
        </div>
      )}

      {!diffResult && selectedHost && selectedGroup && (
        <div {...tourAnchor("comparePicker")} className="flex flex-col gap-6">
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
            {/* break-all: a hostname is one unbroken token, so a long one
                  (a deep subdomain on a long registrable domain) set this
                  block's min width and pushed the page sideways on a phone. */}
            <h2 className="font-mono text-sm font-medium break-all">
              {selectedHost}
            </h2>
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
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
              )}
              Compare
            </Button>
          </div>
        </div>
      )}

      {diffResult && (
        <div {...tourAnchor("compareDiff")} className="flex flex-col gap-6">
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
    </AppPageShell>
  );
}
