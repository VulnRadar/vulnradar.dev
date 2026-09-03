"use client";

import { useState, useEffect, useRef } from "react";
// AppPageShell, the signed-in app chrome, not PublicPageShell. /badge was in
// PUBLIC_PATHS and briefly rendered the public marketing nav to match; it is a
// builder over the caller's own scan history, so it is signed-in only now (see
// lib/config/public-paths.ts) and gets the app header the rest of the account
// surface uses. The shell now stays mounted while the scans load, so the
// loading state and the loaded page cannot disagree about the top bar.
import { AppPageShell } from "@/components/shared/app-page-shell";
import { API } from "@/lib/config/client-constants";
import {
  BadgeScanList,
  BadgePreview,
  BadgeEmptyState,
  BadgeDataSkeleton,
  type ScanEntry,
} from "@/components/badge";

export default function BadgePage() {
  const [scans, setScans] = useState<ScanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ScanEntry | null>(null);
  const [generating, setGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Tracks the most recently requested scan id so a slow /share response for
  // a scan the user has since clicked away from can't clobber the current
  // selection (out-of-order network responses).
  const selectionRef = useRef<number | null>(null);

  useEffect(() => {
    const fetchBadgeScans = async () => {
      try {
        const res = await fetch(API.BADGE_SCANS);
        if (!res.ok) {
          setScans([]);
          setLoading(false);
          return;
        }
        const data = await res.json();
        // The route returns { scans }. The bare-array form is still accepted
        // so a cached client or a self-hoster mid-upgrade keeps working.
        setScans(
          Array.isArray(data)
            ? data
            : Array.isArray(data?.scans)
              ? data.scans
              : [],
        );
      } catch {
        setScans([]);
      } finally {
        setLoading(false);
      }
    };
    fetchBadgeScans();
  }, []);

  async function handleSelect(scan: ScanEntry) {
    if (scan.site_badge_token) {
      selectionRef.current = scan.id;
      setSelected(scan);
      return;
    }

    selectionRef.current = scan.id;
    setGenerating(true);
    setSelected(scan);
    try {
      const res = await fetch(API.BADGE_SITE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scanId: scan.id }),
      });
      const data = await res.json();
      // Ignore this response if the user has since selected a different
      // scan: applying it now would overwrite the newer selection with
      // stale data from a request that was superseded before it resolved.
      if (selectionRef.current !== scan.id) return;
      if (res.ok && data.token) {
        const updated = { ...scan, site_badge_token: data.token };
        setSelected(updated);
        setScans((prev) => prev.map((s) => (s.id === scan.id ? updated : s)));
      }
    } catch {
      // keep selected but no token
    } finally {
      if (selectionRef.current === scan.id) setGenerating(false);
    }
  }

  function handleScopeChange(scope: "user" | "global") {
    setSelected((prev) => (prev ? { ...prev, site_badge_scope: scope } : prev));
    setScans((prev) =>
      prev.map((s) =>
        s.id === selected?.id ? { ...s, site_badge_scope: scope } : s,
      ),
    );
  }

  return (
    <AppPageShell maxWidth="max-w-5xl" padding="py-8 sm:py-10">
      {/* Static, so it prints on the first frame rather than as grey bars:
          the fetch below decides what goes under this header, not whether
          the page has one. */}
      <header className="mb-8 max-w-xl">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
          Badge
        </h1>
        <p className="text-muted-foreground mt-2 leading-relaxed">
          Pick a scan and get an image that links back to the full report. The
          badge is tied to that URL, not that one scan: every time you scan it
          again, the badge updates on its own. Paste the embed code once and
          forget it.
        </p>
      </header>

      {loading ? (
        <BadgeDataSkeleton />
      ) : scans.length === 0 ? (
        <BadgeEmptyState />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
          <BadgeScanList
            scans={scans}
            selected={selected}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelect={handleSelect}
          />
          <BadgePreview
            selected={selected}
            token={selected?.site_badge_token ?? null}
            generating={generating}
            onScopeChange={handleScopeChange}
          />
        </div>
      )}
    </AppPageShell>
  );
}
