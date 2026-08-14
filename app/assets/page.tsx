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
  getQueryParamInt,
  QUERY_CHANGE_EVENT,
  setQueryParam,
} from "@/lib/ui/url-state";
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
      const res = await fetch(API.ASSETS);
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
  }, [router]);

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

  if (loading) {
    return <AssetsSkeleton />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5">
        <HistoryViewTabs />

        <div aria-label="Assets" className="mb-1 pb-2 pt-6 sm:pt-8">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
            Assets
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {assets.length} distinct {assets.length === 1 ? "host" : "hosts"}{" "}
            scanned, most recently scanned first.
          </p>
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
