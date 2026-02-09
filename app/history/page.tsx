"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Clock,
  Globe,
  Trash2,
  Search,
  ExternalLink,
  ChevronRight,
  Loader2,
  RotateCcw,
  ArrowLeft,
  Tag,
  Plus,
  X,
  List,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { ScanSummary } from "@/components/scanner/scan-summary"
import { ResultsList } from "@/components/scanner/results-list"
import { IssueDetail } from "@/components/scanner/issue-detail"
import { ExportButton } from "@/components/scanner/export-button"
import { ShareButton } from "@/components/scanner/share-button"
import type { ScanResult, Vulnerability } from "@/lib/scanner/types"
import { cn } from "@/lib/utils"

interface ScanRecord {
  id: number
  url: string
  summary: {
    critical?: number
    high?: number
    medium?: number
    low?: number
    info?: number
    total?: number
  }
  findings_count: number
  duration: number
  scanned_at: string
  source?: string
  tags?: string[]
}

function SeverityDot({ severity, count }: { severity: string; count: number }) {
  if (count === 0) return null
  const colors: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-yellow-500",
    low: "bg-blue-500",
    info: "bg-muted-foreground/50",
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className={cn("w-1.5 h-1.5 rounded-full", colors[severity] || "bg-muted-foreground")} />
      {count}
    </span>
  )
}

export default function HistoryPage() {
  const router = useRouter()
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [filter, setFilter] = useState("")

  const [selectedScanId, setSelectedScanId] = useState<number | null>(null)
  const [scanDetail, setScanDetail] = useState<ScanResult | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [allTags, setAllTags] = useState<string[]>([])
  const [addingTagFor, setAddingTagFor] = useState<number | null>(null)
  const [newTag, setNewTag] = useState("")
  const [rescanning, setRescanning] = useState<number | null>(null)
  const [showBulkScan, setShowBulkScan] = useState(false)
  const [bulkUrls, setBulkUrls] = useState("")
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ total: number; successful: number; failed: number } | null>(null)

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/history")
      if (!res.ok) {
        router.push("/login")
        return
      }
      const data = await res.json()
      setScans(data.scans || [])
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchHistory()
    fetch("/api/scan/tags").then((r) => r.json()).then((d) => setAllTags(d.tags || [])).catch(() => {})
  }, [fetchHistory])

  async function handleAddTag(scanId: number, tag: string) {
    if (!tag.trim()) return
    const res = await fetch("/api/scan/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, tag: tag.trim() }),
    })
    if (res.ok) {
      const data = await res.json()
      setScans((prev) => prev.map((s) => s.id === scanId ? { ...s, tags: data.tags } : s))
      if (!allTags.includes(tag.trim().toLowerCase())) setAllTags((prev) => [...prev, tag.trim().toLowerCase()].sort())
    }
    setAddingTagFor(null)
    setNewTag("")
  }

  async function handleRemoveTag(scanId: number, tag: string) {
    const res = await fetch("/api/scan/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, tag, action: "remove" }),
    })
    if (res.ok) {
      const data = await res.json()
      setScans((prev) => prev.map((s) => s.id === scanId ? { ...s, tags: data.tags } : s))
    }
  }

  async function handleRescan(scan: ScanRecord) {
    setRescanning(scan.id)
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scan.url }),
      })
      if (res.ok) {
        await fetchHistory()
      }
    } catch { /* ignore */ }
    setRescanning(null)
  }

  async function handleBulkScan() {
    const urls = bulkUrls.split("\n").map((u) => u.trim()).filter((u) => u.length > 0)
    if (urls.length === 0) return
    setBulkLoading(true)
    setBulkResult(null)
    try {
      const res = await fetch("/api/scan/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      })
      const data = await res.json()
      if (res.ok) {
        setBulkResult({ total: data.total, successful: data.successful, failed: data.failed })
        await fetchHistory()
      }
    } catch { /* ignore */ }
    setBulkLoading(false)
  }

  async function handleViewScan(scan: ScanRecord) {
    setSelectedScanId(scan.id)
    setDetailLoading(true)
    setScanDetail(null)
    setSelectedIssue(null)

    try {
      const res = await fetch(`/api/history/${scan.id}`)
      if (res.ok) {
        const data = await res.json()
        setScanDetail(data)
      }
    } catch {
      // silently fail
    } finally {
      setDetailLoading(false)
    }
  }

  function handleBackToList() {
    setSelectedScanId(null)
    setScanDetail(null)
    setSelectedIssue(null)
  }

  async function handleClearHistory() {
    if (!confirm("Are you sure you want to clear all scan history? This cannot be undone.")) return
    setClearing(true)
    try {
      await fetch("/api/history", { method: "DELETE" })
      setScans([])
    } catch {
      // silently fail
    } finally {
      setClearing(false)
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  function getHostname(url: string) {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }

  const filtered = scans.filter((s) => {
    const matchesUrl = !filter.trim() || s.url.toLowerCase().includes(filter.toLowerCase())
    const matchesTag = !tagFilter || (s.tags && s.tags.includes(tagFilter))
    return matchesUrl && matchesTag
  })

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 sm:py-8 flex flex-col gap-6">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading history...</p>
          </div>
        ) : selectedScanId !== null ? (
          /* ── DETAIL VIEW ──────────────────────────── */
          <>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <button
                type="button"
                onClick={handleBackToList}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to History
              </button>
              {!detailLoading && scanDetail && !selectedIssue && (
                <div className="flex items-center gap-2">
                  <ExportButton result={scanDetail} />
                  <ShareButton scanId={selectedScanId!} />
                </div>
              )}
            </div>

            {detailLoading && (
              <div className="flex flex-col items-center gap-3 py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading scan details...</p>
              </div>
            )}

            {!detailLoading && scanDetail && (
              <div className="flex flex-col gap-6">
                {selectedIssue ? (
                  <IssueDetail
                    issue={selectedIssue}
                    onBack={() => setSelectedIssue(null)}
                  />
                ) : (
                  <>
                    <ScanSummary result={scanDetail} />

                    {scanDetail.findings.length > 0 ? (
                      <ResultsList
                        findings={scanDetail.findings}
                        onSelectIssue={setSelectedIssue}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 py-8 text-center rounded-xl border border-dashed border-border">
                        <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                          <Globe className="h-5 w-5 text-emerald-500" />
                        </div>
                        <p className="text-sm font-medium text-foreground">No issues found</p>
                        <p className="text-xs text-muted-foreground max-w-xs">
                          This scan came back clean with no detected vulnerabilities.
                        </p>
                      </div>
                    )}


                  </>
                )}
              </div>
            )}

            {!detailLoading && !scanDetail && (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <p className="text-sm text-muted-foreground">
                  Could not load scan details. The data may no longer be available.
                </p>
                <Button variant="outline" onClick={handleBackToList} className="bg-transparent">
                  Back to History
                </Button>
              </div>
            )}
          </>
        ) : (
          /* ── LIST VIEW ────────────────────────────── */
          <>
            {/* Page header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Scan History
                </h1>
                <p className="text-sm text-muted-foreground">
                  Click any scan to view full results. History kept for 90 days.
                </p>
              </div>
              {scans.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearHistory}
                  disabled={clearing}
                  className="text-destructive hover:text-destructive shrink-0 bg-transparent self-start sm:self-auto"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  {clearing ? "Clearing..." : "Clear All"}
                </Button>
              )}
            </div>

            {/* Search + Bulk Scan + Tag filter */}
            {scans.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter by URL..."
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      className="pl-9 bg-card h-10"
                    />
                  </div>
                  <Button variant="outline" size="sm" className="bg-transparent h-10 gap-1.5" onClick={() => setShowBulkScan(!showBulkScan)}>
                    <List className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Bulk Scan</span>
                  </Button>
                </div>
                {allTags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Tag className="h-3 w-3 text-muted-foreground" />
                    <button
                      type="button"
                      onClick={() => setTagFilter(null)}
                      className={cn(
                        "text-[11px] px-2 py-0.5 rounded-full border transition-colors",
                        !tagFilter ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-border hover:border-primary/20"
                      )}
                    >
                      All
                    </button>
                    {allTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                        className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full border transition-colors",
                          tagFilter === tag ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-border hover:border-primary/20"
                        )}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
                {showBulkScan && (
                  <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">Bulk Scan (max 10 URLs)</p>
                      <button type="button" onClick={() => { setShowBulkScan(false); setBulkResult(null) }} className="text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <textarea
                      placeholder={"https://example.com\nhttps://another-site.com\nhttps://third-site.com"}
                      value={bulkUrls}
                      onChange={(e) => setBulkUrls(e.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono"
                    />
                    <div className="flex items-center gap-3">
                      <Button size="sm" onClick={handleBulkScan} disabled={bulkLoading || !bulkUrls.trim()}>
                        {bulkLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Scanning...</> : "Start Bulk Scan"}
                      </Button>
                      {bulkResult && (
                        <p className="text-xs text-muted-foreground">
                          {bulkResult.successful}/{bulkResult.total} scanned successfully{bulkResult.failed > 0 && `, ${bulkResult.failed} failed`}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Empty state */}
            {scans.length === 0 && (
              <div className="flex flex-col items-center gap-4 py-16 text-center rounded-xl border border-dashed border-border">
                <Clock className="h-10 w-10 text-muted-foreground/20" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-foreground">No scan history yet</p>
                  <p className="text-xs text-muted-foreground">
                    Scans you run will appear here automatically.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => router.push("/")} className="bg-transparent">
                  Run Your First Scan
                </Button>
              </div>
            )}

            {/* Filtered empty */}
            {scans.length > 0 && filtered.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-center rounded-xl border border-dashed border-border">
                <Search className="h-6 w-6 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">
                  No scans match &quot;{filter}&quot;
                </p>
              </div>
            )}

            {/* Scan list */}
            <div className="flex flex-col gap-2">
              {filtered.map((scan) => (
                <div
                  key={scan.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleViewScan(scan)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleViewScan(scan) }}
                  className="group flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-border bg-card hover:bg-muted/50 hover:border-primary/20 transition-all text-left active:scale-[0.99] cursor-pointer"
                >
                  <div className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-primary/10 shrink-0">
                    <Globe className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {getHostname(scan.url)}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider shrink-0 border",
                          scan.source === "api"
                            ? "bg-primary/10 text-primary border-primary/20"
                            : "bg-muted text-muted-foreground border-border"
                        )}
                      >
                        {scan.source === "api" ? "API" : "Web"}
                      </span>
                      <a
                        href={scan.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(scan.scanned_at)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {(scan.duration / 1000).toFixed(1)}s
                      </span>
                      {scan.tags && scan.tags.length > 0 && scan.tags.map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                          <Tag className="h-2.5 w-2.5" />{tag}
                          <button type="button" className="ml-0.5 hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleRemoveTag(scan.id, tag) }}>
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                      {addingTagFor === scan.id ? (
                        <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleAddTag(scan.id, newTag); if (e.key === "Escape") { setAddingTagFor(null); setNewTag("") } }}
                            placeholder="tag name"
                            className="w-20 text-[10px] px-1.5 py-0.5 rounded-full border border-primary/30 bg-background text-foreground focus:outline-none"
                            autoFocus
                          />
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-dashed border-border text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors"
                          onClick={(e) => { e.stopPropagation(); setAddingTagFor(scan.id); setNewTag("") }}
                        >
                          <Plus className="h-2.5 w-2.5" />tag
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Severity dots - desktop */}
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <SeverityDot severity="critical" count={scan.summary?.critical || 0} />
                    <SeverityDot severity="high" count={scan.summary?.high || 0} />
                    <SeverityDot severity="medium" count={scan.summary?.medium || 0} />
                    <SeverityDot severity="low" count={scan.summary?.low || 0} />
                    <SeverityDot severity="info" count={scan.summary?.info || 0} />
                  </div>

                  <span
                    className={cn(
                      "inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium shrink-0 border",
                      scan.findings_count === 0
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : "bg-muted text-muted-foreground border-border",
                    )}
                  >
                    {scan.findings_count === 0 ? "Clean" : `${scan.findings_count} issues`}
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); handleRescan(scan) }}
                    disabled={rescanning === scan.id}
                    title="Rescan this URL"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", rescanning === scan.id && "animate-spin")} />
                  </Button>

                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
                </div>
              ))}
            </div>

            {/* Summary */}
            {scans.length > 0 && (
              <p className="text-xs text-muted-foreground text-center">
                Showing {filtered.length} of {scans.length} scan{scans.length === 1 ? "" : "s"}
              </p>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}
