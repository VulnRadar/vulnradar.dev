"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GitCompareArrows,
  Loader2,
  Search,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { API } from "@/lib/config/constants";
import {
  CompareScanPicker,
  CompareHeader,
  CompareSummaryStats,
  CompareFindingsList,
  type ScanOption,
  type DiffResult,
  getDomain,
  displayUrl,
} from "@/components/compare";

export default function ComparePage() {
  const [scans, setScans] = useState<ScanOption[]>([]);
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

  const handleCompare = useCallback(async () => {
    if (!selectedA || !selectedB) return;
    setLoading(true);
    setDiffResult(null);
    try {
      const res = await fetch(`${API.COMPARE}?a=${selectedA}&b=${selectedB}`);
      const data = await res.json();
      if (res.ok) setDiffResult(data);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [selectedA, selectedB]);

  const filteredScans = scans.filter((s) =>
    displayUrl(s.url).toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const selectedADomain = selectedA
    ? getDomain(scans.find((s) => s.id === selectedA)?.url || "")
    : null;
  const filteredScansB = selectedADomain
    ? filteredScans.filter(
        (s) => getDomain(s.url) === selectedADomain && s.id !== selectedA,
      )
    : [];

  function handleReset() {
    setDiffResult(null);
    setSelectedA(null);
    setSelectedB(null);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-8">
          {/* Page title */}
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Compare Scans
            </h1>
            <p className="text-sm text-muted-foreground">
              Track security changes between scan results
            </p>
          </div>

          {/* Selection UI */}
          {!diffResult && (
            <div className="flex flex-col gap-6">
              {/* Search */}
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by URL..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-card/50 border-border/50"
                />
              </div>

              {/* Scan pickers */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr,auto,1fr] gap-4 items-start">
                <CompareScanPicker
                  title="Select base scan"
                  step={1}
                  hint="older"
                  scans={filteredScans}
                  selected={selectedA}
                  loading={loadingScans}
                  onSelect={(id) => {
                    setSelectedA(id);
                    setSelectedB(null);
                    setDiffResult(null);
                  }}
                />

                <div className="hidden lg:flex items-center justify-center pt-12">
                  <div className="flex items-center justify-center w-9 h-9 rounded-full bg-muted">
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                <CompareScanPicker
                  title="Select scan to compare"
                  step={2}
                  hint="newer"
                  scans={filteredScansB}
                  selected={selectedB}
                  loading={false}
                  locked={!selectedA}
                  lockedMessage="Select a base scan first"
                  onSelect={setSelectedB}
                />
              </div>

              {/* Compare button */}
              <div className="flex justify-center pt-2">
                <Button
                  onClick={handleCompare}
                  disabled={!selectedA || !selectedB || loading}
                  size="lg"
                  className="gap-2 min-w-[200px]"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <GitCompareArrows className="h-4 w-4" />
                  )}
                  Compare Scans
                </Button>
              </div>
            </div>
          )}

          {/* Results */}
          {diffResult && (
            <div className="flex flex-col gap-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="self-start -ml-2 text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4 rotate-180 mr-1" />
                Back to selection
              </Button>

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
      </main>
      <Footer />
    </div>
  );
}
