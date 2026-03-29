"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { ScanSummary } from "@/components/scanner/scan-summary"
import { ResultsList } from "@/components/scanner/results-list"
import { IssueDetail } from "@/components/scanner/issue-detail"
import { ResponseHeaders } from "@/components/scanner/response-headers"
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery"
import { PaginationControl, usePagination } from "@/components/ui/pagination-control"
import { API, BILLING_HISTORY_RETENTION } from "@/lib/config/constants"
import { useAuth } from "@/components/providers/auth-provider"
import type { ScanResult, Vulnerability } from "@/lib/scanner/types"

import {
  type ScanRecord,
  HistoryStats,
  HistoryFilters,
  HistoryScanList,
  HistoryEmptyState,
  HistoryDetailHeader,
  HistoryNotes,
} from "@/components/history"

export default function HistoryPage() {
  const router = useRouter()
  const { me } = useAuth()

  // List state
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [filter, setFilter] = useState("")
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [allTags, setAllTags] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [rescanning, setRescanning] = useState<number | null>(null)

  // Detail state
  const [selectedScanId, setSelectedScanId] = useState<number | null>(null)
  const [scanDetail, setScanDetail] = useState<ScanResult | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(null)
  const [scanOwnerId, setScanOwnerId] = useState<number | null>(null)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [scanNotes, setScanNotes] = useState("")

  // Retention info
  const isStaff = me?.role && ["admin", "moderator", "support"].includes(me.role)
  const userPlan = (me?.plan || "free") as keyof typeof BILLING_HISTORY_RETENTION
  const retentionDays = isStaff ? -1 : (BILLING_HISTORY_RETENTION[userPlan] ?? BILLING_HISTORY_RETENTION.free)

  // URL hash sync
  const updateUrlWithScan = useCallback((id: number | null, replace = false) => {
    if (typeof window === "undefined") return
    const method = replace ? "replaceState" : "pushState"
    if (id) {
      window.history[method](null, "", `/history#${id}`)
    } else {
      window.history.replaceState(null, "", "/history")
    }
  }, [])

  const loadScanDetail = useCallback(async (scanId: number) => {
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
    } catch {
      setSelectedScanId(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

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
  }, [loadScanDetail])

  useEffect(() => {
    handleHashChange()
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [handleHashChange])

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(API.HISTORY)
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) router.push("/login")
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
    fetch(API.SCAN_TAGS).then((r) => r.json()).then((d) => setAllTags(d.tags || [])).catch(() => {})
    fetch(API.AUTH.ME).then((r) => r.json()).then((d) => setCurrentUserId(d.userId || null)).catch(() => {})
  }, [fetchHistory])

  // Handlers
  const handleViewScan = (scan: ScanRecord) => {
    setSelectedScanId(scan.id)
    setSelectedIssue(null)
    loadScanDetail(scan.id)
    updateUrlWithScan(scan.id)
  }

  const handleBackToList = () => {
    setSelectedScanId(null)
    setScanDetail(null)
    setSelectedIssue(null)
    updateUrlWithScan(null)
  }

  const handleRescan = async (scan: ScanRecord) => {
    setRescanning(scan.id)
    try {
      const res = await fetch(API.SCAN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scan.url }),
      })
      if (res.ok) await fetchHistory()
    } catch {}
    setRescanning(null)
  }

  const handleClearHistory = async () => {
    if (!confirm("Are you sure you want to clear all scan history? This cannot be undone.")) return
    setClearing(true)
    try {
      await fetch(API.HISTORY, { method: "DELETE" })
      setScans([])
    } catch {}
    setClearing(false)
  }

  const handleAddTag = async (scanId: number, tag: string) => {
    if (!tag.trim()) return
    const res = await fetch(API.SCAN_TAGS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, tag: tag.trim() }),
    })
    if (res.ok) {
      const data = await res.json()
      setScans((prev) => prev.map((s) => s.id === scanId ? { ...s, tags: data.tags } : s))
      if (!allTags.includes(tag.trim().toLowerCase())) {
        setAllTags((prev) => [...prev, tag.trim().toLowerCase()].sort())
      }
    }
  }

  const handleRemoveTag = async (scanId: number, tag: string) => {
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

  const handleSaveNotes = async (notes: string) => {
    if (!selectedScanId) return
    const res = await fetch(`${API.HISTORY}/${selectedScanId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    })
    if (res.ok) setScanNotes(notes)
  }

  // Filtering & pagination
  const filtered = scans.filter((s) => {
    const matchesUrl = !filter.trim() || s.url.toLowerCase().includes(filter.toLowerCase())
    const matchesTag = !tagFilter || (s.tags && s.tags.includes(tagFilter))
    return matchesUrl && matchesTag
  })

  useEffect(() => { setCurrentPage(1) }, [filter, tagFilter])

  const { totalPages, getPage } = usePagination(filtered, pageSize)
  const paginatedScans = getPage(currentPage)

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 sm:py-8 flex flex-col gap-6">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading history...</p>
          </div>
        ) : selectedScanId !== null ? (
          /* Detail View */
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
                  <IssueDetail issue={selectedIssue} onBack={() => setSelectedIssue(null)} />
                ) : (
                  <>
                    <HistoryDetailHeader
                      scanDetail={scanDetail}
                      scanId={selectedScanId}
                      isOwner={scanOwnerId === currentUserId}
                      onBack={handleBackToList}
                      onDeleted={() => {
                        setSelectedScanId(null)
                        setScanDetail(null)
                        fetchHistory()
                      }}
                    />

                    <ScanSummary result={scanDetail} />

                    {scanDetail.responseHeaders && Object.keys(scanDetail.responseHeaders).length > 0 && (
                      <ResponseHeaders headers={scanDetail.responseHeaders} />
                    )}

                    <SubdomainDiscovery url={scanDetail.url} />

                    <HistoryNotes
                      notes={scanNotes}
                      isOwner={scanOwnerId === currentUserId}
                      onSave={handleSaveNotes}
                    />

                    {scanDetail.findings.length > 0 ? (
                      <ResultsList findings={scanDetail.findings} onSelectIssue={setSelectedIssue} />
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
          /* List View */
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">Scan History</h1>
              <p className="text-sm text-muted-foreground">
                View and manage your previous scans. History kept for {retentionDays === -1 ? "unlimited time" : `${retentionDays} days`}.
              </p>
            </div>

            <HistoryStats scans={scans} />

            {scans.length > 0 && (
              <HistoryFilters
                filter={filter}
                onFilterChange={setFilter}
                tagFilter={tagFilter}
                onTagFilterChange={setTagFilter}
                allTags={allTags}
                onClearHistory={handleClearHistory}
                clearing={clearing}
              />
            )}

            <HistoryEmptyState
              hasScans={scans.length > 0}
              hasFilters={Boolean(filter || tagFilter)}
              onClearFilters={() => { setFilter(""); setTagFilter(null) }}
            />

            {paginatedScans.length > 0 && (
              <HistoryScanList
                scans={paginatedScans}
                onViewScan={handleViewScan}
                onRescan={handleRescan}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
                rescanningScanId={rescanning}
              />
            )}

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
