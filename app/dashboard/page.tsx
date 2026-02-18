"use client"

import { useState, useCallback, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Header } from "@/components/scanner/header"
import { ScanForm, type ScanMode } from "@/components/scanner/scan-form"
import { ScanningIndicator } from "@/components/scanner/scanning-indicator"
import { ScanSummary } from "@/components/scanner/scan-summary"
import { ResultsList } from "@/components/scanner/results-list"
import { IssueDetail } from "@/components/scanner/issue-detail"
import { ExportButton } from "@/components/scanner/export-button"
import { ShareButton } from "@/components/scanner/share-button"
import { ResponseHeaders } from "@/components/scanner/response-headers"
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery"
import { CrawlUrlSelector } from "@/components/scanner/crawl-url-selector"
import { Dashboard } from "@/components/scanner/dashboard"
import { Footer } from "@/components/scanner/footer"
import { OnboardingTour } from "@/components/onboarding-tour"
import type { ScanResult, ScanStatus, Vulnerability } from "@/lib/scanner/types"
import { DEFAULT_SCAN_NOTE } from "@/lib/constants"
import { AlertCircle, RotateCcw, MessageSquare, Pencil, Save, Loader2 as Loader2Icon, Globe, ChevronDown, ChevronRight, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  )
}

function DashboardLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading dashboard...</p>
      </div>
    </div>
  )
}

function DashboardContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<ScanStatus>("idle")
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanHistoryId, setScanHistoryId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(null)
  const [scanNotes, setScanNotes] = useState("")
  const [editingNotes, setEditingNotes] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [crawlInfo, setCrawlInfo] = useState<CrawlInfo | null>(null)
  const [crawlDiscoveryUrls, setCrawlDiscoveryUrls] = useState<string[]>([])
  const [crawlDiscovering, setCrawlDiscovering] = useState(false)
  const [showCrawlSelector, setShowCrawlSelector] = useState(false)
  const [pendingCrawlUrl, setPendingCrawlUrl] = useState("")

  async function handleSaveNotes() {
    if (!scanHistoryId) return
    setSavingNotes(true)
    try {
      await fetch(`/api/history/${scanHistoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: scanNotes }),
      })
      setEditingNotes(false)
    } catch { /* ignore */ }
    setSavingNotes(false)
  }

  const handleScan = useCallback(async (url: string, mode: ScanMode = "quick") => {
    // Deep crawl: first discover URLs, then show selector
    if (mode === "deep") {
      setPendingCrawlUrl(url)
      setShowCrawlSelector(true)
      setCrawlDiscovering(true)
      setCrawlDiscoveryUrls([url]) // always include the entry URL

      try {
        const res = await fetch("/api/scan/crawl/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        })
        const data = await res.json()
        if (res.ok && data.urls) {
          setCrawlDiscoveryUrls(data.urls)
        }
      } catch { /* keep the entry URL at minimum */ }
      setCrawlDiscovering(false)
      return
    }

    // Quick scan (or crawl with pre-selected URLs)
    runScan(url)
  }, [])

  const runScan = useCallback(async (url: string, crawlUrls?: string[]) => {
    setStatus("scanning")
    setResult(null)
    setScanHistoryId(null)
    setError(null)
    setSelectedIssue(null)
    setScanNotes("")
    setEditingNotes(false)
    setCrawlInfo(null)

    const isCrawl = !!crawlUrls
    const endpoint = isCrawl ? "/api/scan/crawl" : "/api/scan"
    const payload = isCrawl ? { url, urls: crawlUrls } : { url }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "An unexpected error occurred.")
        setStatus("failed")
        return
      }

      // For deep crawl: show only the main URL's findings in the result view
      if (data.crawl && data.crawl.pages?.length > 0) {
        const mainPage = data.crawl.pages[0]
        setResult({
          ...data,
          findings: mainPage.findings,
          summary: mainPage.summary,
          duration: mainPage.duration,
        })
        setCrawlInfo(data.crawl)
      } else {
        setResult(data)
      }
      const historyId = data.scanHistoryId || null
      setScanHistoryId(historyId)
      setScanNotes(DEFAULT_SCAN_NOTE)
      setStatus("done")

      // Auto-save default note to DB
      if (historyId) {
        fetch(`/api/history/${historyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: DEFAULT_SCAN_NOTE }),
        }).catch(() => {})
      }
    } catch {
      setError("Failed to connect to the scanner. Please check your connection and try again.")
      setStatus("failed")
    }
  }, [])

  function handleCrawlConfirm(selectedUrls: string[]) {
    setShowCrawlSelector(false)
    setCrawlDiscoveryUrls([])
    runScan(pendingCrawlUrl, selectedUrls)
  }

  function handleCrawlCancel() {
    setShowCrawlSelector(false)
    setCrawlDiscoveryUrls([])
    setPendingCrawlUrl("")
    setCrawlDiscovering(false)
  }

  // Auto-scan if ?scan= param is present (e.g. from subdomain scan button on other pages)
  useEffect(() => {
    const scanUrl = searchParams.get("scan")
    if (scanUrl && status === "idle") {
      handleScan(scanUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function handleReset() {
    setStatus("idle")
    setResult(null)
    setScanHistoryId(null)
    setError(null)
    setSelectedIssue(null)
    setScanNotes("")
    setEditingNotes(false)
    setCrawlInfo(null)
    setShowCrawlSelector(false)
    setCrawlDiscoveryUrls([])
    setPendingCrawlUrl("")
    setCrawlDiscovering(false)
  }

  return (
  <div className="min-h-screen flex flex-col bg-background">
  <OnboardingTour />
  <Header />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 pb-12">
        {/* Scan form always visible at top */}
        {status !== "done" && <ScanForm onScan={handleScan} status={status} />}

        {/* Dashboard when idle */}
        {status === "idle" && <Dashboard />}

        {/* Scanning state */}
        {status === "scanning" && <ScanningIndicator />}

        {/* Error state */}
        {status === "failed" && error && (
          <div className="flex flex-col items-center gap-5 py-12">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <div className="flex flex-col items-center gap-2 text-center max-w-sm">
              <h2 className="text-base font-semibold text-foreground">Scan Failed</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{error}</p>
            </div>
            <Button variant="outline" onClick={handleReset} className="bg-transparent">
              <RotateCcw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </div>
        )}

        {/* Results */}
        {status === "done" && result && (
          <div className="flex flex-col gap-6 pt-6">
            {!selectedIssue ? (
              <>
                {/* Action buttons at top */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-1">Scanned URL</p>
                    <p className="text-sm font-medium text-foreground truncate">{result.url}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={handleReset} size="sm" className="bg-transparent">
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Scan Another URL
                    </Button>
                    <ExportButton result={result} />
                    {scanHistoryId && <ShareButton scanId={scanHistoryId} />}
                  </div>
                </div>

                {/* Scan summary */}
                <ScanSummary result={result} />

                {/* Deep crawl: other pages scanned */}
                {crawlInfo && crawlInfo.pages.length > 1 && (
                  <CrawlPagesInfo crawlInfo={crawlInfo} onSelectIssue={setSelectedIssue} />
                )}

                {/* Response headers */}
                {result.responseHeaders && (
                  <ResponseHeaders headers={result.responseHeaders} />
                )}

                {/* Subdomain discovery */}
                <SubdomainDiscovery url={result.url} onScanSubdomain={(subUrl) => handleScan(subUrl)} />

                {/* Notes */}
                {scanHistoryId && (
                  <div className="rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        <h3 className="text-sm font-medium text-foreground">Notes</h3>
                      </div>
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
                            onClick={() => setEditingNotes(false)}
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
                            {savingNotes ? <Loader2Icon className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            Save
                          </Button>
                        </div>
                      )}
                    </div>
                    {editingNotes ? (
                      <textarea
                        value={scanNotes}
                        onChange={(e) => setScanNotes(e.target.value)}
                        placeholder="Add notes about this scan... (e.g., 'Fixed CSP issue, re-scan next week')"
                        maxLength={2000}
                        className="w-full min-h-[80px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                      />
                    ) : scanNotes ? (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{scanNotes}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground/60 italic">{'No notes yet. Click "Add Note" to annotate this scan.'}</p>
                    )}
                  </div>
                )}

                {/* Results list */}
                <ResultsList findings={result.findings} onSelectIssue={setSelectedIssue} />
              </>
            ) : (
              <IssueDetail issue={selectedIssue} onBack={() => setSelectedIssue(null)} />
            )}
          </div>
        )}
      </main>

      <Footer />

      {/* Crawl URL selector modal */}
      {showCrawlSelector && (
        <CrawlUrlSelector
          urls={crawlDiscoveryUrls}
          isLoading={crawlDiscovering}
          onConfirm={handleCrawlConfirm}
          onCancel={handleCrawlCancel}
        />
      )}
    </div>
  )
}

interface CrawlPageData {
  url: string
  findings: Vulnerability[]
  findings_count: number
  summary: Record<string, number>
  duration: number
}

interface CrawlInfo {
  pagesDiscovered: number
  pagesScanned: number
  pages: CrawlPageData[]
}

function CrawlPagesInfo({ crawlInfo, onSelectIssue }: { crawlInfo: CrawlInfo; onSelectIssue: (issue: Vulnerability) => void }) {
  const [open, setOpen] = useState(false)
  const [expandedPage, setExpandedPage] = useState<string | null>(null)
  // Skip first page (already shown as main results)
  const otherPages = crawlInfo.pages.slice(1)
  const totalOtherIssues = otherPages.reduce((sum, p) => sum + p.findings_count, 0)

  function getPath(u: string) {
    try { return new URL(u).pathname + new URL(u).search || "/" } catch { return u }
  }

  const SEV_DOT: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-blue-500",
    info: "bg-muted-foreground/50",
  }
  const SEV_TEXT: Record<string, string> = {
    critical: "text-red-500 bg-red-500/10 border-red-500/20",
    high: "text-orange-500 bg-orange-500/10 border-orange-500/20",
    medium: "text-amber-500 bg-amber-500/10 border-amber-500/20",
    low: "text-blue-500 bg-blue-500/10 border-blue-500/20",
    info: "text-muted-foreground bg-muted border-border",
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header (matches subdomain discovery style) */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <Globe className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground flex-1">
          Also Crawled
        </span>
        <span className="text-xs text-muted-foreground">
          {otherPages.length} {otherPages.length === 1 ? "page" : "pages"} / {totalOtherIssues} issues
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-border">
          {/* Stats bar */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 bg-muted/30 border-b border-border">
            <span className="text-xs text-muted-foreground">
              Pages: <span className="font-medium text-foreground">{otherPages.length}</span>
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {totalOtherIssues} total issues
            </span>
            <span className="text-xs text-muted-foreground">
              {otherPages.filter(p => p.findings_count === 0).length} clean
            </span>
          </div>

          {/* Page rows */}
          <div className="px-4 py-3">
            <div className="flex flex-col gap-1">
              {otherPages.map((page) => {
                const path = getPath(page.url)
                const isExpanded = expandedPage === page.url

                return (
                  <div key={page.url}>
                    <div className="flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors group">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${page.findings_count > 0 ? "bg-amber-500" : "bg-emerald-500"}`} />
                      <button
                        type="button"
                        onClick={() => setExpandedPage(isExpanded ? null : page.url)}
                        className="text-[10px] sm:text-xs font-mono text-foreground truncate flex-1 text-left hover:text-primary transition-colors"
                      >
                        {path}
                      </button>
                      <span className={`text-[10px] font-mono shrink-0 ${page.findings_count > 0 ? "text-amber-500" : "text-emerald-500"}`}>
                        {page.findings_count}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline tabular-nums">
                        {(page.duration / 1000).toFixed(1)}s
                      </span>
                      <a
                        href={page.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary transition-opacity shrink-0"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 cursor-pointer" onClick={() => setExpandedPage(null)} />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0 cursor-pointer" onClick={() => setExpandedPage(page.url)} />
                      )}
                    </div>

                    {isExpanded && (
                      <div className="ml-4 pl-2 border-l-2 border-border/40 mt-1 mb-2">
                        {page.findings.length === 0 ? (
                          <p className="text-[10px] text-emerald-500/80 py-1.5 italic">No issues found.</p>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {page.findings.map((f) => (
                              <button
                                type="button"
                                key={`${page.url}-${f.id}`}
                                onClick={() => onSelectIssue(f)}
                                className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-muted/50 transition-colors text-left"
                              >
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEV_DOT[f.severity] || SEV_DOT.info}`} />
                                <span className="text-[10px] sm:text-xs text-foreground truncate flex-1">
                                  {f.title}
                                </span>
                                <span className={`text-[9px] sm:text-[10px] font-medium uppercase shrink-0 ${
                                  f.severity === "critical" ? "text-red-500" :
                                  f.severity === "high" ? "text-orange-500" :
                                  f.severity === "medium" ? "text-amber-500" :
                                  f.severity === "low" ? "text-blue-500" :
                                  "text-muted-foreground"
                                }`}>
                                  {f.severity}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

