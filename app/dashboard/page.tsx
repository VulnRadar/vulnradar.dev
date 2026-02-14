"use client"

import { useState, useCallback } from "react"
import { Header } from "@/components/scanner/header"
import { ScanForm } from "@/components/scanner/scan-form"
import { ScanningIndicator } from "@/components/scanner/scanning-indicator"
import { ScanSummary } from "@/components/scanner/scan-summary"
import { ResultsList } from "@/components/scanner/results-list"
import { IssueDetail } from "@/components/scanner/issue-detail"
import { ExportButton } from "@/components/scanner/export-button"
import { ShareButton } from "@/components/scanner/share-button"
import { Dashboard } from "@/components/scanner/dashboard"
import { Footer } from "@/components/scanner/footer"
import { OnboardingTour } from "@/components/onboarding-tour"
import type { ScanResult, ScanStatus, Vulnerability } from "@/lib/scanner/types"
import { AlertCircle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function DashboardPage() {
  const [status, setStatus] = useState<ScanStatus>("idle")
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanHistoryId, setScanHistoryId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(null)

  const handleScan = useCallback(async (url: string) => {
    setStatus("scanning")
    setResult(null)
    setScanHistoryId(null)
    setError(null)
    setSelectedIssue(null)

    try {
      const response = await fetch("/api/scan", {
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
      setStatus("done")
    } catch {
      setError("Failed to connect to the scanner. Please check your connection and try again.")
      setStatus("failed")
    }
  }, [])

  function handleReset() {
    setStatus("idle")
    setResult(null)
    setScanHistoryId(null)
    setError(null)
    setSelectedIssue(null)
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

