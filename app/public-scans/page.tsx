"use client";

import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControl } from "@/components/ui/pagination-control";
import { HistoryViewTabs } from "@/components/history";
import {
  PublicScansTable,
  PublicScansEmptyState,
} from "@/components/public-scans";
import type { PublicScan } from "@/components/public-scans/public-scans-types";
import { API } from "@/lib/config/constants";
import {
  getQueryParamInt,
  QUERY_CHANGE_EVENT,
  setQueryParam,
} from "@/lib/ui/url-state";

const PAGE_SIZE = 20;

function PublicScansTableSkeleton() {
  return (
    <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3.5 pl-4 pr-4">
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="hidden sm:block h-4 w-20" />
          <Skeleton className="hidden sm:block h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export default function PublicScansPage() {
  const [scans, setScans] = useState<PublicScan[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(
    () => getQueryParamInt("page") ?? 1,
  );

  function handlePageChange(page: number) {
    setCurrentPage(page);
    setQueryParam("page", page > 1 ? String(page) : null, { replace: true });
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API.PUBLIC_SCANS}?page=${currentPage}&limit=${PAGE_SIZE}`,
        );
        if (!res.ok) {
          if (!cancelled)
            setError("Could not load the Public Scans directory.");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setScans(data.scans || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      } catch {
        if (!cancelled) setError("Could not load the Public Scans directory.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [currentPage]);

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

  return (
    <PublicPageShell
      badge="Public Scans"
      maxWidth="max-w-6xl"
      padding="py-6 sm:py-8"
    >
      <div className="flex flex-col gap-5">
        <HistoryViewTabs />

        <div className="flex flex-wrap items-end justify-between gap-3 pb-2 pt-2 sm:pt-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Public Scans
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Every scan someone chose to list here, most recent first. Each one
              links to the full read-only report. Sharing a scan lists it by
              default, unless you or your account settings say otherwise.
            </p>
          </div>
          {!loading && total > 0 && (
            <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {total} listed
            </p>
          )}
        </div>

        {loading && <PublicScansTableSkeleton />}

        {!loading && error && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <CircleAlert aria-hidden className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {!loading && !error && scans.length === 0 && <PublicScansEmptyState />}

        {!loading && !error && scans.length > 0 && (
          <>
            <PublicScansTable scans={scans} />
            <PaginationControl
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </div>
    </PublicPageShell>
  );
}
