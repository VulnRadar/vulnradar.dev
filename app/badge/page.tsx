"use client";

import { useState, useEffect, useRef } from "react";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { API } from "@/lib/config/constants";
import {
  BadgeScanList,
  BadgePreview,
  BadgeEmptyState,
  type ScanEntry,
} from "@/components/badge";
import { BadgeSkeleton } from "@/components/badge/badge-skeleton";

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
        setScans(Array.isArray(data) ? data : []);
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

  if (loading) {
    return <BadgeSkeleton />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <header className="mb-8 max-w-xl">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Badge
          </h1>
          <p className="text-muted-foreground mt-2 leading-relaxed">
            Pick a scan and get an image that links back to the full report. The
            badge is tied to that URL, not that one scan: every time you scan it
            again, the badge updates on its own. Paste the embed code once and
            forget it.
          </p>
        </header>

        {scans.length === 0 ? (
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
            />
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
