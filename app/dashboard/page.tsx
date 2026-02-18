"use client"

import { useState, useCallback, useEffect } from "react"
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
import { Dashboard } from "@/components/scanner/dashboard"
import { Footer } from "@/components/scanner/footer"
import { OnboardingTour } from "@/components/onboarding-tour"
import type { ScanResult, ScanStatus, Vulnerability } from "@/lib/scanner/types"
import { AlertCircle, RotateCcw, MessageSquare, Pencil, Save, Loader2 as Loader2Icon, Globe, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function DashboardPage() {
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
    setStatus("scanning")
    setResult(null)
    setScanHistoryId(null)
    setError(null)
    setSelectedIssue(null)
    setScanNotes("")
    setEditingNotes(false)
    setCrawlInfo(null)

    const endpoint = mode === "deep" ? "/api/scan/crawl" : "/api/scan"

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "An unexpected error occurred.")
        setStatus("failed")
        return
      }

      setResult(data)
      setScanHistoryId(data.scanHistoryId || null)
      if (data.crawl) setCrawlInfo(data.crawl)
      setStatus("done")
    } catch {
      setError("Failed to connect to the scanner. Please check your connection and try again.")
      setStatus("failed")
    }
  }, [])

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

                {/* Deep crawl pages info */}
                {crawlInfo && (
                  <CrawlPagesInfo crawlInfo={crawlInfo} onSelectIssue={setSelectedIssue} />
                )}

                {/* Scan summary */}
                <ScanSummary result={result} />

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
  const [expandedPage, setExpandedPage] = useState<string | null>(null)

  function getPath(u: string) {
    try { return new URL(u).pathname + new URL(u).search || "/" } catch { return u }
  }

  return (
    <div className="rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
        <Globe className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium text-foreground flex-1">
          Deep Crawl -- {crawlInfo.pagesScanned} pages scanned
        </span>
      </div>

      <div className="divide-y divide-border/30">
        {crawlInfo.pages.map((page) => {
          const path = getPath(page.url)
          const isExpanded = expandedPage === page.url

          return (
            <div key={page.url}>
              <button
                type="button"
                onClick={() => setExpandedPage(isExpanded ? null : page.url)}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-muted/50 transition-colors"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${page.findings_count > 0 ? "bg-amber-500" : "bg-emerald-500"}`} />
                <span className="text-[10px] sm:text-xs font-mono text-foreground truncate flex-1 max-w-[180px] sm:max-w-none">
                  {path}
                </span>
                <span className={`text-[10px] sm:text-xs font-medium shrink-0 ${page.findings_count > 0 ? "text-amber-500" : "text-emerald-500"}`}>
                  {page.findings_count} issues
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">
                  {(page.duration / 1000).toFixed(1)}s
                </span>
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
              </button>

              {isExpanded && (
                <div className="bg-muted/20 px-4 py-2 border-t border-border/20">
                  {page.findings.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center italic">No issues found on this page.</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {page.findings.map((f) => (
                        <button
                          type="button"
                          key={`${page.url}-${f.id}`}
                          onClick={() => onSelectIssue(f)}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors text-left"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            f.severity === "critical" ? "bg-red-500" :
                            f.severity === "high" ? "bg-orange-500" :
                            f.severity === "medium" ? "bg-amber-500" :
                            f.severity === "low" ? "bg-blue-500" :
                            "bg-muted-foreground/50"
                          }`} />
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
  )
}

