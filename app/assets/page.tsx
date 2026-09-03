"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PaginationControl,
  usePagination,
} from "@/components/ui/pagination-control";
import { API } from "@/lib/config/client-constants";
import {
  getQueryParam,
  getQueryParamInt,
  QUERY_CHANGE_EVENT,
  setQueryParam,
  useQuerySeededState,
} from "@/lib/ui/url-state";
import { cn } from "@/lib/ui/utils";
import { toggles } from "@/lib/ui/animations";
import {
  AssetsStats,
  AssetsTable,
  AssetsEmptyState,
  AssetsDataSkeleton,
  type AssetRow,
} from "@/components/assets";
import { HistoryViewTabs } from "@/components/history";
import { AppPageShell } from "@/components/shared/app-page-shell";

export default function AssetsPage() {
  const router = useRouter();

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load used to fall straight through to AssetsEmptyState, which
  // says "No assets yet" and offers "Scan your first host". For an account
  // with a hundred hosts on file, a 500 told them they had none. /shares and
  // /history both grew this listError panel for exactly this reason and
  // /assets never did.
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // "mine" = the caller's own scanned hosts (default); "all" = every public
  // host on file (host_reputation, public-scan-only). Synced to ?scope=.
  const [scope, setScope] = useQuerySeededState<"mine" | "all">(
    () => (getQueryParam("scope") === "all" ? "all" : "mine"),
    "mine",
  );
  const [currentPage, setCurrentPage] = useQuerySeededState(
    () => getQueryParamInt("page") ?? 1,
    1,
  );
  const [pageSize, setPageSize] = useState(10);

  // page=1 is the implicit default, so it's left out of the URL entirely
  // rather than ever showing up as ?page=1. Mirrors app/history/page.tsx.
  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);
      setQueryParam("page", page > 1 ? String(page) : null, { replace: true });
    },
    [setCurrentPage],
  );

  // Keeps currentPage in sync with browser back/forward on ?page=.
  useEffect(() => {
    const syncPageFromUrl = () => setCurrentPage(getQueryParamInt("page") ?? 1);
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (detail.key === "page") syncPageFromUrl();
    };
    window.addEventListener(QUERY_CHANGE_EVENT, onChange);
    window.addEventListener("popstate", syncPageFromUrl);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onChange);
      window.removeEventListener("popstate", syncPageFromUrl);
    };
  }, [setCurrentPage]);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        scope === "all" ? `${API.ASSETS}?scope=all` : API.ASSETS,
      );
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.push("/login");
          return;
        }
        setListError("Couldn't load your hosts.");
        return;
      }
      const data = await res.json();
      setListError(null);
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch {
      // Was setAssets([]), which turned a dropped connection into a positive
      // claim that this account has never scanned anything.
      setListError("Couldn't reach the server to load your hosts.");
    } finally {
      setLoading(false);
    }
  }, [router, scope]);

  const changeScope = useCallback(
    (next: "mine" | "all") => {
      // The setLoading/setAssets/setQueryParam calls used to live inside the
      // setScope updater. React may run an updater twice under StrictMode, so
      // the history.replaceState fired twice; app/shares/page.tsx documents
      // avoiding this same pattern. An updater must be pure.
      if (scope === next) return;
      setScope(next);
      setLoading(true);
      setAssets([]);
      setListError(null);
      setQueryParam("scope", next === "all" ? "all" : null, { replace: true });
    },
    [scope],
  );

  useEffect(() => {
    // Only fetch once `scope` agrees with the URL. On a /assets?scope=all
    // load the first pass still holds the SSR-safe "mine" default that
    // useQuerySeededState renders to match the server, and fetching there
    // would request the wrong list and then immediately request the right one.
    // changeScope writes the state and the param in the same handler, so this
    // never blocks a deliberate switch.
    const urlScope = getQueryParam("scope") === "all" ? "all" : "mine";
    if (urlScope !== scope) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchAssets();
  }, [fetchAssets, scope]);

  const filtered = assets.filter(
    (a) =>
      !filter.trim() ||
      a.host.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  // Skip the very first run: it fires on mount too, and resetting there
  // would immediately wipe out a deep-linked ?page=N before it ever
  // renders. Mirrors app/history/page.tsx's identical guard.
  const isFirstFilterRun = useRef(true);
  useEffect(() => {
    if (isFirstFilterRun.current) {
      isFirstFilterRun.current = false;
      return;
    }
    handlePageChange(1);
  }, [filter, handlePageChange]);

  const { totalPages, getPage } = usePagination(filtered, pageSize);
  const paginatedAssets = getPage(currentPage);

  // Clamp a stale/deep-linked page that now sits past the last page (e.g. a
  // filter shrank the list), which otherwise renders a reversed "41-15 of 15"
  // range and an empty table.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot clamp: currentPage <= totalPages after this fires, so it can't re-trigger
    if (currentPage > totalPages) handlePageChange(totalPages);
  }, [currentPage, totalPages, handlePageChange]);

  return (
    <AppPageShell className="flex flex-col gap-5">
      {/* Title first, view switcher under it. The tabs used to render above
            the H1, which put nav chrome ahead of the thing that names the
            page. */}
      <div aria-label="Assets" className="pb-1">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
          {scope === "all" ? "All public hosts" : "Assets"}
        </h1>
        {/* Both counts are over a capped window, not a lifetime total: the
              API reads at most HISTORY_LIST_MAX_ROWS scan rows (or ALL_HOSTS_MAX
              reputation rows) and then groups those into hosts, so it cannot
              know the account-wide figure. The old copy said "N distinct hosts
              you've scanned", which reads as that figure. /history had the same
              defect and says "showing the N most recent"; this says what the
              number actually counts instead. */}
        <p className="mt-1 text-sm text-muted-foreground">
          {/* The count is only true once the fetch lands. Printing it while
              loading opened the page by telling an account with hosts on file
              that it has none, then correcting itself a moment later. Saying
              what is about to be counted is honest at both moments. */}
          {loading
            ? scope === "all"
              ? "Reading every public host on file..."
              : "Reading the hosts across your recent scans..."
            : listError
              ? "We couldn't read this list just now."
              : scope === "all"
                ? `The ${assets.length} most recently scanned ${assets.length === 1 ? "host" : "hosts"} with a public scan on file.`
                : `${assets.length} distinct ${assets.length === 1 ? "host" : "hosts"} across your recent scans, most recently scanned first.`}
        </p>
      </div>

      <HistoryViewTabs />

      {/* Scope toggle: your own scans vs every public host on file. The
            "all" view reads only public scan data (host_reputation).

            Deliberately a group of toggle buttons rather than a tablist:
            role="tab" promises a matching role="tabpanel" with
            aria-controls and arrow-key navigation between the tabs, and
            this control has none of that, so a screen reader announced
            "tab, 1 of 2" and then found nothing the tab governed.
            aria-pressed describes what these buttons actually are.

            Drawn on the shared segmented-control metrics (TabsList: h-10
            container, rounded-md, p-1) instead of the one-off p-0.5 box with
            off-ladder `rounded` children it used to have, so it sits at the
            same height and rung as the search field below it. */}
      <div
        role="group"
        aria-label="Asset scope"
        className="inline-flex h-10 w-fit items-center rounded-md border border-border bg-card p-1"
      >
        {(
          [
            { key: "mine", label: "My scans" },
            { key: "all", label: "All public hosts" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            aria-pressed={scope === opt.key}
            onClick={() => changeScope(opt.key)}
            className={cn(
              "h-8 rounded-md px-3 text-sm font-medium",
              toggles.control,
              scope === opt.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {!loading && !listError && <AssetsStats assets={assets} />}

      {!loading && !listError && assets.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by host..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter assets by host"
            className="pl-9 bg-card/50 h-10"
          />
        </div>
      )}

      {/* The failure panel REPLACES the empty state rather than sitting above
            it: "we could not check" and "you have nothing" are different
            claims, and only one of them is true here. Same shape and copy
            structure as the one on /shares. */}
      {/* A scope switch refetches. The rows on screen belong to the scope
            you just left, so they are replaced by a busy panel rather than
            left up under the new heading. It is the size of a short table so
            the page does not collapse and rebound. */}
      {/* A scope switch refetches, and the rows on screen belong to the
            scope you just left, so they are replaced rather than left up under
            the new heading. The list shape, not a spinner: it reserves the
            height the table is about to take. */}
      {loading ? (
        <AssetsDataSkeleton />
      ) : listError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-destructive/30 bg-destructive/5 px-4 py-14 text-center">
          <AlertTriangle
            className="h-6 w-6 text-destructive/70"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-foreground">{listError}</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Your scans are unaffected. This page just could not read the list of
            hosts.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="bg-transparent"
            onClick={fetchAssets}
          >
            Retry
          </Button>
        </div>
      ) : (
        <AssetsEmptyState
          hasAssets={assets.length > 0}
          hasFilter={Boolean(filter)}
          onClearFilter={() => setFilter("")}
        />
      )}

      {!loading && !listError && paginatedAssets.length > 0 && (
        <AssetsTable assets={paginatedAssets} />
      )}

      {!loading && !listError && filtered.length > 0 && (
        <PaginationControl
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          pageSize={pageSize}
          onPageSizeChange={(s) => {
            setPageSize(s);
            handlePageChange(1);
          }}
          totalItems={filtered.length}
        />
      )}
    </AppPageShell>
  );
}
