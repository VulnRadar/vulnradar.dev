"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  GitCompareArrows,
  Plus,
  Minus,
  Equal,
  Loader2,
  ArrowRight,
  Globe,
  AlertTriangle,
  CheckCircle,
} from "lucide-react"

interface ScanOption {
  id: number
  url: string
  findings_count: number
  scanned_at: string
  source?: string
}

interface DiffResult {
  scanA: ScanOption & { summary: Record<string, number> }
  scanB: ScanOption & { summary: Record<string, number> }
  diff: {
    added: { title: string; severity: string }[]
    removed: { title: string; severity: string }[]
    unchanged: { title: string; severity: string }[]
    summary: { added: number; removed: number; unchanged: number }
  }
}

const severityColors: Record<string, string> = {
  critical: "bg-[hsl(var(--severity-critical))]",
  high: "bg-[hsl(var(--severity-high))]",
  medium: "bg-[hsl(var(--severity-medium))]",
  low: "bg-[hsl(var(--severity-low))]",
  info: "bg-muted-foreground/50",
}

export default function ComparePage() {
  const router = useRouter()
  const [scans, setScans] = useState<ScanOption[]>([])
  const [selectedA, setSelectedA] = useState<number | null>(null)
  const [selectedB, setSelectedB] = useState<number | null>(null)
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingScans, setLoadingScans] = useState(true)

  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : Array.isArray(d?.scans) ? d.scans : []
        setScans(list)
        setLoadingScans(false)
      })
      .catch(() => setLoadingScans(false))
  }, [])

  const handleCompare = useCallback(async () => {
    if (!selectedA || !selectedB) return
    setLoading(true)
    setDiffResult(null)
    try {
      const res = await fetch(`/api/compare?a=${selectedA}&b=${selectedB}`)
      const data = await res.json()
      if (res.ok) setDiffResult(data)
    } catch { /* ignore */ }
    setLoading(false)
  }, [selectedA, selectedB])

  function displayUrl(url: string) {
    try {
      const u = new URL(url)
      const path = u.pathname === "/" ? "" : u.pathname + u.search
      return u.hostname + path
    } catch {
      return url
    }
  }

  function getDomain(url: string) {
    try { return new URL(url).hostname } catch { return url }
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
              <GitCompareArrows className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Compare Scans</h1>
              <p className="text-sm text-muted-foreground">Select two scans to see what changed between them</p>
            </div>
          </div>

          {/* Scan selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Scan A */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold text-muted-foreground">Older Scan (Before)</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {loadingScans ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                    {scans.map((scan) => (
                      <button
                        key={scan.id}
                        onClick={() => { setSelectedA(scan.id); if (selectedB && getDomain(scan.url) !== getDomain(scans.find(s => s.id === selectedB)?.url || "")) setSelectedB(null) }}
                        disabled={scan.id === selectedB}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors",
                          selectedA === scan.id
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : scan.id === selectedB
                              ? "opacity-30 cursor-not-allowed"
                              : "hover:bg-muted text-foreground",
                        )}
                      >
                        <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate flex-1">{displayUrl(scan.url)}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(scan.scanned_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </button>
                    ))}
                    {scans.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No scans yet</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Scan B: filtered to same domain as A */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold text-muted-foreground">
                  Newer Scan (After)
                  {selectedA && (
                    <span className="font-normal text-xs text-muted-foreground/60 ml-1.5">
                      (showing {getDomain(scans.find(s => s.id === selectedA)?.url || "")} only)
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {loadingScans ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                    {(() => {
                      const selectedADomain = selectedA ? getDomain(scans.find(s => s.id === selectedA)?.url || "") : null
                      const filteredScans = selectedADomain
                        ? scans.filter(s => getDomain(s.url) === selectedADomain)
                        : scans
                      return filteredScans.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          {selectedA ? "No other scans for this domain" : "Select a scan on the left first"}
                        </p>
                      ) : filteredScans.map((scan) => (
                        <button
                          key={scan.id}
                          onClick={() => setSelectedB(scan.id)}
                          disabled={scan.id === selectedA}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors",
                            selectedB === scan.id
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : scan.id === selectedA
                                ? "opacity-30 cursor-not-allowed"
                                : "hover:bg-muted text-foreground",
                          )}
                        >
                          <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate flex-1">{displayUrl(scan.url)}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {new Date(scan.scanned_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        </button>
                      ))
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Compare button */}
          <div className="flex justify-center">
            <Button
              onClick={handleCompare}
              disabled={!selectedA || !selectedB || loading}
              className="gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
              Compare Scans
            </Button>
          </div>

          {/* Diff results */}
          {diffResult && (
            <div className="flex flex-col gap-4">
              {/* Overview */}
              <Card className="bg-card border-border">
                <CardContent className="pt-4 pb-4 px-4">
                  <div className="flex flex-col sm:flex-row items-center gap-4 justify-center">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Before</p>
                      <p className="text-sm font-medium text-foreground truncate max-w-[200px]">{displayUrl(diffResult.scanA.url)}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(diffResult.scanA.scanned_at)}</p>
                      <p className="text-lg font-bold text-foreground">{diffResult.scanA.findings_count} issues</p>
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground hidden sm:block" />
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">After</p>
                      <p className="text-sm font-medium text-foreground truncate max-w-[200px]">{displayUrl(diffResult.scanB.url)}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(diffResult.scanB.scanned_at)}</p>
                      <p className="text-lg font-bold text-foreground">{diffResult.scanB.findings_count} issues</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Diff summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <Card className="bg-card border-border">
                  <CardContent className="pt-4 pb-4 px-4 flex flex-col items-center gap-1">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-destructive/10">
                      <Plus className="h-4 w-4 text-destructive" />
                    </div>
                    <span className="text-2xl font-bold text-destructive">{diffResult.diff.summary.added}</span>
                    <span className="text-xs text-muted-foreground">New Issues</span>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="pt-4 pb-4 px-4 flex flex-col items-center gap-1">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10">
                      <Minus className="h-4 w-4 text-emerald-500" />
                    </div>
                    <span className="text-2xl font-bold text-emerald-500">{diffResult.diff.summary.removed}</span>
                    <span className="text-xs text-muted-foreground">Fixed</span>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="pt-4 pb-4 px-4 flex flex-col items-center gap-1">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
                      <Equal className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <span className="text-2xl font-bold text-foreground">{diffResult.diff.summary.unchanged}</span>
                    <span className="text-xs text-muted-foreground">Unchanged</span>
                  </CardContent>
                </Card>
              </div>

              {/* Detailed lists */}
              {diffResult.diff.added.length > 0 && (
                <Card className="bg-card border-border border-l-4 border-l-destructive">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      New Issues ({diffResult.diff.added.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 flex flex-col gap-1.5">
                    {diffResult.diff.added.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className={cn("w-2 h-2 rounded-full shrink-0", severityColors[f.severity])} />
                        <span className="text-foreground">{f.title}</span>
                        <span className="text-xs text-muted-foreground uppercase">{f.severity}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {diffResult.diff.removed.length > 0 && (
                <Card className="bg-card border-border border-l-4 border-l-emerald-500">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-emerald-500">
                      <CheckCircle className="h-4 w-4" />
                      Fixed Issues ({diffResult.diff.removed.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 flex flex-col gap-1.5">
                    {diffResult.diff.removed.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className={cn("w-2 h-2 rounded-full shrink-0", severityColors[f.severity])} />
                        <span className="text-foreground line-through opacity-60">{f.title}</span>
                        <span className="text-xs text-muted-foreground uppercase">{f.severity}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {diffResult.diff.unchanged.length > 0 && (
                <Card className="bg-card border-border">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
                      <Equal className="h-4 w-4" />
                      Unchanged ({diffResult.diff.unchanged.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 flex flex-col gap-1.5">
                    {diffResult.diff.unchanged.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className={cn("w-2 h-2 rounded-full shrink-0", severityColors[f.severity])} />
                        <span className="text-muted-foreground">{f.title}</span>
                        <span className="text-xs text-muted-foreground/50 uppercase">{f.severity}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
