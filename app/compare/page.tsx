"use client"

import { useState, useEffect, useCallback } from "react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/ui/utils"
import {
  GitCompareArrows,
  Plus,
  Minus,
  Equal,
  Loader2,
  ArrowRight,
  Globe,
  AlertTriangle,
  CheckCircle2,
  Search,
  Calendar,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Shield,
  Clock,
  ExternalLink,
} from "lucide-react"
import { API } from "@/lib/config/constants"

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

const severityTextColors: Record<string, string> = {
  critical: "text-[hsl(var(--severity-critical))]",
  high: "text-[hsl(var(--severity-high))]",
  medium: "text-[hsl(var(--severity-medium))]",
  low: "text-[hsl(var(--severity-low))]",
  info: "text-muted-foreground",
}

export default function ComparePage() {
  const [scans, setScans] = useState<ScanOption[]>([])
  const [selectedA, setSelectedA] = useState<number | null>(null)
  const [selectedB, setSelectedB] = useState<number | null>(null)
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingScans, setLoadingScans] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    fetch(API.HISTORY)
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
      const res = await fetch(`${API.COMPARE}?a=${selectedA}&b=${selectedB}`)
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
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  function formatTime(d: string) {
    return new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  }

  function getRelativeTime(date: string) {
    const now = new Date()
    const then = new Date(date)
    const diffMs = now.getTime() - then.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return formatDate(date)
  }

  const filteredScans = scans.filter((s) => 
    displayUrl(s.url).toLowerCase().includes(searchQuery.toLowerCase())
  )

  const selectedADomain = selectedA ? getDomain(scans.find(s => s.id === selectedA)?.url || "") : null
  const filteredScansB = selectedADomain
    ? filteredScans.filter(s => getDomain(s.url) === selectedADomain && s.id !== selectedA)
    : []

  const scanA = scans.find(s => s.id === selectedA)
  const scanB = scans.find(s => s.id === selectedB)

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-8">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Compare Scans</h1>
            <p className="text-sm text-muted-foreground">Track security changes between scan results</p>
          </div>

          {/* Selection UI */}
          {!diffResult && (
            <div className="flex flex-col gap-6">
              {/* Search */}
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search scans by URL..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-card border-border"
                />
              </div>

              {/* Selection flow */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr,auto,1fr] gap-4 items-start">
                {/* Scan A - Base scan */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-semibold">1</span>
                    <span className="text-sm font-medium">Select base scan</span>
                    <span className="text-xs text-muted-foreground">(older)</span>
                  </div>
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    {loadingScans ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : filteredScans.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                        <Globe className="h-8 w-8 text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-muted-foreground">No scans found</p>
                      </div>
                    ) : (
                      <div className="flex flex-col max-h-[400px] overflow-y-auto">
                        {filteredScans.map((scan) => (
                          <button
                            key={scan.id}
                            onClick={() => { 
                              setSelectedA(scan.id)
                              setSelectedB(null)
                              setDiffResult(null)
                            }}
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border last:border-b-0",
                              selectedA === scan.id
                                ? "bg-primary/5 border-l-2 border-l-primary"
                                : "hover:bg-muted/50",
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{displayUrl(scan.url)}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-muted-foreground">{getRelativeTime(scan.scanned_at)}</span>
                                <span className="text-xs text-muted-foreground">·</span>
                                <span className={cn(
                                  "text-xs font-medium",
                                  scan.findings_count === 0 ? "text-emerald-500" : "text-foreground"
                                )}>
                                  {scan.findings_count} issues
                                </span>
                              </div>
                            </div>
                            {selectedA === scan.id && (
                              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Arrow */}
                <div className="hidden lg:flex items-center justify-center pt-12">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted">
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                {/* Scan B - Compare to */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-semibold">2</span>
                    <span className="text-sm font-medium">Select scan to compare</span>
                    <span className="text-xs text-muted-foreground">(newer)</span>
                  </div>
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    {!selectedA ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                        <ChevronRight className="h-8 w-8 text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-muted-foreground">Select a base scan first</p>
                      </div>
                    ) : filteredScansB.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                        <Globe className="h-8 w-8 text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-muted-foreground">No other scans for this domain</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">Run another scan to compare</p>
                      </div>
                    ) : (
                      <div className="flex flex-col max-h-[400px] overflow-y-auto">
                        {filteredScansB.map((scan) => (
                          <button
                            key={scan.id}
                            onClick={() => setSelectedB(scan.id)}
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border last:border-b-0",
                              selectedB === scan.id
                                ? "bg-primary/5 border-l-2 border-l-primary"
                                : "hover:bg-muted/50",
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{displayUrl(scan.url)}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-muted-foreground">{getRelativeTime(scan.scanned_at)}</span>
                                <span className="text-xs text-muted-foreground">·</span>
                                <span className={cn(
                                  "text-xs font-medium",
                                  scan.findings_count === 0 ? "text-emerald-500" : "text-foreground"
                                )}>
                                  {scan.findings_count} issues
                                </span>
                              </div>
                            </div>
                            {selectedB === scan.id && (
                              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
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
              {/* Back button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDiffResult(null)
                  setSelectedA(null)
                  setSelectedB(null)
                }}
                className="self-start -ml-2 text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4 rotate-180 mr-1" />
                Back to selection
              </Button>

              {/* Comparison header */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] divide-y md:divide-y-0 md:divide-x divide-border">
                  {/* Before */}
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground uppercase">Base</span>
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{getRelativeTime(diffResult.scanA.scanned_at)}</span>
                    </div>
                    <p className="text-sm font-medium truncate mb-1">{displayUrl(diffResult.scanA.url)}</p>
                    <div className="flex items-center gap-3">
                      <span className="text-3xl font-bold tabular-nums">{diffResult.scanA.findings_count}</span>
                      <span className="text-sm text-muted-foreground">issues</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{formatDate(diffResult.scanA.scanned_at)} at {formatTime(diffResult.scanA.scanned_at)}</p>
                  </div>

                  {/* Arrow / Change indicator */}
                  <div className="flex items-center justify-center p-4 bg-muted/30">
                    <div className="flex flex-col items-center gap-1">
                      <ArrowRight className="h-5 w-5 text-muted-foreground md:block hidden" />
                      {(() => {
                        const delta = diffResult.scanB.findings_count - diffResult.scanA.findings_count
                        if (delta < 0) {
                          return (
                            <div className="flex items-center gap-1 text-emerald-500">
                              <TrendingDown className="h-4 w-4" />
                              <span className="text-sm font-semibold">{Math.abs(delta)}</span>
                            </div>
                          )
                        } else if (delta > 0) {
                          return (
                            <div className="flex items-center gap-1 text-destructive">
                              <TrendingUp className="h-4 w-4" />
                              <span className="text-sm font-semibold">+{delta}</span>
                            </div>
                          )
                        } else {
                          return (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Equal className="h-4 w-4" />
                              <span className="text-sm font-semibold">0</span>
                            </div>
                          )
                        }
                      })()}
                    </div>
                  </div>

                  {/* After */}
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary uppercase">Compare</span>
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{getRelativeTime(diffResult.scanB.scanned_at)}</span>
                    </div>
                    <p className="text-sm font-medium truncate mb-1">{displayUrl(diffResult.scanB.url)}</p>
                    <div className="flex items-center gap-3">
                      <span className="text-3xl font-bold tabular-nums">{diffResult.scanB.findings_count}</span>
                      <span className="text-sm text-muted-foreground">issues</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{formatDate(diffResult.scanB.scanned_at)} at {formatTime(diffResult.scanB.scanned_at)}</p>
                  </div>
                </div>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl border border-border bg-card p-5 flex flex-col items-center gap-2">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-destructive/10">
                    <Plus className="h-5 w-5 text-destructive" />
                  </div>
                  <span className="text-3xl font-bold tabular-nums text-destructive">{diffResult.diff.summary.added}</span>
                  <span className="text-sm text-muted-foreground">New Issues</span>
                </div>
                <div className="rounded-xl border border-border bg-card p-5 flex flex-col items-center gap-2">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10">
                    <Minus className="h-5 w-5 text-emerald-500" />
                  </div>
                  <span className="text-3xl font-bold tabular-nums text-emerald-500">{diffResult.diff.summary.removed}</span>
                  <span className="text-sm text-muted-foreground">Fixed</span>
                </div>
                <div className="rounded-xl border border-border bg-card p-5 flex flex-col items-center gap-2">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-muted">
                    <Equal className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <span className="text-3xl font-bold tabular-nums">{diffResult.diff.summary.unchanged}</span>
                  <span className="text-sm text-muted-foreground">Unchanged</span>
                </div>
              </div>

              {/* Clean comparison message */}
              {diffResult.diff.summary.added === 0 && diffResult.diff.summary.removed === 0 && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10">
                    <Shield className="h-6 w-6 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-emerald-500">No Changes Detected</p>
                    <p className="text-sm text-muted-foreground">The security state is identical between these two scans.</p>
                  </div>
                </div>
              )}

              {/* Detailed lists */}
              {diffResult.diff.added.length > 0 && (
                <div className="rounded-xl border border-destructive/20 bg-card overflow-hidden">
                  <div className="px-5 py-4 border-b border-border bg-destructive/5">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <span className="font-semibold text-destructive">New Issues</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">{diffResult.diff.added.length}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Issues that appeared in the newer scan</p>
                  </div>
                  <div className="divide-y divide-border">
                    {diffResult.diff.added.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                        <span className={cn("w-2 h-2 rounded-full shrink-0", severityColors[f.severity])} />
                        <span className="flex-1 text-sm">{f.title}</span>
                        <span className={cn("text-xs font-medium uppercase", severityTextColors[f.severity])}>{f.severity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diffResult.diff.removed.length > 0 && (
                <div className="rounded-xl border border-emerald-500/20 bg-card overflow-hidden">
                  <div className="px-5 py-4 border-b border-border bg-emerald-500/5">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <span className="font-semibold text-emerald-500">Fixed Issues</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500">{diffResult.diff.removed.length}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Issues that were resolved since the base scan</p>
                  </div>
                  <div className="divide-y divide-border">
                    {diffResult.diff.removed.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                        <span className={cn("w-2 h-2 rounded-full shrink-0 opacity-50", severityColors[f.severity])} />
                        <span className="flex-1 text-sm line-through opacity-60">{f.title}</span>
                        <span className="text-xs font-medium uppercase text-muted-foreground">{f.severity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diffResult.diff.unchanged.length > 0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="px-5 py-4 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Equal className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">Unchanged Issues</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">{diffResult.diff.unchanged.length}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Issues present in both scans</p>
                  </div>
                  <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
                    {diffResult.diff.unchanged.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                        <span className={cn("w-2 h-2 rounded-full shrink-0", severityColors[f.severity])} />
                        <span className="flex-1 text-sm text-muted-foreground">{f.title}</span>
                        <span className="text-xs font-medium uppercase text-muted-foreground/70">{f.severity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
