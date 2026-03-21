"use client"
import { SEVERITY_LEVELS, API, BILLING_HISTORY_RETENTION } from "@/lib/constants"
import { useAuth } from "@/components/auth-provider"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Globe,
  Trash2,
  Search,
  ExternalLink,
  ChevronRight,
  Loader2,
  Clock,
  ArrowLeft,
  Tag,
  Plus,
  X,
  RefreshCw,
  MessageSquare,
  Save,
  Pencil,
  Filter,
  Terminal,
  Monitor,
  AlertTriangle,
  ShieldCheck,
  MoreHorizontal,
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
import { DeleteScanButton } from "@/components/scanner/delete-scan-button"
import { ResponseHeaders } from "@/components/scanner/response-headers"
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery"
import type { ScanResult, Vulnerability } from "@/lib/scanner/types"
import { cn } from "@/lib/utils"
import { PaginationControl, usePagination } from "@/components/ui/pagination-control"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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

function SeverityPill({ severity, count }: { severity: string; count: number }) {
  if (count === 0) return null
  const styles: Record<string, string> = {
    critical: "bg-red-500/10 text-red-500 border-red-500/20",
    high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    info: "bg-muted text-muted-foreground border-border",
  }
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border tabular-nums", styles[severity] || styles.info)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", {
        "bg-red-500": severity === "critical",
        "bg-orange-500": severity === "high",
        "bg-yellow-500": severity === "medium",
        "bg-blue-500": severity === "low",
        "bg-muted-foreground": severity === "info",
      })} />
      {count}
    </span>
  )
}

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
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

function HistoryPageContent() {
  const router = useRouter()
  const { me } = useAuth()
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [filter, setFilter] = useState("")

  // Staff/admin always get unlimited retention regardless of plan
  const isStaff = me?.role && ["admin", "moderator", "support"].includes(me.role)
  const userPlan = (me?.plan || "free") as keyof typeof BILLING_HISTORY_RETENTION
  const retentionDays = isStaff ? -1 : (BILLING_HISTORY_RETENTION[userPlan] ?? BILLING_HISTORY_RETENTION.free)

  const [selectedScanId, setSelectedScanId] = useState<number | null>(null)
  const [scanDetail, setScanDetail] = useState<ScanResult | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(null)
  const [scanOwnerId, setScanOwnerId] = useState<number | null>(null)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [allTags, setAllTags] = useState<string[]>([])
  const [addingTagFor, setAddingTagFor] = useState<number | null>(null)
  const [newTag, setNewTag] = useState("")
  const [rescanning, setRescanning] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [scanNotes, setScanNotes] = useState("")
  const [editingNotes, setEditingNotes] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)

  // Sync scan selection with URL hash
  const updateUrlWithScan = useCallback((id: number | null, replace = false) => {
    if (typeof window === "undefined") return
    const method = replace ? "replaceState" : "pushState"
    if (id) {
      window.history[method](null, "", `/history#${id}`)
    } else {
      window.history.replaceState(null, "", "/history")
    }
  }, [])

  // Parse hash and load scan
  const handleHashChange = useCallback(() => {
    if (typeof window === "undefined") return
    const hash = window.location.hash.replace("#", "")
    if (hash) {
      const id = parseInt(hash, 10)
      if (!isNaN(id)) {
        setSelectedScanId(id)
        loadScanDetail(id)
      } else {
        setSelectedScanId(null)
        setScanDetail(null)
      }
    } else {
      setSelectedScanId(null)
      setScanDetail(null)
    }
  }, [])

  useEffect(() => {
    handleHashChange()
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [handleHashChange])

  async function loadScanDetail(scanId: number) {
    setDetailLoading(true)
    try {
      const res = await fetch(`${API.HISTORY}/${scanId}`)
      if (!res.ok) {
        setSelectedScanId(null)
        return
      }
      const data = await res.json()
      setScanDetail({
        url: data.url,
        scannedAt: data.scannedAt,
        duration: data.duration,
        summary: data.summary,
        findings: data.findings,
        responseHeaders: data.responseHeaders,
      })
      setScanOwnerId(data.userId || null)
      setScanNotes(data.notes || "")
      setEditingNotes(false)
    } catch (err) {
      console.error("Failed to load scan:", err)
      setSelectedScanId(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleSaveNotes() {
    if (!selectedScanId) return
    setSavingNotes(true)
    try {
      const res = await fetch(`${API.HISTORY}/${selectedScanId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: scanNotes }),
      })
      if (res.ok) {
        setEditingNotes(false)
      }
    } catch {
      // silently fail
    } finally {
      setSavingNotes(false)
    }
  }

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(API.HISTORY)
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.push("/login")
        }
        return
      }
      const data = await res.json()
      setScans(Array.isArray(data.scans) ? data.scans : [])
    } catch {
      setScans([])
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchHistory()
    fetch(API.SCAN_TAGS).then((r) => r.json()).then((d) => setAllTags(d.tags || [])).catch(() => { })
    fetch(API.AUTH.ME).then((r) => r.json()).then((d) => setCurrentUserId(d.userId || null)).catch(() => { })
  }, [fetchHistory])

  async function handleAddTag(scanId: number, tag: string) {
    if (!tag.trim()) return
    const res = await fetch(API.SCAN_TAGS, {
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
    const res = await fetch(API.SCAN_TAGS, {
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
      const res = await fetch(API.SCAN, {
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

  async function handleViewScan(scan: ScanRecord) {
    setSelectedScanId(scan.id)
    setSelectedIssue(null)
    loadScanDetail(scan.id)
    updateUrlWithScan(scan.id)
  }

  function handleBackToList() {
    setSelectedScanId(null)
    setScanDetail(null)
    setSelectedIssue(null)
    updateUrlWithScan(null)
  }

  async function handleClearHistory() {
    if (!confirm("Are you sure you want to clear all scan history? This cannot be undone.")) return
    setClearing(true)
    try {
      await fetch(API.HISTORY, { method: "DELETE" })
      setScans([])
    } catch {
      // silently fail
    } finally {
      setClearing(false)
    }
  }

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

  const filtered = scans.filter((s) => {
    const matchesUrl = !filter.trim() || s.url.toLowerCase().includes(filter.toLowerCase())
    const matchesTag = !tagFilter || (s.tags && s.tags.includes(tagFilter))
    return matchesUrl && matchesTag
  })

  useEffect(() => { setCurrentPage(1) }, [filter, tagFilter])

  const PAGE_SIZE = pageSize
  const { totalPages, getPage } = usePagination(filtered, PAGE_SIZE)
  const paginatedScans = getPage(currentPage)

  // Calculate stats
  const totalScans = scans.length
  const cleanScans = scans.filter(s => s.findings_count === 0).length
  const issueScans = scans.filter(s => s.findings_count > 0).length
  const totalIssues = scans.reduce((acc, s) => acc + (s.findings_count || 0), 0)

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-6">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading history...</p>
          </div>
        ) : selectedScanId !== null ? (
          /* ── DETAIL VIEW ──────────────────────────── */
          <>
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
                    {/* Action buttons at top */}
                    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-border bg-card">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">Scanned URL</p>
                        <p className="text-sm font-medium text-foreground truncate">{scanDetail.url}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={handleBackToList} size="sm" className="bg-transparent">
                          <ArrowLeft className="mr-2 h-4 w-4" />
                          <span className="hidden sm:inline">Back to History</span>
                        </Button>
                        <ExportButton result={scanDetail} />
                        <ShareButton scanId={selectedScanId!} />
                        <DeleteScanButton 
                          scanId={selectedScanId!} 
                          isOwner={scanOwnerId === currentUserId}
                          onDeleted={() => {
                            setSelectedScanId(null)
                            setScanDetail(null)
                            fetchHistory()
                          }}
                        />
                      </div>
                    </div>

                    <ScanSummary result={scanDetail} />

                    {scanDetail.responseHeaders && Object.keys(scanDetail.responseHeaders).length > 0 && (
                      <ResponseHeaders headers={scanDetail.responseHeaders} />
                    )}

                    <SubdomainDiscovery url={scanDetail.url} />

                    {/* Scan Notes */}
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          <h3 className="text-sm font-medium text-foreground">Notes</h3>
                        </div>
                        {scanOwnerId === currentUserId && (
                          <>
                            {!editingNotes ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingNotes(true)}
                                className="h-7 text-xs gap-1.5 text-muted-foreground"
                              >
                                <Pencil className="h-3 w-3" />
                                {scanNotes ? "Edit" : "Add Note"}
                              </Button>
                            ) : (
                              <div className="flex gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => { setEditingNotes(false); setScanNotes(scanNotes) }}
                                  className="h-7 text-xs text-muted-foreground"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handleSaveNotes}
                                  disabled={savingNotes}
                                  className="h-7 text-xs gap-1.5 bg-transparent"
                                >
                                  {savingNotes ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                  Save
                                </Button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      {editingNotes && scanOwnerId === currentUserId ? (
                        <textarea
                          value={scanNotes}
                          onChange={(e) => setScanNotes(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          onKeyUp={(e) => e.stopPropagation()}
                          placeholder="Add notes about this scan..."
                          maxLength={2000}
                          className="w-full min-h-[80px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                        />
                      ) : scanNotes ? (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{scanNotes}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground/60 italic">
                          {scanOwnerId === currentUserId ? 'No notes yet. Click "Add Note" to annotate this scan.' : "No notes for this scan."}
                        </p>
                      )}
                    </div>

                    {scanDetail.findings.length > 0 ? (
                      <ResultsList
                        findings={scanDetail.findings}
                        onSelectIssue={setSelectedIssue}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 py-8 text-center rounded-xl border border-dashed border-border">
                        <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                          <ShieldCheck className="h-5 w-5 text-emerald-500" />
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
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Scan History</h1>
              <p className="text-sm text-muted-foreground">
                View and manage your previous scans. History kept for {retentionDays === -1 ? "unlimited time" : `${retentionDays} days`}.
              </p>
            </div>

            {/* Stats row */}
            {scans.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="flex flex-col gap-1 p-4 rounded-xl border border-border bg-card">
                  <span className="text-2xl font-semibold tabular-nums text-foreground">{totalScans}</span>
                  <span className="text-xs text-muted-foreground">Total Scans</span>
                </div>
                <div className="flex flex-col gap-1 p-4 rounded-xl border border-border bg-card">
                  <span className="text-2xl font-semibold tabular-nums text-emerald-500">{cleanScans}</span>
                  <span className="text-xs text-muted-foreground">Clean</span>
                </div>
                <div className="flex flex-col gap-1 p-4 rounded-xl border border-border bg-card">
                  <span className="text-2xl font-semibold tabular-nums text-amber-500">{issueScans}</span>
                  <span className="text-xs text-muted-foreground">With Issues</span>
                </div>
                <div className="flex flex-col gap-1 p-4 rounded-xl border border-border bg-card">
                  <span className="text-2xl font-semibold tabular-nums text-foreground">{totalIssues}</span>
                  <span className="text-xs text-muted-foreground">Total Issues</span>
                </div>
              </div>
            )}

            {/* Search + Filters + Actions */}
            {scans.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by URL..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="pl-9 bg-card h-10"
                  />
                </div>
                
                {allTags.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2 bg-transparent h-10 shrink-0">
                        <Filter className="h-4 w-4" />
                        {tagFilter ? tagFilter : "All Tags"}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setTagFilter(null)}>
                        All Tags
                      </DropdownMenuItem>
                      {allTags.map((tag) => (
                        <DropdownMenuItem key={tag} onClick={() => setTagFilter(tag)}>
                          {tag}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearHistory}
                  disabled={clearing}
                  className="text-destructive hover:text-destructive shrink-0 bg-transparent h-10"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {clearing ? "Clearing..." : "Clear All"}
                </Button>
              </div>
            )}

            {/* Empty state */}
            {scans.length === 0 && (
              <div className="flex flex-col items-center gap-4 py-16 text-center rounded-xl border border-dashed border-border bg-card/50">
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                  <Clock className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-foreground">No scan history yet</p>
                  <p className="text-xs text-muted-foreground">
                    Scans you run will appear here automatically.
                  </p>
                </div>
                <Button variant="outline" size="sm" className="bg-transparent" asChild>
                  <a href="/dashboard">Run Your First Scan</a>
                </Button>
              </div>
            )}

            {/* Filtered empty */}
            {scans.length > 0 && filtered.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-12 text-center rounded-xl border border-dashed border-border">
                <Search className="h-6 w-6 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  No scans match your search
                </p>
                <Button variant="ghost" size="sm" onClick={() => { setFilter(""); setTagFilter(null) }}>
                  Clear filters
                </Button>
              </div>
            )}

            {/* Scan list - Table style */}
            {paginatedScans.length > 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Table header */}
                <div className="hidden sm:grid sm:grid-cols-[1fr,auto,auto,auto,auto] gap-4 px-4 py-3 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>URL</span>
                  <span className="text-center w-20">Source</span>
                  <span className="text-center w-32">Issues</span>
                  <span className="text-right w-24">Scanned</span>
                  <span className="w-10"></span>
                </div>

                {/* Table rows */}
                <div className="divide-y divide-border">
                  {paginatedScans.map((scan) => (
                    <div
                      key={scan.id}
                      className="group flex flex-col sm:grid sm:grid-cols-[1fr,auto,auto,auto,auto] gap-2 sm:gap-4 p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => handleViewScan(scan)}
                    >
                      {/* URL + Tags */}
                      <div className="flex flex-col gap-1.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            {scan.source === "api" ? (
                              <Terminal className="h-4 w-4 text-primary" />
                            ) : (
                              <Monitor className="h-4 w-4 text-primary" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-medium text-foreground truncate block">
                              {getDomain(scan.url)}
                            </span>
                            <span className="text-xs text-muted-foreground truncate block">
                              {displayUrl(scan.url)}
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              window.open(scan.url, "_blank", "noopener,noreferrer")
                            }}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-opacity shrink-0"
                            title="Open in new tab"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        
                        {/* Tags row */}
                        <div className="flex flex-wrap items-center gap-1 ml-10">
                          {scan.tags && scan.tags.length > 0 && scan.tags.map((tag) => (
                            <span key={tag} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                              <Tag className="h-2.5 w-2.5" />{tag}
                              <button 
                                type="button" 
                                className="ml-0.5 hover:text-destructive" 
                                onClick={(e) => { e.stopPropagation(); handleRemoveTag(scan.id, tag) }}
                              >
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
                                onKeyDown={(e) => {
                                  e.stopPropagation()
                                  if (e.key === "Enter") { e.preventDefault(); handleAddTag(scan.id, newTag) }
                                  if (e.key === "Escape") { e.preventDefault(); setAddingTagFor(null); setNewTag("") }
                                }}
                                placeholder="tag"
                                className="w-16 text-[10px] px-1.5 py-0.5 rounded-md border border-primary/30 bg-background text-foreground focus:outline-none"
                                autoFocus
                              />
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                              onClick={(e) => { e.stopPropagation(); setAddingTagFor(scan.id); setNewTag("") }}
                            >
                              <Plus className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Source badge */}
                      <div className="hidden sm:flex items-center justify-center w-20">
                        <span className={cn(
                          "inline-flex items-center rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wider border",
                          scan.source === "api"
                            ? "bg-violet-500/10 text-violet-500 border-violet-500/20"
                            : "bg-cyan-500/10 text-cyan-500 border-cyan-500/20"
                        )}>
                          {scan.source === "api" ? "API" : "Web"}
                        </span>
                      </div>

                      {/* Severity pills */}
                      <div className="flex items-center justify-center gap-1 w-32">
                        {scan.findings_count === 0 ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                            <ShieldCheck className="h-3 w-3" />
                            Clean
                          </span>
                        ) : (
                          <div className="flex items-center gap-1 flex-wrap justify-center">
                            <SeverityPill severity={SEVERITY_LEVELS.CRITICAL} count={scan.summary?.critical || 0} />
                            <SeverityPill severity={SEVERITY_LEVELS.HIGH} count={scan.summary?.high || 0} />
                            <SeverityPill severity={SEVERITY_LEVELS.MEDIUM} count={scan.summary?.medium || 0} />
                            <SeverityPill severity={SEVERITY_LEVELS.LOW} count={scan.summary?.low || 0} />
                          </div>
                        )}
                      </div>

                      {/* Time */}
                      <div className="hidden sm:flex items-center justify-end w-24">
                        <span className="text-xs text-muted-foreground tabular-nums" title={formatDate(scan.scanned_at)}>
                          {formatRelativeTime(scan.scanned_at)}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="hidden sm:flex items-center justify-center w-10">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleViewScan(scan) }}>
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleRescan(scan) }}>
                              <RefreshCw className={cn("h-3.5 w-3.5 mr-2", rescanning === scan.id && "animate-spin")} />
                              Rescan
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); window.open(scan.url, "_blank") }}>
                              <ExternalLink className="h-3.5 w-3.5 mr-2" />
                              Open URL
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Mobile: meta row */}
                      <div className="flex sm:hidden items-center justify-between text-xs text-muted-foreground ml-10">
                        <span className={cn(
                          "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                          scan.source === "api" ? "bg-violet-500/10 text-violet-500" : "bg-cyan-500/10 text-cyan-500"
                        )}>
                          {scan.source === "api" ? "API" : "Web"}
                        </span>
                        <span>{formatRelativeTime(scan.scanned_at)}</span>
                        {scan.findings_count === 0 ? (
                          <span className="text-emerald-500">Clean</span>
                        ) : (
                          <span>{scan.findings_count} issues</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pagination */}
            {filtered.length > 0 && (
              <PaginationControl
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onPageSizeChange={(s) => { setPageSize(s); setCurrentPage(1) }}
                totalItems={filtered.length}
              />
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}

export default function HistoryPage() {
  return <HistoryPageContent />
}
