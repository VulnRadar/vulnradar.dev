"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { Loader2 } from "lucide-react";
import { API } from "@/lib/config/constants";
import {
  BadgeScanList,
  BadgePreview,
  BadgeEmptyState,
  type ScanEntry,
} from "@/components/badge";

export default function BadgePage() {
  const [scans, setScans] = useState<ScanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ScanEntry | null>(null);
  const [generating, setGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
    if (scan.share_token) {
      setSelected(scan);
      return;
    }

    setGenerating(true);
    setSelected(scan);
    try {
      const res = await fetch(`${API.HISTORY}/${scan.id}/share`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.token) {
        const updated = { ...scan, share_token: data.token };
        setSelected(updated);
        setScans((prev) => prev.map((s) => (s.id === scan.id ? updated : s)));
      }
    } catch {
      // keep selected but no token
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="mb-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Security Badge
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Generate embeddable badges to showcase your security status on
              your website.
            </p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading scans...</p>
            </div>
          ) : scans.length === 0 ? (
            <BadgeEmptyState />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <BadgeScanList
                scans={scans}
                selected={selected}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onSelect={handleSelect}
              />
              <BadgePreview
                selected={selected}
                token={selected?.share_token ?? null}
                generating={generating}
              />
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
