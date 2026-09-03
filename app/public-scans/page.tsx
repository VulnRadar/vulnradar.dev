"use client";

import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { hasCachedSignIn } from "@/components/shared/auth-cache-client";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControl } from "@/components/ui/pagination-control";
import { HistoryViewTabs } from "@/components/history";
import { useAuth } from "@/components/providers/auth-provider";
import {
  PublicScansTable,
  PublicScansEmptyState,
} from "@/components/public-scans";
import type { PublicScan } from "@/components/public-scans/public-scans-types";
import { API } from "@/lib/config/client-constants";
import {
  getQueryParamInt,
  QUERY_CHANGE_EVENT,
  setQueryParam,
  useQuerySeededState,
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
  const { me, isLoading: authLoading } = useAuth();
  const isLoggedIn = !!me?.userId;
  const [scans, setScans] = useState<PublicScan[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useQuerySeededState(
    () => getQueryParamInt("page") ?? 1,
    1,
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
        const pages = data.totalPages || 1;
        setTotalPages(pages);
        // A stale/deep-linked ?page= past the last page returns no rows and the
        // pagination control (rendered only when scans exist) disappears,
        // stranding the user. Clamp back to the last valid page.
        if (currentPage > pages) handlePageChange(pages);
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
  }, [setCurrentPage]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const showAppNav = mounted && (authLoading ? hasCachedSignIn() : isLoggedIn);

  // This page is the fourth tab of the app's History strip (My History,
  // Assets, Attack Surface, Public Scans) and the only one a guest can reach.
  // Sending a signed-in reader here through the public nav meant the top bar
  // changed identity on one tab out of four, which is the same complaint that
  // took the auth swap out of PublicPageShell, pointing the other way. So this
  // single page picks its shell instead: app chrome for a reader who is inside
  // the app, public chrome for the visitor the page exists to serve.
  //
  // Resolved after mount, never in a useState initializer. The initializer is
  // what previously made the client's first render disagree with the server
  // HTML for anyone holding a session, and hydration then discarded it. First
  // paint therefore matches the server, and the cached hint only stands in for
  // the brief window before /auth/me answers.
  const body = (
    <div className="flex flex-col gap-5">
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

      {/* Under the title, matching /assets and /attack-surface. Two of the
          four tabs in this strip used to render it above the h1, which puts
          nav chrome ahead of the thing that names the page, and made the same
          strip sit at two different heights depending on which tab you were on.

          This is the one page in the set an anonymous visitor can reach, and
          the other three all bounce a guest to /login. Three of four tabs
          being traps for exactly the audience the page exists to serve is
          worse than no tab strip, so a signed-out visitor does not get one. */}
      {isLoggedIn && <HistoryViewTabs />}

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
  );

  return showAppNav ? (
    <AppPageShell maxWidth="max-w-6xl" padding="py-6 sm:py-8">
      {body}
    </AppPageShell>
  ) : (
    <PublicPageShell
      badge="Public Scans"
      maxWidth="max-w-6xl"
      padding="py-6 sm:py-8"
    >
      {body}
    </PublicPageShell>
  );
}
