"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { Input } from "@/components/ui/input";
import {
  PaginationControl,
  usePagination,
} from "@/components/ui/pagination-control";
import { API } from "@/lib/config/constants";
import {
  getQueryParam,
  getQueryParamInt,
  QUERY_CHANGE_EVENT,
  setQueryParam,
} from "@/lib/ui/url-state";
import { cn } from "@/lib/ui/utils";
import {
  AssetsStats,
  AssetsTable,
  AssetsEmptyState,
  AssetsSkeleton,
  type AssetRow,
} from "@/components/assets";
import { HistoryViewTabs } from "@/components/history";

export default function AssetsPage() {
  const router = useRouter();

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  // "mine" = the caller's own scanned hosts (default); "all" = every public
  // host on file (host_reputation, public-scan-only). Synced to ?scope=.
  const [scope, setScope] = useState<"mine" | "all">(() =>
    getQueryParam("scope") === "all" ? "all" : "mine",
  );
  const [currentPage, setCurrentPage] = useState(
    () => getQueryParamInt("page") ?? 1,
  );
  const [pageSize, setPageSize] = useState(10);

  // page=1 is the implicit default, so it's left out of the URL entirely
  // rather than ever showing up as ?page=1. Mirrors app/history/page.tsx.
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    setQueryParam("page", page > 1 ? String(page) : null, { replace: true });
  }, []);

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
  }, []);

  const fetchAssets = useCallback(async () => {
    try {
      const res = await fetch(
        scope === "all" ? `${API.ASSETS}?scope=all` : API.ASSETS,
      );
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) router.push("/login");
        return;
      }
      const data = await res.json();
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch {
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [router, scope]);

  const changeScope = useCallback((next: "mine" | "all") => {
    setScope((prev) => {
      if (prev === next) return prev;
      setLoading(true);
      setAssets([]);
      setQueryParam("scope", next === "all" ? "all" : null, {
        replace: true,
      });
      return next;
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchAssets();
  }, [fetchAssets]);

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

  if (loading) {
    return <AssetsSkeleton />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5"
      >
        <HistoryViewTabs />

        <div aria-label="Assets" className="mb-1 pb-2 pt-6 sm:pt-8">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
            {scope === "all" ? "All public hosts" : "Assets"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {scope === "all"
              ? `${assets.length} ${assets.length === 1 ? "host" : "hosts"} on file with a public scan, most recently scanned first.`
              : `${assets.length} distinct ${assets.length === 1 ? "host" : "hosts"} you've scanned, most recently scanned first.`}
          </p>

          {/* Scope toggle: your own scans vs every public host on file. The
              "all" view reads only public scan data (host_reputation). */}
          <div
            role="tablist"
            aria-label="Asset scope"
            className="mt-3 inline-flex rounded-md border border-border bg-card p-0.5"
          >
            {(
              [
                { key: "mine", label: "My scans" },
                { key: "all", label: "All public hosts" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                role="tab"
                aria-selected={scope === opt.key}
                onClick={() => changeScope(opt.key)}
                className={cn(
                  "rounded px-3 py-1 text-sm font-medium transition-colors",
                  scope === opt.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <AssetsStats assets={assets} />

        {assets.length > 0 && (
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

        <AssetsEmptyState
          hasAssets={assets.length > 0}
          hasFilter={Boolean(filter)}
          onClearFilter={() => setFilter("")}
        />

        {paginatedAssets.length > 0 && <AssetsTable assets={paginatedAssets} />}

        {filtered.length > 0 && (
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
      </main>

      <Footer />
    </div>
  );
}
